from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULTS, TICK_COUNT
from app.main import app
from app.weather import MetForecast, MetWarning, MetWeatherContext

client = TestClient(app)


def test_health_and_config() -> None:
    assert client.get("/api/v1/health").json()["status"] == "ok"
    config = client.get("/api/v1/config").json()
    assert config["synthetic"] is True
    assert config["simulation"]["tick_minutes"] == 10
    assert config["simulation"]["daylight_evaluation_ghi"] == 200
    assert config["simulation"]["continuous_angles"] is True
    assert config["simulation"]["actuator_speed_deg_per_min"] == 6.0


def test_health_reports_observations_without_contacting_upstreams(monkeypatch) -> None:
    from app import feed_health

    monkeypatch.setattr(feed_health, "_observations", {})
    monkeypatch.delenv("ROBOFLOW_API_KEY", raising=False)

    def forbidden(*args, **kwargs):
        raise AssertionError("Health must never make an outbound request")

    monkeypatch.setattr("app.weather.urlopen", forbidden)
    monkeypatch.setattr("app.vision.urlopen", forbidden)
    result = client.get("/api/v1/health").json()
    assert result["status"] == "ok"
    assert result["service"] == "neuroskin-api"
    assert result["model"] == "deterministic"
    assert result["dependencies"]["roboflow"] == {
        "configured": False,
        "last_status": "unknown",
        "last_success_at": None,
    }
    stamp = datetime(2026, 9, 13, 4, 4, tzinfo=timezone.utc)
    feed_health.record_feed("open_meteo", "applied", stamp)
    feed_health.record_feed("open_meteo", "applied", stamp.replace(day=12))
    feed_health.record_feed("open_meteo", "fallback")
    monkeypatch.setenv("ROBOFLOW_API_KEY", "test-secret")
    result = client.get("/api/v1/health").json()
    assert result["dependencies"]["open_meteo"] == {
        "configured": True,
        "last_status": "fallback",
        "last_success_at": stamp.isoformat(),
    }
    assert result["dependencies"]["roboflow"]["configured"] is True
    assert "test-secret" not in str(result)


@pytest.mark.parametrize("enabled", [False, True])
def test_simulation_is_reproducible_and_complete(enabled: bool) -> None:
    request = {"scenario": "overview", "seed": 7, "daylight_model_enabled": enabled}
    first = client.post("/api/v1/simulations/run", json=request)
    second = client.post("/api/v1/simulations/run", json=request)
    assert first.status_code == 200
    assert first.json() == second.json()
    assert len(first.json()["ticks"]) == TICK_COUNT
    assert first.json()["metadata"]["load_unit"] == "relative cooling-load index"
    assert first.json()["metadata"]["environment_source"] == "synthetic"
    assert first.json()["metadata"]["weather_context"] is None


def test_default_facade_actuators_follow_the_sun_and_reopen() -> None:
    response = client.post(
        "/api/v1/simulations/run", json={"scenario": "overview", "wind_override": 3}
    )
    assert response.status_code == 200
    ticks = response.json()["ticks"]
    walls = {
        orientation: [
            next(wall for wall in tick["facade"] if wall["orientation"] == orientation)
            for tick in ticks
        ]
        for orientation in ("east", "west")
    }
    moves = {
        orientation: [index for index, wall in enumerate(series) if wall["moved"]]
        for orientation, series in walls.items()
    }
    # Diffuse daylight can move a rear-facing wall too; direct sun need not
    # be the trigger for its first adjustment.
    assert any(ticks[index]["solar_azimuth"] < 180 for index in moves["east"])
    assert any(ticks[index]["solar_azimuth"] > 180 for index in moves["west"])
    assert walls["west"][moves["west"][0]]["angle"] > 0
    # The simulated day stops at 19:00, before sunset, so the wall reopens toward
    # flat as the sun drops instead of reaching the night-parked 0 degrees.
    peak = max(wall["angle"] for wall in walls["west"])
    assert 0 <= walls["west"][moves["west"][-1]]["angle"] < peak
    travel = DEFAULTS.actuator_speed_deg_per_min * DEFAULTS.tick_minutes
    for orientation, series in walls.items():
        assert len({tuple(zone["angle"] for zone in wall["zones"]) for wall in series}) > 1
        assert any(len({zone["angle"] for zone in wall["zones"]}) > 1 for wall in series)
        for index in moves[orientation]:
            # Night parking is also a gradual normal movement.
            assert ticks[index]["solar_elevation"] < 90
            assert series[index]["mode"] == "NORMAL"
            assert series[index]["angle"] != series[index - 1]["angle"]
        for previous, current in zip(series, series[1:]):
            for before, after in zip(previous["zones"], current["zones"]):
                assert after["moved"] == (after["angle"] != before["angle"])
                if after["mode"] != "SAFE":
                    assert abs(after["angle"] - before["angle"]) <= travel + 1e-6
                comfort = after["conditions"]
                assert comfort["solar_heat_gain"] == pytest.approx(
                    comfort["transmitted"] * comfort["glazing_shgc"], abs=0.02
                )
                assert 0 <= comfort["direct_sun"] <= comfort["transmitted"] + 0.01
                assert comfort["daylight_status"] in {"low", "useful", "high"}
        angles = [zone["angle"] for wall in series for zone in wall["zones"]]
        # Targets are genuinely refined, not the old 5-degree mechanical grid.
        assert any(0 < angle < 60 and abs(angle / 5 - round(angle / 5)) > 0.01 for angle in angles)


