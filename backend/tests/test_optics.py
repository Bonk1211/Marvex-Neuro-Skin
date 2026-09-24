from math import isfinite

import pytest

from app.domain.optics import FacadeOptics


def test_beam_transmission_matches_negative_x_blade_rotation_and_mesh_samples() -> None:
    optics = FacadeOptics(1, 30, 180, 180)
    # Actual two-blade meshes, sampled over a repeated bank, at a 30-degree sun.
    assert optics.beam_transmittance(0) == pytest.approx(0.1268, abs=0.001)
    assert optics.beam_transmittance(30) == pytest.approx(0.9495, abs=0.001)
    assert optics.beam_transmittance(60) == pytest.approx(0.1268, abs=0.001)
    # At high profile angles horizontal blades block sun; 60 degrees can admit it.
    high_sun = FacadeOptics(1, 60, 180, 180)
    assert high_sun.beam_transmittance(0) == 0
    assert high_sun.beam_transmittance(60) == pytest.approx(0.6679, abs=0.001)


@pytest.mark.parametrize("elevation,azimuth", [(-5, 180), (0, 180), (30, 0), (80, 180)])
def test_night_rear_and_self_shaded_walls_have_no_direct_contribution(
    elevation: float, azimuth: float
) -> None:
    optics = FacadeOptics(0.8, elevation, azimuth, 180)
    assert optics.beam_transmittance(30) == 0
    assert optics.solar_transmittance(30) == pytest.approx(0.2 * optics.diffuse_transmittance(30))
    assert optics.daylight_transmittance(30) == optics.solar_transmittance(30)


def test_diffuse_only_follows_blade_geometry_for_sky_and_ground() -> None:
    sky = FacadeOptics(0, 30, 180, 180)
    ground = FacadeOptics(0, 30, 180, 180, sky_fraction=0)
    # Horizontal deep blades obstruct both hemispheres; tilting them admits
    # more sky initially while progressively closing the view toward the ground.
    assert 0.3 < sky.diffuse_transmittance(0) < 0.5
    assert 0.3 < ground.diffuse_transmittance(0) < 0.5
    assert sky.diffuse_transmittance(15) > sky.diffuse_transmittance(0)
    assert ground.diffuse_transmittance(15) < ground.diffuse_transmittance(0)
    assert sky.diffuse_transmittance(60) < sky.diffuse_transmittance(0)
    assert ground.diffuse_transmittance(60) < ground.diffuse_transmittance(0)
    # A vertical wall and horizontal blades are symmetric above and below.
    vertical_sky = FacadeOptics(0, 30, 180, 180, facade_tilt=90)
    vertical_ground = FacadeOptics(0, 30, 180, 180, facade_tilt=90, sky_fraction=0)
    assert vertical_sky.diffuse_transmittance(0) == pytest.approx(
        vertical_ground.diffuse_transmittance(0)
    )


def test_mixed_beam_and_diffuse_are_weighted_without_inventing_light_at_cutoff() -> None:
    optics = FacadeOptics(0.75, 30, 180, 180, sky_fraction=0.3)
    beam = optics.beam_transmittance(30)
    sky = FacadeOptics(0, 30, 180, 180).diffuse_transmittance(30)
    ground = FacadeOptics(0, 30, 180, 180, sky_fraction=0).diffuse_transmittance(30)
    expected = 0.75 * beam + 0.25 * (0.3 * sky + 0.7 * ground)
    assert optics.solar_transmittance(30) == pytest.approx(expected)
    assert optics.daylight_transmittance(30) == pytest.approx(expected)
    cutoff = FacadeOptics(1, 60, 180, 180)
    assert cutoff.solar_transmittance(0) == cutoff.daylight_transmittance(0) == 0


def test_diffuse_lookup_interpolates_continuous_actuator_angles() -> None:
    optics = FacadeOptics(0, 30, 180, 180, sky_fraction=0.4)
    assert optics.diffuse_transmittance(17.25) == pytest.approx(
        0.75 * optics.diffuse_transmittance(17) + 0.25 * optics.diffuse_transmittance(18)
    )


def test_fraction_angle_and_grazing_sun_bounds_are_finite() -> None:
    for fraction in [-1, 0, 0.5, 1, 2, float("nan"), float("inf")]:
        optics = FacadeOptics(fraction, 30, 180, 180, sky_fraction=fraction)
        assert 0 <= optics.beam_fraction <= 1
        assert 0 <= optics.sky_fraction <= 1
        for method in (
            optics.beam_transmittance,
            optics.diffuse_transmittance,
            optics.solar_transmittance,
            optics.daylight_transmittance,
        ):
            assert method(-10) == method(0)
            assert method(100) == method(60)
            for angle in [0, 30, 60, float("nan"), float("inf")]:
                assert isfinite(method(angle)) and 0 <= method(angle) <= 1
    assert FacadeOptics(1, 65, 180, 180).beam_transmittance(60) == 0
    assert FacadeOptics(1, 30, float("nan"), 180).beam_transmittance(30) == 0
