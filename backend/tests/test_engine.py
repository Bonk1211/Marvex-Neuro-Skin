from dataclasses import replace
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.config import DEFAULTS, TICK_COUNT
from app.domain.brain import optimise_angle
from app.domain.controller import run_tick
from app.domain.environment import generate_day, inject_sensor_fault
from app.domain.optics import FacadeOptics
from app.domain.safety import movement_budget, safety_gate
from app.domain.solar import sun_position
from app.domain.thermal import load_at_angle, predict_load
from app.domain.types import (
    ControllerWeights,
    EnvironmentAnchor,
    LoadEstimate,
    SolarState,
    WallGain,
    ZoneSensors,
)
from app.domain.validation import validate


def test_solar_is_dark_at_midnight_and_peaks_during_day() -> None:
    tz = ZoneInfo(DEFAULTS.timezone)
    midnight = sun_position(datetime(2026, 3, 21, 0, 0, tzinfo=tz))
    noon = sun_position(datetime(2026, 3, 21, 13, 0, tzinfo=tz))
    assert midnight.elevation <= 0
    assert midnight.clear_sky_ghi == 0
    assert noon.elevation > 60
    assert noon.clear_sky_ghi > 700


def test_day_generation_is_seeded_and_contains_diffuse_cloud_events() -> None:
    first = generate_day(date(2026, 3, 21), seed=42)
    second = generate_day(date(2026, 3, 21), seed=42)
    assert len(first) == TICK_COUNT
    assert [tick.cloud for tick in first] == [tick.cloud for tick in second]
    assert max(tick.cloud for tick in first) > 0.5
    assert max(tick.diffuse_fraction for tick in first) >= 0.8


def test_weather_anchor_preserves_seeded_ticks_and_applies_daily_bounds() -> None:
    anchor = EnvironmentAnchor(
        min_temp=25,
        max_temp=34,
        morning_cloud=0.12,
        afternoon_cloud=0.86,
        night_cloud=0.72,
        morning_rain=False,
        afternoon_rain=True,
        night_rain=True,
    )
    first = generate_day(date(2026, 8, 11), seed=7, weather_anchor=anchor)
    second = generate_day(date(2026, 8, 11), seed=7, weather_anchor=anchor)

    assert first == second
    assert min(tick.outdoor_temp for tick in first) == pytest.approx(25)
    assert max(tick.outdoor_temp for tick in first) == pytest.approx(34)
    morning_cloud = [tick.cloud for tick in first if 6 <= tick.t.hour < 12]
    afternoon_cloud = [tick.cloud for tick in first if 12 <= tick.t.hour < 18]
    assert sum(afternoon_cloud) / len(afternoon_cloud) > sum(morning_cloud) / len(morning_cloud)


def test_dead_sensor_is_rejected_under_clear_sky_but_cloud_gate_is_trusted() -> None:
    env = generate_day(date(2026, 3, 21), cloud_profile="clear")[30]
    solar = sun_position(env.t)
    fault = inject_sensor_fault(replace(env, cloud=0.05), "dead_pyranometer")
    trusted, reason = validate(fault, solar)
    assert trusted is False
    assert "failed pyranometer" in reason

    clouded = replace(fault, cloud=0.94, measured_irradiance=8.0)
    trusted, reason = validate(clouded, solar)
    assert trusted is True
    assert "cloud-gating" in reason


def test_latent_floor_remains_under_full_shading() -> None:
    env = generate_day(date(2026, 3, 21))[30]
    load = predict_load(env, sun_position(env.t))
    shaded = load_at_angle(load, 60)
    assert shaded >= load.latent
    assert load.latent > 0


