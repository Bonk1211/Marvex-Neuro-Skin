from fastapi.testclient import TestClient

from app.main import app

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
