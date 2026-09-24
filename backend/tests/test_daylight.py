from dataclasses import replace
from datetime import date
from math import pi
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import pytest

from app.config import DEFAULTS
from app.domain.daylight.features import FEATURE_NAMES, build_features
from app.domain.daylight.oracle import illuminance_at_probes
from app.domain.daylight.room import ORIENTATIONS, Probe, RoomGeometry, probes_for
from app.domain.environment import generate_day
from app.domain.optics import FacadeOptics
from app.domain.types import SolarState


def test_oracle_obeys_four_physical_invariants_and_preserves_direct_beam_tail() -> None:
    room = RoomGeometry()
    probes = tuple(Probe("seat", room.width / 2, depth, 1.2, 0) for depth in (1, 3, 5))
    kwargs = dict(solar_elevation=20, solar_azimuth=270, wall_azimuth=270)
    assert illuminance_at_probes(room, probes, beam_flux=0, diffuse_flux=0, **kwargs) == (
        (0, 0),
        (0, 0),
        (0, 0),
    )
    diffuse = illuminance_at_probes(room, probes, beam_flux=0, diffuse_flux=100, **kwargs)
    assert diffuse[0][0] > diffuse[1][0] > diffuse[2][0] > 0
    facing = illuminance_at_probes(
        room,
        (probes[0], replace(probes[0], view_rad=pi)),
        beam_flux=400,
        diffuse_flux=100,
        **kwargs,
    )
    assert facing[0][1] > facing[1][1]
    assert facing[0][1] > 20_000
    once = illuminance_at_probes(room, probes, beam_flux=0, diffuse_flux=100, bounces=1, **kwargs)
    assert diffuse[-1][0] > once[-1][0]
    assert illuminance_at_probes(room, (), beam_flux=0, diffuse_flux=100, **kwargs) == ()


def test_all_floor_programs_have_valid_local_probes_and_no_circular_imports() -> None:
    room = RoomGeometry()
    for orientation in ORIENTATIONS:
        for band in range(4):
            probes = probes_for(orientation, band)
            assert any(p.kind == "seat" and np.isfinite(p.view_rad) for p in probes)
            assert all(0 < p.x < room.width and 0 < p.z < room.depth for p in probes)
    for path in Path("app/domain/daylight").glob("*.py"):
        source = path.read_text()
        assert "from app.domain.controller" not in source
        assert "from app.domain.brain" not in source
        assert "lux_at_angle" not in source
        assert "WALL_LUX_PER_IRRADIANCE" not in source
        assert "matplotlib" not in source
        assert "notebooks/" not in source
    with pytest.raises(ValueError):
        Probe("seat", 1, 1, 1.2, float("nan"))


def test_features_are_deterministic_and_rotation_invariant_with_absolute_flux() -> None:
    env = generate_day(date(2026, 3, 20))[18]
    room, probe = RoomGeometry(), Probe("seat", 2, 3, 1.2, 0)
    west = SolarState(250, 40, 800)
    south = replace(west, azimuth=160)
    optics = FacadeOptics(0.6, 40, 250, 270)
    a = build_features(probe, optics, 30, west, env, room)
    b = build_features(
        probe, replace(optics, solar_azimuth=160, wall_azimuth=180), 30, south, env, room
    )
    assert len(a) == len(FEATURE_NAMES)
    np.testing.assert_array_equal(a, b)
    np.testing.assert_array_equal(a, build_features(probe, optics, 30, west, env, room))
    assert not any(
        name.startswith("wall_azimuth") or name == "solar_azimuth" for name in FEATURE_NAMES
    )
    brighter = build_features(probe, optics, 30, west, replace(env, ghi=env.ghi * 2), room)
    assert (
        brighter[FEATURE_NAMES.index("incident_w_m2")]
        == 2 * a[FEATURE_NAMES.index("incident_w_m2")]
    )
    assert DEFAULTS.daylight_model_enabled is False


