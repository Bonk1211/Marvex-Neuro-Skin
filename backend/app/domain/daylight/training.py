"""Reproducible surrogate experiments; presentation stays outside the app.

Method: Tabatabaei Manesh et al. (2025), doi:10.1016/j.autcon.2025.106474.
MAE selects models; row-shuffled scores are deliberately shown beside structural
holdout and never-trained orientation transfer. No external data/weights are used.
"""

import hashlib
import json
import subprocess
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.config import DEFAULTS
from app.domain.daylight.features import FEATURE_NAMES

try:
    from sklearn.base import clone
    from sklearn.ensemble import ExtraTreesRegressor, RandomForestRegressor
    from sklearn.linear_model import LinearRegression
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
    from sklearn.model_selection import GroupKFold, RandomizedSearchCV, train_test_split
except ImportError:
    ExtraTreesRegressor = None


@dataclass(frozen=True)
class Splits:
    train: pd.DataFrame
    shuffled: pd.DataFrame
    holdout: pd.DataFrame
    transfer: pd.DataFrame
    target: str
    seed: int
    unused_rows: int


@dataclass(frozen=True)
class RunMetrics:
    target: str
    model: str
    params: dict
    mae_shuffled: float
    mae_holdout: float
    mae_transfer: float
    r2_shuffled: float
    r2_holdout: float
    r2_transfer: float
    mse_shuffled: float
    mse_holdout: float
    mse_transfer: float
    n_train: int
    n_test: int
    n_transfer: int
    train_orientations: tuple[str, ...]
    seed: int


def _require_sklearn() -> None:
    if ExtraTreesRegressor is None:
        raise RuntimeError("Training requires scikit-learn; install the backend dependencies")


def load_dataset(path: Path) -> tuple[pd.DataFrame, str]:
    files = sorted(path.glob("*.parquet")) if path.is_dir() else [path]
    if not files:
        raise ValueError(f"No Parquet data at {path}; run make daylight-data")
    digest = hashlib.sha256()
    frames = []
    for file in files:
        digest.update(file.name.encode())
        digest.update(file.read_bytes())
        frames.append(pd.read_parquet(file))
    frame = pd.concat(frames, ignore_index=True)
    keys = ["day_id", "orientation", "band", "tick", "theta_deg", "probe_index", "split_role"]
    if frame.isna().any().any() or frame.duplicated(keys).any():
        raise ValueError("Missing values or duplicated oracle observations")
    return frame, digest.hexdigest()


