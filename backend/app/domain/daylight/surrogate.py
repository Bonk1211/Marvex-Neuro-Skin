"""Optional, read-only occupant-plane predictions on cached angle curves."""

import logging
from functools import lru_cache
from math import isfinite
from pathlib import Path
from threading import Lock

import numpy as np

from app.config import DEFAULTS
from app.domain.daylight.features import FEATURE_NAMES, build_features
from app.domain.daylight.room import ORIENTATIONS, Probe, RoomGeometry
from app.domain.optics import FacadeOptics
from app.domain.types import Environment, SolarState

logger = logging.getLogger("neuroskin.daylight")
_load_lock = Lock()


@lru_cache(maxsize=2)
def _load_models(directory: str):
    try:
        import joblib
        import sklearn  # noqa: F401 — unpickling needs the serving dependency

        artifacts = [joblib.load(Path(directory) / f"{target}.joblib") for target in ("et", "ev")]
        for target, artifact in zip(("et", "ev"), artifacts):
            if artifact["target"] != target or tuple(artifact["feature_names"]) != FEATURE_NAMES:
                raise ValueError("Daylight artifact feature contract mismatch")
            artifact["model"].set_params(n_jobs=1)
        if artifacts[0]["dataset_sha256"] != artifacts[1]["dataset_sha256"]:
            raise ValueError("Daylight artifacts come from different datasets")
        return tuple(artifacts)
    except Exception as exc:
        # Optional local artifacts may be absent, unreadable or incompatible.
        # Cache failure too: log once, retry after restart or explicit cache clear.
        logger.warning(
            "Daylight model unavailable: %s", exc, extra={"daylight_model": "unavailable"}
        )
        return None


def models():
    # lru_cache alone can execute a simultaneous first load twice.
    with _load_lock:
        return _load_models(DEFAULTS.daylight_model_dir)


def feature_grid(probe, optics, solar, env, room, angles) -> np.ndarray:
    """Reuse the scalar contract, broadcasting only its three angle-dependent columns."""
    base = build_features(probe, optics, angles[0], solar, env, room)
    matrix = np.tile(base, (len(angles), 1))
    for name, values in (
        ("theta_deg", angles),
        ("beam_transmittance", [optics.beam_transmittance(a) for a in angles]),
        ("diffuse_transmittance", [optics.diffuse_transmittance(a) for a in angles]),
    ):
        matrix[:, FEATURE_NAMES.index(name)] = values
    return matrix


@lru_cache(maxsize=2)
def curves_for(inputs: tuple, step: int = 1):
    """Batch a day of (probe, optics, solar, local env, room) into two predict calls.

    Returns paired Et/Ev whole-degree curves, in input order. Night and unsupported
    orientations return None. The returned arrays are immutable and safe to share.
    """
    artifacts = models()
    if artifacts is None:
        return None
    scope = set(artifacts[0]["orientations"]) & set(artifacts[1]["orientations"])
    valid = [
        i
        for i, (_probe, optics, solar, _env, _room) in enumerate(inputs)
        if solar.elevation > DEFAULTS.min_elevation
        and ORIENTATIONS[int(optics.wall_azimuth % 360 / 90)] in scope
    ]
    result = [None] * len(inputs)
    if not valid:
        return tuple(result)
    # ponytail: a sampled angle curve interpolates between grid points; use a
    # finer grid when the measured inference budget and interpolation error allow.
    angles = tuple(range(0, int(DEFAULTS.angle_max) + 1, step))
    if angles[-1] != DEFAULTS.angle_max:
        raise ValueError("Angle step must divide the full range")
    try:
        matrix = np.concatenate([feature_grid(*inputs[i], angles) for i in valid])
        predicted = [a["model"].predict(matrix).reshape(len(valid), len(angles)) for a in artifacts]
        if not all(np.isfinite(p).all() and (p >= 0).all() for p in predicted):
            raise ValueError("Invalid daylight model output")
        degrees = np.arange(int(DEFAULTS.angle_max) + 1)
        for row, index in enumerate(valid):
            curves = np.array([np.interp(degrees, angles, target[row]) for target in predicted])
            curves.setflags(write=False)
            result[index] = curves
        return tuple(result)
    except Exception as exc:
        logger.warning("Daylight prediction unavailable: %s", exc)
        return None


def curve_for(
    probe: Probe, optics: FacadeOptics, solar: SolarState, env: Environment, room: RoomGeometry
):
    curves = curves_for(((probe, optics, solar, env, room),), DEFAULTS.daylight_angle_step)
    return curves[0] if curves is not None else None


def at_angle(curve, angle: float) -> float | None:
    if curve is None or not isfinite(angle):
        return None
    bounded = min(DEFAULTS.angle_max, max(DEFAULTS.angle_min, angle))
    low = int(bounded)
    high = min(low + 1, len(curve) - 1)
    return float(curve[low] + (bounded - low) * (curve[high] - curve[low]))