def test_optimizer_weights_change_selected_angle_and_cost_sums() -> None:
    load = LoadEstimate(total=0.9, shadeable=0.65, latent=0.25)
    daylight = optimise_angle(
        load, 420, 0, 2, ControllerWeights(thermal=0.05, lux=0.9, movement=0.05, risk=0)
    )
    thermal = optimise_angle(
        load, 900, 0, 2, ControllerWeights(thermal=0.9, lux=0.05, movement=0.05, risk=0)
    )
    assert daylight.angle < thermal.angle
    assert sum(thermal.breakdown.values()) == pytest.approx(thermal.total_cost)


def test_safety_precedence_and_movement_budget() -> None:
    env = generate_day(date(2026, 3, 21))[30]
    assert safety_gate(env, False)[:2] == ("SAFE", DEFAULTS.shaded_default)
    windy = replace(env, wind=DEFAULTS.critical_wind)
    assert safety_gate(windy, True)[:2] == ("SAFE", DEFAULTS.retract_flat)
    assert movement_budget(5, 0, 0.001, threshold=0.025) == (0, False)
    assert movement_budget(30, 0, 0.5) == (30, True)
    assert movement_budget(0.05, 0, 0.5) == (0, False)
    assert movement_budget(0.4, 0, 0.001) == (0.4, True)


def test_local_sensors_are_independent_of_roof_faults_but_share_safety() -> None:
    env = generate_day(date(2026, 3, 21), cloud_profile="clear")[54]
    solar = sun_position(env.t)
    fault = replace(env, measured_irradiance=0, cloud=0.05, rain=False)
    assert validate(fault, solar)[0] is False
    gain = WallGain("west", 270, 400, 90, 20, 40)
    sensors = ZoneSensors("W2", 900, 1200, "override")
    kwargs = {"solar": solar, "gain": gain, "local_sensors": sensors}
    normal = run_tick(fault, 0, ControllerWeights(), **kwargs)
    assert normal.decision.sensor_trusted is True
    assert normal.decision.angle_final > 0
    assert normal.control_input.irradiance == 900
    assert normal.control_input.open_lux == 1200
    assert normal.control_input.irradiance_source == "sensor"
    assert normal.control_input.daylight_source == "sensor"
    # Zero on the facade is legitimate local shade, not a roof-sensor fault.
    dark = run_tick(
        fault,
        0,
        ControllerWeights(),
        **{**kwargs, "local_sensors": replace(sensors, irradiance=0, illuminance=0)},
    )
    assert dark.decision.sensor_trusted is True
    assert dark.decision.angle_final == 0
    measured = run_tick(
        fault,
        30,
        ControllerWeights(),
        **{**kwargs, "local_sensors": replace(sensors, illuminance=320)},
    )
    # 320 measured lux at 30 degrees means 500 lux with the blades open.
    assert measured.lux == pytest.approx(
        max(20, 500 * (1 - 0.72 * measured.decision.angle_final / 60))
    )
    assert measured.control_input.open_lux == pytest.approx(500)
    invalid = run_tick(
        fault,
        0,
        ControllerWeights(),
        **{**kwargs, "local_sensors": replace(sensors, irradiance=float("nan"))},
    )
    assert invalid.decision.sensor_trusted is False
    assert 0 <= invalid.decision.angle_final <= 60
    assert invalid.control_input.irradiance == gain.incident
    assert invalid.control_input.open_lux == pytest.approx(680)
    assert invalid.control_input.irradiance_source == "model"
    assert invalid.control_input.daylight_source == "model"
    closed = run_tick(fault, 0, ControllerWeights(), optics=FacadeOptics(1, 45, 270, 270), **kwargs)
    assert closed.decision.sensor_trusted
    assert closed.control_input.irradiance == sensors.irradiance
    assert closed.control_input.irradiance_source == "sensor"
    assert closed.control_input.daylight_source == "model"
    assert closed.control_input.open_lux == pytest.approx(680)
    observed = run_tick(
        fault,
        0,
        ControllerWeights(),
        daylight_curves=((0, "seat", ([400] * 61, [800] * 61)),),
        **kwargs,
    )
    assert replace(observed, conditions=normal.conditions) == normal
    for safe_env, powered, angle in [
        (fault, False, 60),
        (replace(fault, wind=DEFAULTS.critical_wind), True, 0),
        (replace(fault, rain=True), True, 0),
    ]:
        result = run_tick(safe_env, 30, ControllerWeights(), power_ok=powered, **kwargs)
        assert result.decision.mode == "SAFE"
        assert result.decision.angle_final == angle
        assert result.control_input == replace(normal.control_input, open_lux=1875)