def build_splits(frame: pd.DataFrame, *, target: str, seed: int) -> Splits:
    _require_sklearn()
    required = {
        "day_id",
        "zone",
        "orientation",
        "split_role",
        "probe_kind",
        f"{target}_lux",
        *FEATURE_NAMES,
    }
    if missing := required - set(frame.columns):
        raise ValueError(f"Missing required split/features: {sorted(missing)}")
    if target not in ("ev", "et") or frame[list(required)].isna().any().any():
        raise ValueError("Invalid target or missing split values")
    if not set(frame.split_role) <= {"train", "transfer"}:
        raise ValueError("Unrecognised split_role")
    if not set(frame.loc[frame.split_role == "train", "orientation"]) <= set(
        DEFAULTS.daylight_train_orientations
    ) or not set(frame.loc[frame.split_role == "transfer", "orientation"]) <= set(
        DEFAULTS.daylight_transfer_orientations
    ):
        raise ValueError("Orientation/role mismatch; transfer orientations must never train")
    # Ev is meaningful at eyes only; training on desk Ev=0 flatters the score.
    selected = frame.loc[frame.probe_kind == "seat"] if target == "ev" else frame
    pool = selected.loc[selected.split_role == "train"]
    transfer = selected.loc[selected.split_role == "transfer"]
    days = sorted(pool.day_id.unique())
    if len(days) < 2 or transfer.empty:
        raise ValueError("At least two training days and a transfer slice are required")
    rng = np.random.default_rng(seed)
    held_days = set(rng.choice(days, max(1, len(days) // 4), replace=False))
    held_zones = set()
    for orientation in sorted(pool.orientation.unique()):
        zones = sorted(pool.loc[pool.orientation == orientation, "zone"].unique())
        if len(zones) < 2:
            raise ValueError("Whole-zone holdout requires at least two zones per orientation")
        held_zones.update(rng.choice(zones, max(1, len(zones) // 4), replace=False))
    held_day, held_zone = pool.day_id.isin(held_days), pool.zone.isin(held_zones)
    # Strict intersection: every holdout row has BOTH an unseen day and zone.
    # Cross-strata are excluded from fitting and reported, never quietly shuffled in.
    honest = pool.loc[held_day & held_zone]
    candidates = pool.loc[~held_day & ~held_zone]
    if honest.empty or len(candidates) < 5:
        raise ValueError("Insufficient observations for the structural holdout")
    train, shuffled = train_test_split(candidates, test_size=0.2, random_state=seed)
    assert not set(train.day_id) & set(honest.day_id)
    assert not set(train.zone) & set(honest.zone)
    assert not (train.split_role == "transfer").any()
    return Splits(
        train, shuffled, honest, transfer, target, seed, len(pool) - len(honest) - len(candidates)
    )


def feature_matrix(frame: pd.DataFrame) -> np.ndarray:
    return frame.loc[:, FEATURE_NAMES].to_numpy(dtype=float)


def _metrics(
    splits: Splits, predictions: list[np.ndarray], *, label: str, params: dict
) -> RunMetrics:
    scores = {}
    for name, frame, prediction in zip(
        ("shuffled", "holdout", "transfer"),
        (splits.shuffled, splits.holdout, splits.transfer),
        predictions,
    ):
        truth = frame[f"{splits.target}_lux"].to_numpy()
        scores[f"mae_{name}"] = float(mean_absolute_error(truth, prediction))
        scores[f"mse_{name}"] = float(mean_squared_error(truth, prediction))
        scores[f"r2_{name}"] = float(r2_score(truth, prediction))
    return RunMetrics(
        target=splits.target,
        model=label,
        params=params,
        **scores,
        n_train=len(splits.train),
        n_test=len(splits.holdout),
        n_transfer=len(splits.transfer),
        train_orientations=tuple(sorted(splits.train.orientation.unique())),
        seed=splits.seed,
    )


def fit_and_evaluate(splits: Splits, estimator: Any, *, label: str) -> RunMetrics:
    _require_sklearn()
    estimator.fit(feature_matrix(splits.train), splits.train[f"{splits.target}_lux"])
    predictions = [
        estimator.predict(feature_matrix(f))
        for f in (splits.shuffled, splits.holdout, splits.transfer)
    ]
    return _metrics(splits, predictions, label=label, params=estimator.get_params())


def incumbent_metrics(splits: Splits) -> RunMetrics:
    if splits.target != "et":
        raise ValueError("The incumbent has no eye-plane prediction")
    return _metrics(
        splits,
        [f.incumbent_et_lux.to_numpy() for f in (splits.shuffled, splits.holdout, splits.transfer)],
        label="incumbent scalar",
        params={"source": "dataset incumbent_et_lux"},
    )


def model_grid(target: str) -> dict:
    """Small declared search, with the paper's settings among the starting priors."""
    return {
        "n_estimators": [100] if target == "et" else [200],
        "min_samples_split": [2, 5],
        "min_samples_leaf": [1, 3],
        "max_depth": [20, 30],
    }


def tune_models(splits: Splits, *, grid: dict, n_iter: int = 2) -> tuple[dict, list[RunMetrics]]:
    _require_sklearn()
    models, metrics = {}, []
    days = splits.train.day_id
    # Full experiments require five distinct days. A two-day smoke run only
    # checks plumbing; its CV groups are (day, zone), explicitly not evidence.
    groups = days if days.nunique() >= 5 else days + ":" + splits.train.zone
    if groups.nunique() < 5:
        raise ValueError("Five-fold tuning needs at least five groups")
    for label, estimator in (
        ("extra trees", ExtraTreesRegressor(random_state=splits.seed, n_jobs=1)),
        ("random forest", RandomForestRegressor(random_state=splits.seed, n_jobs=1)),
        ("linear", LinearRegression(n_jobs=1)),
    ):
        search = RandomizedSearchCV(
            estimator,
            grid if label != "linear" else {"fit_intercept": [True, False]},
            n_iter=n_iter,
            scoring="neg_mean_absolute_error",
            cv=GroupKFold(5),
            random_state=splits.seed,
            n_jobs=2,
            refit=False,
            error_score="raise",
        )
        search.fit(
            feature_matrix(splits.train), splits.train[f"{splits.target}_lux"], groups=groups
        )
        fitted = clone(estimator).set_params(**search.best_params_)
        metric = fit_and_evaluate(splits, fitted, label=label)
        models[label] = fitted
        metrics.append(metric)
        print(f"{splits.target} {label}: holdout MAE {metric.mae_holdout:.2f} lux", flush=True)
    if splits.target == "et":
        metrics.append(incumbent_metrics(splits))
    return models, metrics


def winner(metrics: list[RunMetrics]) -> RunMetrics:
    candidates = [m for m in metrics if m.model != "incumbent scalar"]
    return min(candidates, key=lambda m: (m.mae_holdout, m.model))


def transfer_verdict(metric: RunMetrics) -> tuple[tuple[str, ...], str]:
    ceiling = (
        metric.mae_holdout * DEFAULTS.daylight_transfer_mae_ratio
        + DEFAULTS.daylight_transfer_mae_margin_lux
    )
    held = metric.mae_transfer <= ceiling
    scope = ("north", "east", "south", "west") if held else metric.train_orientations
    return scope, (
        f"{metric.target.upper()} ({metric.model}): east/north transfer "
        f"{'held' if held else 'failed'}: MAE {metric.mae_transfer:.2f} lux vs "
        f"holdout {metric.mae_holdout:.2f} lux. Predeclared tolerance: "
        f"{DEFAULTS.daylight_transfer_mae_ratio} × holdout + "
        f"{DEFAULTS.daylight_transfer_mae_margin_lux:g} lux. Scope: {', '.join(scope)}."
    )


def prediction_rows(splits: Splits, model: Any, *, split: str = "holdout") -> pd.DataFrame:
    frame = getattr(splits, split)
    rows = frame[["day_id", "zone", "tick", "theta_deg", "probe_index", "depth_m"]].copy()
    rows["actual_lux"] = frame[f"{splits.target}_lux"]
    rows["predicted_lux"] = model.predict(feature_matrix(frame))
    rows["residual_lux"] = rows.predicted_lux - rows.actual_lux
    rows["absolute_error_lux"] = rows.residual_lux.abs()
    return rows


def worst_and_best_sets(rows: pd.DataFrame) -> pd.DataFrame:
    keys = ["day_id", "zone", "tick", "theta_deg"]
    sets = rows.groupby(keys).absolute_error_lux.mean().sort_values()
    wanted = pd.concat([sets.head(1), sets.tail(1)]).rename("set_mae_lux").reset_index()
    return rows.merge(wanted, on=keys).sort_values(["set_mae_lux", "probe_index"])


def append_run(
    metrics: RunMetrics, *, ledger_path: Path, dataset_sha256: str, git_sha: str
) -> None:
    row = {
        **asdict(metrics),
        "run_at": datetime.now(timezone.utc).isoformat(),
        "dataset_sha256": dataset_sha256,
        "git_sha": git_sha,
        "code_sha256": code_fingerprint(),
    }
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    with ledger_path.open("a") as stream:
        stream.write(json.dumps(row, sort_keys=True, allow_nan=False) + "\n")


def code_fingerprint() -> str:
    digest = hashlib.sha256()
    for path in sorted(Path(__file__).parent.glob("*.py")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def git_sha() -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()


def history(ledger_path: Path, pending: list[RunMetrics] | None = None) -> pd.DataFrame:
    rows = pd.read_json(ledger_path, lines=True) if ledger_path.exists() else pd.DataFrame()
    if pending:
        # The history cell precedes save: include the current verified metrics
        # without writing a ledger entry until the save cell succeeds.
        current = pd.DataFrame(
            [{**asdict(m), "run_at": datetime.now(timezone.utc).isoformat()} for m in pending]
        )
        rows = pd.concat([rows, current], ignore_index=True)
    if not rows.empty:
        rows["run_at"] = pd.to_datetime(rows.run_at, utc=True)
    return rows


def save_experiment(
    models: dict,
    metrics: list[RunMetrics],
    splits: dict,
    *,
    dataset_sha256: str,
    ledger_path: Path,
    model_dir: Path,
    report_path: Path,
) -> str:
    import joblib

    model_dir.mkdir(parents=True, exist_ok=True)
    sha = git_sha()
    verdicts, lines = [], []
    for target in ("ev", "et"):
        relevant = [m for m in metrics if m.target == target]
        selected = winner(relevant)
        scope, verdict = transfer_verdict(selected)
        verdicts.append(verdict)
        linear = next(m for m in relevant if m.model == "linear")
        trees = next(m for m in relevant if m.model == "extra trees")
        if linear.mae_holdout <= trees.mae_holdout:
            verdicts.append(
                f"STOP: {target.upper()} linear baseline matches/beats Extra Trees; "
                "the nonlinear surrogate is not justified. Phase B must not proceed."
            )
        artifact = {
            "model": models[target][selected.model],
            "target": target,
            "feature_names": FEATURE_NAMES,
            "orientations": scope,
            "dataset_sha256": dataset_sha256,
            "git_sha": sha,
            "code_sha256": code_fingerprint(),
            "metrics": asdict(selected),
        }
        path = model_dir / f"{target}.joblib"
        temporary = path.with_suffix(".tmp")
        joblib.dump(artifact, temporary, compress=3)
        temporary.replace(path)
        split = splits[target]
        lines.append(
            f"{target.upper()}: {len(split.train):,} fit / "
            f"{len(split.shuffled):,} shuffled / {len(split.holdout):,} structural / "
            f"{len(split.transfer):,} transfer; {split.unused_rows:,} cross-stratum "
            f"rows excluded. Artifact: {path.stat().st_size / 1024**2:.2f} MiB."
        )
    for metric in metrics:
        append_run(metric, ledger_path=ledger_path, dataset_sha256=dataset_sha256, git_sha=sha)
    table = [
        "| Target / model | MAE shuffled | MAE holdout | MAE transfer | "
        "R² shuffled / holdout / transfer | MSE shuffled / holdout / transfer |",
        "|---|---:|---:|---:|---|---|",
    ]
    for m in metrics:
        table.append(
            f"| {m.target.upper()} / {m.model} | {m.mae_shuffled:.2f} | "
            f"{m.mae_holdout:.2f} | {m.mae_transfer:.2f} | "
            f"{m.r2_shuffled:.3f} / {m.r2_holdout:.3f} / {m.r2_transfer:.3f} | "
            f"{m.mse_shuffled:.0f} / {m.mse_holdout:.0f} / {m.mse_transfer:.0f} |"
        )
    gaps = [
        f"{m.target.upper()} {m.model}: structural minus shuffled MAE "
        f"{m.mae_holdout - m.mae_shuffled:+.2f} lux."
        for m in metrics
        if m.model == winner([v for v in metrics if v.target == m.target]).model
    ]
    report = (
        "\n\n".join(
            [
                "# Daylight surrogate training results",
                "Modelled oracle labels, not measured occupant comfort. MAE (lux) is the selection "
                "criterion. MSE is lux²; R² is dimensionless. Selection uses structural holdout "
                "MAE, so it is a validation set; only orientation transfer is "
                "untouched by selection.",
                "Shuffled rows share days/zones with fitting. Structural rows have BOTH an unseen "
                "day and unseen zone; the two cross-strata are excluded. Five-fold search groups "
                "by whole training days. Ev excludes desks, whose eye-plane target is undefined.",
                "\n".join(table),
                "\n".join(gaps),
                "\n\n".join(verdicts),
                "\n\n".join(lines),
                f"Seed: {metrics[0].seed}; git: `{sha}`; code SHA-256: `{code_fingerprint()}`; "
                f"dataset SHA-256: `{dataset_sha256}`. JSONL records each target/model evaluation.",
                "Features add incident intensity, lateral position, tilt and sky fraction to the "
                "plan's list: without these, different physical inputs can produce identical "
                "vectors. Every directional feature remains facade-relative. Fixed room/material "
                "assumptions constrain model applicability.",
                "Method precedent: [Tabatabaei Manesh et al. (2025)]"
                "(https://doi.org/10.1016/j.autcon.2025.106474). Independent local "
                "data and weights; "
                "four-bounce empty box, 4×4 patches per surface, full-wall aperture, uniform "
                "louvre-bank transmission, no furniture occlusion or glass spectral calibration. "
                "This oracle is not Radiance and does not establish measured glare or comfort.",
            ]
        )
        + "\n"
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report)
    return report
