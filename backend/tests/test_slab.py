"""Predictive radiant-slab charging: mass identification, plan, baseline audit."""

from datetime import date

from fastapi.testclient import TestClient

from app.domain.slab import (
    NIGHT_HOURS,
    SEQUENCE,
    DayForecast,
    SlabModel,
    ZoneForecast,
    audit_baseline,
    baseline_schedule,
    charge_schedule,
    cop,
    dew_point,
    identify_slab_response,
    optimise_zone,
    plan_slab,
    simulate_zone,
)
from app.main import app
from app.schemas import BaselineNightInput, SlabPlanRequest

DAY = date(2026, 3, 21)


def _forecast(load: float = 40.0, outdoor: float = 28.0) -> DayForecast:
    zone = ZoneForecast(
        zone="W1",
        row=0,
        column=0,
        load=tuple(load if hour >= 8 else 8.0 for hour in SEQUENCE),
        gain_wh=load * 14,
    )
    return DayForecast(
        outdoor_temp=tuple(
            outdoor - 4.0 if hour in NIGHT_HOURS else outdoor for hour in SEQUENCE
        ),
        dew_point=tuple([21.0] * len(SEQUENCE)),
        occupancy=tuple(0.9 if 8 <= hour < 18 else 0.05 for hour in SEQUENCE),
        zones=(zone,),
    )


def test_cop_and_dew_point_move_the_right_way():
    assert cop(20.0) > cop(32.0)
    assert dew_point(24.0, 80.0) > dew_point(24.0, 55.0)
    # Saturated air dews at its own temperature.
    assert abs(dew_point(24.0, 100.0) - 24.0) < 0.2


def test_identification_recovers_the_slab_it_was_given():
    model = SlabModel()
    fitted, fit = identify_slab_response([], model)
    assert fit.source == "synthetic"
    assert fit.r_squared > 0.9
    # A 1R1C slab is identifiable from its own trajectory, so the fit should land
    # close to the constants that generated it.
    assert abs(fitted.capacity_wh - model.capacity_wh) / model.capacity_wh < 0.15
    assert abs(fitted.surface_ua - model.surface_ua) / model.surface_ua < 0.15


def test_charging_never_drives_the_slab_below_its_floor():
    model = SlabModel()
    forecast = _forecast()
    run = simulate_zone(
        forecast.zones[0], baseline_schedule(model), forecast, model, 20.0, 25.0
    )
    assert run.min_slab_temp >= 20.0 - 1e-6
    assert 0 < run.delivered_wh <= model.charge_power * len(NIGHT_HOURS) + 1e-6


def test_schedule_fills_the_coolest_hours_first():
    model = SlabModel()
    forecast = _forecast()
    schedule = charge_schedule(2 * model.charge_power, forecast, model)
    used = [slot for slot, watts in enumerate(schedule) if watts > 0]
    assert len(used) == 2
    assert all(slot < len(NIGHT_HOURS) for slot in used)
    night_temps = forecast.outdoor_temp[: len(NIGHT_HOURS)]
    assert max(forecast.outdoor_temp[slot] for slot in used) <= min(night_temps) + 1e-6


def test_predictive_charging_never_costs_more_than_the_fixed_timer():
    model = SlabModel()
    forecast = _forecast(load=18.0)  # A mild day the timer overcharges for.
    _target, predictive = optimise_zone(forecast.zones[0], forecast, model, 20.0, 25.0)
    fixed = simulate_zone(
        forecast.zones[0], baseline_schedule(model), forecast, model, 20.0, 25.0
    )
    assert predictive.electrical_wh <= fixed.electrical_wh
    assert predictive.unmet_hours <= fixed.unmet_hours


def test_no_thermal_mass_fails_the_o1_constraint():
    request = SlabPlanRequest(date=DAY, environment_source="synthetic")
    request.model.thickness_m = 0.02  # A steel deck, not a slab.
    plan = plan_slab(request)
    assert plan.applicable is False
    assert "O1" in plan.applicability_note


def test_baseline_audit_separates_a_clock_from_a_controller():
    fixed = [
        BaselineNightInput(
            date=date(2026, 3, day),
            charge_kwh=400.0,
            next_day_cooling_kwh=1500.0 + 60 * day,
        )
        for day in range(1, 11)
    ]
    assert audit_baseline(fixed).verdict == "fixed_schedule"
    assert audit_baseline(fixed).claim_allowed is True

    compensated = [
        BaselineNightInput(
            date=date(2026, 3, day),
            charge_kwh=250.0 + 30.0 * day,
            next_day_cooling_kwh=1200.0 + 150.0 * day,
        )
        for day in range(1, 11)
    ]
    audit = audit_baseline(compensated)
    assert audit.verdict == "load_compensated"
    assert audit.claim_allowed is False

    assert audit_baseline([]).verdict == "not_supplied"
    assert audit_baseline(fixed[:3]).verdict == "insufficient_data"


def test_plan_endpoint_returns_sixteen_zones_and_a_full_day():
    client = TestClient(app)
    response = client.post(
        "/api/v1/slab/plan",
        json={"date": DAY.isoformat(), "environment_source": "synthetic"},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["zones"]) == 16
    assert len(body["hours"]) == 24
    # The plan opens at 22:00 the night before the day it is charging for.
    assert body["hours"][0]["hour"] == 22
    assert body["applicable"] is True
    # Nothing was logged, so nothing may be claimed against the fixed timer.
    assert body["baseline_audit"]["verdict"] == "not_supplied"
    assert body["baseline_audit"]["claim_allowed"] is False
    assert body["measurement_protocol"]
