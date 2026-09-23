"""Per-angle mean transmittance / beam fraction / incident irradiance from the daylight train split."""

from __future__ import annotations

import glob
import pathlib

import pandas as pd

COLUMNS = ["beam_transmittance", "diffuse_transmittance", "beam_fraction", "incident_w_m2"]
DATASET = pathlib.Path(__file__).resolve().parents[1] / "data" / "daylight" / "dataset"
OUT = pathlib.Path(__file__).resolve().parents[2] / "docs" / "appendix"


def load() -> pd.DataFrame:
    paths = sorted(glob.glob(str(DATASET / "train-*.parquet")))
    if not paths:
        raise SystemExit(f"no train parquet under {DATASET}")
    return pd.concat((pd.read_parquet(p) for p in paths), ignore_index=True)


def table(frame: pd.DataFrame) -> pd.DataFrame:
    grouped = frame.groupby("theta_deg")[COLUMNS].mean()
    grouped.insert(0, "n_rows", frame.groupby("theta_deg").size())
    return grouped.round(6)


def main() -> None:
    frame = load()
    OUT.mkdir(parents=True, exist_ok=True)
    for name, subset in (
        ("solar-gain-shave-by-angle.csv", frame),
        ("solar-gain-shave-by-angle-beam-only.csv", frame[frame.beam_transmittance > 0]),
    ):
        result = table(subset)
        result.to_csv(OUT / name)
        print(f"\n== {name}  ({len(subset)} rows)")
        print(result.to_string())


if __name__ == "__main__":
    main()
