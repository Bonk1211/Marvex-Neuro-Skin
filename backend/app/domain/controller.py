from dataclasses import dataclass, replace
from math import isfinite

from app.config import DEFAULTS
from app.domain.brain import daylight_transmittance, lux_at_angle, naive_angle, optimise_angle
from app.domain.daylight.surrogate import at_angle
from app.domain.optics import FacadeOptics
from app.domain.safety import movement_budget, safety_gate
from app.domain.solar import sun_position
from app.domain.thermal import load_at_angle, predict_load, shade_transmittance
from app.domain.types import (
    ComfortState,
    ControlInput,
    ControllerWeights,
    Decision,
    Environment,
    Site,
    SolarState,
    WallGain,
    ZoneSensors,
)
from app.domain.validation import expected_irradiance, validate

# Work-plane daylight per W/m2 of plane-of-array gain. Scaled so a wall in full
# tropical sun lands near the top of the 300-700 lux band, keeping the same
# working scale as the horizontal proxy in the environment model. This is a
# glazing-and-geometry constant: re-tune it against a real lux meter.
WALL_LUX_PER_IRRADIANCE = 1.7


def wall_open_lux(gain: WallGain) -> float:
    """Daylight available behind one wall before its louvres act."""

    return max(20.0, gain.incident * WALL_LUX_PER_IRRADIANCE)


@dataclass(frozen=True)
class TickResult:
    decision: Decision
    clear_sky_ghi: float
    solar_azimuth: float
    solar_elevation: float
    expected_ghi: float
    load_relative: float
    latent_load: float
    lux: float
    naive_angle: float
    naive_load_relative: float
    naive_lux: float
    conditions: ComfortState
    control_input: ControlInput