def test_one_sensor_override_changes_only_its_own_zone_and_future_state() -> None:
    request = {"scenario": "overview", "wind_override": 3}
    baseline = client.post("/api/v1/simulations/run", json=request).json()
    override = client.post(
        "/api/v1/simulations/run",
        json={
            **request,
            "zone_sensor_overrides": {
                "W2": {"tick_index": 54, "irradiance": 900, "illuminance": 1200}
            },
        },
    )
    assert override.status_code == 200
    changed = override.json()
    own = []
    for before, after in zip(baseline["ticks"], changed["ticks"]):
        pairs = {}
        assert {key: value for key, value in before.items() if key != "facade"} == {
            key: value for key, value in after.items() if key != "facade"
        }
        for old_wall, new_wall in zip(before["facade"], after["facade"]):
            assert {key: value for key, value in old_wall.items() if key != "zones"} == {
                key: value for key, value in new_wall.items() if key != "zones"
            }
            for old, new in zip(old_wall["zones"], new_wall["zones"]):
                pairs[old["zone"]] = (old, new)
                assert old["sensors"]["sensor_id"] == old["zone"]
                assert old["sensors"]["source"] == "simulated"
                if old["zone"] != "W2":
                    assert old == new
        assert len(pairs) == 64
        own.append(pairs["W2"])
    assert all(old == new for old, new in own[:54])
    old, new = own[54]
    assert new["angle_target"] > old["angle_target"]
    assert new["angle"] > old["angle"] and new["moved"]
    assert new["sensor_trusted"] and "Injected" in new["reason"]
    assert new["sensors"] == {
        "sensor_id": "W2",
        "irradiance": 900,
        "illuminance": 1200,
        "source": "override",
    }
    effective = new["control_input"]
    assert effective["irradiance"] == 900
    assert effective["irradiance_source"] == effective["daylight_source"] == "sensor"
    achieved_transmission = new["conditions"]["transmitted"] / effective["irradiance"]
    assert new["lux"] == pytest.approx(
        max(20, effective["open_lux"] * achieved_transmission), abs=0.05
    )
    assert set(new["cost_breakdown"]) == {"thermal", "lux", "movement", "risk"}
    assert sum(new["cost_breakdown"].values()) > 0
    assert any(old["angle"] != new["angle"] for old, new in own[55:])
    assert all(new["sensors"]["source"] == "simulated" for _, new in own[55:])
    assert baseline["comparison"] == changed["comparison"]


@pytest.mark.parametrize(
    "zone,reading",
    [
        ("W17", {}),
        ("w2", {}),
        ("N0", {}),
        ("W2", {"tick_index": -1}),
        ("W2", {"tick_index": TICK_COUNT}),
        ("W2", {"tick_index": 1.5}),
        ("W2", {"irradiance": -1}),
        ("W2", {"irradiance": 1601}),
        ("W2", {"illuminance": -1}),
        ("W2", {"illuminance": 10001}),
        ("W2", {"irradiance": "NaN"}),
        ("W2", {"illuminance": "Infinity"}),
    ],
)
def test_zone_sensor_override_rejects_invalid_ids_indices_and_readings(zone, reading) -> None:
    response = client.post(
        "/api/v1/simulations/run",
        json={
            "zone_sensor_overrides": {
                zone: {"tick_index": 54, "irradiance": 500, "illuminance": 400, **reading}
            }
        },
    )
    assert response.status_code == 422


