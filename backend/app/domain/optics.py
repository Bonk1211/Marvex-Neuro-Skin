from dataclasses import dataclass
from functools import lru_cache
from math import cos, isfinite, pi, radians, sin, sqrt

from app.config import DEFAULTS

# Match BuildingHeatmap/louvreAssembly: two blades per row, chord/pitch 1.05,
# 0.009 scene units = 0.09 m thick, with the 1/9.5-height podium excluded.
_BLADE_PITCH_M = (
    DEFAULTS.floors * DEFAULTS.floor_height_m * (1 - 1 / 9.5) / (DEFAULTS.facade_zone_rows * 2)
)
_THICKNESS_TO_PITCH = 0.09 / _BLADE_PITCH_M


def _clamp(value: float, maximum: float = 1.0) -> float:
    return min(maximum, max(0.0, value)) if isfinite(value) else 0.0


def _ray_transmittance(
    sy: float, sz: float, cos_lean: float, incidence: float, sine: float, cosine: float
) -> float:
    if incidence <= 1e-9:
        return 0.0
    # Negative X rotation lifts the outward edge of the blade.
    blocked = (
        (1.05 * abs(sz * sine - sy * cosine) + _THICKNESS_TO_PITCH * abs(sz * cosine + sy * sine))
        * cos_lean
        / incidence
    )
    return _clamp(1 - blocked)


@lru_cache(maxsize=16)
def _diffuse_curves(tilt: float) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """Cosine-weighted isotropic sky/ground transmission at each whole degree."""
    lean = radians(tilt - 90)
    cos_lean, sin_lean = cos(lean), sin(lean)
    curves: list[tuple[float, ...]] = []
    for hemisphere in (1, -1):
        samples = []
        # Equal steps in sin(elevation) and azimuth have equal solid angle.
        for altitude in range(8):
            sy = hemisphere * (altitude + 0.5) / 8
            for azimuth in range(16):
                sz = sqrt(1 - sy * sy) * cos(2 * pi * (azimuth + 0.5) / 16)
                incidence = sz * cos_lean - sy * sin_lean
                if incidence > 1e-9:
                    samples.append((sy, sz, incidence))
        weight = sum(incidence for _, _, incidence in samples)
        transmission = []
        for angle in range(int(DEFAULTS.angle_max) + 1):
            sine, cosine = sin(radians(angle)), cos(radians(angle))
            transmitted = sum(
                incidence * _ray_transmittance(sy, sz, cos_lean, incidence, sine, cosine)
                for sy, sz, incidence in samples
            )
            transmission.append(transmitted / weight if weight > 0 else 0.0)
        curves.append(tuple(transmission))
    return curves[0], curves[1]


@dataclass(frozen=True)
class FacadeOptics:
    """Local beam/diffuse transmission through the rendered louvre geometry."""

    beam_fraction: float
    solar_elevation: float
    solar_azimuth: float
    wall_azimuth: float
    facade_tilt: float = DEFAULTS.facade_tilt
    sky_fraction: float = 1.0

    def __post_init__(self) -> None:
        object.__setattr__(self, "beam_fraction", _clamp(self.beam_fraction))
        object.__setattr__(self, "sky_fraction", _clamp(self.sky_fraction))

    def beam_transmittance(self, angle: float) -> float:
        if self.solar_elevation <= 0 or not all(
            isfinite(value)
            for value in (
                self.solar_elevation,
                self.solar_azimuth,
                self.wall_azimuth,
                self.facade_tilt,
            )
        ):
            return 0.0
        elevation = radians(self.solar_elevation)
        sy = sin(elevation)
        sz = cos(elevation) * cos(radians(self.solar_azimuth - self.wall_azimuth))
        lean = radians(_clamp(self.facade_tilt, 180.0) - 90.0)
        projected_pitch = sz * cos(lean) - sy * sin(lean)
        theta = radians(_clamp(angle, DEFAULTS.angle_max))
        # ponytail: periodic-bank average omits finite ends/side gaps; use the
        # existing mesh raycast when a spatial shadow map is required.
        return _ray_transmittance(sy, sz, cos(lean), projected_pitch, sin(theta), cos(theta))

    def diffuse_transmittance(self, angle: float) -> float:
        # ponytail: isotropic hemispheres with 8x16 rays, interpolated at 1 degree;
        # increase quadrature or add sky luminance data when calibration warrants it.
        sky, ground = _diffuse_curves(_clamp(self.facade_tilt, 180.0))
        bounded = _clamp(angle, DEFAULTS.angle_max)
        low = int(bounded)
        high = min(low + 1, len(sky) - 1)
        fraction = bounded - low
        sky_value = sky[low] + fraction * (sky[high] - sky[low])
        ground_value = ground[low] + fraction * (ground[high] - ground[low])
        return self.sky_fraction * sky_value + (1 - self.sky_fraction) * ground_value

    def solar_transmittance(self, angle: float) -> float:
        return self.beam_fraction * self.beam_transmittance(angle) + (
            1 - self.beam_fraction
        ) * self.diffuse_transmittance(angle)

    def daylight_transmittance(self, angle: float) -> float:
        # Opaque blades have the same geometric transmission for visible light;
        # the room/glazing lux transfer remains the sensor model's calibration.
        return self.solar_transmittance(angle)
