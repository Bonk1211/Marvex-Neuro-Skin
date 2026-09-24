from dataclasses import replace
from datetime import date

import pytest

from app.domain.controller import run_tick
from app.domain.environment import generate_day
from app.domain.optics import FacadeOptics
from app.domain.scenarios import run_scenario
from app.domain.types import ControllerWeights, SolarState
from app.schemas import SimulationRunRequest


def test_west_demo_tracks_sun_progressively_through_the_full_range() -> None:
    run = run_scenario(
        SimulationRunRequest(scenario="solar_tracking", cloud_profile="clear", wind_override=3)
    )
    assert run.summary["sensor_fault_ticks"] == run.summary["safe_mode_ticks"] == 0
    angles = []
    for tick in run.ticks:
        west = next(w for w in tick.facade if w.orientation == "west")
        rig = [z for z in west.zones if z.zone in {"W9", "W10", "W13", "W14"}]
        assert all(z.sensor_trusted and z.mode != "SAFE" for z in rig)
        angles.append(rig[0].angle)
        assert all(z.angle == pytest.approx(z.angle_target) for z in rig)
        if tick.timestamp.hour == 15 and tick.timestamp.minute == 0:
            assert all(49 < z.angle < 51 for z in rig)
        if tick.timestamp.hour == 16 and tick.timestamp.minute == 0:
            assert all(79 < z.angle < 81 for z in rig)
        if tick.timestamp.hour == 17 and tick.timestamp.minute == 0:
            assert all(109 < z.angle < 111 for z in rig)
        if tick.timestamp.hour < 13:
            assert all(z.angle == 0 for z in rig)
    assert 160 < max(angles) < 180
    assert all(0 <= b - a < 6 for a, b in zip(angles, angles[1:]))
    assert len({round(angle, 1) for angle in angles}) > 30

    for elevation, target in ((90, 0), (75, 30), (60, 60), (45, 90), (30, 120), (15, 150)):
        optics = FacadeOptics(0.8, elevation, 270, 270, reflector=True)
        assert optics.tracking_angle() == pytest.approx(target)
        # The target must not jump as direct sun emerges from cloud/roof shade.
        assert replace(optics, beam_fraction=0).tracking_angle() == pytest.approx(target)
    assert replace(optics, solar_elevation=0.001).tracking_angle() == pytest.approx(179.998)

    env = generate_day(date(2026, 3, 21), cloud_profile="clear")[54]
    solar = SolarState(270, 30, 800)
    optics = FacadeOptics(0.8, 30, 270, 270, reflector=True)
    assert optics.tracking_angle() == pytest.approx(120)
    assert replace(optics, solar_azimuth=90).tracking_angle() == 0
    assert replace(optics, solar_elevation=-5).tracking_angle() == 0
    # Projected sun elevation, not the clock or altitude alone, drives the hinge.
    assert replace(optics, solar_azimuth=300).tracking_angle() < optics.tracking_angle()
    # A literal half-turn flips the blade, restoring its original optical plane.
    assert optics.beam_transmittance(180) == pytest.approx(optics.beam_transmittance(0))
    assert optics.diffuse_transmittance(180) == pytest.approx(optics.diffuse_transmittance(0))
    assert optics.beam_transmittance(180) > optics.beam_transmittance(60)
    assert optics.diffuse_transmittance(200) == optics.diffuse_transmittance(180)
    kwargs = dict(solar=solar, optics=optics)
    limited = run_tick(env, 0, ControllerWeights(), actuator_speed_deg_per_min=0.5, **kwargs)
    assert limited.decision.angle_target == pytest.approx(120)
    assert limited.decision.angle_final == 5
    assert (
        run_tick(replace(env, wind=18), 45, ControllerWeights(), **kwargs).decision.mode == "SAFE"
    )
    assert run_tick(env, 45, ControllerWeights(), power_ok=False, **kwargs).decision.mode == "SAFE"