def _zone_states(payload: dict) -> dict[tuple[int, str], dict]:
    return {
        (index, zone["zone"]): zone
        for index, tick in enumerate(payload["ticks"])
        for wall in tick["facade"]
        for zone in wall["zones"]
    }


def _without_assurance(payload: dict) -> dict:
    for tick in payload["ticks"]:
        for wall in tick["facade"]:
            for zone in wall["zones"]:
                zone.pop("assurance")
    payload.pop("episodes", None)
    for key in list(payload["summary"]):
        if key.startswith(("assurance_", "episodes_")) or key == "unmatched_approvals":
            payload["summary"].pop(key)
    return payload


def test_fault_window_corrupts_one_zone_and_monitor_only_adds_evidence() -> None:
    request = {"scenario": "overview", "seed": 42}
    dead = {"W6": {"kind": "dead", "start_tick": 36, "end_tick": 54}}
    baseline = client.post("/api/v1/simulations/run", json=request).json()
    faulted = client.post(
        "/api/v1/simulations/run", json={**request, "zone_perturbations": dead}
    ).json()
    before, after = _zone_states(baseline), _zone_states(faulted)
    changed = {key for key in before if before[key] != after[key]}
    assert changed and {zone for _, zone in changed} == {"W6"}
    assert all(index >= 36 for index, _ in changed)
    assert after[(38, "W6")]["sensors"] == {**before[(38, "W6")]["sensors"], "irradiance": 0}
    # Zero is valid shade: without assurance the range check still admits it.
    assert after[(38, "W6")]["sensor_trusted"] is True
    assert "assurance" not in after[(38, "W6")]

    monitored = client.post(
        "/api/v1/simulations/run", json={**request, "fault_correction": "monitor"}
    ).json()
    verdicts = {zone["assurance"]["verdict"] for zone in _zone_states(monitored).values()}
    assert "fault" not in verdicts and "consistent" in verdicts
    assert monitored["summary"]["assurance_fault_zone_ticks"] == 0
    assert _without_assurance(monitored) == baseline

    watched = client.post(
        "/api/v1/simulations/run",
        json={**request, "zone_perturbations": dead, "fault_correction": "monitor"},
    ).json()
    states = _zone_states(watched)
    assert [states[(index, "W6")]["assurance"]["verdict"] for index in (36, 37, 38)] == [
        "suspect",
        "suspect",
        "fault",
    ]
    assert states[(38, "W6")]["assurance"]["hypothesis"] == "dead"
    assert states[(38, "W6")]["assurance"]["episode_id"] == "W6:38:dead"
    # Monitoring records the episode and closes it once the window ends; nothing acts.
    (episode,) = watched["episodes"]
    assert episode["status"] == "closed" and episode["mitigated_tick"] is None
    assert [event["stage"] for event in episode["events"]] == ["detect", "authorise", "close"]
    assert not any(
        state["assurance"]["verdict"] == "fault"
        for (_, zone), state in states.items()
        if zone != "W6"
    )
    assert _without_assurance(watched) == faulted


@pytest.mark.parametrize(
    "body",
    [
        {"zone_perturbations": {"W6": {"kind": "dead", "start_tick": 48, "end_tick": 38}}},
        {"zone_perturbations": {"W6": {"kind": "melted", "start_tick": 38, "end_tick": 48}}},
        {"zone_perturbations": {"W17": {"kind": "dead", "start_tick": 38, "end_tick": 48}}},
        {"zone_perturbations": {"W6": {"kind": "drift", "start_tick": 38, "end_tick": TICK_COUNT}}},
        {
            "zone_perturbations": {
                "W6": {"kind": "fouled", "start_tick": 8, "end_tick": 9, "severity": 0}
            }
        },
        {"fault_correction": "fix_everything"},
    ],
)
def test_fault_injection_and_correction_mode_reject_invalid_requests(body) -> None:
    assert client.post("/api/v1/simulations/run", json=body).status_code == 422


