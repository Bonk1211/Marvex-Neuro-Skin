"""Per-wall solar gain and surface temperature for the building heat map.

pvlib already resolves plane-of-array irradiance for any wall azimuth, and the
ASHRAE sol-air temperature turns that gain into the surface temperature a
thermal camera would read. Nothing here is learned or fitted.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pvlib

from app.config import DEFAULTS
from app.domain.thermal import shade_transmittance
from app.domain.types import FacadeHeat

ORIENTATIONS: dict[str, float] = {
    "north": 0.0,
    "east": 90.0,
    "south": 180.0,
    "west": 270.0,
}

# ASHRAE sol-air temperature: T_sol-air = T_air + (absorptance * I) / h_o.
# The long-wave sky-radiation correction is taken as zero for vertical surfaces
# and the outside film coefficient is h_o = 5.7 + 3.8 * wind (W/m2K).
SOLAR_ABSORPTANCE = 0.6

_POA_KEYS = ("poa_global", "poa_sky_diffuse", "poa_ground_diffuse")


def poa_series(
    times: pd.DatetimeIndex,
    solar_position: pd.DataFrame,
    ghi: np.ndarray,
    dni: np.ndarray,
    dhi: np.ndarray,
    tilt: float = DEFAULTS.facade_tilt,
) -> dict[str, dict[str, np.ndarray]]:
    """Plane-of-array irradiance per cardinal wall for the whole day.

    ``tilt`` is the pvlib surface tilt in degrees: 90 is a plain vertical wall,
    and anything above 90 leans outward so the wall shades itself. Vectorised on
    purpose: four pvlib calls per run instead of four per tick.
    """

    series: dict[str, dict[str, np.ndarray]] = {}
    for orientation, azimuth in ORIENTATIONS.items():
        poa = pvlib.irradiance.get_total_irradiance(
            surface_tilt=tilt,
            surface_azimuth=azimuth,
            solar_zenith=solar_position["apparent_zenith"],
            solar_azimuth=solar_position["azimuth"],
            dni=pd.Series(dni, index=times),
            ghi=pd.Series(ghi, index=times),
            dhi=pd.Series(dhi, index=times),
        )
        series[orientation] = {
            key: np.nan_to_num(poa[key].to_numpy(dtype=float), nan=0.0).clip(0.0)
            for key in _POA_KEYS
        }
    return series


def sol_air_temp(outdoor_temp: float, poa_global: float, wind: float) -> float:
    film_coefficient = 5.7 + 3.8 * max(0.0, wind)
    return float(outdoor_temp + SOLAR_ABSORPTANCE * max(0.0, poa_global) / film_coefficient)


def facade_heat(
    series: dict[str, dict[str, np.ndarray]],
    index: int,
    *,
    outdoor_temp: float,
    wind: float,
    angle: float,
    controlled: str,
) -> list[FacadeHeat]:
    """Heat state of all four walls at one tick, with louvres applied to one."""

    walls: list[FacadeHeat] = []
    for orientation, azimuth in ORIENTATIONS.items():
        wall = series[orientation]
        incident = float(wall["poa_global"][index])
        is_controlled = orientation == controlled
        transmitted = incident * shade_transmittance(angle) if is_controlled else incident
        walls.append(
            FacadeHeat(
                orientation=orientation,
                azimuth=azimuth,
                incident=round(incident, 2),
                transmitted=round(transmitted, 2),
                sky_diffuse=round(float(wall["poa_sky_diffuse"][index]), 2),
                ground_diffuse=round(float(wall["poa_ground_diffuse"][index]), 2),
                sol_air_temp=round(sol_air_temp(outdoor_temp, transmitted, wind), 2),
                controlled=is_controlled,
            )
        )
    return walls
