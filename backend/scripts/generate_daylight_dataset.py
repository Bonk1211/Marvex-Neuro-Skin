"""Generate seeded oracle labels: python -m scripts.generate_daylight_dataset."""

import argparse
import hashlib
import json
from dataclasses import asdict, replace
from datetime import date
from pathlib import Path
from time import perf_counter

import numpy as np
import pandas as pd

from app.config import DEFAULTS
from app.domain.controller import WALL_LUX_PER_IRRADIANCE
from app.domain.daylight.features import FEATURE_NAMES, build_features
from app.domain.daylight.oracle import illuminance_at_probes
from app.domain.daylight.room import RoomGeometry, probes_for, zone_for
from app.domain.environment import generate_day, solar_frame
from app.domain.facade import poa_series, wall_gains, zone_gains
from app.domain.optics import FacadeOptics
from app.domain.types import Environment, SolarState, ZoneGain


def optics_for(gain: ZoneGain, solar: SolarState) -> FacadeOptics:
    diffuse = gain.sky_diffuse + gain.ground_diffuse
    return FacadeOptics(
        beam_fraction=max(0, gain.incident - diffuse) / gain.incident if gain.incident else 0,
        sky_fraction=gain.sky_diffuse / diffuse if diffuse else 1,
        solar_elevation=solar.elevation,
        solar_azimuth=solar.azimuth,
        wall_azimuth=gain.azimuth,
    )


def day_inputs(day: date, seed: int) -> tuple[list[Environment], list[SolarState], list[dict]]:
    environments = generate_day(day, seed=seed)
    times, positions, location = solar_frame(day)
    clear = location.get_clearsky(times)
    solar = [
        SolarState(float(row.azimuth), float(row.apparent_elevation), float(clear.iloc[i].ghi))
        for i, row in enumerate(positions.itertuples())
    ]
    poa = poa_series(
        times,
        positions,
        np.array([e.ghi for e in environments]),
        np.array([e.dni for e in environments]),
        np.array([e.dhi for e in environments]),
    )
    gains = [
        zone_gains(wall_gains(poa, i), solar_elevation=s.elevation, solar_azimuth=s.azimuth)
        for i, s in enumerate(solar)
    ]
    return environments, solar, gains


def generate_frame(
    day: date, orientations: tuple[str, ...], *, role: str, seed: int = DEFAULTS.seed
) -> pd.DataFrame:
    room = RoomGeometry()
    environments, suns, grids = day_inputs(day, seed)
    rows = []
    for tick in range(0, len(environments), DEFAULTS.daylight_dataset_tick_stride):
        solar, env = suns[tick], environments[tick]
        if solar.elevation <= DEFAULTS.min_elevation:
            continue
        for orientation in orientations:
            for band in DEFAULTS.daylight_dataset_bands:
                probes = probes_for(orientation, band)
                # All columns have the same aperture flux. Corner coupling is an
                # incumbent sensor assumption, not extra light in this one-window room.
                gain = grids[tick][orientation][band * DEFAULTS.facade_zone_columns]
                optics = optics_for(gain, solar)
                local_env = replace(env, ghi=gain.incident)
                for theta in np.arange(
                    DEFAULTS.angle_min, DEFAULTS.angle_max + 1, DEFAULTS.angle_step
                ):
                    labels = illuminance_at_probes(
                        room,
                        probes,
                        beam_flux=gain.incident
                        * optics.beam_fraction
                        * optics.beam_transmittance(theta),
                        diffuse_flux=gain.incident
                        * (1 - optics.beam_fraction)
                        * optics.diffuse_transmittance(theta),
                        solar_elevation=solar.elevation,
                        solar_azimuth=solar.azimuth,
                        wall_azimuth=gain.azimuth,
                    )
                    for probe_index, (probe, (et, ev)) in enumerate(zip(probes, labels)):
                        feature = build_features(probe, optics, theta, solar, local_env, room)
                        rows.append(
                            {
                                "zone": zone_for(probe, orientation, band, room),
                                "orientation": orientation,
                                "split_role": role,
                                "tick": tick,
                                "band": band,
                                "probe_index": probe_index,
                                "probe_kind": probe.kind,
                                "view_rad": probe.view_rad or 0.0,
                                **dict(zip(FEATURE_NAMES, feature)),
                                "et_lux": et,
                                "ev_lux": ev,
                                "day_id": day.isoformat(),
                                "seed": seed,
                                "incumbent_et_lux": max(
                                    20,
                                    gain.incident
                                    * WALL_LUX_PER_IRRADIANCE
                                    * optics.daylight_transmittance(theta),
                                ),
                            }
                        )
    frame = pd.DataFrame(rows)
    if frame.empty or frame.isna().any().any():
        raise ValueError("Generation produced empty or missing data")
    if not np.isfinite(frame.select_dtypes("number")).all().all():
        raise ValueError("Generation produced non-finite data")
    if (frame[["et_lux", "ev_lux"]] < 0).any().any():
        raise ValueError("Generation produced negative lux")
    return frame


def dataset_signature() -> str:
    paths = [
        Path("app/config.py"),
        *sorted(Path("app/domain").glob("*.py")),
        *[Path("app/domain/daylight") / f"{name}.py" for name in ("room", "oracle", "features")],
        Path(__file__),
    ]
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--days", type=int, choices=range(1, 13))
    parser.add_argument("--seed", type=int, default=DEFAULTS.seed)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = args.output or Path("data/daylight/smoke" if args.smoke else "data/daylight/dataset")
    output.mkdir(parents=True, exist_ok=True)
    train_days = DEFAULTS.daylight_dataset_days[: 2 if args.smoke else args.days]
    transfer_days = (
        DEFAULTS.daylight_transfer_days[:1] if args.smoke else DEFAULTS.daylight_transfer_days
    )
    metadata = {
        "source_sha256": dataset_signature(),
        "defaults": asdict(DEFAULTS),
        "seed": args.seed,
        "train_days": train_days,
        "transfer_days": transfer_days,
    }
    metadata = json.loads(json.dumps(metadata))
    manifest = output / "manifest.json"
    if manifest.exists() and json.loads(manifest.read_text()) != metadata:
        raise ValueError(
            f"Stale generation settings/code at {output}; use a fresh --output directory"
        )
    manifest.write_text(json.dumps(metadata, indent=2) + "\n")
    started = perf_counter()
    for role, days, orientations in (
        ("train", train_days, DEFAULTS.daylight_train_orientations),
        ("transfer", transfer_days, DEFAULTS.daylight_transfer_orientations),
    ):
        for day in days:
            path = output / f"{role}-{day}.parquet"
            if path.exists():
                print(f"Resume: {path}", flush=True)
                continue
            frame = generate_frame(date.fromisoformat(day), orientations, role=role, seed=args.seed)
            temporary = path.with_suffix(".tmp")
            frame.to_parquet(temporary, index=False)
            temporary.replace(path)
            print(f"{path}: {len(frame):,} rows ({perf_counter() - started:.1f}s)", flush=True)


if __name__ == "__main__":
    main()
