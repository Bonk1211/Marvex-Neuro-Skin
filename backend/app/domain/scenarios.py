from dataclasses import replace
from datetime import time

import numpy as np

from app.config import DEFAULTS
from app.domain.controller import run_tick
from app.domain.environment import generate_day, inject_sensor_fault, solar_frame
from app.domain.facade import facade_heat, poa_series
from app.domain.types import ControllerWeights, Environment, Site
from app.schemas import (
    ComparisonMetric,
    CostBreakdown,
    EventAnnotation,
    FacadeHeatPayload,
    SimulationMetadata,
    SimulationRunRequest,
    SimulationRunResponse,
    TickPayload,
    WeatherContextPayload,
    WeatherWarningPayload,
)
from app.weather import (
    FORECAST_URL,
    LOCATION_ID,
    LOCATION_NAME,
    MetWeatherContext,
    OpenMeteoContext,
    get_met_weather_context,
    get_open_meteo_context,
)

SCENARIO_TITLES = {
    "overview": "NeuroSkin representative tropical day",
    "lie_detector": "Tier 1 — Almanac lie-detector catch",
    "co_optimization": "Tier 2 — Naive versus co-optimisation",
    "budget_failsafe": "Tier 3 — Movement budget and fail-shaded safety",
}


def _site(request: SimulationRunRequest) -> Site:
    return Site(
        name=request.location_name,
        latitude=request.latitude,
        longitude=request.longitude,
        timezone=request.timezone,
    )


def _prepare_environment(
    request: SimulationRunRequest,
    site: Site,
) -> tuple[list[Environment], MetWeatherContext | None, OpenMeteoContext | None]:
    weather_context = (
        get_met_weather_context(request.date)
        if request.environment_source == "met_anchored"
        else None
    )
    open_meteo = (
        get_open_meteo_context(request.date, site)
        if request.environment_source == "open_meteo"
        else None
    )
    day = generate_day(
        request.date,
        cloud_profile=request.cloud_profile,
        seed=request.seed,
        occupancy_scale=request.occupancy_scale,
        wind_override=request.wind_override,
        weather_anchor=weather_context.anchor if weather_context is not None else None,
        observed=open_meteo.observed if open_meteo is not None else None,
        site=site,
    )
    if request.scenario == "lie_detector":
        prepared: list[Environment] = []
        for env in day:
            local_time = env.t.time()
            if time(11, 30) <= local_time <= time(13, 0):
                prepared.append(
                    inject_sensor_fault(replace(env, cloud=0.05, rain=False), "dead_pyranometer")
                )
            elif time(15, 0) <= local_time <= time(15, 30):
                prepared.append(
                    replace(
                        env,
                        cloud=0.94,
                        ghi=min(env.ghi, 12.0),
                        dni=0.0,
                        dhi=min(env.dhi, 12.0),
                        measured_irradiance=8.0,
                        indoor_lux=260.0,
                        rain=False,
                    )
                )
            else:
                prepared.append(env)
        return prepared, weather_context, open_meteo
    return day, weather_context, open_meteo


def _open_meteo_payload(
    context: OpenMeteoContext,
    request: SimulationRunRequest,
    site: Site,
) -> WeatherContextPayload:
    return WeatherContextPayload(
        status=context.status,
        provider="Open-Meteo",
        source_url=context.source_url,
        dataset=context.dataset,
        fetched_at=context.fetched_at,
        location_id=f"{site.latitude:.4f},{site.longitude:.4f}",
        location_name=site.name,
        forecast_date=request.date if context.status == "applied" else None,
        fallback_reason=context.fallback_reason,
    )


def _weather_payload(context: MetWeatherContext | None) -> WeatherContextPayload | None:
    if context is None:
        return None
    forecast = context.forecast
    return WeatherContextPayload(
        status=context.status,
        provider="MET Malaysia via data.gov.my",
        source_url=FORECAST_URL,
        fetched_at=context.fetched_at,
        location_id=forecast.location_id if forecast else LOCATION_ID,
        location_name=forecast.location_name if forecast else LOCATION_NAME,
        forecast_date=forecast.date if forecast else None,
        min_temp=forecast.min_temp if forecast else None,
        max_temp=forecast.max_temp if forecast else None,
        morning_forecast=forecast.morning_forecast if forecast else None,
        afternoon_forecast=forecast.afternoon_forecast if forecast else None,
        night_forecast=forecast.night_forecast if forecast else None,
        summary_forecast=forecast.summary_forecast if forecast else None,
        summary_when=forecast.summary_when if forecast else None,
        warnings=[
            WeatherWarningPayload(
                title=warning.title,
                heading=warning.heading,
                text=warning.text,
                instruction=warning.instruction,
                valid_from=warning.valid_from,
                valid_to=warning.valid_to,
            )
            for warning in context.warnings
        ],
        fallback_reason=context.fallback_reason,
    )


