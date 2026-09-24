import inspect
from dataclasses import replace

import pytest

from app.config import DEFAULTS, TICK_COUNT
from app.domain import recovery
from app.domain.recovery import Episode, authorise, may_transition, open_episode, step, verdict
from app.domain.scenarios import run_scenario
from app.domain.types import ZoneAssessment
from app.schemas import SimulationRunRequest

FAULT = ZoneAssessment("fault", "dead", 1.0, -1.0, 0.0, "W6 reads nothing.")
CONSISTENT = ZoneAssessment("consistent", None, 0.0, 0.0, 0.0, "W6 agrees.")
NONE: frozenset[str] = frozenset()


@pytest.mark.parametrize(
    "mode,hypothesis,score,approved,expected",
    [
        ("monitor", "dead", 1.0, {"W6:38:dead"}, "monitoring"),
        ("review", "dead", 1.0, set(), "awaiting_approval"),
        ("review", "dead", 1.0, {"W6:38:dead"}, "mitigating"),
        ("auto", "dead", 1.0, set(), "mitigating"),
        ("auto", "stuck", 0.8, set(), "mitigating"),
        ("auto", "dead", 0.79, set(), "awaiting_approval"),
        ("auto", "drift_or_fouling", 1.0, set(), "awaiting_approval"),
        ("auto", "drift_or_fouling", 1.0, {"W6:38:dead"}, "mitigating"),
    ],
)
def test_authority_follows_mode_policy_and_explicit_approval(
    mode, hypothesis, score, approved, expected
) -> None:
    assert authorise(mode, hypothesis, score, "W6:38:dead", frozenset(approved))[0] == expected


def test_corrections_never_start_or_stop_under_a_safety_override() -> None:
    assert may_transition(safe_now=False, reading_present=True)
    assert not may_transition(safe_now=True, reading_present=True)
    assert not may_transition(safe_now=False, reading_present=False)
    authorised = open_episode("W6", 80, FAULT, "auto", NONE)
    assert step(authorised, FAULT, 80, safe_now=True, angle=12.0).mitigated_tick is None
    applied = step(authorised, FAULT, 81, safe_now=False, angle=12.0)
    assert (applied.mitigated_tick, applied.snapshot_angle) == (81, 12.0)
    assert [stage for _, stage, _ in applied.events] == [
        "detect",
        "authorise",
        "snapshot",
        "mitigate",
    ]


def test_episode_ids_are_stable_and_a_repeat_offender_escalates() -> None:
    assert open_episode("W6", 80, FAULT, "review", NONE) == open_episode(
        "W6", 80, FAULT, "review", NONE
    )
    repeat = open_episode("W6", 99, FAULT, "auto", NONE, persistent=True)
    assert (repeat.episode_id, repeat.status, repeat.maintenance_flag) == (
        "W6:99:dead",
        "escalated",
        True,
    )
    assert step(repeat, FAULT, 99, False, 5.0).isolating


def test_unapproved_episodes_close_when_the_evidence_clears() -> None:
    waiting = open_episode("W6", 80, FAULT, "review", NONE)
    for tick in range(81, 81 + DEFAULTS.assurance_persist_ticks):
        waiting = step(waiting, CONSISTENT, tick, False, 0.0)
    assert (waiting.status, waiting.closed_tick) == ("closed", 83)
    assert not waiting.isolating


def mitigating(**fields) -> Episode:
    base = Episode("W6:38:dead", "W6", "dead", 1.0, 80, "mitigating", 0.0, 80)
    return replace(base, **fields)


LIMIT = DEFAULTS.recovery_max_episode_ticks
UNVERIFIABLE = DEFAULTS.recovery_unverifiable_ticks


