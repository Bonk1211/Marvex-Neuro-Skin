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
from app.domain.types import (
    FacadeHeat,
    RoofSegment,
    WallGain,
    WallState,
    ZoneGain,
    ZoneHeat,
)

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

    zenith = solar_position["apparent_zenith"]
    # Perez rather than pvlib's isotropic default. Isotropic spreads the diffuse
    # evenly over the sky dome, so two walls at the same tilt read the same
    # diffuse however the sun sits; Perez carries the circumsolar brightening and
    # the horizon band, which is where a sunward wall's extra diffuse comes from.
    dni_extra = pvlib.irradiance.get_extra_radiation(times)
    airmass = pvlib.atmosphere.get_relative_airmass(zenith)

    series: dict[str, dict[str, np.ndarray]] = {}
    for orientation, azimuth in ORIENTATIONS.items():
        poa = pvlib.irradiance.get_total_irradiance(
            surface_tilt=tilt,
            surface_azimuth=azimuth,
            solar_zenith=zenith,
            solar_azimuth=solar_position["azimuth"],
            dni=pd.Series(dni, index=times),
            ghi=pd.Series(ghi, index=times),
            dhi=pd.Series(dhi, index=times),
            dni_extra=dni_extra,
            airmass=airmass,
            model="perez",
        )
        entry = {
            key: np.nan_to_num(poa[key].to_numpy(dtype=float), nan=0.0).clip(0.0)
            for key in _POA_KEYS
        }
        # Angle of incidence, so a caller can tell a wall the sun has gone behind
        # from one it still reaches. Above 90 degrees the beam is off the plane
        # entirely and the wall is left with diffuse only.
        entry["aoi"] = np.nan_to_num(
            pvlib.irradiance.aoi(
                tilt, azimuth, zenith, solar_position["azimuth"]
            ).to_numpy(dtype=float),
            nan=180.0,
        )
        series[orientation] = entry
    return series


def sol_air_temp(outdoor_temp: float, poa_global: float, wind: float) -> float:
    film_coefficient = 5.7 + 3.8 * max(0.0, wind)
    return float(outdoor_temp + SOLAR_ABSORPTANCE * max(0.0, poa_global) / film_coefficient)


def roof_segments(
    series: dict[str, dict[str, np.ndarray]],
    index: int,
    *,
    outdoor_temp: float,
    wind: float,
    pitch: float,
) -> list[RoofSegment]:
    """Heat state of each pitched roof face at one tick.

    A roof face is just another surface with a tilt and an azimuth, so this
    reuses ``poa_series`` — call it with the roof pitch instead of the facade
    tilt. There are no louvres up here, so incident gain is what the surface
    keeps. At pitch 0 every quadrant returns the same value, correctly: a flat
    roof has no orientation to distinguish.
    """

    segments: list[RoofSegment] = []
    for quadrant, azimuth in ORIENTATIONS.items():
        face = series[quadrant]
        incident = float(face["poa_global"][index])
        segments.append(
            RoofSegment(
                quadrant=quadrant,
                azimuth=azimuth,
                tilt=pitch,
                incident=round(incident, 2),
                sky_diffuse=round(float(face["poa_sky_diffuse"][index]), 2),
                ground_diffuse=round(float(face["poa_ground_diffuse"][index]), 2),
                sol_air_temp=round(sol_air_temp(outdoor_temp, incident, wind), 2),
            )
        )
    return segments


def wall_gains(series: dict[str, dict[str, np.ndarray]], index: int) -> list[WallGain]:
    """Unshaded gain on each wall at one tick. This is what each controller reads."""

    return [
        WallGain(
            orientation=orientation,
            azimuth=azimuth,
            incident=float(series[orientation]["poa_global"][index]),
            sky_diffuse=float(series[orientation]["poa_sky_diffuse"][index]),
            ground_diffuse=float(series[orientation]["poa_ground_diffuse"][index]),
            aoi=float(series[orientation].get("aoi", np.full(1, 180.0))[index]),
        )
        for orientation, azimuth in ORIENTATIONS.items()
    ]


def profile_angle(elevation: float, azimuth: float, wall_azimuth: float) -> float:
    """Sun's elevation as seen in the wall's own vertical section, in degrees.

    This is the angle a horizontal overhang shades against: the sun's altitude
    projected into the plane perpendicular to the wall. Returns 90 when the sun
    is level with or behind the wall, where an overhang casts nothing onto it.
    """

    delta = np.radians(azimuth - wall_azimuth)
    if elevation <= 0.0 or np.cos(delta) <= 0.0:
        return 90.0
    return float(np.degrees(np.arctan(np.tan(np.radians(elevation)) / np.cos(delta))))


# Which wall each end bay of a wall shares its corner with, as seen from
# outside: column 0 is the wall's left edge, the last column its right. This has
# to agree with the 3D view, which numbers zones the same way.
CORNER_NEIGHBOURS: dict[str, tuple[str, str]] = {
    "south": ("west", "east"),
    "east": ("south", "north"),
    "north": ("east", "west"),
    "west": ("north", "south"),
}


