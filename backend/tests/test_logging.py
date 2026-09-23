import json
import logging

from fastapi.testclient import TestClient

from app.logging_config import JsonFormatter
from app.main import app

client = TestClient(app)


def test_http_logger_returns_and_records_request_id(caplog) -> None:
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="neuroskin.api"):
        response = client.get(
            "/api/v1/health",
            headers={"X-Request-ID": "judge-run-42"},
        )
    assert response.headers["X-Request-ID"] == "judge-run-42"
    completed = next(
        record for record in caplog.records if record.event == "http_request_completed"
    )
    assert completed.request_id == "judge-run-42"
    assert completed.status_code == 200
    assert completed.path == "/api/v1/health"


def test_simulation_logger_records_summary(caplog) -> None:
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="neuroskin.api"):
        response = client.post(
            "/api/v1/simulations/run",
            json={"scenario": "lie_detector", "seed": 42},
        )
    assert response.status_code == 200
    completed = next(record for record in caplog.records if record.event == "simulation_completed")
    assert completed.scenario == "lie_detector"
    assert completed.seed == 42
    assert completed.environment_source == "synthetic"
    assert completed.tick_count == 144
    assert completed.sensor_fault_ticks > 0
    assert completed.fault_correction == "off"
    assert completed.episodes_opened is None


def test_fault_correction_counts_reach_the_json_log(caplog) -> None:
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="neuroskin.api"):
        response = client.post(
            "/api/v1/simulations/run",
            json={
                "fault_correction": "auto",
                "zone_perturbations": {"W6": {"kind": "dead", "start_tick": 78, "end_tick": 84}},
            },
        )
    assert response.status_code == 200
    completed = next(record for record in caplog.records if record.event == "simulation_completed")
    payload = json.loads(JsonFormatter().format(completed))
    assert payload["fault_correction"] == "auto"
    assert payload["assurance_fault_zone_ticks"] > 0
    assert payload["episodes_opened"] == 1
    assert payload["episodes_rolled_back"] == 0
    assert payload["episodes_escalated"] == 0
    assert payload["unmatched_approvals"] == 0


def test_json_log_formatter_includes_context() -> None:
    record = logging.LogRecord(
        name="neuroskin.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="Simulation completed",
        args=(),
        exc_info=None,
    )
    record.event = "simulation_completed"
    record.request_id = "request-1"
    record.tick_count = 144
    payload = json.loads(JsonFormatter().format(record))
    assert payload["level"] == "INFO"
    assert payload["service"] == "neuroskin-api"
    assert payload["event"] == "simulation_completed"
    assert payload["request_id"] == "request-1"
    assert payload["tick_count"] == 144
