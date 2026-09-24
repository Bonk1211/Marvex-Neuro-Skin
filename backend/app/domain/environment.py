from dataclasses import replace
from datetime import date

import numpy as np
import pandas as pd
import pvlib

from app.config import DEFAULTS
from app.domain.types import Environment, EnvironmentAnchor, ObservedWeather, Site, ZoneSensors


def default_site() -> Site:
    return Site(
        name=DEFAULTS.location_name,
        latitude=DEFAULTS.latitude,
        longitude=DEFAULTS.longitude,
        timezone=DEFAULTS.timezone,
    )


def solar_frame(
    day: date,
    *,
    site: Site | None = None,
    tick_minutes: int = DEFAULTS.tick_minutes,
) -> tuple[pd.DatetimeIndex, pd.DataFrame, pvlib.location.Location]:
    """Tick timestamps and solar position for the occupied window of one local day."""

    site = site or default_site()
    start = pd.Timestamp(day, tz=site.timezone) + pd.Timedelta(hours=DEFAULTS.day_start_hour)
    hours = DEFAULTS.day_end_hour - DEFAULTS.day_start_hour
    periods = hours * 60 // tick_minutes
    times = pd.date_range(start, periods=periods, freq=f"{tick_minutes}min")
    location = pvlib.location.Location(site.latitude, site.longitude, tz=site.timezone)
    return times, location.get_solarposition(times), location


def _hourly_to_ticks(hours: np.ndarray, values: tuple[float, ...]) -> np.ndarray:
    # ponytail: np.interp clamps after the last hourly sample instead of wrapping
    # into the next day. Only the 23:00-23:50 tail is affected, where irradiance
    # is zero and temperature barely moves. Fetch a second day if that matters.
    return np.interp(hours, np.arange(len(values), dtype=float), np.asarray(values, dtype=float))


