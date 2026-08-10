from dataclasses import dataclass

from app.config import DEFAULTS
from app.domain.brain import lux_at_angle, naive_angle, optimise_angle
from app.domain.safety import movement_budget, safety_gate
from app.domain.solar import sun_position
from app.domain.thermal import load_at_angle, predict_load
from app.domain.types import ControllerWeights, Decision, Environment
from app.domain.validation import expected_irradiance, validate


@dataclass(frozen=True)
class TickResult:
    decision: Decision
    clear_sky_ghi: float
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
) -> TickResult:
    solar = sun_position(env.t)
    trusted, trust_reason = validate(env, solar)
    expected = expected_irradiance(env, solar)
    effective_irradiance = env.measured_irradiance if trusted else expected
    open_lux = env.indoor_lux
    if not trusted and env.ghi > 1:
        open_lux *= effective_irradiance / env.ghi
    load = predict_load(env, solar)
    baseline_angle = naive_angle(env.measured_irradiance)
    baseline_load = load_at_angle(load, baseline_angle)
    baseline_lux = lux_at_angle(env.indoor_lux, baseline_angle)

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
        expected_ghi=expected,
        load_relative=load_at_angle(load, final_angle),
        latent_load=load.latent,
        lux=lux_at_angle(open_lux, final_angle),
        naive_angle=baseline_angle,
        naive_load_relative=baseline_load,
        naive_lux=baseline_lux,
    )
