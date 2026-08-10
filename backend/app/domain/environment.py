from dataclasses import replace
from datetime import date

import numpy as np
import pandas as pd
import pvlib

from app.config import DEFAULTS
from app.domain.types import Environment


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


def generate_day(
    day: date,
    *,
    cloud_profile: str = "scattered",
    tick_minutes: int = DEFAULTS.tick_minutes,
    seed: int = DEFAULTS.seed,
    occupancy_scale: float = 1.0,
    wind_override: float | None = None,
) -> list[Environment]:
    rng = np.random.default_rng(seed)
    start = pd.Timestamp(day, tz=DEFAULTS.timezone)
    periods = 24 * 60 // tick_minutes
    times = pd.date_range(start, periods=periods, freq=f"{tick_minutes}min")
    location = pvlib.location.Location(
        DEFAULTS.latitude,
        DEFAULTS.longitude,
        tz=DEFAULTS.timezone,
    )
    clear = location.get_clearsky(times, model="ineichen")
    position = location.get_solarposition(times)
    cloud = _cloud_series(cloud_profile, periods, rng)
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

    output: list[Environment] = []
    for i, timestamp in enumerate(times):
        hour = timestamp.hour + timestamp.minute / 60
        temp = 28.2 + 3.8 * np.sin((hour - 9.5) / 24 * 2 * np.pi)
        temp += rng.normal(0, 0.18)
        occupancy = _occupancy(hour, occupancy_scale)
        wind = wind_override if wind_override is not None else 2.3 + 1.1 * np.sin(hour / 24 * np.pi)
        wind = max(0.0, float(wind + rng.normal(0, 0.25)))
        # Keep incidental safety events out of the ordinary demos. Rain remains
        # available through the explicit overcast profile and Tier 3 has its own
        # deterministic power-loss event.
        rain = bool(cloud_profile == "overcast" and cloud[i] > 0.91 and rng.random() < 0.2)
        current_ghi = max(0.0, float(ghi[i]))
        current_dni = max(0.0, float(decomposition.iloc[i]["dni"]))
        current_dhi = max(0.0, float(decomposition.iloc[i]["dhi"]))
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
