"""Seeded sensor-assurance fault matrix.

Run: cd backend && uv run python -m scripts.assurance_matrix [--split calibration] [--smoke]

Writes docs/appendix/assurance-matrix-results.{json,md}. Every number is synthetic: a
healthy simulated sensor is the geometry model plus 1% noise, so these rates are an
upper bound on what a physical facade would show. Thresholds may be tuned on the
calibration seeds only; the evaluation seeds are run once and reported as they fall.
"""

import argparse
import json
import os
import subprocess
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from math import ceil
from pathlib import Path
from statistics import median
from tempfile import gettempdir

from app.config import DEFAULTS
from app.domain.scenarios import run_scenario
from app.schemas import SimulationRunRequest

SPLITS = {"calibration": (1, 2, 3), "evaluation": (7, 11, 13)}
CLOUDS = ("clear", "scattered")
# Interior, corner, top row and bottom row of the west wall.
ZONES = ("W6", "W5", "W14", "W2")
# 13:00-16:00, the west wall's afternoon. Detection is judged on this window only.
START, END = 78, 96
# Recovery-only: 13:00-20:00. Added after the first full run showed that no 3 h fault
# outlived verification (mostly diffuse light, so the branches rarely disagreed); no
# threshold changed with it.
LONG_END = 120
FAULT_CASES = ("dead", "stuck", "drift", "fouled")
CASES = {
    "dead": ("dead", 1.0),
    "stuck": ("stuck", 0.5),
    "drift": ("drift", 0.5),
    "fouled": ("fouled", 0.4),
    "shadow_single": ("shadow", 0.5),
    "shadow_cluster": ("shadow", 0.5),
}
OUTPUT = Path(__file__).resolve().parents[2] / "docs" / "appendix" / "assurance-matrix-results"


def drift_onset() -> int:
    """Ticks into the window before the injected drift exceeds the peer threshold."""

    severity = CASES["drift"][1]
    return ceil(DEFAULTS.assurance_peer_deviation / severity * (END - START))


def neighbour(zone: str) -> str:
    """The same-row neighbour a cluster shadow also covers."""

    index = int(zone[1:]) - 1
    return f"{zone[0]}{index + 2}" if index % 4 < 3 else f"{zone[0]}{index}"


def recovery_quality(
    response, targets: list[str], kind: str | None, severity: float | None, end: int
):
    """Score episodes against the declared ground truth the controller never saw."""

    safe = {index for index, tick in enumerate(response.ticks) if tick.mode == "SAFE"}
    episodes = []
    for episode in response.episodes:
        stages = {event.stage: event.tick_index for event in episode.events}
        mitigated = stages.get("mitigate")
        faulty = episode.zone in targets and kind != "shadow"
        episodes.append(
            {
                "status": episode.status,
                "retained": "retain" in stages,
                "mitigated": mitigated is not None,
                # Isolating a sensor that was not faulty at that moment.
                "false_intervention": mitigated is not None
                and not (faulty and START <= mitigated <= end),
                "safe_tick_mitigation": mitigated in safe,
                "mitigation_delay": mitigated - START
                if mitigated is not None and episode.zone in targets
                else None,
            }
        )
    admitted = reported = isolated = 0.0
    for index in range(START, end + 1):
        for wall in response.ticks[index].facade:
            for heat in wall.zones:
                if heat.zone not in targets or heat.sensor_trusted:
                    continue
                truth = heat.incident * (1 - severity if kind == "shadow" else 1)
                admitted += abs(heat.control_input.irradiance - truth)
                reported += abs(heat.sensors.irradiance - truth)
                isolated += 1
    return {
        "episodes": episodes,
        "isolated_zone_ticks": int(isolated),
        "admitted_error_sum": round(admitted, 2),
        "sensor_error_sum": round(reported, 2),
    }