def test_glare_constraint_moves_gradually_despite_useful_lux_and_high_movement_budget() -> None:
    env = replace(generate_day(date(2026, 3, 21))[54], rain=False, wind=3)
    weights = ControllerWeights(thermal=0, lux=0.8, movement=0.2, risk=0)
    kwargs = {
        "solar": SolarState(270, 45, 1000),
        "gain": WallGain("west", 270, 500, 0, 0, 30),
        "local_sensors": ZoneSensors("W2", 500, 500),
        "movement_threshold": 10,
        "actuator_speed_deg_per_min": 0.1,
    }
    diffuse = run_tick(env, 45, weights, optics=FacadeOptics(0, 45, 270, 270), **kwargs)
    optics = FacadeOptics(1, 45, 270, 270)
    beam = run_tick(env, 45, weights, optics=optics, **kwargs)
    assert diffuse.decision.angle_final == 45 and not diffuse.conditions.glare_risk
    assert beam.decision.angle_target < 30
    assert beam.decision.angle_target != round(beam.decision.angle_target)
    assert beam.decision.angle_final == 44
    assert beam.conditions.daylight_status == "useful"
    assert beam.conditions.glare_risk
    assert beam.conditions.direct_sun == pytest.approx(500 * optics.beam_transmittance(44))
    assert beam.conditions.direct_sun <= beam.conditions.transmitted
    assert beam.conditions.solar_heat_gain == pytest.approx(beam.conditions.transmitted * 0.4)
    assert 500 * optics.beam_transmittance(beam.decision.angle_target) <= 25 + 1e-6
    current = beam.decision.angle_final
    open_lux = 500 / optics.daylight_transmittance(45)
    for _ in range(4):
        kwargs["local_sensors"] = ZoneSensors(
            "W2", 500, open_lux * optics.daylight_transmittance(current)
        )
        result = run_tick(env, current, weights, optics=optics, **kwargs)
        assert 0 < current - result.decision.angle_final <= 1
        current = result.decision.angle_final


def test_tracking_does_not_slew_between_clear_branches_through_a_glare_peak() -> None:
    env = replace(generate_day(date(2026, 3, 21))[54], rain=False, wind=3)
    optics = FacadeOptics(1, 30, 270, 270)
    result = run_tick(
        env,
        60,
        ControllerWeights(thermal=0, lux=0, movement=0, risk=1),
        solar=SolarState(270, 30, 1000),
        gain=WallGain("west", 270, 500, 0, 0, 30),
        optics=optics,
        glare_limit_w_m2=200,
    )
    assert result.decision.angle_target > 30
    assert not result.conditions.glare_risk
    for index in range(21):
        angle = 60 + (result.decision.angle_final - 60) * index / 20
        assert 500 * optics.beam_transmittance(angle) <= 200 + 1e-6


def test_unsatisfiable_glare_screen_reports_residual_risk_with_rate_limited_travel() -> None:
    env = replace(generate_day(date(2026, 3, 21))[54], rain=False, wind=3)
    optics = FacadeOptics(1, 30, 270, 270)
    assert min(500 * optics.beam_transmittance(angle) for angle in range(61)) > 25
    result = run_tick(
        env,
        30,
        ControllerWeights(),
        solar=SolarState(270, 30, 1000),
        gain=WallGain("west", 270, 500, 0, 0, 30),
        local_sensors=ZoneSensors("W2", 500, 500),
        optics=optics,
        movement_threshold=10,
        actuator_speed_deg_per_min=1.2,
    )
    assert result.decision.mode == "NORMAL"
    assert 0 < abs(result.decision.angle_final - 30) <= 12
    assert 500 * optics.beam_transmittance(result.decision.angle_target) > 25
    assert result.conditions.glare_risk
    assert result.conditions.direct_sun == pytest.approx(
        500 * optics.beam_transmittance(result.decision.angle_final)
    )
    assert "remains above the screening limit" in result.decision.reason