@pytest.mark.parametrize(
    "episode,cleared,expected",
    [
        # Rule 1 outranks a winning objective: a recovered sensor gets its input back.
        (mitigating(valid_ticks=6, e_corrected=1, e_uncorrected=5), True, "closed"),
        (mitigating(status="retained", fault_ticks=LIMIT), True, "closed"),
        (mitigating(status="retained", fault_ticks=LIMIT), False, "escalated"),
        # Isolated all night with no evidence either way: nothing to escalate on.
        (mitigating(status="retained", fault_ticks=LIMIT - 1), False, None),
        (mitigating(valid_ticks=3, evidence_ticks=UNVERIFIABLE), False, "escalated"),
        (mitigating(valid_ticks=3, evidence_ticks=UNVERIFIABLE - 1), False, None),
        (mitigating(valid_ticks=6, e_corrected=1.0, e_uncorrected=1.5), False, "retained"),
        (mitigating(valid_ticks=6, e_corrected=1.0, e_uncorrected=1.005), False, "rolled_back"),
        (mitigating(valid_ticks=5, e_corrected=0.0, e_uncorrected=9.0), False, None),
    ],
)
def test_verdict_rules_apply_in_declared_order(episode, cleared, expected) -> None:
    outcome = verdict(episode, cleared)
    assert (outcome and outcome[0]) == expected


def test_episode_limits_count_evidence_not_dark_hours() -> None:
    insufficient = ZoneAssessment("insufficient", None, 0.0, None, None, "Too dark.")
    episode = mitigating()
    for tick in range(81, 81 + 3 * LIMIT):
        episode = step(episode, insufficient, tick, False, 0.0)
    assert (episode.evidence_ticks, episode.fault_ticks) == (0, 0)
    episode = step(episode, FAULT, 200, False, 0.0)
    episode = step(episode, CONSISTENT, 201, False, 0.0)
    assert (episode.evidence_ticks, episode.fault_ticks, episode.cleared_ticks) == (2, 1, 1)
    # Nothing is counted before the isolation actually starts.
    waiting = step(open_episode("W6", 80, FAULT, "review", NONE), FAULT, 81, False, 0.0)
    assert (waiting.evidence_ticks, waiting.fault_ticks) == (0, 0)


def test_verification_counts_only_informative_ticks_before_judging() -> None:
    episode = mitigating()
    for tick in range(80, 85):
        episode = recovery.verify(episode, tick, False, 0.0, 0.0)
    assert (episode.status, episode.valid_ticks) == ("mitigating", 0)
    for tick in range(85, 91):
        episode = recovery.verify(episode, tick, True, 0.2, 0.9)
    assert episode.status == "retained"
    assert [stage for _, stage, _ in episode.events][-2:] == ["verify", "retain"]


def test_recovery_functions_cannot_be_handed_a_ground_truth_label() -> None:
    for function in (authorise, open_episode, step, verdict, recovery.verify):
        assert not set(inspect.signature(function).parameters) & {"kind", "label", "truth"}


def _run(**fields):
    return run_scenario(SimulationRunRequest(**fields)).model_dump(mode="json")


def _zones(payload: dict) -> dict[tuple[int, str], dict]:
    return {
        (index, zone["zone"]): {key: value for key, value in zone.items() if key != "assurance"}
        for index, tick in enumerate(payload["ticks"])
        for wall in tick["facade"]
        for zone in wall["zones"]
    }


DEAD = {"W6": {"kind": "dead", "start_tick": 36, "end_tick": 70}}


