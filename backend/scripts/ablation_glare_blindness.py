"""Score the shipped controller's actual zone decisions with the room oracle."""

import argparse
import hashlib
import json
from dataclasses import replace
from datetime import date
from pathlib import Path
from time import perf_counter

import pandas as pd

from app.config import DEFAULTS
from app.domain.daylight.oracle import illuminance_at_probes
from app.domain.daylight.room import ORIENTATIONS, RoomGeometry, probes_for, zone_for
from app.domain.scenarios import run_scenario
from app.domain.thermal import load_at_angle, predict_load
from app.schemas import SimulationRunRequest
from scripts.generate_daylight_dataset import day_inputs, optics_for


def score_day(day: date, seed: int) -> tuple[list[dict], list[dict]]:
    request = SimulationRunRequest(date=day, seed=seed)
    run = run_scenario(request)
    envs, suns, gains = day_inputs(day, seed)
    room = RoomGeometry()
    rows, totals = [], []
    for controller in ("naive", "NeuroSkin (shipped)"):
        moves, load_sum, load_count = 0, 0.0, 0
        previous_naive = 0.0
        for tick_index, tick in enumerate(run.ticks):
            solar, env = suns[tick_index], envs[tick_index]
            naive_moved = tick.naive_angle != previous_naive
            previous_naive = tick.naive_angle
            all_zones = [zone for wall in tick.facade for zone in wall.zones]
            moves += (
                len(all_zones) * naive_moved
                if controller == "naive"
                else sum(zone.moved for zone in all_zones)
            )
            if (
                solar.elevation <= DEFAULTS.min_elevation
                or env.occupancy < DEFAULTS.daylight_occupied_min
            ):
                continue
            for orientation in ORIENTATIONS:
                wall = next(w for w in tick.facade if w.orientation == orientation)
                by_zone = {z.zone: z for z in wall.zones}
                raw_gains = {g.zone: g for g in gains[tick_index][orientation]}
                for band in range(DEFAULTS.facade_zone_rows):
                    seats = tuple(p for p in probes_for(orientation, band) if p.kind == "seat")
                    over, in_band, blind, max_ev = 0, 0, 0, 0.0
                    for zone_id in sorted({zone_for(p, orientation, band, room) for p in seats}):
                        selected = tuple(
                            p for p in seats if zone_for(p, orientation, band, room) == zone_id
                        )
                        gain, zone = raw_gains[zone_id], by_zone[zone_id]
                        optics = optics_for(gain, solar)
                        angle = tick.naive_angle if controller == "naive" else zone.angle
                        labels = illuminance_at_probes(
                            room,
                            selected,
                            beam_flux=gain.incident
                            * optics.beam_fraction
                            * optics.beam_transmittance(angle),
                            diffuse_flux=gain.incident
                            * (1 - optics.beam_fraction)
                            * optics.diffuse_transmittance(angle),
                            solar_elevation=solar.elevation,
                            solar_azimuth=solar.azimuth,
                            wall_azimuth=gain.azimuth,
                        )
                        for et, ev in labels:
                            over += ev > DEFAULTS.ev_cap_lux
                            in_band += DEFAULTS.et_band_low_lux <= et <= DEFAULTS.et_band_high_lux
                            blind += ev > DEFAULTS.ev_cap_lux and not zone.conditions.glare_risk
                            max_ev = max(max_ev, ev)
                    rows.append(
                        {
                            "controller": controller,
                            "day_id": day.isoformat(),
                            "tick": tick_index,
                            "orientation": orientation,
                            "band": band,
                            "seats": len(seats),
                            "over_cap_seats": over,
                            "et_in_band_seats": in_band,
                            "screen_missed_seats": blind,
                            "max_ev_lux": max_ev,
                        }
                    )
                # Compare the relative-load proxy on the same occupied/daylight
                # zone-ticks, using the local incident sensor each controller used.
                for zone in wall.zones:
                    if controller == "naive":
                        optics = optics_for(raw_gains[zone.zone], solar)
                        load = predict_load(replace(env, ghi=zone.sensors.irradiance), solar)
                        value = load_at_angle(
                            load,
                            tick.naive_angle,
                            transmittance=optics.solar_transmittance(tick.naive_angle)
                            * request.glazing_shgc,
                        )
                    else:
                        value = zone.load_relative
                    load_sum += value
                    load_count += 1
        totals.append(
            {
                "controller": controller,
                "day_id": day.isoformat(),
                "movement_count": moves,
                "load_sum": load_sum,
                "load_count": load_count,
            }
        )
    return rows, totals