def test_glazing_affects_the_thermal_target_without_shading_internal_load() -> None:
    load = LoadEstimate(total=0.9, shadeable=0.6, latent=0.2, internal=0.1)
    weights = ControllerWeights(thermal=0.9, lux=0, movement=0.1, risk=0)
    kwargs = {
        "optics": FacadeOptics(1, 45, 270, 270),
        "incident": 500,
        "glare_limit_w_m2": 2000,
    }
    insulated = optimise_angle(load, 500, 45, 3, weights, glazing_shgc=0, **kwargs)
    admitting = optimise_angle(load, 500, 45, 3, weights, glazing_shgc=1, **kwargs)
    assert insulated.angle == 45
    assert admitting.angle < 35
    assert load_at_angle(load, 60, transmittance=0) == pytest.approx(0.3)


def test_optical_safety_bypasses_slew_and_reports_remaining_exposure() -> None:
    env = replace(generate_day(date(2026, 3, 21))[54], rain=False, wind=3)
    kwargs = {
        "solar": SolarState(270, 5, 1000),
        "gain": WallGain("west", 270, 500, 0, 0, 30),
        "optics": FacadeOptics(1, 5, 270, 270),
        "actuator_speed_deg_per_min": 0.1,
    }
    for safe_env, power, angle in [
        (replace(env, wind=20), True, 0),
        (replace(env, rain=True), True, 0),
        (env, False, 60),
    ]:
        result = run_tick(safe_env, 30, ControllerWeights(), power_ok=power, **kwargs)
        assert result.decision.mode == "SAFE"
        assert result.decision.angle_final == angle
        if angle == 0:
            assert result.conditions.glare_risk
            assert "exposure remains" in result.decision.reason


def test_night_parking_remains_rate_limited_and_yields_to_hard_safety() -> None:
    # The simulated day stops at 19:00, before sunset here, so park the clock
    # past sunset explicitly rather than reading a dark tick out of the day.
    env = replace(
        generate_day(date(2026, 3, 21))[-1],
        t=datetime(2026, 3, 21, 20, 0, tzinfo=ZoneInfo(DEFAULTS.timezone)),
        rain=False,
        wind=3,
    )
    current = 60.0
    for expected in [48, 36, 24, 12, 0]:
        result = run_tick(
            env,
            current,
            ControllerWeights(),
            movement_threshold=10,
            actuator_speed_deg_per_min=1.2,
        )
        assert result.decision.angle_target == 0
        assert result.decision.angle_final == expected
        assert "park" in result.decision.reason
        current = result.decision.angle_final
    result = run_tick(env, 0, ControllerWeights(), power_ok=False)
    assert result.decision.mode == "SAFE" and result.decision.angle_final == 60


@pytest.mark.parametrize(
    "measured,status",
    [
        (299.96, "useful"),
        (700.04, "useful"),
        (299.9, "low"),
        (700.1, "high"),
    ],
)
def test_daylight_status_agrees_with_displayed_lux_precision(measured, status) -> None:
    env = replace(generate_day(date(2026, 3, 21))[54], rain=False, wind=3)
    result = run_tick(
        env,
        0,
        ControllerWeights(),
        local_sensors=ZoneSensors("W2", 0, measured),
        movement_threshold=10,
    )
    assert result.decision.angle_final == 0
    assert result.conditions.daylight_status == status