def _data_notice(
    met: MetWeatherContext | None,
    open_meteo: OpenMeteoContext | None,
    site: Site,
) -> str:
    if open_meteo is not None:
        if open_meteo.status == "applied":
            return (
                f"Open-Meteo {open_meteo.dataset} supplies hourly irradiance, temperature, "
                f"cloud, wind and rain for {site.name}, interpolated to 10-minute ticks. "
                "Occupancy, indoor readings and every sensor fault remain synthetic."
            )
        return (
            "Open-Meteo data was requested but unavailable; the run fell back to a fully "
            f"synthetic {site.name} day."
        )
    if met is not None:
        if met.status == "applied":
            return (
                "MET Malaysia daily forecast anchors temperature and period-level sky "
                "conditions; all 10-minute environmental and sensor ticks remain seeded "
                "synthetic data."
            )
        return (
            "MET anchoring was requested but unavailable; the run fell back to a fully "
            "synthetic Kuala Lumpur day."
        )
    return f"Modelled {site.name} day; all environmental and sensor data are synthetic."


def _metric_payload(ticks: list[TickPayload]) -> list[ComparisonMetric]:
    occupied = [tick for tick in ticks if tick.occupancy >= 0.2]
    occupied = occupied or ticks
    # Do not score the facade for dawn/dusk periods when insufficient daylight
    # exists for either strategy. Cooling load still covers every occupied tick.
    daylight_window = [
        tick for tick in occupied if tick.ghi >= DEFAULTS.daylight_evaluation_ghi
    ] or occupied
    ours_compliant = np.mean([300 <= tick.lux <= 700 for tick in daylight_window]) * 100
    naive_compliant = np.mean(
        [300 <= tick.naive_lux <= 700 for tick in daylight_window]
    ) * 100
    ours_load = float(np.mean([tick.load_relative for tick in occupied]))
    naive_load = float(np.mean([tick.naive_load_relative for tick in occupied]))
    ours_moves = sum(tick.moved for tick in ticks)
    naive_moves = sum(
        ticks[index].naive_angle != ticks[index - 1].naive_angle for index in range(1, len(ticks))
    )
    return [
        ComparisonMetric(
            metric="lux_compliance",
            label="Daylight lux compliance",
            unit="%",
            ours=round(float(ours_compliant), 1),
            naive=round(float(naive_compliant), 1),
            higher_is_better=True,
        ),
        ComparisonMetric(
            metric="relative_load",
            label="Mean cooling load",
            unit="relative index",
            ours=round(ours_load, 3),
            naive=round(naive_load, 3),
            higher_is_better=False,
        ),
        ComparisonMetric(
            metric="movement_count",
            label="Movement count",
            unit="moves",
            ours=float(ours_moves),
            naive=float(naive_moves),
            higher_is_better=False,
        ),
    ]


