from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from threading import Lock
from time import monotonic
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.domain.types import EnvironmentAnchor, ObservedWeather, Site
from app.feed_health import record_feed

FORECAST_URL = "https://api.data.gov.my/weather/forecast/"
WARNING_URL = "https://api.data.gov.my/weather/warning/"
LOCATION_ID = "Tn079"
LOCATION_NAME = "Kuala Lumpur"
FORECAST_TTL_SECONDS = 6 * 60 * 60
WARNING_TTL_SECONDS = 10 * 60
REQUEST_TIMEOUT_SECONDS = 5

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_TTL_SECONDS = 60 * 60
# The forecast endpoint only reaches a few months back, and ERA5 reanalysis in
# the archive endpoint lags reality by about five days. Switch on that boundary.
OPEN_METEO_ARCHIVE_LAG_DAYS = 6
OPEN_METEO_VARIABLES = (
    "shortwave_radiation",
    "direct_normal_irradiance",
    "diffuse_radiation",
    "temperature_2m",
    "cloud_cover",
    "wind_speed_10m",
    "wind_direction_10m",
    "precipitation",
)

JsonFetcher = Callable[[str, dict[str, str]], Any]


@dataclass(frozen=True)
class MetForecast:
    date: date
    location_id: str
    location_name: str
    min_temp: float
    max_temp: float
    morning_forecast: str
    afternoon_forecast: str
    night_forecast: str
    summary_forecast: str
    summary_when: str


@dataclass(frozen=True)
class MetWarning:
    title: str
    heading: str
    text: str
    instruction: str
    valid_from: str | None
    valid_to: str | None


@dataclass(frozen=True)
class MetWeatherContext:
    status: str
    fetched_at: datetime
    forecast: MetForecast | None
    warnings: tuple[MetWarning, ...]
    fallback_reason: str | None = None

    @property
    def anchor(self) -> EnvironmentAnchor | None:
        if self.forecast is None:
            return None
        morning_cloud, morning_rain = _condition(self.forecast.morning_forecast)
        afternoon_cloud, afternoon_rain = _condition(self.forecast.afternoon_forecast)
        night_cloud, night_rain = _condition(self.forecast.night_forecast)
        return EnvironmentAnchor(
            min_temp=self.forecast.min_temp,
            max_temp=self.forecast.max_temp,
            morning_cloud=morning_cloud,
            afternoon_cloud=afternoon_cloud,
            night_cloud=night_cloud,
            morning_rain=morning_rain,
            afternoon_rain=afternoon_rain,
            night_rain=night_rain,
        )


@dataclass
class _CacheEntry:
    expires_at: float
    fetched_at: datetime
    value: Any


_cache: dict[str, _CacheEntry] = {}
_cache_lock = Lock()
_cache_key_locks: dict[str, Lock] = {}


def _get_cache_key_lock(key: str) -> Lock:
    with _cache_lock:
        return _cache_key_locks.setdefault(key, Lock())


