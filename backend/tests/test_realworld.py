"""Location parameterisation, Open-Meteo observed weather, and facade heat."""

from datetime import date, datetime
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.domain.environment import generate_day, solar_frame
from app.domain.facade import (
    facade_heat,
    poa_series,
    profile_angle,
    sol_air_temp,
    wall_gains,
    zone_gains,
    zone_heat,
)
from app.domain.scenarios import run_scenario
from app.domain.types import Site, WallState
from app.main import app
from app.schemas import SimulationRunRequest
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
    from app.feed_health import feed_health

    assert feed_health()["open_meteo"]["last_status"] == "applied"
    assert feed_health()["open_meteo"]["last_success_at"] == context.fetched_at.isoformat()


def test_open_meteo_falls_back_when_upstream_fails():
    def broken(_url: str, _params: dict[str, str]) -> Any:
        raise RuntimeError("Weather API request failed: upstream unavailable")

    context = get_open_meteo_context(DAY, KUALA_LUMPUR, fetcher=broken)

    assert context.status == "fallback"
    assert context.observed is None
    assert "upstream unavailable" in (context.fallback_reason or "")
    from app.feed_health import feed_health

    assert feed_health()["open_meteo"]["last_status"] == "fallback"


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


def test_each_wall_cools_by_its_own_angle():
    gains = wall_gains(_poa_for(), AFTERNOON_TICK)
    angles = {"north": 0.0, "east": 0.0, "south": 0.0, "west": 60.0}
    walls = {
        wall.orientation: wall
        for wall in facade_heat(
            gains,
            {
                orientation: WallState(
                    angle=angle,
                    mode="NORMAL",
                    moved=False,
                    lux=400.0,
                    load_relative=0.4,
                    reason="test",
                )
                for orientation, angle in angles.items()
            },
            outdoor_temp=32.0,
            wind=2.0,
            primary="west",
        )
    }

    assert [wall.primary for wall in walls.values()].count(True) == 1
    assert walls["west"].transmitted < walls["west"].incident
    assert walls["north"].transmitted == walls["north"].incident
    assert walls["west"].sol_air_temp < sol_air_temp(32.0, walls["west"].incident, 2.0)


def test_each_wall_reaches_its_own_angle():
    """The point of per-facade control: different walls, different answers."""

    payload = run_scenario(
        SimulationRunRequest(
            date=DAY,
            cloud_profile="clear",
            facade_orientation="west",
            facade_tilt=90.0,
        )
    )
    late = payload.ticks[17 * 6].facade
    angles = {wall.orientation: wall.angle for wall in late}

    assert len(set(angles.values())) > 1, angles
    # More irradiance does not imply a larger blade angle: beam cut-off depends
    # on the sun's profile relative to the blade, not a linear closure fraction.
    assert angles["west"] != angles["north"], angles
    gains = {wall.orientation: wall.incident for wall in late}
    assert gains["west"] > gains["north"]


def test_the_tilt_leaves_the_louvres_little_to_do():
    """As built, the 25 degree overhang already does the shading work."""

    tilted = run_scenario(
        SimulationRunRequest(date=DAY, cloud_profile="clear", facade_tilt=115.0)
    )
    upright = run_scenario(
        SimulationRunRequest(date=DAY, cloud_profile="clear", facade_tilt=90.0)
    )

    def shaded_ticks(payload):
        return sum(wall.angle > 0 for tick in payload.ticks for wall in tick.facade)

    assert shaded_ticks(tilted) < shaded_ticks(upright)


def test_diamond_tilt_self_shades_north_and_south():
    """The 25 degree overhang is the building's passive shading device.

    Published design claim: the tilt leaves the north and south facades fully
    self-shaded year round and cuts east/west solar impact substantially.
    """

    def beam(series, wall):
        face = series[wall]
        return (
            (face["poa_global"] - face["poa_sky_diffuse"] - face["poa_ground_diffuse"])
            .clip(0.0)
            .sum()
        )

    for day in (date(2026, 3, 21), date(2026, 6, 21), date(2026, 12, 21)):
        upright = _poa_for(PUTRAJAYA, tilt=90.0, day=day)
        tilted = _poa_for(PUTRAJAYA, tilt=115.0, day=day)
        # Shading is a claim about the beam, so measure the beam. Total gain is
        # the wrong yardstick here: a wall leaning out looks down at the sunlit
        # ground, so on days when it never saw the sun anyway (north in March,
        # south in June) the extra ground-reflected diffuse lifts its total a
        # few percent even as the tilt keeps the beam off it entirely.
        for wall in ("north", "south"):
            assert beam(tilted, wall) < 0.25 * max(beam(upright, wall), 1.0)
        for wall in ("east", "west"):
            reduction = 1 - (
                tilted[wall]["poa_global"].sum() / upright[wall]["poa_global"].sum()
            )
            assert 0.15 < reduction < 0.5