def _cloud_series(profile: str, count: int, rng: np.random.Generator) -> np.ndarray:
    x = np.arange(count)
    if profile == "clear":
        cloud = np.full(count, 0.06) + rng.normal(0, 0.015, count)
    elif profile == "overcast":
        cloud = np.full(count, 0.78) + rng.normal(0, 0.045, count)
    else:
        cloud = np.full(count, 0.18) + rng.normal(0, 0.035, count)
        for _ in range(7):
            centre = rng.integers(max(1, count // 4), max(2, count * 4 // 5))
            width = rng.uniform(2.0, 8.0)
            height = rng.uniform(0.2, 0.62)
            cloud += height * np.exp(-0.5 * ((x - centre) / width) ** 2)
    return np.clip(cloud, 0.0, 0.96)


def _occupancy(hour: float, scale: float) -> float:
    if hour < 7 or hour >= 20:
        base = 0.04
    elif hour < 9:
        base = 0.25 + 0.3 * (hour - 7)
    elif 12 <= hour < 14:
        base = 0.58
    elif hour < 18:
        base = 0.88
    else:
        base = max(0.1, 0.88 - 0.39 * (hour - 18))
    return float(np.clip(base * scale, 0.0, 1.0))


def _prevailing_bearing(day: date) -> float:
    """Peninsular Malaysia monsoon bearing, degrees the wind blows from.

    November-March is the north-east monsoon, May-September the south-west one.
    The inter-monsoon months are dominated by afternoon squall lines that reach
    the Klang Valley from the west. Feed Open-Meteo in for a measured bearing.
    """
    if day.month in (11, 12, 1, 2, 3):
        return 45.0
    if day.month in (5, 6, 7, 8, 9):
        return 225.0
    return 270.0


def generate_day(
    day: date,
    *,
    cloud_profile: str = "scattered",
    tick_minutes: int = DEFAULTS.tick_minutes,
    seed: int = DEFAULTS.seed,
    occupancy_scale: float = 1.0,
    wind_override: float | None = None,
    wind_direction_override: float | None = None,
    weather_anchor: EnvironmentAnchor | None = None,
    observed: ObservedWeather | None = None,
    site: Site | None = None,
) -> list[Environment]:
    rng = np.random.default_rng(seed)
    site = site or default_site()
    times, position, location = solar_frame(day, site=site, tick_minutes=tick_minutes)
    periods = len(times)
    hours = times.hour.to_numpy() + times.minute.to_numpy() / 60.0

    temp_series: np.ndarray | None = None
    wind_series: np.ndarray | None = None
    direction_hours: tuple[float, ...] = ()
    # Its own stream, so adding a bearing leaves every other seeded series alone.
    direction_rng = np.random.default_rng(seed + 303_011)
    prevailing = _prevailing_bearing(day)
    rain_series: np.ndarray | None = None

    if observed is not None:
        # Measured/forecast irradiance replaces the clear-sky-times-cloud guess.
        # Occupancy, indoor readings and sensor faults stay synthetic.
        ghi = np.maximum(0.0, _hourly_to_ticks(hours, observed.ghi))
        dni = np.maximum(0.0, _hourly_to_ticks(hours, observed.dni))
        dhi = np.maximum(0.0, _hourly_to_ticks(hours, observed.dhi))
        cloud = np.clip(_hourly_to_ticks(hours, observed.cloud), 0.0, 0.96)
        temp_series = _hourly_to_ticks(hours, observed.temperature)
        wind_series = np.maximum(0.0, _hourly_to_ticks(hours, observed.wind))
        direction_hours = observed.wind_direction
        rain_series = _hourly_to_ticks(hours, observed.precipitation) > 0.1
    else:
        clear = location.get_clearsky(times, model="ineichen")
        cloud = _cloud_series(cloud_profile, periods, rng)
        rain_period = np.zeros(periods, dtype=bool)
        if weather_anchor is not None:
            period_cloud = np.empty(periods)
            for i, timestamp in enumerate(times):
                hour = timestamp.hour + timestamp.minute / 60
                if 6 <= hour < 12:
                    period_cloud[i] = weather_anchor.morning_cloud
                    rain_period[i] = weather_anchor.morning_rain
                elif 12 <= hour < 18:
                    period_cloud[i] = weather_anchor.afternoon_cloud
                    rain_period[i] = weather_anchor.afternoon_rain
                else:
                    period_cloud[i] = weather_anchor.night_cloud
                    rain_period[i] = weather_anchor.night_rain
            # Preserve seeded intra-period variation while making the official
            # period-level forecast the dominant shape of the synthetic sky.
            cloud = np.clip(0.35 * cloud + 0.65 * period_cloud, 0.0, 0.96)
        transmittance = np.clip(1.0 - DEFAULTS.cloud_attenuation * cloud, 0.12, 1.0)
        ghi = clear["ghi"].to_numpy() * transmittance
        decomposition = pd.DataFrame(
            pvlib.irradiance.erbs(
                pd.Series(ghi, index=times),
                position["zenith"],
                times.dayofyear,
            ),
            index=times,
        ).fillna(0.0)
        dni = decomposition["dni"].to_numpy()
        dhi = decomposition["dhi"].to_numpy()

        if weather_anchor is not None:
            anchor_rng = np.random.default_rng(seed + 101_003)
            raw_temp = np.array(
                [
                    28.2
                    + 3.8 * np.sin((timestamp.hour + timestamp.minute / 60 - 9.5) / 24 * 2 * np.pi)
                    + anchor_rng.normal(0, 0.18)
                    for timestamp in times
                ]
            )
            span = float(raw_temp.max() - raw_temp.min())
            normalized = (raw_temp - raw_temp.min()) / span if span else np.zeros(periods)
            temp_series = weather_anchor.min_temp + normalized * (
                weather_anchor.max_temp - weather_anchor.min_temp
            )
            rain_rng = np.random.default_rng(seed + 202_007)
            rain_series = np.array(
                [
                    bool(rain_period[i] and cloud[i] > 0.62 and rain_rng.random() < 0.35)
                    for i in range(periods)
                ]
            )

    output: list[Environment] = []
    for i, timestamp in enumerate(times):
        hour = timestamp.hour + timestamp.minute / 60
        if temp_series is not None:
            temp = float(temp_series[i])
        else:
            temp = 28.2 + 3.8 * np.sin((hour - 9.5) / 24 * 2 * np.pi)
            temp += rng.normal(0, 0.18)
        occupancy = _occupancy(hour, occupancy_scale)
        if wind_override is not None:
            wind = wind_override
        elif wind_series is not None:
            wind = float(wind_series[i])
        else:
            wind = 2.3 + 1.1 * np.sin(hour / 24 * np.pi)
        wind = max(0.0, float(wind + rng.normal(0, 0.25)))
        # Bearing the wind blows from. Hour-stepped rather than interpolated: 350
        # and 10 degrees are 20 degrees apart, and np.interp would average them
        # to 180. A degree of resolution past the hour buys nothing here.
        if wind_direction_override is not None:
            direction = wind_direction_override
        elif direction_hours:
            direction = float(direction_hours[min(int(hour), len(direction_hours) - 1)])
        else:
            direction = prevailing + 12 * np.sin(hour / 12 * np.pi) + direction_rng.normal(0, 4)
        direction = float(direction % 360)
        if rain_series is not None:
            rain = bool(rain_series[i])
        else:
            # Keep incidental safety events out of the ordinary demos. Rain remains
            # available through the explicit overcast profile and Tier 3 has its own
            # deterministic power-loss event. The draw stays inside the loop so the
            # seeded stream matches the pre-observed-weather behaviour.
            rain = bool(cloud_profile == "overcast" and cloud[i] > 0.91 and rng.random() < 0.2)
        current_ghi = max(0.0, float(ghi[i]))
        current_dni = max(0.0, float(dni[i]))
        current_dhi = max(0.0, float(dhi[i]))
        diffuse_fraction = current_dhi / current_ghi if current_ghi > 1 else 1.0
        measured = max(0.0, current_ghi * (1 + rng.normal(0, 0.025)))
        # Simple indoor work-plane proxy: diffuse light remains useful in the
        # tropical sky while direct light raises glare risk when unshaded.
        open_lux = max(20.0, current_dhi * 1.4 + current_dni)
        indoor_temp = 24.4 + 0.16 * (temp - 24) + 0.55 * occupancy
        indoor_rh = float(np.clip(62 + 11 * cloud[i] + 3 * occupancy, 45, 85))
        output.append(
            Environment(
                t=timestamp.to_pydatetime(),
                ghi=current_ghi,
                dni=current_dni,
                dhi=current_dhi,
                diffuse_fraction=float(np.clip(diffuse_fraction, 0, 1)),
                cloud=float(cloud[i]),
                wind=wind,
                rain=rain,
                outdoor_temp=float(temp),
                occupancy=occupancy,
                measured_irradiance=measured,
                indoor_lux=float(open_lux),
                indoor_temp=float(indoor_temp),
                indoor_rh=indoor_rh,
                wind_direction=direction,
            )
        )
    return output


def inject_sensor_fault(env: Environment, kind: str) -> Environment:
    if kind == "dead_pyranometer":
        return replace(env, measured_irradiance=0.0)
    if kind == "stuck_lux":
        return replace(env, indoor_lux=350.0)
    if kind == "drift":
        return replace(env, measured_irradiance=env.measured_irradiance * 0.42)
    raise ValueError(f"Unsupported sensor fault: {kind}")


def perturb_zone_sensors(
    sensors: ZoneSensors,
    kind: str,
    severity: float,
    progress: float,
    stuck: ZoneSensors | None,
) -> ZoneSensors:
    """Declared test perturbation of one zone's pair. Faults corrupt the irradiance
    reading while the aperture is unchanged; shadow is a real drop on both channels
    that the geometry model cannot see."""

    if kind == "dead":
        return replace(sensors, irradiance=0.0)
    if kind == "stuck":
        stuck = stuck or sensors
        return replace(sensors, irradiance=stuck.irradiance, illuminance=stuck.illuminance)
    if kind == "drift":
        factor = 1 - severity * min(1.0, max(0.0, progress))
        return replace(sensors, irradiance=round(sensors.irradiance * factor, 2))
    if kind == "fouled":
        return replace(sensors, irradiance=round(sensors.irradiance * (1 - severity), 2))
    if kind == "shadow":
        return replace(
            sensors,
            irradiance=round(sensors.irradiance * (1 - severity), 2),
            illuminance=round(sensors.illuminance * (1 - severity), 1),
        )
    raise ValueError(f"Unsupported zone perturbation: {kind}")
