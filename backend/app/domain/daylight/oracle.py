"""Diffuse-patch radiosity in an empty illustrative box with one glazed wall.

The glazing at z=0 is a full-wall, non-reflecting aperture. Boundary flux is
already transmitted through the louvres. No furniture, spectral glass model or
measured geometry is implied. View factors use centre-to-centre quadrature.
"""

from math import cos, isfinite, pi, radians, sin

import numpy as np

from app.config import DEFAULTS
from app.domain.daylight.room import Probe, RoomGeometry


def _patches(room: RoomGeometry) -> tuple[np.ndarray, ...]:
    count = DEFAULTS.daylight_patch_divisions
    centres, normals, areas, reflectances = [], [], [], []
    dimensions = (room.width, room.height, room.depth)
    for axis in range(3):
        other = [i for i in range(3) if i != axis]
        area = dimensions[other[0]] * dimensions[other[1]] / count**2
        for side in (0, 1):
            normal = [0.0, 0.0, 0.0]
            normal[axis] = 1.0 if side == 0 else -1.0
            rho = (
                (room.floor_reflectance if side == 0 else room.ceiling_reflectance)
                if axis == 1
                else room.wall_reflectance
            )
            if axis == 2 and side == 0:
                rho = 0.0
            for a in range(count):
                for b in range(count):
                    point = [0.0, 0.0, 0.0]
                    point[axis] = side * dimensions[axis]
                    point[other[0]] = (a + 0.5) * dimensions[other[0]] / count
                    point[other[1]] = (b + 0.5) * dimensions[other[1]] / count
                    centres.append(point)
                    normals.append(normal)
                    areas.append(area)
                    reflectances.append(rho)
    return tuple(np.asarray(v) for v in (centres, normals, areas, reflectances))


def _factors(
    points: np.ndarray,
    normals: np.ndarray,
    patches: np.ndarray,
    patch_normals: np.ndarray,
    areas: np.ndarray,
) -> np.ndarray:
    vector = patches[None, :, :] - points[:, None, :]
    distance2 = np.sum(vector**2, axis=2)
    direction = vector / np.sqrt(np.maximum(distance2, 1e-20))[:, :, None]
    receiver = np.maximum(0, np.einsum("ijk,ik->ij", direction, normals))
    sender = np.maximum(0, -np.einsum("ijk,jk->ij", direction, patch_normals))
    return receiver * sender * areas / (pi * np.maximum(distance2, 1e-20))


def _beam_visible(points: np.ndarray, sun: np.ndarray, room: RoomGeometry) -> np.ndarray:
    if sun[2] >= -1e-9:
        return np.zeros(len(points), dtype=bool)
    entry = points + (-points[:, 2] / sun[2])[:, None] * sun
    return (
        (entry[:, 0] >= 0)
        & (entry[:, 0] <= room.width)
        & (entry[:, 1] >= 0)
        & (entry[:, 1] <= room.height)
        & (points[:, 2] > 0)
    )


def illuminance_at_probes(
    room: RoomGeometry,
    probes: tuple[Probe, ...],
    *,
    beam_flux: float,
    diffuse_flux: float,
    solar_elevation: float,
    solar_azimuth: float,
    wall_azimuth: float,
    bounces: int = DEFAULTS.daylight_oracle_bounces,
) -> tuple[tuple[float, float], ...]:
    """Return (Et at work-plane height, Ev at eye height) in lux per probe.

    beam_flux/diffuse_flux are W/m² arriving through the glazing plane. The
    transmitted beam is spatially averaged by the louvre optics, then traced
    to its first room-surface hit. Direct eye exposure remains unsmoothed.
    """
    if (
        not all(
            isfinite(v)
            for v in (beam_flux, diffuse_flux, solar_elevation, solar_azimuth, wall_azimuth)
        )
        or min(beam_flux, diffuse_flux) < 0
    ):
        raise ValueError("Flux must be finite/nonnegative; solar angles must be finite")
    if not isinstance(bounces, int) or bounces < 1:
        raise ValueError("At least one radiosity pass is required")
    if any(
        not (0 < p.x < room.width and 0 < p.z < room.depth and 0 < p.height_m < room.height)
        for p in probes
    ):
        raise ValueError("Probes must lie strictly inside the room")
    if not probes or beam_flux + diffuse_flux == 0:
        return tuple((0.0, 0.0) for _ in probes)
    patches, normals, areas, rho = _patches(room)
    factors = _factors(patches, normals, patches, normals, areas)
    # A single scale preserves reciprocity and prevents coarse quadrature from
    # creating energy. Open-window escape/absorption keeps the solve passive.
    factors /= max(1.0, float(factors.sum(axis=1).max()))
    elevation = radians(solar_elevation)
    relative = radians((solar_azimuth - wall_azimuth) % 360)
    sun = np.array(
        [cos(elevation) * sin(relative), sin(elevation), -cos(elevation) * cos(relative)]
    )
    normal_beam = beam_flux / -sun[2] if sun[2] < -1e-9 and elevation > 0 else 0.0
    direct = normal_beam * np.maximum(0, normals @ sun) * _beam_visible(patches, sun, room)
    # Conserve the entering beam's power despite centre-sampled first-hit patches.
    deposited = float(direct @ areas)
    if deposited > 0:
        direct *= beam_flux * room.width * room.height / deposited
    source = rho * direct
    source[patches[:, 2] == 0] = diffuse_flux
    radiosity = source.copy()
    # ponytail: four diffuse bounces and 4x4 patches per surface; refine the grid
    # and check convergence, then use Radiance for calibrated occupant claims.
    for _ in range(bounces - 1):
        radiosity = source + rho * (factors @ radiosity)

    task_points = np.array([(p.x, DEFAULTS.daylight_desk_height_m, p.z) for p in probes])
    eye_points = np.array([(p.x, p.height_m, p.z) for p in probes])
    up = np.tile((0.0, 1.0, 0.0), (len(probes), 1))
    facing = np.array(
        [
            (sin(p.view_rad), 0, -cos(p.view_rad)) if p.view_rad is not None else (0, 0, 0)
            for p in probes
        ]
    )
    task_factors = _factors(task_points, up, patches, normals, areas)
    eye_factors = _factors(eye_points, facing, patches, normals, areas)
    # A probe's hemisphere sees the complete closed box (including the aperture),
    # hence its view factors sum to one. This prevents near-patch quadrature from
    # amplifying a uniform field. Desk eye normals are zero by definition.
    task_factors /= np.maximum(task_factors.sum(axis=1, keepdims=True), 1e-20)
    eye_factors /= np.maximum(eye_factors.sum(axis=1, keepdims=True), 1e-20)
    task = task_factors @ radiosity
    eye = eye_factors @ radiosity
    task += normal_beam * max(0, sun[1]) * _beam_visible(task_points, sun, room)
    eye += normal_beam * np.maximum(0, facing @ sun) * _beam_visible(eye_points, sun, room)
    efficacy = DEFAULTS.luminous_efficacy_lm_per_w
    return tuple((float(et * efficacy), float(ev * efficacy)) for et, ev in zip(task, eye))