def summarize(rows: pd.DataFrame, totals: pd.DataFrame) -> list[dict]:
    result = []
    for controller, group in rows.groupby("controller", sort=False):
        ticks = group.groupby(["day_id", "tick"]).over_cap_seats.sum()
        operating = totals.loc[totals.controller == controller]
        seats = int(group.seats.sum())
        count = len(ticks)
        result.append(
            {
                "controller": controller,
                "occupied_daylight_ticks": count,
                "ev_exceedance_ticks": int((ticks > 0).sum()),
                "ev_exceedance_percent": float((ticks > 0).mean() * 100),
                "room_ticks": len(group),
                "room_exceedance_ticks": int((group.over_cap_seats > 0).sum()),
                "room_exceedance_percent": float((group.over_cap_seats > 0).mean() * 100),
                "seat_ticks": seats,
                "over_cap_seat_ticks": int(group.over_cap_seats.sum()),
                "seat_exceedance_percent": float(group.over_cap_seats.sum() / seats * 100),
                "et_in_band_seat_ticks": int(group.et_in_band_seats.sum()),
                "et_in_band_percent": float(group.et_in_band_seats.sum() / seats * 100),
                "movement_count": int(operating.movement_count.sum()),
                "mean_relative_load": float(operating.load_sum.sum() / operating.load_count.sum()),
                "max_ev_lux": float(group.max_ev_lux.max()),
            }
        )
    return result


