"""Diffuse-patch radiosity in an empty illustrative box with one glazed wall.

The glazing at z=0 is a full-wall, non-reflecting aperture. Boundary flux is
already transmitted through the louvres. No furniture, spectral glass model or
measured geometry is implied. View factors use centre-to-centre quadrature.

``solve_radiosity`` exposes the solved patch field so a section view can draw the
interreflection the probes integrate; ``illuminance_at_probes`` is the label path
and its results are unchanged by that split.
"""

from dataclasses import dataclass
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


def _validate(
    beam_flux: float,
    diffuse_flux: float,
    solar_elevation: float,
    solar_azimuth: float,
    wall_azimuth: float,
    bounces: int,
) -> None:
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


@dataclass(frozen=True)
class RadiosityField:
    """One solved room: what each patch ends up radiating, and where that came from.

    ``radiosity`` is W/m² leaving a patch after the diffuse passes; ``direct`` is the
    first-hit beam it received before any bounce. The difference between ``radiosity``
    and ``reflectance * direct`` is the share a patch owes to its neighbours rather
    than to the sun, which is the quantity a section view is drawing.
    """

    centres: np.ndarray
    normals: np.ndarray
    areas: np.ndarray
    reflectance: np.ndarray
    direct: np.ndarray
    radiosity: np.ndarray
    sun: np.ndarray
    normal_beam: float


def solve_radiosity(
    room: RoomGeometry,
    *,
    beam_flux: float,
    diffuse_flux: float,
    solar_elevation: float,
    solar_azimuth: float,
    wall_azimuth: float,
    bounces: int = DEFAULTS.daylight_oracle_bounces,
) -> RadiosityField:
    """Solve the patch field. beam_flux/diffuse_flux are W/m² through the glazing."""
    _validate(beam_flux, diffuse_flux, solar_elevation, solar_azimuth, wall_azimuth, bounces)
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
    return RadiosityField(
        centres=patches,
        normals=normals,
        areas=areas,
        reflectance=rho,
        direct=direct,
        radiosity=radiosity,
        sun=sun,
        normal_beam=normal_beam,
    )


def _probe_geometry(
    probes: tuple[Probe, ...], views: tuple[float | None, ...]
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Work-plane points, eye points and eye normals. A desk probe has no eye normal."""
    task_points = np.array([(p.x, DEFAULTS.daylight_desk_height_m, p.z) for p in probes])
    eye_points = np.array([(p.x, p.height_m, p.z) for p in probes])
    facing = np.array([(sin(v), 0, -cos(v)) if v is not None else (0, 0, 0) for v in views])
    return task_points, eye_points, facing


def _integrate(
    room: RoomGeometry,
    probes: tuple[Probe, ...],
    field: RadiosityField,
    views: tuple[float | None, ...],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (Et, Ev, per-patch eye contributions) in W/m² before luminous efficacy."""
    task_points, eye_points, facing = _probe_geometry(probes, views)
    up = np.tile((0.0, 1.0, 0.0), (len(probes), 1))
    task_factors = _factors(task_points, up, field.centres, field.normals, field.areas)
    eye_factors = _factors(eye_points, facing, field.centres, field.normals, field.areas)
    # A probe's hemisphere sees the complete closed box (including the aperture),
    # hence its view factors sum to one. This prevents near-patch quadrature from
    # amplifying a uniform field. Desk eye normals are zero by definition.
    task_factors /= np.maximum(task_factors.sum(axis=1, keepdims=True), 1e-20)
    eye_factors /= np.maximum(eye_factors.sum(axis=1, keepdims=True), 1e-20)
    eye_patches = eye_factors * field.radiosity
    task = task_factors @ field.radiosity
    eye = eye_patches.sum(axis=1)
    task += field.normal_beam * max(0, field.sun[1]) * _beam_visible(task_points, field.sun, room)
    eye += (
        field.normal_beam
        * np.maximum(0, facing @ field.sun)
        * _beam_visible(eye_points, field.sun, room)
    )
    return task, eye, eye_patches


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
    _validate(beam_flux, diffuse_flux, solar_elevation, solar_azimuth, wall_azimuth, bounces)
    if any(
        not (0 < p.x < room.width and 0 < p.z < room.depth and 0 < p.height_m < room.height)
        for p in probes
    ):
        raise ValueError("Probes must lie strictly inside the room")
    if not probes or beam_flux + diffuse_flux == 0:
        return tuple((0.0, 0.0) for _ in probes)
    field = solve_radiosity(
        room,
        beam_flux=beam_flux,
        diffuse_flux=diffuse_flux,
        solar_elevation=solar_elevation,
        solar_azimuth=solar_azimuth,
        wall_azimuth=wall_azimuth,
        bounces=bounces,
    )
    task, eye, _ = _integrate(room, probes, field, tuple(p.view_rad for p in probes))
    efficacy = DEFAULTS.luminous_efficacy_lm_per_w
    return tuple((float(et * efficacy), float(ev * efficacy)) for et, ev in zip(task, eye))


@dataclass(frozen=True)
class ProbeBreakdown:
    """Where one probe's light comes from, patch by patch, in lux.

    ``eye_patch_lux`` sums to ``eye_lux`` minus ``eye_direct_lux``: the interreflected
    share. ``eye_direct_lux`` is unbounced sun straight into the eye plane, which is
    the term that collapses to zero the moment the occupant turns away from it.
    """

    task_lux: float
    eye_lux: float
    eye_direct_lux: float
    eye_patch_lux: np.ndarray


def probe_breakdown(
    room: RoomGeometry,
    probe: Probe,
    field: RadiosityField,
    *,
    view_rad: float | None = None,
) -> ProbeBreakdown:
    """Decompose one probe's Et/Ev over the patch field.

    ``view_rad`` overrides the probe's own facing, so a caller can sweep head yaw
    against a single solved room instead of re-solving the radiosity per angle.
    """
    if not (
        0 < probe.x < room.width and 0 < probe.z < room.depth and 0 < probe.height_m < room.height
    ):
        raise ValueError("Probes must lie strictly inside the room")
    view = probe.view_rad if view_rad is None else view_rad
    if view is not None and not isfinite(view):
        raise ValueError("view_rad must be finite")
    task, eye, eye_patches = _integrate(room, (probe,), field, (view,))
    efficacy = DEFAULTS.luminous_efficacy_lm_per_w
    interreflected = float(eye_patches[0].sum())
    return ProbeBreakdown(
        task_lux=float(task[0] * efficacy),
        eye_lux=float(eye[0] * efficacy),
        eye_direct_lux=float((eye[0] - interreflected) * efficacy),
        eye_patch_lux=eye_patches[0] * efficacy,
    )
