"""Location parameterisation, Open-Meteo observed weather, and facade heat."""

from datetime import date, datetime
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.domain.environment import generate_day, solar_frame
from app.domain.facade import facade_heat, poa_series, sol_air_temp
from app.domain.types import Site
from app.main import app
from app.weather import OpenMeteoContext, clear_weather_cache, get_open_meteo_context

KUALA_LUMPUR = Site("Kuala Lumpur, Malaysia", 3.1390, 101.6869, "Asia/Kuala_Lumpur")
PUTRAJAYA = Site("ST Diamond Building, Putrajaya", 2.9220, 101.6885, "Asia/Kuala_Lumpur")
OSLO = Site("Oslo, Norway", 59.9139, 10.7522, "Europe/Oslo")
DAY = date(2026, 3, 21)
AFTERNOON_TICK = 16 * 6  # 16:00 at 10-minute ticks


@pytest.fixture(autouse=True)
def _isolate_weather_cache():
    clear_weather_cache()
    yield
    clear_weather_cache()


def _payload(day: date = DAY, hours: int = 24) -> dict[str, Any]:
    ghi = [max(0.0, 900 * (1 - ((hour - 13) / 6) ** 2)) for hour in range(hours)]
    return {
        "hourly": {
            "time": [f"{day.isoformat()}T{hour:02d}:00" for hour in range(hours)],
            "shortwave_radiation": ghi,
            "direct_normal_irradiance": [value * 0.7 for value in ghi],
            "diffuse_radiation": [value * 0.3 for value in ghi],
            "temperature_2m": [26.0 + 0.01 * value for value in ghi],
            "cloud_cover": [40.0] * hours,
            "wind_speed_10m": [3.0] * hours,
            "precipitation": [0.0] * hours,
        }
    }


def _fetcher(payload: dict[str, Any]):
    def fetch(_url: str, _params: dict[str, str]) -> Any:
        return payload

    return fetch


def _observed(day: date = DAY):
    context = get_open_meteo_context(day, KUALA_LUMPUR, fetcher=_fetcher(_payload(day)))
    assert context.observed is not None
    return context.observed


def test_open_meteo_context_reads_every_hourly_channel():
    context = get_open_meteo_context(DAY, KUALA_LUMPUR, fetcher=_fetcher(_payload()))

    assert context.status == "applied"
    assert context.observed is not None
    assert len(context.observed.ghi) == 24
    assert context.observed.cloud[0] == pytest.approx(0.4)  # percent converted to fraction
    assert context.observed.ghi[13] == pytest.approx(900.0)
    assert context.fallback_reason is None


def test_open_meteo_falls_back_when_upstream_fails():
    def broken(_url: str, _params: dict[str, str]) -> Any:
        raise RuntimeError("Weather API request failed: upstream unavailable")

    context = get_open_meteo_context(DAY, KUALA_LUMPUR, fetcher=broken)

    assert context.status == "fallback"
    assert context.observed is None
    assert "upstream unavailable" in (context.fallback_reason or "")


def test_open_meteo_rejects_a_short_day():
    context = get_open_meteo_context(DAY, KUALA_LUMPUR, fetcher=_fetcher(_payload(hours=12)))

    assert context.status == "fallback"
    assert context.observed is None
    assert "12 hourly rows" in (context.fallback_reason or "")


def test_observed_weather_drives_the_tick_irradiance():
    day = generate_day(DAY, observed=_observed(), site=KUALA_LUMPUR)
    noon = day[13 * 6]

    assert noon.ghi == pytest.approx(900.0, rel=0.01)
    assert noon.dni == pytest.approx(630.0, rel=0.01)
    # The pyranometer reading stays a noisy synthetic sensor over the real value.
    assert noon.measured_irradiance != noon.ghi
    assert noon.measured_irradiance == pytest.approx(noon.ghi, rel=0.15)


def test_site_changes_the_solar_geometry():
    tropical = generate_day(date(2026, 12, 21), cloud_profile="clear", site=KUALA_LUMPUR)
    nordic = generate_day(date(2026, 12, 21), cloud_profile="clear", site=OSLO)

    assert max(env.ghi for env in nordic) < 0.2 * max(env.ghi for env in tropical)


def test_solar_frame_follows_the_site_timezone():
    times, _position, _location = solar_frame(DAY, site=OSLO)

    assert str(times.tz) == "Europe/Oslo"
    assert len(times) == 144