def test_generation_counts_and_structural_splits_and_ledger_are_auditable() -> None:
    import json

    import pandas as pd
    from sklearn.ensemble import ExtraTreesRegressor

    from app.domain.daylight import training
    from scripts.generate_daylight_dataset import day_inputs, generate_frame

    days = (date(2026, 1, 21), date(2026, 6, 21))
    frames = [generate_frame(day, ("west", "south"), role="train") for day in days]
    frames.append(generate_frame(days[0], ("east", "north"), role="transfer"))
    frame = pd.concat(frames, ignore_index=True)
    for day, generated in zip(days, frames):
        _, suns, _ = day_inputs(day, DEFAULTS.seed)
        ticks = sum(
            s.elevation > DEFAULTS.min_elevation
            for s in suns[:: DEFAULTS.daylight_dataset_tick_stride]
        )
        count = sum(
            len(probes_for(o, b))
            for o in ("west", "south")
            for b in DEFAULTS.daylight_dataset_bands
        )
        angles = len(np.arange(DEFAULTS.angle_min, DEFAULTS.angle_max + 1, DEFAULTS.angle_step))
        assert len(generated) == ticks * count * angles
        assert not generated.isna().any().any()
        assert (generated[["et_lux", "ev_lux"]] >= 0).all().all()
    splits = training.build_splits(frame, target="et", seed=42)
    assert not set(splits.train.day_id) & set(splits.holdout.day_id)
    assert not set(splits.train.zone) & set(splits.holdout.zone)
    assert set(splits.transfer.orientation) == {"east", "north"}
    assert not (splits.train.split_role == "transfer").any()
    for key in ("zone", "split_role", "orientation", "day_id"):
        with pytest.raises(ValueError, match="Missing required"):
            training.build_splits(frame.drop(columns=[key]), target="et", seed=42)
    model = ExtraTreesRegressor(n_estimators=3, max_depth=4, random_state=42)
    metric = training.fit_and_evaluate(splits, model, label="test trees")
    prediction = model.predict(training.feature_matrix(splits.holdout))
    second = training.fit_and_evaluate(splits, model, label="test trees")
    assert metric == second
    np.testing.assert_array_equal(
        prediction, model.predict(training.feature_matrix(splits.holdout))
    )
    with TemporaryDirectory() as folder:
        ledger = Path(folder) / "runs.jsonl"
        training.append_run(metric, ledger_path=ledger, dataset_sha256="dataset", git_sha="code")
        first = ledger.read_bytes()
        training.append_run(metric, ledger_path=ledger, dataset_sha256="dataset", git_sha="code")
        lines = ledger.read_bytes().splitlines(keepends=True)
        assert len(lines) == 2 and lines[0] == first
        assert json.loads(lines[1])["mae_holdout"] == metric.mae_holdout


def test_training_package_imports_without_sklearn() -> None:
    import subprocess
    import sys

    subprocess.run(
        [
            sys.executable,
            "-c",
            """
import builtins
original = builtins.__import__
def unavailable(name, *args, **kwargs):
    if name.startswith('sklearn'):
        raise ImportError('serve-only environment')
    return original(name, *args, **kwargs)
builtins.__import__ = unavailable
import app.domain.daylight
from app.domain.daylight import training
assert training.ExtraTreesRegressor is None
from app.domain.daylight import surrogate
assert surrogate.models() is None
""",
        ],
        check=True,
    )


def test_exceedance_counts_union_ticks_and_weight_seat_hours() -> None:
    import pandas as pd

    from scripts.ablation_glare_blindness import summarize

    rows = pd.DataFrame(
        [
            {
                "controller": "test",
                "day_id": "day",
                "tick": tick,
                "seats": seats,
                "over_cap_seats": over,
                "et_in_band_seats": useful,
                "max_ev_lux": 1840,
            }
            for tick, seats, over, useful in ((1, 2, 1, 2), (1, 8, 2, 3), (2, 10, 0, 4))
        ]
    )
    totals = pd.DataFrame(
        [{"controller": "test", "movement_count": 4, "load_sum": 2, "load_count": 4}]
    )
    result = summarize(rows, totals)[0]
    assert result["ev_exceedance_percent"] == 50
    assert result["seat_exceedance_percent"] == 15
    assert result["et_in_band_percent"] == 45
    assert result["mean_relative_load"] == 0.5


