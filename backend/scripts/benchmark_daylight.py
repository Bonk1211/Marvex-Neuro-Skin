"""Real-artifact HTTP parity and timing check: python -m scripts.benchmark_daylight."""

import json
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

import numpy as np
from fastapi.testclient import TestClient

from app.config import DEFAULTS
from app.domain import scenarios
from app.domain.daylight import surrogate
from app.main import app


def legacy(payload):
    """Remove only the new observations; every old key/value must still agree."""
    if isinstance(payload, dict):
        return {
            key: legacy(value)
            for key, value in payload.items()
            if key not in ("daylight", "daylight_probes", "eye_illuminance", "task_illuminance")
        }
    return [legacy(v) for v in payload] if isinstance(payload, list) else payload


def main() -> None:
    client, rows, results = TestClient(app), [], {}
    started = perf_counter()
    assert surrogate.models() is not None, "Run make daylight-train first"
    load = perf_counter() - started
    for name, enabled, step in (
        ("off", False, 5),
        ("1 degree", True, 1),
        ("5 degree", True, 5),
        ("5 degree cached", True, 5),
    ):
        scenarios.DEFAULTS = replace(DEFAULTS, daylight_angle_step=step)
        started = perf_counter()
        response = client.post(
            "/api/v1/simulations/run",
            json={
                "scenario": "overview",
                "seed": 42,
                "daylight_model_enabled": enabled,
            },
        )
        elapsed = perf_counter() - started
        assert response.status_code == 200
        results[name] = response.json()
        rows.append({"mode": name, "seconds": elapsed, "bytes": len(response.content)})
        assert legacy(results[name]) == results["off"]
        print(name, round(elapsed, 3), flush=True)
    assert results["5 degree"] == results["5 degree cached"]
    baseline = Path("/private/tmp/daylight-prechange-baseline.json")
    if baseline.exists():
        assert results["off"] == json.loads(baseline.read_text())
    with TemporaryDirectory() as directory:
        surrogate.DEFAULTS = replace(DEFAULTS, daylight_model_dir=directory)
        response = client.post("/api/v1/simulations/run", json={"daylight_model_enabled": True})
        assert response.json() == results["off"]
    surrogate.DEFAULTS, scenarios.DEFAULTS = DEFAULTS, DEFAULTS
    values = {}
    for name in ("1 degree", "5 degree"):
        values[name] = np.array(
            [
                (p["task_illuminance"], p["eye_illuminance"])
                for tick in results[name]["ticks"]
                if not tick["daylight"]["night"]
                for wall in tick["facade"]
                for zone in wall["zones"]
                for p in zone["conditions"].get("daylight_probes", [])
                if p["kind"] == "seat"
            ]
        )
    errors = np.abs(values["1 degree"] - values["5 degree"])
    verdicts = (values["1 degree"][:, 1] > DEFAULTS.ev_cap_lux) != (
        values["5 degree"][:, 1] > DEFAULTS.ev_cap_lux
    )
    artifact = {
        "runs": rows,
        "model_load_seconds": load,
        "seat_ticks_compared": len(errors),
        "coarsening_mae_et_ev_lux": errors.mean(axis=0).tolist(),
        "coarsening_max_et_ev_lux": errors.max(axis=0).tolist(),
        "ev_cap_classification_changes": int(verdicts.sum()),
    }
    path = Path("../docs/appendix/daylight-inference-results")
    path.with_suffix(".json").write_text(json.dumps(artifact, indent=2) + "\n")
    table = "\n".join(f"| {r['mode']} | {r['seconds']:.3f} | {r['bytes']:,} |" for r in rows)
    path.with_suffix(".md").write_text(
        "# Daylight serving verification\n\n"
        "Default overview, seed 42; 144 ticks, all 64 zones and 16 illustrative floor plans. "
        "Timing includes HTTP validation/serialization via TestClient, excludes network transit. "
        "The same process loads the real artifacts once; "
        "each grid starts without a matching curve cache.\n\n"
        f"Model load: {load:.3f} s.\n\n"
        f"| Mode | Seconds | Response bytes |\n|---|---:|---:|\n{table}\n\n"
        f"Five-degree overhead: {rows[2]['seconds'] - rows[0]['seconds']:.3f} s. "
        "The one-degree grid exceeded the ~1 s budget, so serving uses the training grid's "
        "five-degree spacing, interpolated to whole degrees and then to the achieved angle. "
        "The remaining uncached overhead is reported rather than hidden; "
        "the feature defaults off.\n\n"
        f"Compared {len(errors):,} daylight seat-ticks with the one-degree reference. "
        f"Added Et/Ev MAE: {errors.mean(axis=0).round(3).tolist()} lux; "
        f"maximum: {errors.max(axis=0).round(3).tolist()} lux. "
        f"Ev-cap classifications changed for {int(verdicts.sum())} seat-ticks. "
        "This is interpolation sensitivity, separate from the oracle holdout error.\n\n"
        "Assertions passed: all legacy response fields unchanged with observations enabled; "
        "identical predictions on repeat; missing artifacts reproduce the off response; "
        "saved pre-change baseline agrees when present. Night estimates remain null.\n\n"
        "Reproduce: `cd backend && uv run python -m scripts.benchmark_daylight`. "
        "Requires the locally trained, gitignored artifacts.\n"
    )
    Path("/private/tmp/daylight-enabled-response.json").write_text(json.dumps(results["5 degree"]))


if __name__ == "__main__":
    main()