def write_report(rows: pd.DataFrame, totals: pd.DataFrame, *, seed: int, output: Path) -> dict:
    results = summarize(rows, totals)
    ours = next(r for r in results if r["controller"] == "NeuroSkin (shipped)")
    naive = next(r for r in results if r["controller"] == "naive")
    days = sorted(rows.day_id.unique())
    code_paths = [
        Path(__file__),
        *[
            Path("app/domain") / name
            for name in (
                "controller.py",
                "brain.py",
                "scenarios.py",
                "optics.py",
                "environment.py",
                "facade.py",
                "daylight/oracle.py",
                "daylight/room.py",
            )
        ],
        Path("app/config.py"),
    ]
    code_sha = hashlib.sha256(b"".join(p.read_bytes() for p in code_paths)).hexdigest()
    missed = int(rows.loc[rows.controller == "NeuroSkin (shipped)", "screen_missed_seats"].sum())
    data = {
        "seed": seed,
        "days": days,
        "tick_minutes": DEFAULTS.tick_minutes,
        "ev_cap_lux": DEFAULTS.ev_cap_lux,
        "et_band_low_lux": DEFAULTS.et_band_low_lux,
        "et_band_high_lux": DEFAULTS.et_band_high_lux,
        "modelled": True,
        "code_sha256": code_sha,
        "results": results,
        "screen_missed_seat_ticks": missed,
        "by_day": {
            day: summarize(rows.loc[rows.day_id == day], totals.loc[totals.day_id == day])
            for day in days
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.with_suffix(".json").write_text(json.dumps(data, indent=2, allow_nan=False) + "\n")
    table = [
        "| Controller | Any seat Ev > cap (% hours) | Et in band (% seat-hours) | "
        "Full-day zone moves | Mean relative load |",
        "|---|---:|---:|---:|---:|",
    ]
    for row in results:
        table.append(
            f"| {row['controller']} | {row['ev_exceedance_percent']:.2f} | "
            f"{row['et_in_band_percent']:.2f} | {row['movement_count']:,} | "
            f"{row['mean_relative_load']:.4f} |"
        )
    conclusion = (
        "The pre-registered near-zero condition holds: this geometry does not show a "
        "material glare-screening gap; stop Phase B."
        if ours["ev_exceedance_percent"] < DEFAULTS.daylight_negligible_exceedance_percent
        else "The oracle shows occupant-plane exceedance the controller did not compute. "
        "This does not demonstrate that adding Ev to control would avoid those exposures; "
        "that requires a separate controller intervention experiment."
    )
    comparison = (
        "NeuroSkin already beats the naive baseline on any-seat exceedance without computing Ev. "
        "Its existing direct-beam screen therefore supplies partial protection."
        if ours["ev_exceedance_percent"] < naive["ev_exceedance_percent"]
        else "NeuroSkin does not beat naive on the headline any-seat exceedance "
        "measure in this sweep."
    )
    details = []
    for r in results:
        details.append(
            f"{r['controller']}: {r['ev_exceedance_ticks']}/{r['occupied_daylight_ticks']} "
            f"building ticks; {r['room_exceedance_percent']:.2f}% of room-hours; "
            f"{r['seat_exceedance_percent']:.2f}% of seat-hours over cap. "
            f"Maximum Ev {r['max_ev_lux']:,.1f} lux, unclamped."
        )
    text = (
        "\n\n".join(
            [
                "# Daylight glare-blindness experiment",
                "> Modelled, seeded days; uncalibrated illustrative geometry, not "
                "measured occupant comfort.",
                f"The shipped controller spent "
                f"**{ours['ev_exceedance_percent']:.2f}%** of eligible "
                "occupied daylight hours with at least one modelled seat above the eye-illuminance "
                f"cap ({DEFAULTS.ev_cap_lux:g} lux). It never computed Ev.",
                "\n".join(table),
                conclusion,
                comparison,
                "## Population and denominators",
                f"Dates: {', '.join(days)}. Seed {seed}, overview defaults, "
                f"synthetic scattered skies, "
                f"Putrajaya, 115° facade tilt. A tick is eligible when occupancy ≥ "
                f"{DEFAULTS.daylight_occupied_min:g} and solar elevation > "
                f"{DEFAULTS.min_elevation:g}°. "
                "Every chair is a fixed probe while eligible; fractional occupancy "
                "is not a seat schedule.",
                f"Any-seat exceedance is the union across all four orientations × "
                f"four floor groups "
                f"at each {DEFAULTS.tick_minutes}-minute tick, so groups are not "
                f"counted as independent "
                "building hours. Et compliance divides compliant seat-ticks by all "
                "eligible seat-ticks "
                f"using [{DEFAULTS.et_band_low_lux:g}, "
                f"{DEFAULTS.et_band_high_lux:g}] lux, inclusive. "
                "Movement counts sum changes of all 64 zone actuators over complete "
                "days, including "
                "night parking; naive starts at 0°. Relative load averages identical "
                "eligible zone-ticks.",
                "\n\n".join(details),
                f"There were {missed:,} shipped seat-ticks above the Ev cap while "
                f"the corresponding "
                "zone's existing exterior direct-beam screen reported no risk. Ev is a screening "
                "proxy, not a diagnosis of discomfort.",
                "## Method and limits",
                "The real `run_scenario` path executes the shipped zone controller "
                "with its existing "
                "sensor streams, movement budget and safety rules. Each actual zone angle and the "
                "same tick's naive angle are independently re-scored with the "
                "oracle. Neither model "
                "artifact nor surrogate prediction is used. A probe belongs to the facade column "
                "containing its facade-local x coordinate; corner-neighbour sensor coupling does "
                "not create a second aperture in the oracle.",
                "The room is a 6.4 × 6.4 × 3.6 m empty box, full-wall transparent "
                "aperture, wall/floor/"
                "ceiling reflectances 0.5/0.2/0.8. Four passes of diffuse-patch radiosity use 4×4 "
                "patches per surface; coarse view factors are normalised to prevent "
                "energy creation. "
                "Direct beam visibility is traced at each eye. Louvre transmission is the existing "
                "spatially averaged optics. Furniture, partitions, a spectral glazing model and "
                "measured calibration are absent. This is not a Radiance validation.",
                "[Tabatabaei Manesh et al. (2025)](https://doi.org/10.1016/j.autcon.2025.106474) "
                "supplies method precedent, room reflectances and the Ev/Et screening choices. "
                "A fixed 110 lm/W efficacy is an assumption informed by "
                "[Littlefair (1988)](https://doi.org/10.1177/096032718802000405). "
                "Neither paper establishes the outcome of this local experiment.",
                "## Reproduction",
                f"`make daylight-ablate` regenerates this report and its JSON "
                f"numerator/denominator "
                f"companion. Source SHA-256: `{code_sha}`. Raw per-room tick scores are saved to "
                "`backend/data/daylight/ablation-scores.parquet`. All results are deterministic; "
                "execution timing is deliberately excluded from the evidence hash.",
            ]
        )
        + "\n"
    )
    output.write_text(text)
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, choices=range(1, 13), default=12)
    parser.add_argument("--seed", type=int, default=DEFAULTS.seed)
    args = parser.parse_args()
    started = perf_counter()
    rows, totals = [], []
    for day in DEFAULTS.daylight_dataset_days[: args.days]:
        day_rows, day_totals = score_day(date.fromisoformat(day), args.seed)
        rows.extend(day_rows)
        totals.extend(day_totals)
        print(
            f"Scored {day}: {len(day_rows):,} room-ticks ({perf_counter() - started:.1f}s)",
            flush=True,
        )
    frame = pd.DataFrame(rows)
    raw = Path("data/daylight/ablation-scores.parquet")
    raw.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(raw, index=False)
    data = write_report(
        frame,
        pd.DataFrame(totals),
        seed=args.seed,
        output=Path("../docs/appendix/daylight-blindness-results.md"),
    )
    # Keep the bundled UI evidence identical to the report, including its provenance.
    Path("../frontend/src/lib/daylight-blindness-results.json").write_text(
        json.dumps(data, indent=2, allow_nan=False) + "\n"
    )
    print(json.dumps(data["results"], indent=2))


if __name__ == "__main__":
    main()