def run_case(job: tuple[int, str, str, str, int]) -> dict:
    seed, cloud, case, zone, end = job
    targets = []
    if case != "clean":
        targets = [zone, neighbour(zone)] if case == "shadow_cluster" else [zone]
    kind, severity = CASES.get(case, (None, None))

    def run(mode: str, approved: list[str] = ()):
        return run_scenario(
            SimulationRunRequest(
                seed=seed,
                cloud_profile=cloud,
                fault_correction=mode,
                approved_episodes=list(approved),
                zone_perturbations={
                    target: {
                        "kind": kind,
                        "start_tick": START,
                        "end_tick": end,
                        "severity": severity,
                    }
                    for target in targets
                },
            )
        )

    response = run("monitor")
    # Two authorities: bounded automatic policy, and an operator who approves every
    # episode the monitor opened (the replay route the dashboard uses).
    recovery = {
        "auto": recovery_quality(run("auto"), targets, kind, severity, end),
        "approved": recovery_quality(
            run("review", [episode.episode_id for episode in response.episodes]),
            targets,
            kind,
            severity,
            end,
        ),
    }
    first_fault, window, assessed, faults = None, Counter(), 0, 0
    for index, tick in enumerate(response.ticks):
        for wall in tick.facade:
            for heat in wall.zones:
                verdict = heat.assurance.verdict
                if heat.zone in targets:
                    if START <= index <= END:
                        window[verdict] += 1
                        if heat.zone == zone and verdict == "fault" and first_fault is None:
                            first_fault = index
                    continue
                assessed += verdict != "insufficient"
                faults += verdict == "fault"
    return {
        "seed": seed,
        "cloud": cloud,
        "case": case,
        "zone": zone,
        "end_tick": end,
        "delay": None if first_fault is None else first_fault - START,
        "window_verdicts": dict(window),
        "other_assessed_zone_ticks": assessed,
        "other_fault_zone_ticks": faults,
        "recovery": recovery,
    }


def summarise_recovery(rows: list[dict], authority: str) -> dict:
    results = [row["recovery"][authority] for row in rows]
    episodes = [episode for result in results for episode in result["episodes"]]
    delays = [e["mitigation_delay"] for e in episodes if e["mitigation_delay"] is not None]
    statuses = Counter(episode["status"] for episode in episodes)
    isolated = sum(result["isolated_zone_ticks"] for result in results)
    return {
        "cases": len(rows),
        "episodes": len(episodes),
        "mitigated": sum(episode["mitigated"] for episode in episodes),
        "retained": sum(episode["retained"] for episode in episodes),
        "rolled_back": statuses["rolled_back"],
        "escalated": statuses["escalated"],
        "closed": statuses["closed"],
        "unresolved": sum(
            statuses[status] for status in ("monitoring", "awaiting_approval", "mitigating")
        ),
        "false_interventions": sum(episode["false_intervention"] for episode in episodes),
        "safe_tick_mitigations": sum(episode["safe_tick_mitigation"] for episode in episodes),
        "median_mitigation_delay_ticks": median(delays) if delays else None,
        "isolated_zone_ticks": isolated,
        "mean_admitted_error_w_m2": round(
            sum(result["admitted_error_sum"] for result in results) / isolated, 1
        )
        if isolated
        else None,
        "mean_sensor_error_w_m2": round(
            sum(result["sensor_error_sum"] for result in results) / isolated, 1
        )
        if isolated
        else None,
    }