def run_scenario(request: SimulationRunRequest) -> SimulationRunResponse:
    site = _site(request)
    environments, weather_context, open_meteo = _prepare_environment(request, site)
    times, position, _location = solar_frame(request.date, site=site)
    # Heat map runs on the irradiance the walls actually see, doctored ticks included.
    poa = poa_series(
        times,
        position,
        np.array([env.ghi for env in environments]),
        np.array([env.dni for env in environments]),
        np.array([env.dhi for env in environments]),
        tilt=request.facade_tilt,
    )
    weights = ControllerWeights(**request.weights.model_dump())
    ticks: list[TickPayload] = []
    annotations: list[EventAnnotation] = []
    current_angle = 0.0
    budget_time = time(11, 0)
    power_loss_start = time(14, 0)
    power_loss_end = time(14, 30)

    for index, env in enumerate(environments):
        local_time = env.t.time()
        power_ok = request.power_ok
        movement_threshold = DEFAULTS.movement_threshold
        if request.scenario == "budget_failsafe":
            if local_time == budget_time:
                movement_threshold = 1.0
            if power_loss_start <= local_time <= power_loss_end:
                power_ok = False
        result = run_tick(
            env,
            current_angle,
            weights,
            power_ok=power_ok,
            movement_threshold=movement_threshold,
            site=site,
        )
        decision = result.decision
        current_angle = decision.angle_final
        breakdown = CostBreakdown(**decision.cost_breakdown)
        walls = facade_heat(
            poa,
            index,
            outdoor_temp=env.outdoor_temp,
            wind=env.wind,
            angle=decision.angle_final,
            controlled=request.facade_orientation,
        )
        payload = TickPayload(
            timestamp=env.t,
            ghi=round(env.ghi, 2),
            expected_ghi=round(result.expected_ghi, 2),
            solar_azimuth=round(result.solar_azimuth, 2),
            solar_elevation=round(result.solar_elevation, 2),
            measured_irradiance=round(env.measured_irradiance, 2),
            cloud=round(env.cloud, 3),
            outdoor_temp=round(env.outdoor_temp, 2),
            occupancy=round(env.occupancy, 3),
            wind=round(env.wind, 2),
            rain=env.rain,
            load_relative=round(result.load_relative, 4),
            naive_load_relative=round(result.naive_load_relative, 4),
            latent_load=round(result.latent_load, 4),
            lux=round(result.lux, 1),
            naive_lux=round(result.naive_lux, 1),
            angle_target=decision.angle_target,
            angle_final=decision.angle_final,
            naive_angle=result.naive_angle,
            mode=decision.mode,
            moved=decision.moved,
            sensor_trusted=decision.sensor_trusted,
            reason=decision.reason,
            cost_breakdown=breakdown,
            facade=[FacadeHeatPayload(**vars(wall)) for wall in walls],
        )
        ticks.append(payload)

        if request.scenario == "lie_detector" and local_time == time(11, 30):
            annotations.append(
                EventAnnotation(
                    timestamp=env.t,
                    kind="fault",
                    title="Dead pyranometer injected",
                    detail=(
                        "The clear-sky almanac contradicts a near-zero sensor reading, "
                        "so NeuroSkin rejects it."
                    ),
                )
            )
        if request.scenario == "lie_detector" and local_time == time(15, 0):
            annotations.append(
                EventAnnotation(
                    timestamp=env.t,
                    kind="cloud_gate",
                    title="Genuine cloud-gating",
                    detail=(
                        "The same low reading is trusted because heavy cloud explains "
                        "the contradiction."
                    ),
                )
            )
        if request.scenario == "budget_failsafe" and local_time == budget_time:
            annotations.append(
                EventAnnotation(
                    timestamp=env.t,
                    kind="movement_hold",
                    title="Marginal movement declined",
                    detail=(
                        "The target is withheld because its predicted benefit does not "
                        "clear the movement budget."
                    ),
                )
            )
        if request.scenario == "budget_failsafe" and local_time == power_loss_start:
            annotations.append(
                EventAnnotation(
                    timestamp=env.t,
                    kind="power_loss",
                    title="Power loss — fail shaded",
                    detail=(
                        "Safety short-circuits optimisation and moves the passive facade to 60°."
                    ),
                )
            )

    comparison = _metric_payload(ticks)
    untrusted = sum(not tick.sensor_trusted for tick in ticks)
    safe_ticks = sum(tick.mode == "SAFE" for tick in ticks)
    occupied_ticks = [tick for tick in ticks if tick.occupancy >= 0.2] or ticks
    summary: dict[str, float | int | str | bool] = {
        "ticks": len(ticks),
        "movement_count": sum(tick.moved for tick in ticks),
        "sensor_fault_ticks": untrusted,
        "safe_mode_ticks": safe_ticks,
        "mean_relative_load": round(
            float(np.mean([tick.load_relative for tick in occupied_ticks])), 3
        ),
        "mean_diffuse_fraction": round(
            float(np.mean([env.diffuse_fraction for env in environments])), 3
        ),
        "power_ok": request.power_ok,
    }
    metadata = SimulationMetadata(
        location=site.name,
        latitude=site.latitude,
        longitude=site.longitude,
        timezone=site.timezone,
        tick_minutes=DEFAULTS.tick_minutes,
        seed=request.seed,
        environment_source=request.environment_source,
        facade_orientation=request.facade_orientation,
        facade_tilt=request.facade_tilt,
        floors=DEFAULTS.floors,
        synthetic=True,
        data_notice=_data_notice(weather_context, open_meteo, site),
        load_unit="relative cooling-load index",
        weather_context=(
            _open_meteo_payload(open_meteo, request, site)
            if open_meteo is not None
            else _weather_payload(weather_context)
        ),
    )
    return SimulationRunResponse(
        scenario=request.scenario,
        title=SCENARIO_TITLES[request.scenario],
        metadata=metadata,
        summary=summary,
        ticks=ticks,
        comparison=comparison,
        annotations=annotations,
    )