@pytest.mark.parametrize(
    "field,value",
    [
        ("glazing_shgc", -0.01),
        ("glazing_shgc", 1.01),
        ("glazing_shgc", "NaN"),
        ("glare_limit_w_m2", -1),
        ("glare_limit_w_m2", 2001),
        ("glare_limit_w_m2", "Infinity"),
        ("actuator_speed_deg_per_min", 0),
        ("actuator_speed_deg_per_min", 60.1),
        ("actuator_speed_deg_per_min", "NaN"),
    ],
)
def test_comfort_calibration_rejects_out_of_range_or_nonfinite_values(field, value) -> None:
    assert client.post("/api/v1/simulations/run", json={field: value}).status_code == 422


def test_met_anchored_run_exposes_provenance(monkeypatch) -> None:
    context = MetWeatherContext(
        status="applied",
        fetched_at=datetime(2026, 8, 11, 3, 0, tzinfo=timezone.utc),
        forecast=MetForecast(
            date=date(2026, 8, 11),
            location_id="Tn079",
            location_name="Kuala Lumpur",
            min_temp=25,
            max_temp=34,
            morning_forecast="Tiada hujan",
            afternoon_forecast="Ribut petir di beberapa tempat",
            night_forecast="Hujan di satu dua tempat",
            summary_forecast="Ribut petir di beberapa tempat",
            summary_when="Petang",
        ),
        warnings=(
            MetWarning(
                title="Continuous Rain Warning",
                heading="Continuous Rain",
                text="Heavy rain is expected.",
                instruction="Monitor official updates.",
                valid_from="2026-08-11T12:00:00",
                valid_to="2026-08-12T06:00:00",
            ),
        ),
    )
    monkeypatch.setattr("app.domain.scenarios.get_met_weather_context", lambda _day: context)

    response = client.post(
        "/api/v1/simulations/run",
        json={
            "scenario": "overview",
            "date": "2026-08-11",
            "environment_source": "met_anchored",
            "seed": 7,
        },
    )

    assert response.status_code == 200
    metadata = response.json()["metadata"]
    assert metadata["environment_source"] == "met_anchored"
    assert metadata["weather_context"]["status"] == "applied"
    assert metadata["weather_context"]["location_id"] == "Tn079"
    assert metadata["weather_context"]["warnings"][0]["title"] == "Continuous Rain Warning"
    temperatures = [tick["outdoor_temp"] for tick in response.json()["ticks"]]
    assert min(temperatures) == 25
    assert max(temperatures) == 34


def test_met_failure_returns_a_successful_synthetic_fallback(monkeypatch) -> None:
    context = MetWeatherContext(
        status="fallback",
        fetched_at=datetime(2026, 8, 11, 3, 0, tzinfo=timezone.utc),
        forecast=None,
        warnings=(),
        fallback_reason="MET API request failed: upstream unavailable",
    )
    monkeypatch.setattr("app.domain.scenarios.get_met_weather_context", lambda _day: context)

    response = client.post(
        "/api/v1/simulations/run",
        json={"date": "2026-08-11", "environment_source": "met_anchored", "seed": 7},
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["ticks"]) == TICK_COUNT
    assert payload["metadata"]["weather_context"]["status"] == "fallback"
    assert "upstream unavailable" in payload["metadata"]["weather_context"]["fallback_reason"]
    assert "fell back" in payload["metadata"]["data_notice"]


def test_lie_detector_contains_fault_and_cloud_gate() -> None:
    response = client.post("/api/v1/simulations/run", json={"scenario": "lie_detector"})
    payload = response.json()
    assert response.status_code == 200
    assert payload["summary"]["sensor_fault_ticks"] > 0
    assert {event["kind"] for event in payload["annotations"]} == {"fault", "cloud_gate"}


