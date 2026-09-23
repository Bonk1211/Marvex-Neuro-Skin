from dataclasses import dataclass
from math import atan2, cos, degrees, radians, sin

import numpy as np
from scipy.optimize import brentq, minimize_scalar

from app.config import DEFAULTS
from app.domain.optics import FacadeOptics
from app.domain.thermal import load_at_angle
from app.domain.types import ControllerWeights, LoadEstimate


@dataclass(frozen=True)
class OptimisationResult:
    angle: float
    breakdown: dict[str, float]
    total_cost: float
    current_cost: float


def daylight_transmittance(angle: float) -> float:
    shade_fraction = np.clip(angle / DEFAULTS.angle_max, 0.0, 1.0)
    return float(1.0 - 0.72 * shade_fraction)


def lux_at_angle(open_lux: float, angle: float) -> float:
    return float(max(20.0, open_lux * daylight_transmittance(angle)))


def lux_penalty(lux: float) -> float:
    if 300 <= lux <= 700:
        return 0.0
    if lux < 300:
        return float(min(1.0, (300 - lux) / 300))
    return float(min(1.0, (lux - 700) / 700))


def angle_cost_breakdown(
    angle: float,
    load: LoadEstimate,
    open_lux: float,
    current_angle: float,
    wind: float,
    weights: ControllerWeights,
    *,
    optics: FacadeOptics | None = None,
    glazing_shgc: float = DEFAULTS.glazing_shgc,
) -> dict[str, float]:
    normalized = weights.normalized()
    transmission = optics.solar_transmittance(angle) * glazing_shgc if optics else None
    thermal = min(1.0, load_at_angle(load, angle, transmittance=transmission))
    lux = (
        max(20.0, open_lux * optics.daylight_transmittance(angle))
        if optics
        else lux_at_angle(open_lux, angle)
    )
    movement = ((angle - current_angle) / DEFAULTS.angle_max) ** 2
    risk = min(1.0, (wind / DEFAULTS.critical_wind) ** 2 * (angle / DEFAULTS.angle_max))
    return {
        "thermal": normalized.thermal * thermal,
        "lux": normalized.lux * lux_penalty(lux),
        "movement": normalized.movement * movement,
        "risk": normalized.risk * risk,
    }


def optimise_angle(
    load: LoadEstimate,
    open_lux: float,
    current_angle: float,
    wind: float,
    weights: ControllerWeights,
    *,
    optics: FacadeOptics | None = None,
    incident: float = 0.0,
    glare_limit_w_m2: float = DEFAULTS.glare_limit_w_m2,
    glazing_shgc: float = DEFAULTS.glazing_shgc,
) -> OptimisationResult:
    def breakdown_at(angle: float) -> dict[str, float]:
        return angle_cost_breakdown(
            angle,
            load,
            open_lux,
            current_angle,
            wind,
            weights,
            optics=optics,
            glazing_shgc=glazing_shgc,
        )

    def cost(angle: float) -> float:
        return sum(breakdown_at(angle).values())

    def beam(angle: float) -> float:
        return incident * optics.beam_fraction * optics.beam_transmittance(angle) if optics else 0.0

    # The grid locates the global basin, not the available actuator positions.
    grid = sorted({*map(float, range(0, 61, 5)), current_angle})
    bounds = [(DEFAULTS.angle_min, DEFAULTS.angle_max)]
    if optics and incident * optics.beam_fraction > glare_limit_w_m2:
        elevation = radians(optics.solar_elevation)
        along_wall = cos(elevation) * cos(radians(optics.solar_azimuth - optics.wall_azimuth))
        # Include the optical peak so a narrow unsafe interval cannot hide
        # between two clear coarse samples.
        profile = max(0.0, min(60.0, degrees(atan2(sin(elevation), along_wall))))
        grid = sorted({*grid, profile})

        def excess(angle: float) -> float:
            return beam(angle) - glare_limit_w_m2 - 1e-8

        crossings = [
            brentq(excess, left, right)
            for left, right in zip(grid, grid[1:])
            if excess(left) * excess(right) < 0
        ]
        edges = sorted({DEFAULTS.angle_min, DEFAULTS.angle_max, *crossings})
        bounds = [
            (left, right)
            for left, right in zip(edges, edges[1:])
            if excess((left + right) / 2) <= 0
        ]
        if bounds and excess(current_angle) <= 0:
            # Never slew from one clear branch through a glaring gap to another.
            bounds = [pair for pair in bounds if pair[0] - 1e-7 <= current_angle <= pair[1] + 1e-7]
        elif bounds:
            bounds = [min(bounds, key=lambda pair: min(abs(current_angle - x) for x in pair))]
        if not bounds:
            # No clear pose exists: minimise direct exposure and report the
            # remaining risk, rather than claiming the comfort limit was met.
            angle = min(grid, key=lambda x: (beam(x), cost(x), abs(x - current_angle)))
            bounds = [(angle, angle)]

    ranked = [
        (cost(angle), angle, (left, right))
        for left, right in bounds
        for angle in sorted({left, right, *(x for x in grid if left <= x <= right)})
    ]
    total_cost, angle, (left, right) = min(ranked, key=lambda item: (item[0], item[1]))
    if right - left > 0.02:
        refined = minimize_scalar(
            cost,
            bounds=(max(left, angle - 5), min(right, angle + 5)),
            method="bounded",
            options={"xatol": 0.01, "maxiter": 24},
        )
        if refined.fun < total_cost:
            angle, total_cost = float(refined.x), float(refined.fun)
    breakdown = breakdown_at(angle)
    current_breakdown = breakdown_at(current_angle)
    return OptimisationResult(
        angle=angle,
        breakdown=breakdown,
        total_cost=float(total_cost),
        current_cost=float(sum(current_breakdown.values())),
    )


def naive_angle(measured_irradiance: float) -> float:
    return DEFAULTS.shaded_default if measured_irradiance >= 550 else DEFAULTS.retract_flat