def _default_fetcher(url: str, params: dict[str, str]) -> Any:
    request_url = f"{url}?{urlencode(params)}"
    request = Request(
        request_url,
        headers={
            "Accept": "application/json",
            "User-Agent": "neuroskin-simulation/0.1",
        },
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:  # noqa: S310
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        raise RuntimeError(f"Weather API request failed: {exc}") from exc


def _cached_fetch(
    key: str,
    ttl_seconds: int,
    url: str,
    params: dict[str, str],
    fetcher: JsonFetcher,
) -> tuple[Any, datetime]:
    now = monotonic()
    with _cache_lock:
        entry = _cache.get(key)
        if entry is not None and entry.expires_at > now:
            return entry.value, entry.fetched_at

    key_lock = _get_cache_key_lock(key)
    with key_lock:
        now = monotonic()
        with _cache_lock:
            entry = _cache.get(key)
            if entry is not None and entry.expires_at > now:
                return entry.value, entry.fetched_at

        value = fetcher(url, params)
        fetched_at = datetime.now(timezone.utc)
        with _cache_lock:
            _cache[key] = _CacheEntry(monotonic() + ttl_seconds, fetched_at, value)
        return value, fetched_at


def _parse_forecasts(payload: Any) -> list[MetForecast]:
    if not isinstance(payload, list):
        raise RuntimeError("MET forecast response was not a list")
    forecasts: list[MetForecast] = []
    for row in payload:
        try:
            location = row["location"]
            if location["location_id"] != LOCATION_ID:
                continue
            forecasts.append(
                MetForecast(
                    date=date.fromisoformat(row["date"]),
                    location_id=location["location_id"],
                    location_name=location["location_name"],
                    min_temp=float(row["min_temp"]),
                    max_temp=float(row["max_temp"]),
                    morning_forecast=str(row["morning_forecast"]),
                    afternoon_forecast=str(row["afternoon_forecast"]),
                    night_forecast=str(row["night_forecast"]),
                    summary_forecast=str(row["summary_forecast"]),
                    summary_when=str(row["summary_when"]),
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise RuntimeError("MET forecast response contained an invalid row") from exc
    return forecasts


def _parse_warnings(payload: Any) -> tuple[MetWarning, ...]:
    if not isinstance(payload, list):
        raise RuntimeError("MET warning response was not a list")
    warnings: list[MetWarning] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        issue = row.get("warning_issue") or {}
        heading = str(row.get("heading_en") or "")
        text = str(row.get("text_en") or "")
        title = str(issue.get("title_en") or heading or "Weather warning")
        combined = f"{title} {heading} {text}".casefold()
        valid_from = row.get("valid_from")
        valid_to = row.get("valid_to")
        all_clear_markers = ("no advisory", "no tropical cyclone", "tiada amaran")
        is_all_clear = any(marker in combined for marker in all_clear_markers)
        if not valid_from or not valid_to or is_all_clear:
            continue
        warnings.append(
            MetWarning(
                title=title,
                heading=heading,
                text=text,
                instruction=str(row.get("instruction_en") or ""),
                valid_from=valid_from,
                valid_to=valid_to,
            )
        )
    return tuple(warnings)


def _condition(value: str) -> tuple[float, bool]:
    normalized = value.casefold()
    if "ribut petir" in normalized:
        return 0.86, True
    if "hujan" in normalized and "tiada hujan" not in normalized:
        return 0.72, True
    if "berjerebu" in normalized:
        return 0.38, False
    if "tiada hujan" in normalized:
        return 0.12, False
    return 0.45, False


def get_met_weather_context(
    simulation_date: date,
    *,
    fetcher: JsonFetcher = _default_fetcher,
) -> MetWeatherContext:
    errors: list[str] = []
    fetched_at = datetime.now(timezone.utc)
    forecasts: list[MetForecast] = []
    warnings: tuple[MetWarning, ...] = ()

    try:
        raw_forecasts, fetched_at = _cached_fetch(
            f"forecast:{LOCATION_ID}",
            FORECAST_TTL_SECONDS,
            FORECAST_URL,
            {"filter": f"{LOCATION_ID}@location__location_id", "limit": "7"},
            fetcher,
        )
        forecasts = _parse_forecasts(raw_forecasts)
    except RuntimeError as exc:
        errors.append(str(exc))

    try:
        raw_warnings, warning_fetched_at = _cached_fetch(
            "warnings",
            WARNING_TTL_SECONDS,
            WARNING_URL,
            {"limit": "20"},
            fetcher,
        )
        warnings = _parse_warnings(raw_warnings)
        fetched_at = max(fetched_at, warning_fetched_at)
    except RuntimeError as exc:
        errors.append(str(exc))

    forecast = next((item for item in forecasts if item.date == simulation_date), None)
    if forecast is None:
        if forecasts:
            available = sorted(item.date for item in forecasts)
            reason = (
                f"MET has no forecast for {simulation_date.isoformat()}; its current window is "
                f"{available[0].isoformat()} to {available[-1].isoformat()}."
            )
        else:
            reason = errors[0] if errors else "MET returned no forecast for Kuala Lumpur."
        record_feed("met_malaysia", "fallback")
        return MetWeatherContext(
            status="fallback",
            fetched_at=fetched_at,
            forecast=None,
            warnings=warnings,
            fallback_reason=reason,
        )

    record_feed("met_malaysia", "degraded" if errors else "applied", fetched_at)
    return MetWeatherContext(
        status="applied",
        fetched_at=fetched_at,
        forecast=forecast,
        warnings=warnings,
        fallback_reason="; ".join(errors) if errors else None,
    )


@dataclass(frozen=True)
class OpenMeteoContext:
    """Measured/forecast hourly weather for the simulated day and site."""

    status: str
    fetched_at: datetime
    source_url: str
    dataset: str
    observed: ObservedWeather | None
    fallback_reason: str | None = None


def _open_meteo_channel(hourly: dict[str, Any], name: str, rows: list[int]) -> tuple[float, ...]:
    values = hourly.get(name)
    if not isinstance(values, list):
        raise RuntimeError(f"Open-Meteo response is missing {name}")
    try:
        # Open-Meteo emits null for gaps rather than omitting the hour.
        return tuple(0.0 if values[i] is None else float(values[i]) for i in rows)
    except (IndexError, TypeError, ValueError) as exc:
        raise RuntimeError(f"Open-Meteo returned an invalid {name} series") from exc


def _parse_open_meteo(payload: Any, simulation_date: date) -> ObservedWeather:
    if not isinstance(payload, dict):
        raise RuntimeError("Open-Meteo response was not an object")
    hourly = payload.get("hourly")
    if not isinstance(hourly, dict):
        raise RuntimeError("Open-Meteo response contained no hourly block")
    stamps = hourly.get("time")
    if not isinstance(stamps, list):
        raise RuntimeError("Open-Meteo response contained no hourly timestamps")
    prefix = simulation_date.isoformat()
    rows = [
        i for i, stamp in enumerate(stamps) if isinstance(stamp, str) and stamp.startswith(prefix)
    ]
    if len(rows) < 24:
        raise RuntimeError(
            f"Open-Meteo returned {len(rows)} hourly rows for {prefix}; 24 are required"
        )
    rows = rows[:24]
    cloud_percent = _open_meteo_channel(hourly, "cloud_cover", rows)
    return ObservedWeather(
        ghi=_open_meteo_channel(hourly, "shortwave_radiation", rows),
        dni=_open_meteo_channel(hourly, "direct_normal_irradiance", rows),
        dhi=_open_meteo_channel(hourly, "diffuse_radiation", rows),
        temperature=_open_meteo_channel(hourly, "temperature_2m", rows),
        cloud=tuple(value / 100.0 for value in cloud_percent),
        wind=_open_meteo_channel(hourly, "wind_speed_10m", rows),
        # Optional: an older cached response has no bearing, and the synthetic
        # prevailing monsoon bearing stands in for it.
        wind_direction=(
            _open_meteo_channel(hourly, "wind_direction_10m", rows)
            if isinstance(hourly.get("wind_direction_10m"), list)
            else ()
        ),
        precipitation=_open_meteo_channel(hourly, "precipitation", rows),
    )


def get_open_meteo_context(
    simulation_date: date,
    site: Site,
    *,
    fetcher: JsonFetcher = _default_fetcher,
) -> OpenMeteoContext:
    cutoff = datetime.now(timezone.utc).date() - timedelta(days=OPEN_METEO_ARCHIVE_LAG_DAYS)
    archived = simulation_date < cutoff
    url = OPEN_METEO_ARCHIVE_URL if archived else OPEN_METEO_FORECAST_URL
    dataset = "ERA5 reanalysis archive" if archived else "forecast"
    latitude = f"{site.latitude:.4f}"
    longitude = f"{site.longitude:.4f}"
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": ",".join(OPEN_METEO_VARIABLES),
        "timezone": site.timezone,
        "wind_speed_unit": "ms",
        "start_date": simulation_date.isoformat(),
        "end_date": simulation_date.isoformat(),
    }
    key = (
        f"open-meteo:{dataset}:{latitude}:{longitude}:{site.timezone}:{simulation_date.isoformat()}"
    )
    try:
        payload, fetched_at = _cached_fetch(key, OPEN_METEO_TTL_SECONDS, url, params, fetcher)
        observed = _parse_open_meteo(payload, simulation_date)
    except RuntimeError as exc:
        record_feed("open_meteo", "fallback")
        return OpenMeteoContext(
            status="fallback",
            fetched_at=datetime.now(timezone.utc),
            source_url=url,
            dataset=dataset,
            observed=None,
            fallback_reason=str(exc),
        )
    record_feed("open_meteo", "applied", fetched_at)
    return OpenMeteoContext(
        status="applied",
        fetched_at=fetched_at,
        source_url=url,
        dataset=dataset,
        observed=observed,
    )


def clear_weather_cache() -> None:
    """Test helper for keeping cache-sensitive adapter tests isolated."""

    with _cache_lock:
        _cache.clear()