def test_training_serving_parity_includes_every_column_and_every_angle(monkeypatch) -> None:
    from app.domain.daylight.surrogate import at_angle, feature_grid
    from scripts.generate_daylight_dataset import day_inputs, generate_frame, optics_for

    day = date(2026, 1, 21)
    frame = generate_frame(day, ("west",), role="train")
    envs, suns, grids = day_inputs(day, DEFAULTS.seed)
    sample = frame.iloc[len(frame) // 2]
    tick, band, index = int(sample.tick), int(sample.band), int(sample.probe_index)
    probe = probes_for("west", band)[index]
    gain = grids[tick]["west"][band * DEFAULTS.facade_zone_columns]
    env, solar, optics = (
        replace(envs[tick], ghi=gain.incident),
        suns[tick],
        optics_for(gain, suns[tick]),
    )
    matrix = feature_grid(probe, optics, solar, env, RoomGeometry(), tuple(range(61)))
    for angle in range(61):
        np.testing.assert_array_equal(
            matrix[angle], build_features(probe, optics, angle, solar, env, RoomGeometry())
        )
    np.testing.assert_array_equal(
        sample.loc[list(FEATURE_NAMES)].to_numpy(dtype=float), matrix[int(sample.theta_deg)]
    )
    from app.domain import scenarios
    from app.schemas import SimulationRunRequest

    captured = []

    def capture(inputs, step):
        captured.extend(inputs)
        return tuple(range(len(inputs)))

    monkeypatch.setattr(scenarios, "models", lambda: ({"orientations": ORIENTATIONS},) * 2)
    monkeypatch.setattr(scenarios, "curves_for", capture)
    prepared = scenarios._prepare_daylight(
        SimulationRunRequest(daylight_model_enabled=True), [envs[tick]], [solar], [grids[tick]]
    )
    row = next(row for i, _kind, row in prepared[(0, sample.zone)] if i == index)
    np.testing.assert_array_equal(feature_grid(*captured[row], tuple(range(61))), matrix)
    curve = tuple(float(a * a) for a in range(61))
    assert at_angle(curve, 42.5) == (curve[42] + curve[43]) / 2
    assert at_angle(curve, -1) == curve[0]
    assert at_angle(curve, 100) == curve[-1]
    assert at_angle(None, 42) is None
    assert at_angle(curve, float("nan")) is None


def test_missing_unreadable_or_incompatible_artifacts_degrade_and_load_once(monkeypatch) -> None:
    from concurrent.futures import ThreadPoolExecutor

    from app.domain.daylight import surrogate

    calls = []

    def denied(path):
        calls.append(path)
        raise PermissionError("unreadable model directory")

    with TemporaryDirectory() as directory:
        monkeypatch.setattr(surrogate, "DEFAULTS", replace(DEFAULTS, daylight_model_dir=directory))
        surrogate._load_models.cache_clear()
        assert surrogate.models() is None  # actual absent files
        surrogate._load_models.cache_clear()
        monkeypatch.setattr("joblib.load", denied)
        with ThreadPoolExecutor(2) as pool:
            assert list(pool.map(lambda _: surrogate.models(), range(2))) == [None, None]
        assert len(calls) == 1
        surrogate._load_models.cache_clear()
        monkeypatch.setattr("joblib.load", lambda _path: {"target": "wrong"})
        assert surrogate.models() is None
        surrogate._load_models.cache_clear()


def test_real_surrogates_are_deterministic_night_safe_and_observe_only() -> None:
    from app.domain.controller import run_tick
    from app.domain.daylight import surrogate
    from app.domain.types import ControllerWeights

    if not Path(DEFAULTS.daylight_model_dir, "ev.joblib").exists():
        pytest.skip("Run make daylight-train for the real-artifact integration check")
    env = generate_day(date(2026, 3, 20))[18]
    solar, room = SolarState(250, 40, 800), RoomGeometry()
    probe = probes_for("west", 1)[0]
    optics = FacadeOptics(0.6, 40, 250, 270)
    curve = surrogate.curve_for(probe, optics, solar, env, room)
    assert curve is not None
    np.testing.assert_array_equal(curve, surrogate.curve_for(probe, optics, solar, env, room))
    assert not curve.flags.writeable
    assert surrogate.curves_for(()) == ()
    assert surrogate.curve_for(probe, optics, replace(solar, elevation=0), env, room) is None
    before = run_tick(env, 20, ControllerWeights(), solar=solar, optics=optics)
    after = run_tick(
        env,
        20,
        ControllerWeights(),
        solar=solar,
        optics=optics,
        daylight_curves=((0, probe.kind, curve),),
    )
    assert after.conditions.eye_illuminance is not None
    assert replace(after, conditions=before.conditions) == before
    assert (
        replace(after.conditions, eye_illuminance=None, task_illuminance=None, daylight_probes=None)
        == before.conditions
    )
