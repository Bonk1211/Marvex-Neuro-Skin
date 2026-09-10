from app.config import DEFAULTS
from app.domain.types import Environment


def safety_gate(env: Environment, power_ok: bool) -> tuple[str, float, str] | None:
    if not power_ok:
        return (
            "SAFE",
            DEFAULTS.shaded_default,
            "Power loss detected; fail-safe mechanics settle the facade at the shaded default.",
        )
    if env.wind >= DEFAULTS.critical_wind:
        return (
            "SAFE",
            DEFAULTS.retract_flat,
            "Critical wind overrides optimisation; actively retract flat to protect the facade.",
        )
    if env.rain:
        return (
            "SAFE",
            DEFAULTS.retract_flat,
            "Rain override is active; retract flat while power remains available.",
        )
    return None


def movement_budget(
    target: float,
    current: float,
    predicted_gain: float,
    *,
    threshold: float = DEFAULTS.movement_threshold,
) -> tuple[float, bool]:
    if abs(target - current) < 0.1 or predicted_gain < threshold:
        return current, False
    return target, True
