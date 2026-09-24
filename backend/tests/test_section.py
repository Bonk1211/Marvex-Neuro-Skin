from math import pi

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULTS
from app.domain.daylight.oracle import probe_breakdown, solve_radiosity
from app.domain.daylight.room import Probe, RoomGeometry
from app.main import app

client = TestClient(app)

SUNNY = {
    "orientation": "west",
    "band": 1,
    "beam_flux": 180.0,
    "diffuse_flux": 90.0,
    "solar_elevation": 22.0,
    "solar_azimuth": 262.0,
}


def _field(beam: float = 180.0, diffuse: float = 90.0):
    return solve_radiosity(
        RoomGeometry(),
        beam_flux=beam,
        diffuse_flux=diffuse,
        solar_elevation=22.0,
        solar_azimuth=262.0,
        wall_azimuth=270.0,
    )


def test_section_serves_every_patch_and_probe_with_a_yaw_sweep() -> None:
    body = client.post("/api/v1/daylight/section", json=SUNNY).json()
    faces, divisions = 6, DEFAULTS.daylight_patch_divisions
    assert len(body["patches"]) == faces * divisions**2
    assert body["probes"] and all(p["zone"] for p in body["probes"])
    assert len(body["yaw_sweep"]) == 24
    assert body["bounces"] == DEFAULTS.daylight_oracle_bounces
    assert "not measured" in body["provenance"]


def test_default_selection_is_the_brightest_seat_not_a_desk() -> None:
    body = client.post("/api/v1/daylight/section", json=SUNNY).json()
    selected = body["selected"]
    seats = [p for p in body["probes"] if p["kind"] == "seat"]
    assert selected["index"] == max(seats, key=lambda p: p["eye_lux"])["index"]
    assert selected["eye_lux"] == pytest.approx(max(p["eye_lux"] for p in seats), abs=0.1)


def test_turning_the_head_away_from_the_glazing_collapses_ev() -> None:
    """The whole case for sensing posture: same room, same louvre, only the head moves."""
    body = client.post("/api/v1/daylight/section", json=SUNNY).json()
    sweep = {s["view_deg"]: s["eye_lux"] for s in body["yaw_sweep"]}
    assert sweep[0.0] > 5 * sweep[180.0]


def test_view_override_reproduces_the_sweep_it_replaces() -> None:
    swept = client.post("/api/v1/daylight/section", json=SUNNY).json()
    target = swept["yaw_sweep"][6]  # 90 degrees
    forced = client.post(
        "/api/v1/daylight/section",
        json={**SUNNY, "probe_index": swept["selected"]["index"], "view_deg": target["view_deg"]},
    ).json()
    assert forced["selected"]["eye_lux"] == pytest.approx(target["eye_lux"], abs=0.2)


def test_patch_contributions_account_for_the_interreflected_share() -> None:
    body = client.post("/api/v1/daylight/section", json=SUNNY).json()
    total = sum(p["contribution_lux"] for p in body["patches"])
    assert total == pytest.approx(body["selected"]["eye_interreflected_lux"], rel=0.02)


def test_a_beamless_room_is_lit_only_by_bounce() -> None:
    body = client.post("/api/v1/daylight/section", json={**SUNNY, "beam_flux": 0.0}).json()
    assert body["normal_beam_w_m2"] == 0
    assert body["selected"]["eye_direct_lux"] == pytest.approx(0, abs=0.1)
    assert body["selected"]["eye_lux"] > 0


def test_a_dark_room_stays_dark() -> None:
    body = client.post(
        "/api/v1/daylight/section",
        json={**SUNNY, "beam_flux": 0.0, "diffuse_flux": 0.0},
    ).json()
    assert body["selected"]["eye_lux"] == 0
    assert all(p["radiosity_lux"] == 0 for p in body["patches"])


def test_breakdown_rejects_a_probe_outside_the_room() -> None:
    room = RoomGeometry()
    outside = Probe("seat", room.width + 1, 2.0, 1.2, 0.0)
    with pytest.raises(ValueError, match="strictly inside"):
        probe_breakdown(room, outside, _field())


def test_breakdown_matches_the_probes_own_facing_when_not_overridden() -> None:
    room = RoomGeometry()
    probe = Probe("seat", room.width / 2, 2.0, 1.2, pi / 3)
    field = _field()
    assert probe_breakdown(room, probe, field).eye_lux == pytest.approx(
        probe_breakdown(room, probe, field, view_rad=pi / 3).eye_lux
    )


def test_zone_scopes_the_default_pick_to_the_selected_bay() -> None:
    free = client.post("/api/v1/daylight/section", json=SUNNY).json()
    seat_zones = sorted({p["zone"] for p in free["probes"] if p["kind"] == "seat"})
    assert len(seat_zones) > 1, "need more than one bay for this to mean anything"
    for zone in seat_zones:
        body = client.post("/api/v1/daylight/section", json={**SUNNY, "zone": zone}).json()
        chosen = next(p for p in body["probes"] if p["index"] == body["selected"]["index"])
        assert chosen["zone"] == zone
        assert chosen["kind"] == "seat"


def test_an_empty_zone_falls_back_to_the_band_instead_of_blanking() -> None:
    free = client.post("/api/v1/daylight/section", json=SUNNY).json()
    stray = client.post("/api/v1/daylight/section", json={**SUNNY, "zone": "W99"}).json()
    assert stray["selected"]["index"] == free["selected"]["index"]


def test_an_explicit_probe_index_outranks_the_zone() -> None:
    free = client.post("/api/v1/daylight/section", json=SUNNY).json()
    seats = [p for p in free["probes"] if p["kind"] == "seat"]
    other = next(p for p in seats if p["zone"] != seats[0]["zone"])
    body = client.post(
        "/api/v1/daylight/section",
        json={**SUNNY, "zone": seats[0]["zone"], "probe_index": other["index"]},
    ).json()
    assert body["selected"]["index"] == other["index"]
