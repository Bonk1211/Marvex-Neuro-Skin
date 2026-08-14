"""Predictive radiant-slab charging — application 7.1.

The night-cooled slab is a thermal battery. A fixed 22:00–06:00 timer charges it
to the same level every night; this module charges it to the level *tomorrow*
actually needs, from a forecast of tomorrow's gains.

Three pieces, in the order they have to run:

1. ``identify_slab_response`` — a learned model of this building's mass response.
   A 1R1C slab is linear in its own state, so its capacity and surface coupling
   fall out of a least-squares fit on logged (slab temp, zone temp, charge) rows.
2. ``plan_slab`` — forecast tomorrow per zone from the digital twin, then search
   the charge energy that meets it at the lowest electrical cost.
3. ``audit_baseline`` — the honesty gate. A saving against "a fixed timer" is
   only a real saving if the incumbent schedule is genuinely fixed. Logged
   nights are tested for load compensation before any claim is allowed.

Everything is per square metre of floor until the summary, which scales to the
building. Load is thermal W/m²; the headline is electrical kWh through a
temperature-dependent COP, because charging in the cool hours is half the point.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from app.domain.scenarios import run_scenario
from app.schemas import (
    BaselineAuditPayload,
    BaselineNightInput,
    SimulationRunRequest,
    SimulationRunResponse,
    SlabHourPayload,
    SlabModelInput,
    SlabObservationInput,
    SlabPlanMetadata,
    SlabPlanRequest,
    SlabPlanResponse,
    SlabResponseFit,
    SlabSummary,
    SlabZonePlan,
)

# The charging night, in clock hours, followed by the day it pays for. Slot 0 is
# 22:00 the evening before the planned day. The twin is run for the planned day
# only, so hours 22 and 23 are read off that day's own evening — the diurnal
# shape repeats closely enough at this latitude, and irradiance is zero in both.
NIGHT_HOURS = (22, 23, 0, 1, 2, 3, 4, 5)
SEQUENCE = (*NIGHT_HOURS, *range(6, 22))

# A slab lighter than this has no useful battery in it. This is the O1 constraint
# the application carries: no thermal mass, no predictive charging.
MIN_USEFUL_CAPACITY_WH = 60.0

# Internal gains at full occupancy, W/m² of floor: people, lighting, equipment.
INTERNAL_GAIN_W = 25.0
BASE_GAIN_W = 6.0

# Night setback above the occupied setpoint. The slab still exchanges with the
# space overnight, which is where a fixed timer's standby loss comes from.
NIGHT_SETBACK_K = 2.0

MEASUREMENT_PROTOCOL = (
    "Alternate days: predictive charging on odd dates, the incumbent fixed "
    "schedule on even dates, for at least six weeks.",
    "Submeter the chiller separately from the rest of the plant, at 15-minute "
    "resolution, so night charging and day trim can be read apart.",
    "Weather-normalise the pairs on cooling degree hours before differencing; "
    "an unnormalised gap mostly measures which days were hotter.",
    "Log slab and zone temperatures throughout — they re-identify the mass "
    "model and prove the slab actually reached the commanded state.",
    "Run the baseline audit on the incumbent schedule first. If it already "
    "compensates for load, the fixed-timer comparison is not the real baseline.",
)


@dataclass(frozen=True)
class SlabModel:
    """1R1C radiant slab, per m² of floor. Knobs, not fitted constants.

    Defaults describe a 200 mm exposed concrete soffit. Real slabs differ, and
    the fit in ``identify_slab_response`` is what corrects these.
    """

    thickness_m: float = 0.20
    density: float = 2300.0
    specific_heat: float = 880.0
    surface_ua: float = 8.0
    charge_power: float = 70.0
    min_slab_temp: float = 19.0
    zone_setpoint: float = 24.0
    loss_ua: float = 1.5
    day_capacity: float = 55.0
    solar_to_floor: float = 0.10
    floor_area_m2: float = 12000.0

    @property
    def capacity_wh(self) -> float:
        """Heat capacity per m² of floor, Wh/m²K."""

        return self.thickness_m * self.density * self.specific_heat / 3600.0

    @property
    def time_constant_h(self) -> float:
        return self.capacity_wh / self.surface_ua


def model_from_input(value: SlabModelInput) -> SlabModel:
    return SlabModel(**value.model_dump())


def cop(outdoor_temp: float) -> float:
    """Chiller COP against outdoor dry bulb. Cooler air, cheaper cooling."""

    return float(np.clip(6.8 - 0.14 * (outdoor_temp - 24.0), 2.5, 7.5))


def dew_point(temp: float, relative_humidity: float) -> float:
    """Magnus dew point in °C. The floor under any slab temperature target."""

    rh = float(np.clip(relative_humidity, 1.0, 100.0))
    gamma = (17.62 * temp) / (243.12 + temp) + np.log(rh / 100.0)
    return float(243.12 * gamma / (17.62 - gamma))


def _indoor_rh(cloud: float, occupancy: float) -> float:
    """Indoor humidity proxy. Same expression the environment generator uses."""

    return float(np.clip(62.0 + 11.0 * cloud + 3.0 * occupancy, 45.0, 85.0))


# --------------------------------------------------------------------------
# 1. Learned mass response
# --------------------------------------------------------------------------


def identify_slab_response(
    history: list[SlabObservationInput],
    model: SlabModel,
) -> tuple[SlabModel, SlabResponseFit]:
    """Fit capacity and surface coupling from logged slab behaviour.

    One hour of a 1R1C slab is ``ΔT = (UA/C)·(T_zone − T_slab)·Δt − Q/C``, which
    is linear in the two unknowns ``UA/C`` and ``1/C``. Two columns, one least
    squares, no optimiser. With no log supplied the same fit runs against a
    seeded synthetic history so the page shows a real recovery rather than the
    assumed constants — and says so.
    """

    measured = len(history) >= 8
    rows = history if measured else _synthetic_history(model)
    if len(rows) < 8:
        return model, SlabResponseFit(
            source="default",
            samples=len(rows),
            capacity_wh_per_m2k=round(model.capacity_wh, 1),
            surface_ua=round(model.surface_ua, 2),
            time_constant_h=round(model.time_constant_h, 1),
            r_squared=0.0,
            note="Too few logged hours to identify the slab; assumed constants used.",
        )

    # Consecutive pairs only: a fit needs the step the slab actually took.
    design: list[list[float]] = []
    target: list[float] = []
    for previous, current in zip(rows, rows[1:], strict=False):
        design.append([previous.zone_temp - previous.slab_temp, -previous.charge_w])
        target.append(current.slab_temp - previous.slab_temp)
    matrix = np.array(design, dtype=float)
    steps = np.array(target, dtype=float)
    coefficients, *_ = np.linalg.lstsq(matrix, steps, rcond=None)
    ua_over_c, inverse_capacity = (float(coefficients[0]), float(coefficients[1]))

    residual = steps - matrix @ coefficients
    variance = float(np.var(steps))
    r_squared = 1.0 - float(np.var(residual)) / variance if variance > 0 else 0.0

    if inverse_capacity <= 0 or ua_over_c <= 0:
        return model, SlabResponseFit(
            source="measured" if measured else "synthetic",
            samples=len(rows),
            capacity_wh_per_m2k=round(model.capacity_wh, 1),
            surface_ua=round(model.surface_ua, 2),
            time_constant_h=round(model.time_constant_h, 1),
            r_squared=round(r_squared, 3),
            note=(
                "The fit returned a non-physical slab (negative capacity or coupling); "
                "assumed constants kept."
            ),
        )

    capacity = 1.0 / inverse_capacity
    surface_ua = ua_over_c * capacity
    # Capacity is expressed through thickness so the rest of the model stays in
    # one place: the fitted slab is the assumed one scaled to the measured mass.
    fitted = SlabModel(
        **{
            **model.__dict__,
            "thickness_m": capacity * 3600.0 / (model.density * model.specific_heat),
            "surface_ua": surface_ua,
        }
    )
    return fitted, SlabResponseFit(
        source="measured" if measured else "synthetic",
        samples=len(rows),
        capacity_wh_per_m2k=round(capacity, 1),
        surface_ua=round(surface_ua, 2),
        time_constant_h=round(capacity / surface_ua, 1),
        r_squared=round(r_squared, 3),
        note=(
            f"Identified from {len(rows)} logged hours of slab, zone and charge data."
            if measured
            else (
                f"No slab log supplied. Fitted against {len(rows)} hours of seeded "
                "synthetic slab behaviour, which recovers the assumed constants — "
                "supply real logs to identify the real slab."
            )
        ),
    )


def _synthetic_history(model: SlabModel, seed: int = 42) -> list[SlabObservationInput]:
    """Three nights of the assumed slab, with sensor noise. Clearly synthetic."""

    rng = np.random.default_rng(seed)
    rows: list[SlabObservationInput] = []
    slab = 25.5
    for night in range(3):
        for hour in SEQUENCE:
            charging = hour in NIGHT_HOURS and night % 2 == 0
            charge_w = model.charge_power if charging else 0.0
            zone_temp = model.zone_setpoint + (
                NIGHT_SETBACK_K if hour in NIGHT_HOURS else 0.0
            )
            rows.append(
                SlabObservationInput(
                    hour=hour,
                    slab_temp=round(slab + float(rng.normal(0, 0.03)), 3),
                    zone_temp=zone_temp,
                    charge_w=charge_w,
                )
            )
            step = (
                model.surface_ua * (zone_temp - slab) - charge_w
            ) / model.capacity_wh
            slab = float(np.clip(slab + step, model.min_slab_temp, 30.0))
    return rows


# --------------------------------------------------------------------------
# 2. Forecast and charge
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ZoneForecast:
    """Tomorrow, as one zone's controller will meet it."""

    zone: str
    row: int
    column: int
    load: tuple[float, ...]  # W/m² of floor, in SEQUENCE order
    gain_wh: float


