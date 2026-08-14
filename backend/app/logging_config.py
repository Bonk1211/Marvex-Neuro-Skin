import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

LOG_FIELDS = (
    "event",
    "request_id",
    "method",
    "path",
    "status_code",
    "duration_ms",
    "scenario",
    "seed",
    "environment_source",
    "weather_status",
    "tick_count",
    "movement_count",
    "sensor_fault_ticks",
    "safe_mode_ticks",
    # Predictive slab charging.
    "planned_date",
    "forecast_status",
    "applicable",
    "baseline_verdict",
    "claim_allowed",
    "saving_percent",
)


class JsonFormatter(logging.Formatter):
    """Small JSON formatter suitable for local logs and container stdout."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(
                timespec="milliseconds"
            ),
            "service": "neuroskin-api",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for field in LOG_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging() -> None:
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    root = logging.getLogger()

    # Uvicorn or a test runner may already own the root handlers. Add our
    # stdout handler only when the application is responsible for logging.
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        root.addHandler(handler)
        root.setLevel(level)

    logging.getLogger("neuroskin").setLevel(level)
    if level > logging.DEBUG:
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
