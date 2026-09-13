"""Last observed adapter results; health requests never contact providers."""

import logging
import os
from datetime import datetime, timezone
from threading import Lock

logger = logging.getLogger("neuroskin.feeds")
# ponytail: process-local observations reset on restart; share storage if workers need one view.
_observations: dict[str, dict[str, str | None]] = {}
_lock = Lock()


def record_feed(name: str, status: str, fetched_at: datetime | None = None) -> None:
    with _lock:
        previous = _observations.get(name, {})
        success = previous.get("last_success_at")
        if status == "applied":
            stamp = (fetched_at or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()
            success = max(success or stamp, stamp)
        _observations[name] = {"last_status": status, "last_success_at": success}
    logger.info(
        "Feed observed",
        extra={"event": "feed_observed", "environment_source": name, "weather_status": status},
    )


def feed_health() -> dict[str, dict[str, object]]:
    configured = {
        "roboflow": bool(os.environ.get("ROBOFLOW_API_KEY", "").strip()),
        "open_meteo": True,
        "met_malaysia": True,
    }
    with _lock:
        return {
            name: {
                "configured": enabled,
                "last_status": _observations.get(name, {}).get("last_status", "unknown"),
                "last_success_at": _observations.get(name, {}).get("last_success_at"),
            }
            for name, enabled in configured.items()
        }
