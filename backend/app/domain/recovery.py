"""Verified fault recovery: one zone's episode from detection to its outcome.

Pure transitions. Authorisation is a policy lookup, verification is arithmetic on a
same-conditions counterfactual, and nothing here receives a fault label or waits on
a language model. Mechanical safety stays in run_tick; these functions only decide
which input a zone's controller may trust.
"""

from dataclasses import dataclass, replace
from typing import Literal

from app.config import DEFAULTS
from app.domain.types import ZoneAssessment

EpisodeStatus = Literal[
    "monitoring",
    "awaiting_approval",
    "mitigating",
    "retained",
    "rolled_back",
    "escalated",
    "closed",
]
# Statuses in which the zone's own sensor is set aside for the model.
ISOLATING = ("mitigating", "retained", "escalated")
# Statuses that still own the zone; the rest are finished.
OPEN = ("monitoring", "awaiting_approval", *ISOLATING)


@dataclass(frozen=True)
class Episode:
    """One zone's fault episode. The id is stable under replay of the same request."""

    episode_id: str
    zone: str
    hypothesis: str
    score: float
    opened_tick: int
    status: EpisodeStatus
    snapshot_angle: float | None = None
    mitigated_tick: int | None = None
    valid_ticks: int = 0
    e_corrected: float = 0.0
    e_uncorrected: float = 0.0
    cleared_ticks: int = 0
    # Since isolation: ticks with usable evidence, and ticks the fault was still seen.
    # Limits count these, never the clock, so a dark evening cannot escalate anything.
    evidence_ticks: int = 0
    fault_ticks: int = 0
    closed_tick: int | None = None
    maintenance_flag: bool = False
    events: tuple[tuple[int, str, str], ...] = ()

    @property
    def isolating(self) -> bool:
        return self.status in ISOLATING and self.mitigated_tick is not None


def authorise(
    mode: str, hypothesis: str, score: float, episode_id: str, approved: frozenset[str]
) -> tuple[EpisodeStatus, str]:
    if mode == "monitor":
        return "monitoring", "Monitor mode records the evidence and changes nothing."
    if episode_id in approved:
        return "mitigating", f"Operator approved {episode_id}; isolate the sensor."
    if (
        mode == "auto"
        and hypothesis in DEFAULTS.recovery_auto_hypotheses
        and score >= DEFAULTS.recovery_auto_score
    ):
        return (
            "mitigating",
            f"Policy authorises automatic isolation for a {hypothesis} sensor at score "
            f"{score:.2f} (limit {DEFAULTS.recovery_auto_score:.2f}).",
        )
    return (
        "awaiting_approval",
        f"A {hypothesis} hypothesis at score {score:.2f} needs operator approval before "
        "anything changes.",
    )


def may_transition(safe_now: bool, reading_present: bool) -> bool:
    """Never apply or revert a correction while mechanical safety owns the facade."""

    return not safe_now and reading_present


def open_episode(
    zone: str,
    index: int,
    assessment: ZoneAssessment,
    mode: str,
    approved: frozenset[str],
    *,
    persistent: bool = False,
) -> Episode:
    episode_id = f"{zone}:{index}:{assessment.hypothesis}"
    detected = (index, "detect", assessment.reason)
    if persistent:
        return Episode(
            episode_id,
            zone,
            assessment.hypothesis,
            assessment.score,
            index,
            "escalated",
            maintenance_flag=True,
            events=(
                detected,
                (
                    index,
                    "escalate",
                    "This zone re-flagged after an earlier correction was rolled back; keep "
                    "its sensor out of control and request maintenance.",
                ),
            ),
        )
    status, detail = authorise(mode, assessment.hypothesis, assessment.score, episode_id, approved)
    return Episode(
        episode_id,
        zone,
        assessment.hypothesis,
        assessment.score,
        index,
        status,
        events=(detected, (index, "authorise", detail)),
    )