def summarise(all_rows: list[dict]) -> dict:
    rows = [row for row in all_rows if row["end_tick"] == END]
    long_rows = [row for row in all_rows if row["end_tick"] == LONG_END]
    clean = [row for row in rows if row["case"] == "clean"]
    perturbed = [row for row in rows if row["case"] != "clean"]
    kinds = {}
    for case in CASES:
        cases = [row for row in perturbed if row["case"] == case]
        delays = [row["delay"] for row in cases if row["delay"] is not None]
        verdicts = sum((Counter(row["window_verdicts"]) for row in cases), Counter())
        kinds[case] = {
            "cases": len(cases),
            "detected": len(delays),
            "detection_rate": round(len(delays) / len(cases), 3) if cases else None,
            "median_delay_ticks": median(delays) if delays else None,
            "max_delay_ticks": max(delays) if delays else None,
            "window_verdicts": dict(sorted(verdicts.items())),
        }
    return {
        "clean": {
            "runs": len(clean),
            "assessed_zone_ticks": sum(row["other_assessed_zone_ticks"] for row in clean),
            "fault_zone_ticks": sum(row["other_fault_zone_ticks"] for row in clean),
        },
        "collateral": {
            "runs": len(perturbed),
            "assessed_zone_ticks": sum(row["other_assessed_zone_ticks"] for row in perturbed),
            "fault_zone_ticks": sum(row["other_fault_zone_ticks"] for row in perturbed),
        },
        "kinds": kinds,
        "recovery": {
            window: {
                authority: {
                    case: summarise_recovery(
                        [row for row in window_rows if row["case"] == case], authority
                    )
                    for case in cases
                }
                for authority in ("auto", "approved")
            }
            for window, window_rows, cases in (
                ("3 h", rows, ("clean", *CASES)),
                ("7 h", long_rows, FAULT_CASES),
            )
        },
        "rows": all_rows,
    }