def run_tick(
    env: Environment,
    current_angle: float,
    weights: ControllerWeights,
    *,
    power_ok: bool = True,
    movement_threshold: float = DEFAULTS.movement_threshold,
    site: Site | None = None,
    solar: SolarState | None = None,
    gain: WallGain | None = None,
    local_sensors: ZoneSensors | None = None,
    optics: FacadeOptics | None = None,
    glare_limit_w_m2: float = DEFAULTS.glare_limit_w_m2,
    glazing_shgc: float = DEFAULTS.glazing_shgc,
    actuator_speed_deg_per_min: float = DEFAULTS.actuator_speed_deg_per_min,
    vision_cloud: float | None = None,
    daylight_curves: tuple | None = None,
) -> TickResult:
    if vision_cloud is not None:
        env = replace(env, cloud=vision_cloud)
    if solar is None:
        solar = (
            sun_position(env.t, site.latitude, site.longitude, site.timezone)
            if site is not None
            else sun_position(env.t)
        )
    expected = expected_irradiance(env, solar)
    incident = env.ghi if gain is None else gain.incident
    irradiance_source = daylight_source = "model"
    if local_sensors is None:
        trusted, trust_reason = validate(env, solar)
        effective_irradiance = env.measured_irradiance if trusted else expected
        available_lux = env.indoor_lux if gain is None else wall_open_lux(gain)
        open_lux = available_lux
        if not trusted and env.ghi > 1:
            open_lux *= effective_irradiance / env.ghi
    else:
        # These sensors face this zone, not the horizontal pyranometer. Zero is
        # valid shade; range checks cannot diagnose an in-range stuck sensor.
        trusted = (
            isfinite(local_sensors.irradiance)
            and 0 <= local_sensors.irradiance <= 1600
            and isfinite(local_sensors.illuminance)
            and 0 <= local_sensors.illuminance <= 10000
        )
        source = "Simulated" if local_sensors.source == "simulated" else "Injected"
        trust_reason = f"{source} local sensor pair {local_sensors.sensor_id}: "
        if trusted:
            incident = local_sensors.irradiance
            irradiance_source = "sensor"
            trust_reason += "range checks passed; this zone uses its own irradiance and lux."
            transmission = (
                optics.daylight_transmittance(current_angle)
                if optics
                else daylight_transmittance(current_angle)
            )
            if transmission > 1e-6:
                available_lux = local_sensors.illuminance / transmission
                daylight_source = "sensor"
            else:
                available_lux = env.indoor_lux if gain is None else wall_open_lux(gain)
                trust_reason += " Closed beam path cannot reveal open lux; use modelled daylight."
        else:
            available_lux = env.indoor_lux if gain is None else wall_open_lux(gain)
            trust_reason += "out-of-range reading; use this zone's modelled incident and daylight."
        open_lux = available_lux
    control_input = ControlInput(incident, open_lux, irradiance_source, daylight_source)
    if vision_cloud is not None:
        trust_reason = f"AI vision sky estimate {vision_cloud:.0%}. {trust_reason}"
    load = predict_load(replace(env, ghi=incident), solar)

    def conditions_at(angle: float, *, observe: bool = False) -> ComfortState:
        transmission = optics.solar_transmittance(angle) if optics else shade_transmittance(angle)
        lux = (
            max(20.0, open_lux * optics.daylight_transmittance(angle))
            if optics
            else lux_at_angle(open_lux, angle)
        )
        transmitted = incident * transmission
        direct = (
            incident * optics.beam_fraction * optics.beam_transmittance(angle) if optics else 0.0
        )
        probes = (
            tuple(
                {
                    "index": index,
                    "kind": kind,
                    "task_illuminance": at_angle(curves[0], angle) if curves is not None else None,
                    "eye_illuminance": (
                        at_angle(curves[1], angle)
                        if curves is not None and kind == "seat"
                        else None
                    ),
                }
                for index, kind, curves in daylight_curves
            )
            if observe and daylight_curves is not None
            else None
        )
        task = [p["task_illuminance"] for p in probes or () if p["task_illuminance"] is not None]
        eye = [p["eye_illuminance"] for p in probes or () if p["eye_illuminance"] is not None]
        return ComfortState(
            task_illuminance=sum(task) / len(task) if task else None,
            eye_illuminance=max(eye) if eye else None,
            daylight_probes=probes,
            daylight_status="low"
            if round(lux, 1) < 300
            else "high"
            if round(lux, 1) > 700
            else "useful",
            transmitted=transmitted,
            solar_heat_gain=transmitted * glazing_shgc,
            direct_sun=direct,
            glare_risk=direct > glare_limit_w_m2 + 1e-6,
            glare_limit_w_m2=glare_limit_w_m2,
            glazing_shgc=glazing_shgc,
        )

    def lux_at(angle: float, available: float = open_lux) -> float:
        return (
            max(20.0, available * optics.daylight_transmittance(angle))
            if optics
            else lux_at_angle(available, angle)
        )

    def load_at(angle: float) -> float:
        transmission = optics.solar_transmittance(angle) * glazing_shgc if optics else None
        return load_at_angle(load, angle, transmittance=transmission)

    # The naive baseline is a dumb sensor-threshold controller, but it stands on
    # the same wall: comparing its daylight against a different plane would make
    # the contest meaningless.
    baseline_angle = naive_angle(env.measured_irradiance)
    baseline_load = load_at(baseline_angle)
    baseline_lux = lux_at(baseline_angle, available_lux)

    gate = safety_gate(env, power_ok)
    if gate:
        mode, angle, safety_reason = gate
        conditions = conditions_at(angle, observe=True)
        if conditions.glare_risk:
            safety_reason += " Mechanical safety overrides the direct-sun screen; exposure remains."
        decision = Decision(
            mode=mode,
            sensor_trusted=trusted,
            angle_target=angle,
            angle_final=angle,
            moved=angle != current_angle,
            reason=f"{safety_reason} {trust_reason}",
        )
        return TickResult(
            decision=decision,
            clear_sky_ghi=solar.clear_sky_ghi,
            solar_azimuth=solar.azimuth,
            solar_elevation=solar.elevation,
            expected_ghi=expected,
            load_relative=load_at(angle),
            latent_load=load.latent,
            lux=lux_at(angle),
            naive_angle=baseline_angle,
            naive_load_relative=baseline_load,
            naive_lux=baseline_lux,
            conditions=conditions,
            control_input=control_input,
        )

    night_park = solar.elevation <= 0
    result = (
        None
        if night_park
        else optimise_angle(
            load,
            open_lux,
            current_angle,
            env.wind,
            weights,
            optics=optics,
            incident=incident,
            glare_limit_w_m2=glare_limit_w_m2,
            glazing_shgc=glazing_shgc,
        )
    )
    target_angle = 0.0 if result is None else result.angle
    desired_angle = target_angle
    if result is not None:
        desired_angle, _moved = movement_budget(
            result.angle,
            current_angle,
            result.current_cost - result.total_cost,
            threshold=movement_threshold,
        )
    current_conditions = conditions_at(current_angle)
    target_conditions = conditions_at(target_angle)
    glare_improvement = (
        current_conditions.glare_risk
        and target_conditions.direct_sun < current_conditions.direct_sun - 1e-6
    )
    if glare_improvement:
        desired_angle = target_angle
    travel = actuator_speed_deg_per_min * DEFAULTS.tick_minutes
    final_angle = max(current_angle - travel, min(current_angle + travel, desired_angle))
    if abs(final_angle - current_angle) < 1e-8:
        final_angle = current_angle
    moved = final_angle != current_angle
    conditions = conditions_at(final_angle, observe=True)
    if night_park:
        mode = "NORMAL" if moved else "HOLD"
        movement_reason = "Sun below the horizon; park the louvres at 0 degrees."
        if moved and final_angle != target_angle:
            movement_reason += " Parking travel remains rate-limited."
    elif moved:
        mode = "NORMAL"
        movement_reason = (
            "Direct-sun exposure reduction overrides the comfort movement budget."
            if glare_improvement
            else "The expected benefit clears the movement budget."
        )
        if abs(final_angle - target_angle) > 0.1:
            movement_reason += " Actuator travel is rate-limited while approaching the target."
    elif target_angle != current_angle:
        mode = "HOLD"
        movement_reason = "The target improvement is too small to justify mechanical movement."
    else:
        mode = "HOLD"
        movement_reason = "The current angle remains the lowest-cost allowable position."
    if conditions.glare_risk:
        movement_reason += " Direct-sun exposure remains above the screening limit."
    decision = Decision(
        mode=mode,
        sensor_trusted=trusted,
        angle_target=target_angle,
        angle_final=final_angle,
        moved=moved,
        reason=f"{trust_reason} {movement_reason}",
        cost_breakdown=result.breakdown if result is not None else {},
    )
    return TickResult(
        decision=decision,
        clear_sky_ghi=solar.clear_sky_ghi,
        solar_azimuth=solar.azimuth,
        solar_elevation=solar.elevation,
        expected_ghi=expected,
        load_relative=load_at(final_angle),
        latent_load=load.latent,
        lux=lux_at(final_angle),
        naive_angle=baseline_angle,
        naive_load_relative=baseline_load,
        naive_lux=baseline_lux,
        conditions=conditions,
        control_input=control_input,
    )
