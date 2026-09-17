import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from threading import Barrier, Lock
from time import sleep

import pytest

from app.weather import (
    FORECAST_URL,
    WARNING_URL,
    clear_weather_cache,
    get_met_weather_context,
)


@pytest.fixture
def met_payload() -> dict[str, object]:
    path = Path(__file__).parent / "fixtures" / "met_weather.json"
    return json.loads(path.read_text())


@pytest.fixture(autouse=True)
def isolated_weather_cache() -> None:
    clear_weather_cache()


def test_met_context_parses_forecast_warnings_and_anchor(met_payload: dict[str, object]) -> None:
    calls: list[str] = []

    def fetcher(url: str, _params: dict[str, str]) -> object:
        calls.append(url)
        return met_payload["forecast" if url == FORECAST_URL else "warnings"]

    context = get_met_weather_context(date(2026, 8, 11), fetcher=fetcher)

    assert calls == [FORECAST_URL, WARNING_URL]
    assert context.status == "applied"
    assert context.forecast is not None
    assert context.forecast.min_temp == 25
    assert context.forecast.max_temp == 34
    assert len(context.warnings) == 1
    assert context.anchor is not None
    assert context.anchor.morning_rain is False
    assert context.anchor.afternoon_rain is True
    assert context.anchor.afternoon_cloud > context.anchor.morning_cloud
    from app.feed_health import feed_health

    assert feed_health()["met_malaysia"]["last_status"] == "applied"
    assert feed_health()["met_malaysia"]["last_success_at"] == context.fetched_at.isoformat()


def test_met_context_is_cached_and_falls_back_outside_window(
    met_payload: dict[str, object],
) -> None:
    calls = 0

    def fetcher(url: str, _params: dict[str, str]) -> object:
        nonlocal calls
        calls += 1
        return met_payload["forecast" if url == FORECAST_URL else "warnings"]

    first = get_met_weather_context(date(2026, 8, 10), fetcher=fetcher)
    second = get_met_weather_context(date(2026, 8, 10), fetcher=fetcher)

    assert calls == 2
    assert first.status == second.status == "fallback"
    assert first.fallback_reason is not None
    assert "current window" in first.fallback_reason


def test_met_context_coalesces_concurrent_cache_misses(
    met_payload: dict[str, object],
) -> None:
    worker_count = 6
    start = Barrier(worker_count)
    calls: dict[str, int] = {FORECAST_URL: 0, WARNING_URL: 0}
    calls_lock = Lock()

    def fetcher(url: str, _params: dict[str, str]) -> object:
        with calls_lock:
            calls[url] += 1
        sleep(0.05)
        return met_payload["forecast" if url == FORECAST_URL else "warnings"]

    def load_context() -> str:
        start.wait()
        return get_met_weather_context(date(2026, 8, 11), fetcher=fetcher).status

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        statuses = list(executor.map(lambda _index: load_context(), range(worker_count)))

    assert statuses == ["applied"] * worker_count
    assert calls == {FORECAST_URL: 1, WARNING_URL: 1}


def test_met_context_degrades_when_upstream_fails() -> None:
    def failing_fetcher(_url: str, _params: dict[str, str]) -> object:
        raise RuntimeError("offline")

    context = get_met_weather_context(date(2026, 8, 11), fetcher=failing_fetcher)

    assert context.status == "fallback"
    assert context.forecast is None
    assert context.fallback_reason == "offline"
    from app.feed_health import feed_health

    assert feed_health()["met_malaysia"]["last_status"] == "fallback"
