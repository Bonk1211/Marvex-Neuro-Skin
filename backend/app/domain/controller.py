from dataclasses import dataclass, replace

from app.config import DEFAULTS
from app.domain.brain import lux_at_angle, naive_angle, optimise_angle
from app.domain.safety import movement_budget, safety_gate
from app.domain.solar import sun_position
from app.domain.thermal import load_at_angle, predict_load
from app.domain.types import (
    ControllerWeights,
    Decision,
    Environment,
    Site,
    SolarState,
    WallGain,
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
) -> TickResult:
    if solar is None:
        solar = (
            sun_position(env.t, site.latitude, site.longitude, site.timezone)
            if site is not None
            else sun_position(env.t)
        )
    trusted, trust_reason = validate(env, solar)
    expected = expected_irradiance(env, solar)
    effective_irradiance = env.measured_irradiance if trusted else expected
    # Sensor trust stays a building-level judgement on the horizontal pyranometer.
    # Only the angle optimisation is orientation-aware: a wall is shaded for the
    # sun that actually strikes it, not for the sun on a flat roof.
    available_lux = env.indoor_lux if gain is None else wall_open_lux(gain)
    open_lux = available_lux
    if not trusted and env.ghi > 1:
        open_lux *= effective_irradiance / env.ghi
    load = predict_load(env if gain is None else replace(env, ghi=gain.incident), solar)
    # The naive baseline is a dumb sensor-threshold controller, but it stands on
    # the same wall: comparing its daylight against a different plane would make
    # the contest meaningless.
    baseline_angle = naive_angle(env.measured_irradiance)
    baseline_load = load_at_angle(load, baseline_angle)
    baseline_lux = lux_at_angle(available_lux, baseline_angle)

    gate = safety_gate(env, power_ok)
    if gate:
        mode, angle, safety_reason = gate
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
            load_relative=load_at_angle(load, angle),
            latent_load=load.latent,
            lux=lux_at_angle(open_lux, angle),
            naive_angle=baseline_angle,
            naive_load_relative=baseline_load,
            naive_lux=baseline_lux,
        )

    result = optimise_angle(load, open_lux, current_angle, env.wind, weights)
    final_angle, moved = movement_budget(
        result.angle,
        current_angle,
        result.current_cost - result.total_cost,
        threshold=movement_threshold,
    )
    if moved:
        mode = "NORMAL"
        movement_reason = "The expected benefit clears the movement budget."
    elif result.angle != current_angle:
        mode = "HOLD"
        movement_reason = "The target improvement is too small to justify mechanical movement."
    else:
        mode = "HOLD"
        movement_reason = "The current angle remains the lowest-cost allowable position."
    decision = Decision(
        mode=mode,
        sensor_trusted=trusted,
        angle_target=result.angle,
        angle_final=final_angle,
        moved=moved,
        reason=f"{trust_reason} {movement_reason}",
        cost_breakdown=result.breakdown,
    )
    return TickResult(
        decision=decision,
        clear_sky_ghi=solar.clear_sky_ghi,
        solar_azimuth=solar.azimuth,
        solar_elevation=solar.elevation,
        expected_ghi=expected,
        load_relative=load_at_angle(load, final_angle),
        latent_load=load.latent,
        lux=lux_at_angle(open_lux, final_angle),
        naive_angle=baseline_angle,
        naive_load_relative=baseline_load,
        naive_lux=baseline_lux,
    )
