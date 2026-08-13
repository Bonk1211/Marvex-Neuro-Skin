from datetime import date, datetime, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.weather import MetForecast, MetWarning, MetWeatherContext

client = TestClient(app)


def test_health_and_config() -> None:
    assert client.get("/api/v1/health").json()["status"] == "ok"
    config = client.get("/api/v1/config").json()
    assert config["synthetic"] is True
    assert config["simulation"]["tick_minutes"] == 10
    assert config["simulation"]["daylight_evaluation_ghi"] == 200


def test_simulation_is_reproducible_and_complete() -> None:
    request = {"scenario": "overview", "seed": 7}
    first = client.post("/api/v1/simulations/run", json=request)
    second = client.post("/api/v1/simulations/run", json=request)
    assert first.status_code == 200
    assert first.json() == second.json()
    assert len(first.json()["ticks"]) == 144
    assert first.json()["metadata"]["load_unit"] == "relative cooling-load index"
    assert first.json()["metadata"]["environment_source"] == "synthetic"
    assert first.json()["metadata"]["weather_context"] is None


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
    assert len(payload["ticks"]) == 144
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
    metrics = response.json()["comparison"]
    assert {metric["metric"] for metric in metrics} == {
        "lux_compliance",
        "relative_load",
        "movement_count",
    }
    by_name = {metric["metric"]: metric for metric in metrics}
    assert by_name["lux_compliance"]["label"] == "Daylight lux compliance"
    assert by_name["lux_compliance"]["ours"] > by_name["lux_compliance"]["naive"]
    assert by_name["relative_load"]["ours"] < by_name["relative_load"]["naive"]
    assert by_name["movement_count"]["ours"] < by_name["movement_count"]["naive"]


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