def row_incidence(
    gain: WallGain,
    *,
    solar_elevation: float,
    solar_azimuth: float,
    rows: int = DEFAULTS.facade_zone_rows,
    wall_height: float | None = None,
    overhang: float = DEFAULTS.roof_overhang_m,
) -> list[tuple[float, float]]:
    """``(incident, sunlit_fraction)`` for each row of one wall, bottom first.

    The wall's plane-of-array beam is uniform over the plane, so on its own it
    cannot separate one row from another. What separates them is the roof slab
    oversailing the top of the facade: its shadow starts at the roof line and
    walks down the wall as the sun climbs, so the top row loses the beam first
    and the bottom row last. The same lip also hides part of the sky from the
    rows nearest it, which is the second term below.
    """

    height = wall_height or DEFAULTS.floors * DEFAULTS.floor_height_m
    row_height = height / rows
    # Shadow depth measured down the facade from the roof line. Measured on the
    # wall plane rather than vertically: the facade leans out 25 degrees, so this
    # runs a few percent short of the true slope distance.
    psi = profile_angle(solar_elevation, solar_azimuth, gain.azimuth)
    shadow = overhang * np.tan(np.radians(min(psi, 89.5)))

    rows_out: list[tuple[float, float]] = []
    for row in range(rows):
        below_roof = height - (row + 1) * row_height
        shaded = float(np.clip(shadow - below_roof, 0.0, row_height))
        sunlit_fraction = 1.0 - shaded / row_height
        # An infinite horizontal lip of projection P hides a sky band that closes
        # as you move down the wall; sin(arctan(P / z)) is that band's share of
        # the wall's half-dome sky view, and it goes to zero far below the lip.
        gap = below_roof + row_height / 2
        sky_blocked = 0.5 * overhang / float(np.hypot(overhang, gap))
        incident = (
            gain.direct * sunlit_fraction
            + gain.sky_diffuse * (1.0 - sky_blocked)
            + gain.ground_diffuse
        )
        rows_out.append((incident, sunlit_fraction))
    return rows_out


def zone_gains(
    gains: list[WallGain],
    *,
    solar_elevation: float,
    solar_azimuth: float,
    rows: int = DEFAULTS.facade_zone_rows,
    columns: int = DEFAULTS.facade_zone_columns,
    coupling: float = DEFAULTS.corner_daylight_coupling,
) -> dict[str, list[ZoneGain]]:
    """One gain per cell of every wall's zone grid, for its own controller.

    Rows separate on the roof overhang's shadow. Columns separate at the corners:
    the bay at each end of a wall wraps onto the neighbouring facade, so the room
    behind it is glazed on two sides and its controller answers for both. The two
    middle bays of a wall see one facade only, so they read alike — which is the
    truth about a flat piece of wall, not a gap in the model.
    """

    by_wall = {gain.orientation: gain for gain in gains}
    rows_by_wall = {
        gain.orientation: row_incidence(
            gain,
            solar_elevation=solar_elevation,
            solar_azimuth=solar_azimuth,
            rows=rows,
        )
        for gain in gains
    }

    grid: dict[str, list[ZoneGain]] = {}
    for gain in gains:
        left, right = CORNER_NEIGHBOURS[gain.orientation]
        cells: list[ZoneGain] = []
        for row in range(rows):
            incident, sunlit_fraction = rows_by_wall[gain.orientation][row]
            for column in range(columns):
                neighbour = (
                    left if column == 0 else right if column == columns - 1 else None
                )
                shared = (
                    coupling * rows_by_wall[neighbour][row][0]
                    if neighbour is not None
                    else 0.0
                )
                cells.append(
                    ZoneGain(
                        orientation=gain.orientation,
                        azimuth=gain.azimuth,
                        row=row,
                        column=column,
                        zone=f"{gain.orientation[0].upper()}{row * columns + column + 1}",
                        incident=incident,
                        sky_diffuse=gain.sky_diffuse,
                        ground_diffuse=gain.ground_diffuse,
                        sunlit_fraction=sunlit_fraction,
                        daylight=incident + shared,
                        aoi=min(
                            gain.aoi,
                            by_wall[neighbour].aoi if neighbour is not None else 180.0,
                        ),
                    )
                )
        grid[gain.orientation] = cells
    return grid


def zone_heat(
    zone: ZoneGain,
    state: WallState,
    *,
    outdoor_temp: float,
    wind: float,
) -> ZoneHeat:
    """One zone's heat state once its own louvres have taken their angle."""

    transmitted = zone.incident * shade_transmittance(state.angle)
    return ZoneHeat(
        row=zone.row,
        column=zone.column,
        zone=zone.zone,
        incident=round(zone.incident, 2),
        transmitted=round(transmitted, 2),
        sunlit_fraction=round(zone.sunlit_fraction, 3),
        sol_air_temp=round(sol_air_temp(outdoor_temp, transmitted, wind), 2),
        angle=state.angle,
        mode=state.mode,
        moved=state.moved,
        lux=round(state.lux, 1),
        load_relative=round(state.load_relative, 4),
    )


def facade_heat(
    gains: list[WallGain],
    decisions: dict[str, WallState],
    *,
    outdoor_temp: float,
    wind: float,
    primary: str,
    zones: dict[str, list[ZoneHeat]] | None = None,
) -> list[FacadeHeat]:
    """Heat state of every wall once its own louvres have acted."""

    walls: list[FacadeHeat] = []
    for gain in gains:
        state = decisions[gain.orientation]
        transmitted = gain.incident * shade_transmittance(state.angle)
        wall_zones = (zones or {}).get(gain.orientation, [])
        walls.append(
            FacadeHeat(
                orientation=gain.orientation,
                azimuth=gain.azimuth,
                incident=round(gain.incident, 2),
                transmitted=round(transmitted, 2),
                sky_diffuse=round(gain.sky_diffuse, 2),
                ground_diffuse=round(gain.ground_diffuse, 2),
                sol_air_temp=round(sol_air_temp(outdoor_temp, transmitted, wind), 2),
                angle=state.angle,
                mode=state.mode,
                moved=state.moved,
                lux=round(state.lux, 1),
                load_relative=round(state.load_relative, 4),
                reason=state.reason,
                primary=gain.orientation == primary,
                aoi=round(gain.aoi, 2),
                sunlit=gain.sunlit,
                zones=tuple(wall_zones),
            )
        )
    return walls
