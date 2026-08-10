from dataclasses import replace
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.config import DEFAULTS
from app.domain.brain import optimise_angle
from app.domain.environment import generate_day, inject_sensor_fault
from app.domain.safety import movement_budget, safety_gate
from app.domain.solar import sun_position
from app.domain.thermal import load_at_angle, predict_load
from app.domain.types import ControllerWeights, LoadEstimate
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
    assert len(first) == 144
    assert [tick.cloud for tick in first] == [tick.cloud for tick in second]
    assert max(tick.cloud for tick in first) > 0.5
    assert max(tick.diffuse_fraction for tick in first) >= 0.8


def test_dead_sensor_is_rejected_under_clear_sky_but_cloud_gate_is_trusted() -> None:
    env = generate_day(date(2026, 3, 21), cloud_profile="clear")[72]
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
    env = generate_day(date(2026, 3, 21))[72]
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
    env = generate_day(date(2026, 3, 21))[72]
    assert safety_gate(env, False)[:2] == ("SAFE", DEFAULTS.shaded_default)
    windy = replace(env, wind=DEFAULTS.critical_wind)
    assert safety_gate(windy, True)[:2] == ("SAFE", DEFAULTS.retract_flat)
    assert movement_budget(5, 0, 0.001) == (0, False)
    assert movement_budget(30, 0, 0.5) == (30, True)