def test_co_optimization_returns_three_comparable_metrics() -> None:
    response = client.post("/api/v1/simulations/run", json={"scenario": "co_optimization"})
    payload = response.json()
    metrics = payload["comparison"]
    assert {metric["metric"] for metric in metrics} == {
        "lux_compliance",
        "relative_load",
        "movement_count",
    }
    by_name = {metric["metric"]: metric for metric in metrics}
    assert by_name["lux_compliance"]["label"] == "Daylight lux compliance"
    # Report the real trade-off, not a promised win over a binary controller:
    # continuous tracking makes more small moves and glare can limit daylight.
    ticks = payload["ticks"]
    occupied = [tick for tick in ticks if tick["occupancy"] >= 0.2]
    daylight = [
        tick
        for tick in occupied
        if next(wall for wall in tick["facade"] if wall["primary"])["incident"] >= 200
    ] or occupied
    for strategy, lux_key, load_key in [
        ("ours", "lux", "load_relative"),
        ("naive", "naive_lux", "naive_load_relative"),
    ]:
        compliance = round(
            100 * sum(300 <= tick[lux_key] <= 700 for tick in daylight) / len(daylight), 1
        )
        assert by_name["lux_compliance"][strategy] == compliance
        mean_load = sum(tick[load_key] for tick in occupied) / len(occupied)
        assert by_name["relative_load"][strategy] == pytest.approx(mean_load, abs=0.0006)
    assert by_name["movement_count"]["ours"] == sum(tick["moved"] for tick in ticks)
    assert by_name["movement_count"]["naive"] == sum(
        before["naive_angle"] != after["naive_angle"] for before, after in zip(ticks, ticks[1:])
    )


def test_budget_scenario_contains_hold_and_fail_shaded_events() -> None:
    response = client.post("/api/v1/simulations/run", json={"scenario": "budget_failsafe"})
    payload = response.json()
    kinds = {event["kind"] for event in payload["annotations"]}
    assert {"movement_hold", "power_loss"} <= kinds
    power_event = next(event for event in payload["annotations"] if event["kind"] == "power_loss")
    hold_event = next(event for event in payload["annotations"] if event["kind"] == "movement_hold")
    hold_tick = next(
        tick for tick in payload["ticks"] if tick["timestamp"] == hold_event["timestamp"]
    )
    power_tick = next(
        tick for tick in payload["ticks"] if tick["timestamp"] == power_event["timestamp"]
    )
    assert hold_tick["mode"] == "HOLD"
    assert hold_tick["moved"] is False
    assert hold_tick["angle_target"] != hold_tick["angle_final"]
    assert power_tick["mode"] == "SAFE"
    assert power_tick["angle_final"] == 60


def test_request_validation_rejects_bad_values() -> None:
    response = client.post(
        "/api/v1/simulations/run",
        json={"scenario": "unknown", "occupancy_scale": 9},
    )
    assert response.status_code == 422


def test_daylight_off_preserves_the_prechange_http_bytes() -> None:
    import hashlib

    from pydantic_core import to_json

    # Pinned at the speed the hash was taken at: this guards the daylight feature being
    # off, and must not move when the actuator default is retuned.
    response = client.post(
        "/api/v1/simulations/run",
        json={"scenario": "overview", "seed": 42, "actuator_speed_deg_per_min": 1.2},
    )
    assert response.status_code == 200
    # New inspection evidence is additive; every pre-existing field and decision
    # still reproduces byte for byte, including field ordering. Rehashed when the
    # simulated day was cut to the 07:00-19:00 occupied window.
    payload = response.json()
    for tick in payload["ticks"]:
        assert tick.pop("wind_direction") is not None
        for wall in tick["facade"]:
            for zone in wall["zones"]:
                assert zone.pop("control_input") is not None
                assert zone.pop("cost_breakdown") is not None
    legacy = to_json(payload)
    assert hashlib.sha256(legacy).hexdigest() == (
        "f665a877f17852a79ba9209034713f4a33318037cab9939cd66c643a24de1c87"
    )


def _glare_ticks(**fields) -> int:
    response = client.post(
        "/api/v1/simulations/run", json={"scenario": "overview", "cloud_profile": "clear", **fields}
    )
    assert response.status_code == 200
    return sum(
        zone["conditions"]["glare_risk"]
        for tick in response.json()["ticks"]
        for wall in tick["facade"]
        for zone in wall["zones"]
    )


def test_default_actuator_can_cover_the_whole_range_within_one_sample() -> None:
    # The old 1.2 deg/min moved 12 degrees a tick, so the facade lagged the sun by up to
    # ~45 degrees. The default must let the louvres reach any target within a sample.
    assert (
        DEFAULTS.actuator_speed_deg_per_min * DEFAULTS.tick_minutes
        >= DEFAULTS.angle_max - DEFAULTS.angle_min
    )


def test_a_realistic_actuator_clears_glare_a_sluggish_one_leaves_behind() -> None:
    sluggish = _glare_ticks(actuator_speed_deg_per_min=1.2)
    default = _glare_ticks()
    assert sluggish > 0, "the slow actuator should still leave glare, or this proves nothing"
    assert default < sluggish
