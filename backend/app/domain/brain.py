from dataclasses import dataclass

import numpy as np

from app.config import DEFAULTS
from app.domain.thermal import load_at_angle
from app.domain.types import ControllerWeights, LoadEstimate


@dataclass(frozen=True)
class OptimisationResult:
    angle: float
    breakdown: dict[str, float]
    total_cost: float
    current_cost: float


def lux_at_angle(open_lux: float, angle: float) -> float:
    shade_fraction = np.clip(angle / DEFAULTS.angle_max, 0.0, 1.0)
    return float(max(20.0, open_lux * (1.0 - 0.72 * shade_fraction)))


def lux_penalty(lux: float) -> float:
    if 300 <= lux <= 700:
        return 0.0
    if lux < 300:
        return float(min(1.0, (300 - lux) / 300))
    return float(min(1.0, (lux - 700) / 700))


def _breakdown(
    angle: float,
    load: LoadEstimate,
    open_lux: float,
    current_angle: float,
    wind: float,
    weights: ControllerWeights,
) -> dict[str, float]:
    normalized = weights.normalized()
    thermal = min(1.0, load_at_angle(load, angle))
    movement = abs(angle - current_angle) / DEFAULTS.angle_max
    risk = min(1.0, (wind / DEFAULTS.critical_wind) ** 2 * (angle / DEFAULTS.angle_max))
    return {
        "thermal": normalized.thermal * thermal,
        "lux": normalized.lux * lux_penalty(lux_at_angle(open_lux, angle)) ** 2,
        "movement": normalized.movement * movement,
        "risk": normalized.risk * risk,
    }


def optimise_angle(
    load: LoadEstimate,
    open_lux: float,
    current_angle: float,
    wind: float,
    weights: ControllerWeights,
) -> OptimisationResult:
    candidates = np.arange(
        DEFAULTS.angle_min,
        DEFAULTS.angle_max + DEFAULTS.angle_step,
        DEFAULTS.angle_step,
    )
    ranked: list[tuple[float, float, dict[str, float]]] = []
    for angle in candidates:
        breakdown = _breakdown(float(angle), load, open_lux, current_angle, wind, weights)
        ranked.append((sum(breakdown.values()), float(angle), breakdown))
    total_cost, angle, breakdown = min(ranked, key=lambda item: (item[0], item[1]))
    current_breakdown = _breakdown(current_angle, load, open_lux, current_angle, wind, weights)
    return OptimisationResult(
        angle=angle,
        breakdown=breakdown,
        total_cost=float(total_cost),
        current_cost=float(sum(current_breakdown.values())),
    )


def naive_angle(measured_irradiance: float) -> float:
    return DEFAULTS.shaded_default if measured_irradiance >= 550 else DEFAULTS.retract_flat