def markdown(artifact: dict) -> str:
    design = artifact["design"]
    lines = [
        "# Sensor assurance fault matrix",
        "",
        f"Generated {artifact['generated_at']} at commit `{artifact['commit']}`"
        + (" (uncommitted changes)" if artifact["dirty"] else "")
        + ".",
        "",
        "**Synthetic upper bound.** A healthy simulated zone sensor is the geometry model plus "
        "1% noise, so peers agree far more closely than on a real facade. Shadow cases are the "
        "only unmodelled legitimate condition. Nothing here is a field result.",
        "",
        f"Design: date {design['date']}, west wall, zones {', '.join(design['zones'])}, "
        f"perturbation window ticks {design['window'][0]}-{design['window'][1]} "
        f"(13:00-16:00), clouds {', '.join(design['clouds'])}, `fault_correction=monitor`. "
        f"Severities: {', '.join(f'{k} {v[1]}' for k, v in CASES.items())}.",
        "",
    ]
    for name, split in artifact["splits"].items():
        seeds = ", ".join(map(str, design["splits"][name]))
        clean, collateral = split["clean"], split["collateral"]
        lines += [
            f"## {name.title()} seeds ({seeds})",
            "",
            "| Case | Cases | Detected (fault) | Median delay | Max delay | Window verdicts on the "
            "perturbed zone(s) |",
            "|---|---:|---:|---:|---:|---|",
        ]
        for case, row in split["kinds"].items():
            verdicts = ", ".join(f"{k} {v}" for k, v in row["window_verdicts"].items())
            lines.append(
                f"| {case} | {row['cases']} | {row['detected']} | "
                f"{row['median_delay_ticks'] if row['median_delay_ticks'] is not None else '—'} | "
                f"{row['max_delay_ticks'] if row['max_delay_ticks'] is not None else '—'} | "
                f"{verdicts} |"
            )
        lines += [
            "",
            f"Clean runs: {clean['fault_zone_ticks']} fault verdicts in "
            f"{clean['assessed_zone_ticks']:,} assessed zone-ticks ({clean['runs']} runs). "
            f"Unperturbed zones in perturbed runs: {collateral['fault_zone_ticks']} in "
            f"{collateral['assessed_zone_ticks']:,}. Delays are ticks (10 min) from the window "
            "start. A drift ramps from zero and first exceeds the "
            f"{DEFAULTS.assurance_peer_deviation:.0%} peer-deviation threshold after "
            f"{drift_onset()} ticks, so most of its delay is the fault becoming visible.",
            "",
            f"### Recovery quality ({seeds})",
            "",
            "| Fault window | Authority | Case | Cases | Episodes | Isolated | Retained | "
            "Rolled back | Escalated | Closed | Unresolved | False interventions | "
            "On SAFE ticks | Median delay | Isolated zone-ticks | Admitted error | "
            "Sensor error |",
            "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
        for window, authority, cases in (
            (window, authority, cases)
            for window, authorities in split["recovery"].items()
            for authority, cases in authorities.items()
        ):
            for case, row in cases.items():
                cells = [
                    row[key] if row[key] is not None else "—"
                    for key in (
                        "cases",
                        "episodes",
                        "mitigated",
                        "retained",
                        "rolled_back",
                        "escalated",
                        "closed",
                        "unresolved",
                        "false_interventions",
                        "safe_tick_mitigations",
                        "median_mitigation_delay_ticks",
                        "isolated_zone_ticks",
                        "mean_admitted_error_w_m2",
                        "mean_sensor_error_w_m2",
                    )
                ]
                lines.append(
                    f"| {window} | {authority} | {case} | " + " | ".join(map(str, cells)) + " |"
                )
        lines.append("")
    lines += [
        "For shadow cases a `fault` verdict is a false alarm; `legitimate_condition` and "
        "`insufficient` are acceptable.",
        "",
        "**Recovery columns.** `auto` isolates only dead/stuck hypotheses at score ≥ "
        f"{DEFAULTS.recovery_auto_score}; `approved` replays the run with every episode the "
        "monitor opened approved by an operator. Retained counts episodes ever retained, "
        "including those later restored or escalated at the episode limit. Closed episodes "
        "ended because the sensor agreed with its peers again (restored); rolled back means "
        "verification found the correction did not help. The 7 h window (ticks "
        f"{START}-{LONG_END}) is recovery-only and was added after the first full run "
        "showed no 3 h fault outlived verification; no threshold changed with it. A false "
        "intervention is an isolation applied while no declared fault was active on that "
        "zone. Admitted and sensor error are mean |irradiance − truth| (W/m²) over the "
        "window's isolated zone-ticks, for the substitute the controller used and for the "
        "reading it set aside. Truth is the simulation's declared incident, which the "
        "controller never sees; its own verification compares branches on peer evidence, "
        "so the two measures are reported separately and never merged.",
        "",
        "Reproduce: `make assurance-matrix` (add `ARGS=--split calibration` to tune).",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", choices=[*SPLITS, "all"], default="all")
    parser.add_argument("--smoke", action="store_true", help="one seed, cloud and zone")
    args = parser.parse_args()
    splits = SPLITS if args.split == "all" else {args.split: SPLITS[args.split]}
    clouds, zones = CLOUDS, ZONES
    if args.smoke:
        splits = {name: seeds[:1] for name, seeds in list(splits.items())[:1]}
        clouds, zones = CLOUDS[:1], ZONES[:1]
    results = {}
    with ProcessPoolExecutor(max_workers=os.cpu_count()) as pool:
        for name, seeds in splits.items():
            jobs = [(seed, cloud, "clean", "", END) for seed in seeds for cloud in clouds]
            jobs += [
                (seed, cloud, case, zone, end)
                for seed in seeds
                for cloud in clouds
                for zone in zones
                for case, end in (
                    *((case, END) for case in CASES),
                    *((case, LONG_END) for case in FAULT_CASES),
                )
            ]
            results[name] = summarise(list(pool.map(run_case, jobs)))
            print(name, json.dumps(results[name]["kinds"]), flush=True)
    commit = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True
    ).stdout.strip()
    dirty = bool(
        subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True).stdout
    )
    artifact = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "commit": commit,
        "dirty": dirty,
        "design": {
            "date": "2026-03-21",
            "splits": {name: list(seeds) for name, seeds in splits.items()},
            "clouds": list(clouds),
            "zones": list(zones),
            "window": [START, END],
            "recovery_long_window": [START, LONG_END],
            "severities": {case: severity for case, (_, severity) in CASES.items()},
        },
        "splits": results,
    }
    # A smoke run must never overwrite the recorded evidence.
    path = Path(gettempdir()) / "assurance-matrix-smoke" if args.smoke else OUTPUT
    path.with_suffix(".json").write_text(json.dumps(artifact, indent=2) + "\n")
    path.with_suffix(".md").write_text(markdown(artifact))
    print(f"wrote {path.with_suffix('.json')} and .md")


if __name__ == "__main__":
    main()