def test_upright_wall_still_available_for_comparison():
    upright = _poa_for(PUTRAJAYA, tilt=90.0)
    tilted = _poa_for(PUTRAJAYA, tilt=115.0)

    assert upright["west"]["poa_global"].max() > tilted["west"]["poa_global"].max()


def test_a_flat_roof_has_no_orientation_to_distinguish():
    """The degenerate case has to be right, or the heat map is lying."""

    payload = run_scenario(
        SimulationRunRequest(date=DAY, cloud_profile="clear", roof_pitch=0.0)
    )
    noon = payload.ticks[12 * 6].roof

    assert len({segment.incident for segment in noon}) == 1


def test_a_pitched_roof_separates_its_faces():
    payload = run_scenario(
        SimulationRunRequest(date=DAY, cloud_profile="clear", roof_pitch=10.0)
    )
    late = {segment.quadrant: segment.incident for segment in payload.ticks[17 * 6].roof}

    assert len(set(late.values())) == 4, late
    # Late afternoon: the west-facing pitch leads, the east-facing one trails.
    assert late["west"] > late["north"] > late["east"], late


def test_roof_segments_cover_every_quadrant():
    payload = run_scenario(SimulationRunRequest(date=DAY))

    for tick in payload.ticks:
        assert {segment.quadrant for segment in tick.roof} == {
            "north",
            "east",
            "south",
            "west",
        }
        assert all(segment.incident >= 0 for segment in tick.roof)


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
    assert sum(wall["primary"] for wall in facade) == 1
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


def _wall_gain(orientation, azimuth, incident, aoi=40.0):
    from app.domain.types import WallGain

    return WallGain(
        orientation=orientation,
        azimuth=azimuth,
        incident=incident,
        sky_diffuse=90.0,
        ground_diffuse=110.0,
        aoi=aoi,
    )


def _lit_grid():
    return zone_gains(
        [
            _wall_gain("north", 0.0, 240.0, aoi=100.0),
            _wall_gain("east", 90.0, 240.0, aoi=100.0),
            _wall_gain("south", 180.0, 240.0, aoi=100.0),
            _wall_gain("west", 270.0, 500.0, aoi=40.0),
        ],
        solar_elevation=60.0,
        solar_azimuth=270.0,
    )


def test_the_roof_overhang_shades_the_top_zone_first():
    """Zone readings have to fall from the roof line down, or the grid is decoration."""

    zones = _lit_grid()["west"]
    bottom = [zone for zone in zones if zone.row == 0]
    top = [zone for zone in zones if zone.row == 3]

    assert len(zones) == 16
    assert [zone.zone for zone in zones[:4]] == ["W1", "W2", "W3", "W4"]
    # The top row loses the beam while the bottom row still has all of it.
    assert top[0].sunlit_fraction < bottom[0].sunlit_fraction == 1.0
    assert top[0].incident < bottom[0].incident

    state = WallState(
        angle=0.0, mode="NORMAL", moved=False, lux=400.0, load_relative=0.4, reason=""
    )
    heats = [zone_heat(zone, state, outdoor_temp=31.0, wind=2.0) for zone in zones]
    assert heats[-1].sol_air_temp < heats[0].sol_air_temp


def test_a_corner_zone_answers_for_two_facades():
    """The bays at a wall's ends wrap a corner, so they carry more than the middle."""

    zones = _lit_grid()["north"]
    row = {zone.column: zone for zone in zones if zone.row == 0}

    # Same piece of wall, so the same incident gain on the surface itself.
    assert row[0].incident == row[1].incident == row[3].incident
    # The corner bay next to the sunlit west wall has the most to answer for,
    # and the middle bays, glazed on one side only, have the least.
    assert row[3].daylight > row[0].daylight > row[1].daylight == row[2].daylight
    assert row[1].daylight == row[1].incident


