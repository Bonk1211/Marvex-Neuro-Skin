import inspect

import pytest

from app.config import DEFAULTS
from app.domain.assurance import adjacent_zones, assess_zone, peer_median_change, peer_ratios
from app.domain.environment import perturb_zone_sensors
from app.domain.types import ZoneSensors

WALL = [f"W{index}" for index in range(1, 17)]


def evidence(**ratios: float) -> tuple[dict[str, float | None], dict[str, float]]:
    """A sunlit west wall reading its 500 W/m2 model, except the zones given."""

    readings = {zone: 500.0 * ratios.get(zone, 1.0) for zone in WALL}
    return peer_ratios(readings, dict.fromkeys(WALL, 500.0)), readings


def test_zone_perturbations_corrupt_only_their_declared_channels() -> None:
    sensors = ZoneSensors("W6", 400.0, 800.0)
    assert perturb_zone_sensors(sensors, "dead", 1.0, 0.5, None) == ZoneSensors("W6", 0.0, 800.0)
    frozen = ZoneSensors("W6", 350.0, 700.0)
    assert perturb_zone_sensors(sensors, "stuck", 0.5, 0.5, frozen) == ZoneSensors(
        "W6", 350.0, 700.0
    )
    assert perturb_zone_sensors(sensors, "drift", 0.5, 0.0, None) == sensors
    assert perturb_zone_sensors(sensors, "drift", 0.5, 1.0, None).irradiance == 200.0
    assert perturb_zone_sensors(sensors, "fouled", 0.4, 0.0, None) == ZoneSensors(
        "W6", 240.0, 800.0
    )
    # A shadow is real: both channels see less light.
    assert perturb_zone_sensors(sensors, "shadow", 0.5, 0.0, None) == ZoneSensors(
        "W6", 200.0, 400.0
    )
    with pytest.raises(ValueError, match="Unsupported zone perturbation"):
        perturb_zone_sensors(sensors, "melted", 0.5, 0.0, None)


def test_adjacency_follows_the_bottom_up_zone_numbering() -> None:
    assert set(adjacent_zones("W1")) == {"W5", "W2"}
    assert set(adjacent_zones("W6")) == {"W2", "W10", "W5", "W7"}
    assert set(adjacent_zones("W16")) == {"W12", "W15"}


def test_a_whole_wall_under_cloud_is_consistent_not_sixteen_faults() -> None:
    ratios, readings = evidence(**dict.fromkeys(WALL, 0.3))
    assessment = assess_zone("W6", ratios, readings, 0.3, [1.0, 1.0, 1.0], [])
    assert assessment.verdict == "consistent"
    assert assessment.score == 0


def test_a_shadow_shared_with_a_neighbour_and_seen_indoors_is_legitimate() -> None:
    ratios, readings = evidence(W6=0.5, W7=0.5)
    assessment = assess_zone("W6", ratios, readings, 0.5, [1.0, 1.0, 1.0], [])
    assert assessment.verdict == "legitimate_condition"
    assert assessment.hypothesis == "local_shadow"
    assert "W7" in assessment.reason


def test_a_one_zone_drop_confirmed_by_its_own_lux_is_ambiguous_not_a_fault() -> None:
    ratios, readings = evidence(W6=0.5)
    assessment = assess_zone("W6", ratios, readings, 0.5, [1.0, 1.0, 1.0], [])
    assert (assessment.verdict, assessment.hypothesis) == ("insufficient", "ambiguous")


def test_an_isolated_drop_the_lux_channel_denies_persists_into_a_fault() -> None:
    ratios, readings = evidence(W6=0.0)
    first = assess_zone("W6", ratios, readings, 1.0, [1.0, 1.0, 1.0], [])
    assert (first.verdict, first.hypothesis) == ("suspect", "dead")
    recent = [("suspect", 0.0, 5.0), ("suspect", 0.0, 5.0)]
    third = assess_zone("W6", ratios, readings, 1.0, [1.0, 1.0, 1.0], recent, 5.0)
    assert (third.verdict, third.hypothesis) == ("fault", "dead")
    assert third.score == 1.0
    fouled = assess_zone("W6", *evidence(W6=0.6), 1.0, [1.0, 1.0, 1.0], recent)
    assert (fouled.verdict, fouled.hypothesis) == ("fault", "drift_or_fouling")


def test_a_reading_that_never_flickers_while_peers_do_is_stuck() -> None:
    ratios, readings = evidence(W6=1.02)
    held = readings["W6"]
    recent = [("consistent", held, 2.0)] * DEFAULTS.assurance_persist_ticks
    assessment = assess_zone("W6", ratios, readings, 1.0, [1.0, 1.0, 1.0], recent, 2.0)
    assert (assessment.verdict, assessment.hypothesis) == ("fault", "stuck")
    # A live reading with ordinary noise is not stuck.
    live = [("consistent", held + offset, 2.0) for offset in (1.3, -0.8, 2.1)]
    assert assess_zone("W6", ratios, readings, 1.0, [1.0] * 3, live, 2.0).verdict == "consistent"
    # A still sky gives no evidence either way.
    calm = [("consistent", held, 0.0)] * DEFAULTS.assurance_persist_ticks
    assert assess_zone("W6", ratios, readings, 1.0, [1.0] * 3, calm, 0.0).verdict == "consistent"


def test_thin_dark_or_night_evidence_is_insufficient() -> None:
    readings = {zone: 500.0 for zone in ("W5", "W6", "W7")}
    ratios = peer_ratios(readings, dict.fromkeys(readings, 500.0))
    assert assess_zone("W6", ratios, readings, 1.0, [], []).verdict == "insufficient"
    night = peer_ratios(dict.fromkeys(WALL, 0.0), dict.fromkeys(WALL, 20.0))
    assert set(night.values()) == {None}
    assert assess_zone("W6", night, dict.fromkeys(WALL, 0.0), None, [], []).verdict == (
        "insufficient"
    )
    dark, dark_readings = evidence(**dict.fromkeys(WALL, 0.0))
    assert assess_zone("W6", dark, dark_readings, None, [], []).verdict == "insufficient"


def test_isolated_zones_neither_vouch_for_nor_count_as_peers() -> None:
    ratios, readings = evidence(W6=0.5, W7=0.5)
    excluded = frozenset({"W7"})
    assessment = assess_zone("W6", ratios, readings, 0.5, [1.0] * 3, [], excluded=excluded)
    assert assessment.verdict == "insufficient"
    previous = {zone: value - 4.0 for zone, value in readings.items()}
    assert peer_median_change("W6", ratios, readings, previous) == 4.0
    assert peer_median_change("W6", ratios, readings, {}) == 0.0


def test_the_detector_cannot_be_handed_a_ground_truth_label() -> None:
    parameters = set(inspect.signature(assess_zone).parameters)
    assert not parameters & {"kind", "label", "perturbation", "fault", "truth"}