def test_an_automatic_correction_is_verified_retained_and_touches_only_its_zone() -> None:
    # The 12-degree travel bound below is a 1.2 deg/min limit, so both arms pin it.
    slow = {"actuator_speed_deg_per_min": 1.2}
    off = _zones(_run(zone_perturbations=DEAD, **slow))
    payload = _run(zone_perturbations=DEAD, fault_correction="auto", **slow)
    (episode,) = payload["episodes"]
    assert episode["episode_id"] == "W6:38:dead"
    stages = [event["stage"] for event in episode["events"]]
    assert stages == ["detect", "authorise", "snapshot", "mitigate", "verify", "retain"]
    assert episode["e_corrected"] < episode["e_uncorrected"]
    # Evening evidence runs out before the fault could clear or reach the episode limit.
    assert episode["status"] == "retained" and not episode["maintenance_flag"]
    zones = _zones(payload)
    changed = {zone for (index, zone), state in zones.items() if state != off[(index, zone)]}
    assert changed == {"W6"}
    isolated = zones[(48, "W6")]
    assert isolated["sensor_trusted"] is False
    assert isolated["control_input"]["irradiance_source"] == "model"
    # Only the dead irradiance channel is replaced; the live lux channel still counts.
    assert isolated["control_input"]["daylight_source"] == "sensor"
    assert "W6:38:dead" in isolated["reason"]
    assert all(
        abs(zones[(index, "W6")]["angle"] - zones[(index - 1, "W6")]["angle"]) <= 12.000001
        for index in range(37, TICK_COUNT)
    )
    assert payload["summary"]["episodes_retained"] == 1


def test_safety_owns_the_facade_while_a_correction_waits() -> None:
    request = {"scenario": "budget_failsafe", "zone_perturbations": DEAD}
    off = _zones(_run(**request))
    payload = _run(**request, fault_correction="auto")
    safe = {index for index, tick in enumerate(payload["ticks"]) if tick["mode"] == "SAFE"}
    assert safe
    for episode in payload["episodes"]:
        for event in episode["events"]:
            if event["stage"] in ("snapshot", "mitigate", "roll_back", "restore"):
                assert event["tick_index"] not in safe
    zones = _zones(payload)
    for index in safe:
        assert zones[(index, "W6")]["angle"] == off[(index, "W6")]["angle"]
        assert zones[(index, "W6")]["mode"] == "SAFE"


def test_review_waits_for_an_approval_that_replays_deterministically() -> None:
    fouled = {"W6": {"kind": "fouled", "start_tick": 36, "end_tick": 68, "severity": 0.4}}
    off = _zones(_run(zone_perturbations=fouled))
    waiting = _run(zone_perturbations=fouled, fault_correction="review")
    (episode,) = waiting["episodes"]
    assert episode["status"] == "awaiting_approval"
    assert _zones(waiting) == off
    approval = [episode["episode_id"], episode["episode_id"], "W9:12:dead"]
    request = {"zone_perturbations": fouled, "fault_correction": "review"}
    first = _run(**request, approved_episodes=approval)
    assert first == _run(**request, approved_episodes=approval)
    assert first == _run(**request, approved_episodes=approval[1:])
    (approved,) = first["episodes"]
    assert approved["episode_id"] == episode["episode_id"]
    assert [event["stage"] for event in approved["events"]][:4] == [
        "detect",
        "authorise",
        "snapshot",
        "mitigate",
    ]
    assert first["summary"]["unmatched_approvals"] == 1
    assert _zones(first) != off


def test_a_recovered_sensor_is_restored_to_its_own_reading() -> None:
    brief = {"W6": {"kind": "dead", "start_tick": 36, "end_tick": 42}}
    payload = _run(zone_perturbations=brief, fault_correction="auto")
    (episode,) = payload["episodes"]
    # Recovery is not a failed correction, so it neither rolls back nor marks the zone.
    assert episode["status"] == "closed"
    assert episode["events"][-1]["stage"] == "restore"
    assert payload["summary"]["episodes_rolled_back"] == 0
    restored = _zones(payload)[(episode["closed_tick"] + 1, "W6")]
    assert restored["sensor_trusted"] is True
    assert restored["control_input"]["irradiance_source"] == "sensor"


def test_a_shared_shadow_opens_no_episode() -> None:
    shadow = {zone: {"kind": "shadow", "start_tick": 36, "end_tick": 68} for zone in ("W6", "W7")}
    payload = _run(zone_perturbations=shadow, fault_correction="auto")
    assert not payload.get("episodes")
    assert payload["summary"]["episodes_opened"] == 0
    assert payload["summary"]["assurance_shadow_zone_ticks"] > 0