@dataclass(frozen=True)
class DayForecast:
    outdoor_temp: tuple[float, ...]
    dew_point: tuple[float, ...]
    occupancy: tuple[float, ...]
    zones: tuple[ZoneForecast, ...]


def forecast_day(
    twin: SimulationRunResponse, orientation: str, model: SlabModel
) -> DayForecast:
    """Fold the twin's 10-minute ticks into the hourly forecast the planner reads.

    The zones are the primary facade's own 4 x 4 grid: the same sixteen cells the
    louvre controllers already act on, so a zone's slab charge answers for the
    gain its own facade zone is forecast to let through.
    """

    ticks = twin.ticks
    per_hour = max(1, len(ticks) // 24)
    outdoor: list[float] = []
    dew: list[float] = []
    occupancy: list[float] = []
    zone_loads: dict[str, list[float]] = {}
    zone_cells: dict[str, tuple[int, int]] = {}

    for hour in SEQUENCE:
        window = ticks[hour * per_hour : (hour + 1) * per_hour]
        outdoor.append(float(np.mean([tick.outdoor_temp for tick in window])))
        cloud = float(np.mean([tick.cloud for tick in window]))
        occupied = float(np.mean([tick.occupancy for tick in window]))
        occupancy.append(occupied)
        # Indoor air, not outdoor: condensation risk is on the slab's own surface.
        dew.append(dew_point(model.zone_setpoint, _indoor_rh(cloud, occupied)))
        slot = len(outdoor) - 1

        for tick in window:
            wall = next(
                (item for item in tick.facade if item.orientation == orientation), None
            )
            if wall is None:
                continue
            for cell in wall.zones:
                zone_cells[cell.zone] = (cell.row, cell.column)
                load = (
                    model.solar_to_floor * cell.transmitted
                    + INTERNAL_GAIN_W * tick.occupancy
                    + BASE_GAIN_W
                )
                bucket = zone_loads.setdefault(cell.zone, [])
                while len(bucket) <= slot:
                    bucket.append(0.0)
                bucket[slot] += load / len(window)

    zones = tuple(
        ZoneForecast(
            zone=zone,
            row=zone_cells[zone][0],
            column=zone_cells[zone][1],
            load=tuple(loads),
            gain_wh=float(sum(loads)),
        )
        for zone, loads in sorted(
            zone_loads.items(), key=lambda item: zone_cells[item[0]]
        )
    )
    return DayForecast(
        outdoor_temp=tuple(outdoor),
        dew_point=tuple(dew),
        occupancy=tuple(occupancy),
        zones=zones,
    )


def charge_schedule(
    target_wh: float, forecast: DayForecast, model: SlabModel
) -> list[float]:
    """Where in the night to put ``target_wh``, hour by hour.

    Cheapest first: the coolest hours carry the best COP, so the same stored
    kilowatt-hour costs less electricity there. Ties break late, because heat
    stored later has less night left to leak back into the space.
    """

    ranked = sorted(
        range(len(NIGHT_HOURS)), key=lambda slot: (forecast.outdoor_temp[slot], -slot)
    )
    schedule = [0.0] * len(SEQUENCE)
    remaining = target_wh
    for slot in ranked:
        if remaining <= 0:
            break
        take = min(model.charge_power, remaining)
        schedule[slot] = take
        remaining -= take
    return schedule


@dataclass(frozen=True)
class ZoneRun:
    slab_temp: tuple[float, ...]
    charge_w: tuple[float, ...]
    chiller_thermal: tuple[float, ...]
    electrical_wh: float
    unmet_hours: int
    floor_hours: int
    rejected_wh: float
    standby_loss_wh: float
    delivered_wh: float
    min_slab_temp: float


def simulate_zone(
    zone: ZoneForecast,
    schedule: list[float],
    forecast: DayForecast,
    model: SlabModel,
    floor_temp: float,
    start_temp: float,
) -> ZoneRun:
    """One zone through the night and the day it charged for.

    Three things happen to the slab each hour, in order: the plant charges it,
    the space discharges it, and the rest of the world leaks into it. The second
    is capped at the load actually present — a radiant circuit modulates rather
    than freezing an empty room — which is why an overcharged slab does not
    quietly do useful work with the surplus. The third is where the surplus goes.
    """

    slab = start_temp
    temps: list[float] = []
    charged: list[float] = []
    trims: list[float] = []
    electrical = 0.0
    unmet = 0
    floor_hours = 0
    rejected = 0.0
    standby = 0.0
    delivered_total = 0.0

    for slot, hour in enumerate(SEQUENCE):
        # The slab cannot be charged past its floor, so a timer commanding more
        # power than the slab can safely take simply wastes the command.
        headroom = max(0.0, slab - floor_temp) * model.capacity_wh
        delivered = min(schedule[slot], headroom)
        slab -= delivered / model.capacity_wh
        delivered_total += delivered
        if schedule[slot] > 0.5:
            rejected += schedule[slot] - delivered
            if delivered < schedule[slot] - 1e-6:
                floor_hours += 1

        zone_temp = model.zone_setpoint + (
            NIGHT_SETBACK_K if hour in NIGHT_HOURS else 0.0
        )
        load = zone.load[slot]
        # Never more heat than the space has to give.
        absorbed = float(
            np.clip(model.surface_ua * (zone_temp - slab), 0.0, load)
        )
        slab += absorbed / model.capacity_wh

        # What the charge loses to structure, ground and outside air whether the
        # building uses it or not.
        loss = max(0.0, model.loss_ua * (forecast.outdoor_temp[slot] - slab))
        slab += loss / model.capacity_wh
        standby += loss

        thermal = max(0.0, load - absorbed)
        trim = min(thermal, model.day_capacity)
        if thermal - trim > 1e-6:
            unmet += 1

        electrical += (delivered + trim) / cop(forecast.outdoor_temp[slot])
        temps.append(slab)
        charged.append(delivered)
        trims.append(trim)

    return ZoneRun(
        slab_temp=tuple(temps),
        charge_w=tuple(charged),
        chiller_thermal=tuple(trims),
        electrical_wh=electrical,
        unmet_hours=unmet,
        floor_hours=floor_hours,
        rejected_wh=rejected,
        standby_loss_wh=standby,
        delivered_wh=delivered_total,
        min_slab_temp=min(temps),
    )


def optimise_zone(
    zone: ZoneForecast,
    forecast: DayForecast,
    model: SlabModel,
    floor_temp: float,
    start_temp: float,
    steps: int = 24,
) -> tuple[float, ZoneRun]:
    """The charge energy this zone's tomorrow actually needs.

    A one-variable search rather than a closed form: the slab saturates at its
    floor temperature and the COP varies hour to hour, so the cost curve is not
    something to differentiate by hand. Fewest unmet hours first, then cheapest.
    """

    usable = max(0.0, start_temp - floor_temp) * model.capacity_wh
    ceiling = min(usable, model.charge_power * len(NIGHT_HOURS))
    best: tuple[float, ZoneRun] | None = None
    for step in range(steps + 1):
        target = ceiling * step / steps
        run = simulate_zone(
            zone,
            charge_schedule(target, forecast, model),
            forecast,
            model,
            floor_temp,
            start_temp,
        )
        if best is None or (run.unmet_hours, run.electrical_wh) < (
            best[1].unmet_hours,
            best[1].electrical_wh,
        ):
            best = (target, run)
    assert best is not None
    return best


def baseline_schedule(model: SlabModel) -> list[float]:
    """The incumbent: full charge power for every hour of a fixed 22:00–06:00."""

    return [
        model.charge_power if slot < len(NIGHT_HOURS) else 0.0
        for slot in range(len(SEQUENCE))
    ]


# --------------------------------------------------------------------------
# 3. Baseline audit
# --------------------------------------------------------------------------


def audit_baseline(nights: list[BaselineNightInput]) -> BaselineAuditPayload:
    """Is the incumbent charging genuinely a fixed schedule?

    A saving quoted against "a fixed 22:00–06:00 timer" is only real if that is
    what the building does. A schedule that already varies with the next day's
    load is a weaker baseline to beat, and quoting against the timer would
    overstate the result. Two tests on the logged nights: how much the charge
    energy varies at all, and whether what variation exists tracks the next
    day's cooling.
    """

    if not nights:
        return BaselineAuditPayload(
            verdict="not_supplied",
            nights=0,
            charge_variation=None,
            correlation=None,
            claim_allowed=False,
            note=(
                "No logged nights supplied. The fixed-schedule baseline is assumed, "
                "not verified, so no saving is claimed against it yet."
            ),
        )
    if len(nights) < 5:
        return BaselineAuditPayload(
            verdict="insufficient_data",
            nights=len(nights),
            charge_variation=None,
            correlation=None,
            claim_allowed=False,
            note=(
                f"{len(nights)} logged nights is too few to tell a fixed schedule from "
                "a compensated one. Five is the minimum; two weeks is better."
            ),
        )

    charge = np.array([night.charge_kwh for night in nights], dtype=float)
    demand = np.array([night.next_day_cooling_kwh for night in nights], dtype=float)
    mean_charge = float(np.mean(charge))
    variation = float(np.std(charge) / mean_charge) if mean_charge > 0 else 0.0
    correlation = (
        float(np.corrcoef(charge, demand)[0, 1])
        if np.std(charge) > 0 and np.std(demand) > 0
        else 0.0
    )

    if variation < 0.05:
        return BaselineAuditPayload(
            verdict="fixed_schedule",
            nights=len(nights),
            charge_variation=round(variation, 3),
            correlation=round(correlation, 3),
            claim_allowed=True,
            note=(
                f"Night charge varies by {variation * 100:.1f}% across {len(nights)} "
                "nights — a clock, not a controller. The fixed-schedule baseline holds."
            ),
        )
    if abs(correlation) >= 0.5:
        return BaselineAuditPayload(
            verdict="load_compensated",
            nights=len(nights),
            charge_variation=round(variation, 3),
            correlation=round(correlation, 3),
            claim_allowed=False,
            note=(
                f"Night charge already tracks next-day cooling (r = {correlation:.2f}). "
                "This building is not running a fixed timer, so a saving quoted against "
                "one would overstate the result. Compare against the compensated "
                "schedule as it runs today."
            ),
        )
    return BaselineAuditPayload(
        verdict="partially_compensated",
        nights=len(nights),
        charge_variation=round(variation, 3),
        correlation=round(correlation, 3),
        claim_allowed=False,
        note=(
            f"Charge varies by {variation * 100:.1f}% but only weakly with next-day "
            f"load (r = {correlation:.2f}) — probably manual overrides rather than "
            "control. Establish what drives the variation before claiming against a "
            "fixed timer."
        ),
    )


# --------------------------------------------------------------------------
# The plan
# --------------------------------------------------------------------------


def _twin_request(request: SlabPlanRequest, planned: date) -> SimulationRunRequest:
    return SimulationRunRequest(
        scenario="overview",
        date=planned,
        seed=request.seed,
        environment_source=request.environment_source,
        cloud_profile=request.cloud_profile,
        latitude=request.latitude,
        longitude=request.longitude,
        timezone=request.timezone,
        location_name=request.location_name,
        facade_orientation=request.facade_orientation,
        facade_tilt=request.facade_tilt,
        roof_pitch=request.roof_pitch,
    )


def _peak(runs: list[ZoneRun]) -> float:
    """Highest mean plant call across the day, charge and day trim together."""

    return max(
        float(np.mean([run.charge_w[slot] + run.chiller_thermal[slot] for run in runs]))
        for slot in range(len(SEQUENCE))
    )


def plan_slab(request: SlabPlanRequest, *, today: date | None = None) -> SlabPlanResponse:
    """Tomorrow's charge, zone by zone, against the fixed-timer baseline."""

    planned = request.date or ((today or date.today()) + timedelta(days=1))
    assumed = model_from_input(request.model)
    model, fit = identify_slab_response(request.history, assumed)
    audit = audit_baseline(request.baseline_nights)

    twin = run_scenario(_twin_request(request, planned))
    forecast = forecast_day(twin, request.facade_orientation, model)

    applicable = model.capacity_wh >= MIN_USEFUL_CAPACITY_WH
    applicability_note = (
        f"Slab holds {model.capacity_wh:.0f} Wh/m²K, above the "
        f"{MIN_USEFUL_CAPACITY_WH:.0f} Wh/m²K a night charge needs to survive to the "
        "afternoon. Constraint O1 met."
        if applicable
        else (
            f"Slab holds only {model.capacity_wh:.0f} Wh/m²K, below the "
            f"{MIN_USEFUL_CAPACITY_WH:.0f} Wh/m²K floor. There is no thermal battery "
            "here to charge, so constraint O1 rules this application out for this "
            "building."
        )
    )

    # The slab starts the night where the previous day left it: a degree above
    # the occupied setpoint, uncharged. Its floor is whichever binds first, the
    # structural minimum or the dew point, with a margin against a wet soffit.
    start_temp = model.zone_setpoint + 1.0
    floor_temp = max(model.min_slab_temp, max(forecast.dew_point) + 1.0)

    zone_area = model.floor_area_m2 / max(1, len(forecast.zones))
    zone_plans: list[SlabZonePlan] = []
    predictive_runs: list[ZoneRun] = []
    baseline_runs: list[ZoneRun] = []
    predictive_targets: list[float] = []

    for zone in forecast.zones:
        target, run = optimise_zone(zone, forecast, model, floor_temp, start_temp)
        base = simulate_zone(
            zone, baseline_schedule(model), forecast, model, floor_temp, start_temp
        )
        predictive_targets.append(target)
        predictive_runs.append(run)
        baseline_runs.append(base)
        zone_plans.append(
            SlabZonePlan(
                zone=zone.zone,
                row=zone.row,
                column=zone.column,
                forecast_gain_wh=round(zone.gain_wh, 1),
                charge_target_wh=round(target, 1),
                delivered_wh=round(run.delivered_wh, 1),
                baseline_delivered_wh=round(base.delivered_wh, 1),
                charge_hours=[
                    SEQUENCE[slot]
                    for slot, watts in enumerate(run.charge_w)
                    if watts > 0.5
                ],
                min_slab_temp=round(run.min_slab_temp, 2),
                predictive_kwh=round(run.electrical_wh * zone_area / 1000.0, 2),
                baseline_kwh=round(base.electrical_wh * zone_area / 1000.0, 2),
                unmet_hours=run.unmet_hours,
                baseline_unmet_hours=base.unmet_hours,
                floor_hours=run.floor_hours,
                baseline_floor_hours=base.floor_hours,
            )
        )

    hours = [
        SlabHourPayload(
            slot=slot,
            hour=hour,
            label=f"{hour:02d}:00",
            outdoor_temp=round(forecast.outdoor_temp[slot], 2),
            dew_point=round(forecast.dew_point[slot], 2),
            occupancy=round(forecast.occupancy[slot], 3),
            cop=round(cop(forecast.outdoor_temp[slot]), 2),
            cooling_demand_w=round(
                float(np.mean([zone.load[slot] for zone in forecast.zones])), 2
            ),
            predictive_charge_w=round(
                float(np.mean([run.charge_w[slot] for run in predictive_runs])), 2
            ),
            baseline_charge_w=round(
                float(np.mean([run.charge_w[slot] for run in baseline_runs])), 2
            ),
            predictive_slab_temp=round(
                float(np.mean([run.slab_temp[slot] for run in predictive_runs])), 2
            ),
            baseline_slab_temp=round(
                float(np.mean([run.slab_temp[slot] for run in baseline_runs])), 2
            ),
            predictive_trim_w=round(
                float(np.mean([run.chiller_thermal[slot] for run in predictive_runs])), 2
            ),
            baseline_trim_w=round(
                float(np.mean([run.chiller_thermal[slot] for run in baseline_runs])), 2
            ),
        )
        for slot, hour in enumerate(SEQUENCE)
    ]

    predictive_kwh = sum(run.electrical_wh for run in predictive_runs) * zone_area / 1000.0
    baseline_kwh = sum(run.electrical_wh for run in baseline_runs) * zone_area / 1000.0
    saving = baseline_kwh - predictive_kwh

    summary = SlabSummary(
        predictive_kwh=round(predictive_kwh, 1),
        baseline_kwh=round(baseline_kwh, 1),
        saving_kwh=round(saving, 1),
        saving_percent=round(100.0 * saving / baseline_kwh, 1) if baseline_kwh > 0 else 0.0,
        predictive_charge_wh_m2=round(
            float(np.mean([run.delivered_wh for run in predictive_runs])), 1
        ),
        baseline_charge_wh_m2=round(
            float(np.mean([run.delivered_wh for run in baseline_runs])), 1
        ),
        predictive_peak_w_m2=round(_peak(predictive_runs), 2),
        baseline_peak_w_m2=round(_peak(baseline_runs), 2),
        predictive_unmet_hours=sum(run.unmet_hours for run in predictive_runs),
        baseline_unmet_hours=sum(run.unmet_hours for run in baseline_runs),
        predictive_floor_hours=sum(run.floor_hours for run in predictive_runs),
        baseline_floor_hours=sum(run.floor_hours for run in baseline_runs),
        predictive_rejected_wh_m2=round(
            float(np.mean([run.rejected_wh for run in predictive_runs])), 1
        ),
        baseline_rejected_wh_m2=round(
            float(np.mean([run.rejected_wh for run in baseline_runs])), 1
        ),
        predictive_standby_loss_wh_m2=round(
            float(np.mean([run.standby_loss_wh for run in predictive_runs])), 1
        ),
        baseline_standby_loss_wh_m2=round(
            float(np.mean([run.standby_loss_wh for run in baseline_runs])), 1
        ),
        slab_floor_temp=round(floor_temp, 2),
        zones=len(forecast.zones),
        floor_area_m2=model.floor_area_m2,
    )

    weather = twin.metadata.weather_context
    metadata = SlabPlanMetadata(
        location=twin.metadata.location,
        latitude=twin.metadata.latitude,
        longitude=twin.metadata.longitude,
        timezone=twin.metadata.timezone,
        facade_orientation=twin.metadata.facade_orientation,
        environment_source=twin.metadata.environment_source,
        forecast_status=weather.status if weather is not None else "synthetic",
        forecast_provider=weather.provider if weather is not None else "Seeded synthetic day",
        forecast_dataset=weather.dataset if weather is not None else None,
        forecast_fallback=weather.fallback_reason if weather is not None else None,
        data_notice=twin.metadata.data_notice,
        capacity_wh_per_m2k=round(model.capacity_wh, 1),
        time_constant_h=round(model.time_constant_h, 1),
        charge_power_w_m2=model.charge_power,
        synthetic=True,
    )

    return SlabPlanResponse(
        date=planned,
        title="Predictive radiant-slab charging",
        applicable=applicable,
        applicability_note=applicability_note,
        metadata=metadata,
        model_fit=fit,
        baseline_audit=audit,
        summary=summary,
        hours=hours,
        zones=zone_plans,
        measurement_protocol=list(MEASUREMENT_PROTOCOL),
    )
