"""One facade-relative feature contract for generation and serving."""

from math import cos, degrees, radians, sin

import numpy as np

from app.domain.daylight.room import Probe, RoomGeometry
from app.domain.optics import FacadeOptics
from app.domain.types import Environment, SolarState

FEATURE_NAMES = (
    "beam_transmittance",
    "diffuse_transmittance",
    "theta_deg",
    "solar_elevation",
    "aoi",
    "beam_fraction",
    "cloud",
    "relative_azimuth_sin",
    "relative_azimuth_cos",
    "depth_m",
    "height_m",
    "view_rad_sin",
    "view_rad_cos",
    "probe_is_seat",
    # Intensity and lateral position are necessary: equal fractions can have
    # different lux, and two seats at equal depth can differ by a direct hit.
    "incident_w_m2",
    "lateral_m",
    "facade_tilt",
    "sky_fraction",
)


def build_features(
    probe: Probe,
    optics: FacadeOptics,
    angle: float,
    solar: SolarState,
    env: Environment,
    room: RoomGeometry,
) -> np.ndarray:
    """env.ghi carries local aperture POA (not horizontal GHI) at this seam."""
    if not (0 < probe.x < room.width and 0 < probe.z < room.depth):
        raise ValueError("Probe is outside the room")
    relative = radians((solar.azimuth - optics.wall_azimuth) % 360)
    elevation, tilt = radians(solar.elevation), radians(optics.facade_tilt)
    incidence = sin(elevation) * cos(tilt) + cos(elevation) * sin(tilt) * cos(relative)
    view = probe.view_rad or 0.0
    values = np.array(
        [
            optics.beam_transmittance(angle),
            optics.diffuse_transmittance(angle),
            angle,
            solar.elevation,
            degrees(np.arccos(np.clip(incidence, -1, 1))),
            optics.beam_fraction,
            env.cloud,
            sin(relative),
            cos(relative),
            probe.z,
            probe.height_m,
            sin(view),
            cos(view),
            float(probe.kind == "seat"),
            env.ghi,
            probe.x,
            optics.facade_tilt,
            optics.sky_fraction,
        ],
        dtype=float,
    )
    if not np.isfinite(values).all() or env.ghi < 0:
        raise ValueError("Features must be finite, with nonnegative incident flux")
    return values
