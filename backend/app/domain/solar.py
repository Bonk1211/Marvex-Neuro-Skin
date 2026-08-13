from datetime import datetime

import pandas as pd
import pvlib

from app.config import DEFAULTS
from app.domain.types import SolarState


def sun_position(
    t: datetime,
    lat: float = DEFAULTS.latitude,
    lon: float = DEFAULTS.longitude,
    tz: str = DEFAULTS.timezone,
) -> SolarState:
    timestamp = pd.Timestamp(t)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize(tz)
    times = pd.DatetimeIndex([timestamp])
    location = pvlib.location.Location(lat, lon, tz=str(timestamp.tz))
    position = location.get_solarposition(times).iloc[0]
    clear_sky = location.get_clearsky(times, model="ineichen").iloc[0]
    elevation = float(position["apparent_elevation"])
    return SolarState(
        azimuth=float(position["azimuth"]),
        elevation=elevation,
        clear_sky_ghi=max(0.0, float(clear_sky["ghi"])) if elevation > 0 else 0.0,
    )