def _poa_for(site: Site = KUALA_LUMPUR, tilt: float = 90.0, day: date = DAY):
    ticks = generate_day(day, cloud_profile="clear", site=site)
    times, position, _location = solar_frame(day, site=site)
    return poa_series(
        times,
        position,
        np.array([env.ghi for env in ticks]),
        np.array([env.dni for env in ticks]),
        np.array([env.dhi for env in ticks]),
        tilt=tilt,
    )


def test_west_wall_takes_the_afternoon_sun():
    poa = _poa_for()

    west = poa["west"]["poa_global"][AFTERNOON_TICK]
    north = poa["north"]["poa_global"][AFTERNOON_TICK]

    assert west > north


def test_louvres_only_cool_the_controlled_wall():
    poa = _poa_for()
    walls = {
        wall.orientation: wall
        for wall in facade_heat(
            poa,
            AFTERNOON_TICK,
            outdoor_temp=32.0,
            wind=2.0,
            angle=60.0,
            controlled="west",
        )
    }

    assert [wall.controlled for wall in walls.values()].count(True) == 1
    assert walls["west"].transmitted < walls["west"].incident
    assert walls["north"].transmitted == walls["north"].incident
    assert walls["west"].sol_air_temp < sol_air_temp(32.0, walls["west"].incident, 2.0)


def test_diamond_tilt_self_shades_north_and_south():
    """The 25 degree overhang is the building's passive shading device.

    Published design claim: the tilt leaves the north and south facades fully
    self-shaded year round and cuts east/west solar impact substantially.
    """

    for day in (date(2026, 3, 21), date(2026, 6, 21), date(2026, 12, 21)):
        upright = _poa_for(PUTRAJAYA, tilt=90.0, day=day)
        tilted = _poa_for(PUTRAJAYA, tilt=115.0, day=day)
        for wall in ("north", "south"):
            assert tilted[wall]["poa_global"].sum() < upright[wall]["poa_global"].sum()
        for wall in ("east", "west"):
            reduction = 1 - (
                tilted[wall]["poa_global"].sum() / upright[wall]["poa_global"].sum()
            )
            assert 0.15 < reduction < 0.5


def test_upright_wall_still_available_for_comparison():
    upright = _poa_for(PUTRAJAYA, tilt=90.0)
    tilted = _poa_for(PUTRAJAYA, tilt=115.0)

    assert upright["west"]["poa_global"].max() > tilted["west"]["poa_global"].max()


def test_sol_air_temp_tracks_gain_and_wind():
    assert sol_air_temp(30.0, 0.0, 2.0) == pytest.approx(30.0)
    assert sol_air_temp(30.0, 800.0, 2.0) > sol_air_temp(30.0, 400.0, 2.0)
    assert sol_air_temp(30.0, 800.0, 9.0) < sol_air_temp(30.0, 800.0, 2.0)


def test_run_endpoint_reports_open_meteo_and_facade_heat(monkeypatch):
    context = OpenMeteoContext(
        status="applied",
        fetched_at=datetime(2026, 3, 21, 6, 0),
        source_url="https://api.open-meteo.com/v1/forecast",
        dataset="forecast",
        observed=_observed(),
    )
    monkeypatch.setattr(
        "app.domain.scenarios.get_open_meteo_context",
        lambda _day, _site: context,
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/simulations/run",
            json={
                "scenario": "overview",
                "date": DAY.isoformat(),
                "environment_source": "open_meteo",
                "facade_orientation": "west",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["weather_context"]["provider"] == "Open-Meteo"
    assert body["metadata"]["facade_orientation"] == "west"
    assert "Open-Meteo forecast supplies" in body["metadata"]["data_notice"]

    facade = body["ticks"][AFTERNOON_TICK]["facade"]
    assert len(facade) == 4
    assert sum(wall["controlled"] for wall in facade) == 1
    assert {wall["orientation"] for wall in facade} == {"north", "east", "south", "west"}


def test_run_endpoint_accepts_another_location():
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/simulations/run",
            json={
                "latitude": OSLO.latitude,
                "longitude": OSLO.longitude,
                "timezone": OSLO.timezone,
                "location_name": OSLO.name,
            },
        )

    assert response.status_code == 200
    assert response.json()["metadata"]["location"] == "Oslo, Norway"
    assert response.json()["metadata"]["timezone"] == "Europe/Oslo"


def test_run_endpoint_rejects_an_unknown_timezone():
    with TestClient(app) as client:
        response = client.post("/api/v1/simulations/run", json={"timezone": "Mars/Olympus_Mons"})

    assert response.status_code == 422