def step(
    episode: Episode, assessment: ZoneAssessment, index: int, safe_now: bool, angle: float
) -> Episode:
    """Advance an open episode before this tick's controller acts."""

    deviating = assessment.verdict in ("suspect", "fault")
    if assessment.verdict == "consistent":
        cleared = episode.cleared_ticks + 1
    elif deviating:
        cleared = 0
    else:
        cleared = episode.cleared_ticks
    episode = replace(episode, cleared_ticks=cleared)
    if episode.isolating:
        episode = replace(
            episode,
            evidence_ticks=episode.evidence_ticks + (assessment.verdict != "insufficient"),
            fault_ticks=episode.fault_ticks + deviating,
        )
    if (
        episode.status in ("monitoring", "awaiting_approval")
        and cleared >= DEFAULTS.assurance_persist_ticks
    ):
        return _finish(
            episode, index, "closed", "close", "Evidence cleared before any correction was made."
        )
    if (
        episode.status in ("mitigating", "escalated")
        and episode.mitigated_tick is None
        and may_transition(safe_now, True)
    ):
        return replace(
            episode,
            snapshot_angle=angle,
            mitigated_tick=index,
            events=(
                *episode.events,
                (index, "snapshot", f"Recorded sensor input and louvre angle {angle:.1f}°."),
                (
                    index,
                    "mitigate",
                    "Isolate the implicated channel; control this zone on peer-scaled inputs.",
                ),
            ),
        )
    return episode


def verdict(episode: Episode, fault_evidence_cleared: bool) -> tuple[EpisodeStatus, str] | None:
    """Outcome for a mitigating or retained episode, or None to keep verifying."""

    if fault_evidence_cleared:
        # A recovered sensor is restored, not rolled back: rollback means the
        # correction itself failed verification.
        return "closed", "The sensor agrees with its peers again; restore its input."
    if episode.fault_ticks >= DEFAULTS.recovery_max_episode_ticks:
        return (
            "escalated",
            f"The fault was still evident for {episode.fault_ticks} isolated ticks; the "
            "substitute is not a repair, so request maintenance.",
        )
    if episode.status != "mitigating":
        return None
    if (
        episode.valid_ticks < DEFAULTS.recovery_min_valid_ticks
        and episode.evidence_ticks >= DEFAULTS.recovery_unverifiable_ticks
    ):
        return (
            "escalated",
            f"Only {episode.valid_ticks} informative ticks (sunlit, no safety override, "
            f"branches disagree) in {episode.evidence_ticks} ticks with usable evidence; the "
            "correction cannot be verified, so keep the sensor isolated and request "
            "maintenance.",
        )
    if episode.valid_ticks >= DEFAULTS.recovery_verify_ticks:
        if episode.e_corrected <= episode.e_uncorrected - DEFAULTS.recovery_cost_margin:
            return (
                "retained",
                f"Corrected objective {episode.e_corrected:.3f} beats uncorrected "
                f"{episode.e_uncorrected:.3f} over {episode.valid_ticks} ticks.",
            )
        return (
            "rolled_back",
            f"Corrected objective {episode.e_corrected:.3f} did not beat uncorrected "
            f"{episode.e_uncorrected:.3f} by {DEFAULTS.recovery_cost_margin}; restore the "
            "sensor input.",
        )
    return None


def verify(
    episode: Episode,
    index: int,
    valid: bool,
    corrected: float,
    uncorrected: float,
) -> Episode:
    """Add one tick of counterfactual evidence, then apply the verdict rules."""

    if not episode.isolating or episode.status == "escalated":
        return episode
    if valid and episode.status == "mitigating":
        episode = replace(
            episode,
            valid_ticks=episode.valid_ticks + 1,
            e_corrected=episode.e_corrected + corrected,
            e_uncorrected=episode.e_uncorrected + uncorrected,
        )
    outcome = verdict(episode, episode.cleared_ticks >= DEFAULTS.assurance_persist_ticks)
    if outcome is None:
        return episode
    status, detail = outcome
    stage = {
        "retained": "retain",
        "rolled_back": "roll_back",
        "escalated": "escalate",
        "closed": "restore",
    }[status]
    if episode.status == "mitigating":
        episode = replace(
            episode,
            events=(
                *episode.events,
                (
                    index,
                    "verify",
                    f"{episode.valid_ticks} informative ticks: corrected "
                    f"{episode.e_corrected:.3f}, uncorrected {episode.e_uncorrected:.3f} "
                    "(relative objective).",
                ),
            ),
        )
    if status == "retained":
        return replace(episode, status=status, events=(*episode.events, (index, stage, detail)))
    return _finish(episode, index, status, stage, detail)


def _finish(episode: Episode, index: int, status: EpisodeStatus, stage: str, detail: str):
    return replace(
        episode,
        status=status,
        closed_tick=None if status == "escalated" else index,
        maintenance_flag=episode.maintenance_flag or status == "escalated",
        events=(*episode.events, (index, stage, detail)),
    )