def test_zone_optics_preserves_roof_shaded_beam_without_inventing_corner_sun():
    from app.domain.optics import FacadeOptics

    grid = _lit_grid()
    top = grid["west"][-1]
    beam = max(0.0, top.incident - top.sky_diffuse - top.ground_diffuse)
    assert beam == pytest.approx((500 - 90 - 110) * top.sunlit_fraction)
    assert 0 < top.sunlit_fraction < 1
    assert 0 < top.sky_diffuse < 90
    optics = FacadeOptics(
        beam / top.incident,
        60,
        270,
        top.azimuth,
        sky_fraction=top.sky_diffuse / (top.sky_diffuse + top.ground_diffuse),
    )
    state = WallState(
        angle=60, mode="HOLD", moved=False, lux=400, load_relative=0.4, reason=""
    )
    heat = zone_heat(top, state, outdoor_temp=31, wind=2, optics=optics)
    diffuse = top.sky_diffuse + top.ground_diffuse
    assert heat.diffuse_incident == pytest.approx(diffuse, abs=0.01)
    assert heat.diffuse_transmitted == pytest.approx(
        diffuse * optics.diffuse_transmittance(state.angle), abs=0.01
    )
    assert 0 <= heat.diffuse_transmitted < heat.diffuse_incident
    horizontal = zone_heat(
        top,
        WallState(angle=0, mode="HOLD", moved=False, lux=400, load_relative=0.4, reason=""),
        outdoor_temp=31,
        wind=2,
        optics=optics,
    )
    assert 0 < horizontal.diffuse_transmitted < horizontal.diffuse_incident
    legacy = zone_heat(top, state, outdoor_temp=31, wind=2)
    assert legacy.diffuse_transmitted == pytest.approx(diffuse * 0.22, abs=0.01)
    assert legacy.transmitted == pytest.approx(top.incident * 0.22, abs=0.01)
    # Pre-glazing solar irradiance remains the quantity consumed by the slab.
    expected = beam * optics.beam_transmittance(60) + (
        top.sky_diffuse + top.ground_diffuse
    ) * optics.diffuse_transmittance(60)
    assert heat.transmitted == pytest.approx(expected, abs=0.01)
    assert heat.transmitted > top.incident * optics.diffuse_transmittance(60)

    corner = grid["north"][3]
    assert corner.daylight > corner.incident
    assert corner.aoi < 90  # Inherited from the bright neighbouring west aperture.
    own_beam = max(0.0, corner.incident - corner.sky_diffuse - corner.ground_diffuse)
    assert own_beam == pytest.approx(0, abs=1e-10)
    own_optics = FacadeOptics(
        own_beam / corner.incident,
        60,
        270,
        corner.azimuth,
        sky_fraction=corner.sky_diffuse / (corner.sky_diffuse + corner.ground_diffuse),
    )
    assert own_optics.beam_transmittance(60) == 0
    corner_heat = zone_heat(corner, state, outdoor_temp=31, wind=2, optics=own_optics)
    assert corner_heat.transmitted == pytest.approx(
        corner.incident * own_optics.diffuse_transmittance(60), abs=0.01
    )


def test_every_zone_carries_its_own_controller():
    """16 controllers per wall, and the corner bays must not copy the middle."""

    payload = run_scenario(
        SimulationRunRequest(
            date=DAY, cloud_profile="clear", facade_tilt=90.0, facade_orientation="west"
        )
    )
    zones = {
        (wall.orientation, zone.zone)
        for tick in payload.ticks
        for wall in tick.facade
        for zone in wall.zones
    }
    assert len(zones) == 4 * 16

    split = [
        row
        for tick in payload.ticks
        for wall in tick.facade
        for row in range(4)
        if len({zone.angle for zone in wall.zones if zone.row == row}) > 1
    ]
    assert split, "no row ever split across its four bays"


def test_a_wall_the_sun_has_gone_behind_keeps_no_beam():
    """Sun on the far side means diffuse only, whatever the zone."""

    assert profile_angle(45.0, 90.0, 270.0) == 90.0
    assert profile_angle(-2.0, 270.0, 270.0) == 90.0
    assert profile_angle(45.0, 270.0, 270.0) == pytest.approx(45.0)


def test_run_endpoint_rejects_an_unknown_timezone():
    with TestClient(app) as client:
        response = client.post("/api/v1/simulations/run", json={"timezone": "Mars/Olympus_Mons"})

    assert response.status_code == 422
