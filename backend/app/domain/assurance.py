"""Local sensor assurance: is one zone's reading plausible against its wall peers?

Pure functions over one tick's evidence and that zone's recent history. They never
receive a fault label, so the same code can judge a physical rig. The geometry model
only normalises rows against each other; agreement with the model alone proves
nothing, because in the simulation the model is also the truth.
"""

from collections.abc import Mapping, Sequence
from statistics import median

from app.config import DEFAULTS
from app.domain.types import ZoneAssessment

# One earlier tick for a zone: (verdict, its irradiance reading, median absolute change
# of its sunlit peers' readings since the tick before).
AssuranceSample = tuple[str, float, float]

_DEVIATING = ("suspect", "fault")
_DEAD_RATIO = 0.05


def adjacent_zones(zone: str) -> tuple[str, ...]:
    """Four-neighbours on the same wall, from the id formula in facade.zone_gains."""

    rows, columns = DEFAULTS.facade_zone_rows, DEFAULTS.facade_zone_columns
    row, column = divmod(int(zone[1:]) - 1, columns)
    return tuple(
        f"{zone[0]}{r * columns + c + 1}"
        for r, c in ((row - 1, column), (row + 1, column), (row, column - 1), (row, column + 1))
        if 0 <= r < rows and 0 <= c < columns
    )


def peer_ratios(
    readings: Mapping[str, float], models: Mapping[str, float]
) -> dict[str, float | None]:
    """k = reading / modelled aperture incident, or None where the sun is too weak to judge."""

    return {
        zone: reading / models[zone]
        if models[zone] >= DEFAULTS.assurance_min_model_irradiance
        else None
        for zone, reading in readings.items()
    }


def peer_median_change(
    zone: str,
    ratios: Mapping[str, float | None],
    readings: Mapping[str, float],
    previous: Mapping[str, float],
    excluded: frozenset[str] = frozenset(),
) -> float:
    """Median absolute change since the last tick across the peers that may vouch for
    ``zone``. Live sensors flicker even under a flat sky; a stuck one does not."""

    values = [
        abs(readings[other] - previous[other])
        for other, k in ratios.items()
        if other != zone and other not in excluded and k is not None and other in previous
    ]
    return median(values) if values else 0.0


def _insufficient(zone: str, reason: str, hypothesis=None, deviation=None, lux=None):
    return ZoneAssessment("insufficient", hypothesis, 0.0, deviation, lux, f"{zone}: {reason}")


def assess_zone(
    zone: str,
    ratios: Mapping[str, float | None],
    readings: Mapping[str, float],
    lux_ratio: float | None,
    lux_baseline: Sequence[float],
    recent: Sequence[AssuranceSample],
    peer_change: float = 0.0,
    excluded: frozenset[str] = frozenset(),
) -> ZoneAssessment:
    """Judge one zone's irradiance reading.

    ``lux_ratio`` is this tick's lux over modelled open lux through the blades;
    ``lux_baseline`` holds that ratio from recent ticks the zone read consistently.
    ``peer_change`` is ``peer_median_change`` for this tick. ``excluded`` zones
    (already isolated) never vouch for or against a neighbour.
    """

    own = ratios.get(zone)
    peers = {
        other: k
        for other, k in ratios.items()
        if other != zone and other not in excluded and k is not None
    }
    if own is None or len(peers) < DEFAULTS.assurance_min_peers:
        return _insufficient(zone, "too little sunlit peer evidence to judge this sensor.")
    reference = median(peers.values())
    if reference <= 0:
        return _insufficient(zone, "every sunlit peer reads no light, so no reference exists.")
    deviation = own / reference - 1
    baseline = median(lux_baseline) if len(lux_baseline) >= 3 else 0.0
    lux_deviation = lux_ratio / baseline - 1 if lux_ratio is not None and baseline > 0 else None
    consecutive = 1
    for verdict, *_ in reversed(recent):
        if verdict not in _DEVIATING:
            break
        consecutive += 1

    span = list(recent[-DEFAULTS.assurance_persist_ticks :])
    if len(span) == DEFAULTS.assurance_persist_ticks:
        own_values = [sample[1] for sample in span] + [readings[zone]]
        # Changes into each of the last persist_ticks readings, this tick included.
        peer_flicker = sum(sample[2] for sample in span[1:]) + peer_change
        if (
            max(own_values) - min(own_values) < DEFAULTS.assurance_stuck_change
            and peer_flicker > DEFAULTS.assurance_stuck_peer_change
        ):
            dead = own < _DEAD_RATIO
            return ZoneAssessment(
                "fault",
                "dead" if dead else "stuck",
                min(1.0, peer_flicker / (2 * DEFAULTS.assurance_stuck_peer_change)),
                deviation,
                lux_deviation,
                f"{zone} held {readings[zone]:.0f} W/m² for {len(own_values)} readings while "
                f"its peers moved {peer_flicker:.1f} W/m² between readings; a live sensor "
                "never holds that still.",
            )

    if abs(deviation) <= DEFAULTS.assurance_peer_deviation:
        return ZoneAssessment(
            "consistent",
            None,
            0.0,
            deviation,
            lux_deviation,
            f"{zone} reads {own:.2f}x its model against a peer median of {reference:.2f}x; "
            "consistent with the rest of the wall.",
        )

    corroborated = (
        lux_deviation is not None
        and abs(lux_deviation) > DEFAULTS.assurance_lux_deviation
        and (lux_deviation < 0) == (deviation < 0)
    )
    shared = [
        other
        for other in adjacent_zones(zone)
        if other in peers
        and abs(peers[other] - own) <= DEFAULTS.assurance_shadow_similarity
        and abs(peers[other] / reference - 1) > DEFAULTS.assurance_peer_deviation / 2
    ]
    if corroborated and shared:
        return ZoneAssessment(
            "legitimate_condition",
            "local_shadow",
            0.0,
            deviation,
            lux_deviation,
            f"{zone} and {', '.join(shared)} read {own:.2f}x against a wall median of "
            f"{reference:.2f}x, and indoor lux fell {abs(lux_deviation):.0%} too: a local "
            "shadow, not a sensor fault.",
        )
    if corroborated:
        return _insufficient(
            zone,
            f"reads {own:.2f}x against a wall median of {reference:.2f}x and its lux agrees, "
            "but no neighbour shares the drop; a one-zone shadow and a fouled pair look alike.",
            "ambiguous",
            deviation,
            lux_deviation,
        )

    hypothesis = (
        "dead" if own < _DEAD_RATIO else "drift_or_fouling" if deviation < 0 else "ambiguous"
    )
    verdict = "fault" if consecutive >= DEFAULTS.assurance_persist_ticks else "suspect"
    lux_note = (
        "its own lux channel does not share the change"
        if lux_deviation is not None
        else "no lux baseline is available to explain it"
    )
    return ZoneAssessment(
        verdict,
        hypothesis,
        min(1.0, abs(deviation) / (2 * DEFAULTS.assurance_peer_deviation))
        * min(1.0, consecutive / DEFAULTS.assurance_persist_ticks),
        deviation,
        lux_deviation,
        f"{zone} reads {own:.2f}x its model while the wall median is {reference:.2f}x for "
        f"{consecutive} tick(s), no neighbour shares it and {lux_note}.",
    )
