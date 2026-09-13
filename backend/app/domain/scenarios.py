from dataclasses import asdict, replace
from datetime import datetime, time, timezone

import numpy as np

from app.config import DEFAULTS
from app.domain.controller import WALL_LUX_PER_IRRADIANCE, run_tick
from app.domain.daylight.room import RoomGeometry, probes_for, zone_for
from app.domain.daylight.surrogate import curves_for, models
from app.domain.environment import generate_day, inject_sensor_fault, solar_frame
from app.domain.facade import (
    ORIENTATIONS,
    facade_heat,
    poa_series,
    roof_segments,
    wall_gains,
    zone_gains,
    zone_heat,
)
from app.domain.optics import FacadeOptics
from app.domain.solar import sun_position
from app.domain.types import (
    ControllerWeights,
    Environment,
    Site,
    WallGain,
    WallState,
    ZoneHeat,
    ZoneSensors,
)
from app.schemas import (
    ComparisonMetric,
    CostBreakdown,
    DaylightStatusPayload,
    EventAnnotation,
    FacadeHeatPayload,
    RoofSegmentPayload,
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


def _primary_incident(tick: TickPayload) -> float:
    return next((wall.incident for wall in tick.facade if wall.primary), tick.ghi)


def _metric_payload(ticks: list[TickPayload]) -> list[ComparisonMetric]:
    occupied = [tick for tick in ticks if tick.occupancy >= 0.2]
    occupied = occupied or ticks
    # Score the facade only while its own plane has daylight to work with. A west
    # wall at 09:00 sees a bright sky on the roof and nothing on itself, and
    # neither strategy can do anything about that. Cooling load still covers
    # every occupied tick.
    daylight_window = [
        tick for tick in occupied if _primary_incident(tick) >= DEFAULTS.daylight_evaluation_ghi
    ] or occupied
    ours_compliant = np.mean([300 <= tick.lux <= 700 for tick in daylight_window]) * 100
    naive_compliant = np.mean([300 <= tick.naive_lux <= 700 for tick in daylight_window]) * 100
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


def _prepare_daylight(request, environments, suns, grids, observation=None):
    """Observe aperture flux at each registered probe, independently of sensor noise."""
    if not request.daylight_model_enabled:
        return None
    # Fixed geometry/site were evaluated offline; other sites/tilts have no evidence.
    if (request.latitude, request.longitude, request.facade_tilt) != (
        DEFAULTS.latitude,
        DEFAULTS.longitude,
        DEFAULTS.facade_tilt,
    ):
        return None
    artifacts = models()
    if artifacts is None:
        return None
    scope = set(artifacts[0]["orientations"]) & set(artifacts[1]["orientations"])
    room, inputs, keys = RoomGeometry(), [], []
    for index, (env, solar, grid) in enumerate(zip(environments, suns, grids)):
        for orientation in ORIENTATIONS:
            if orientation not in scope:
                continue
            for band in range(DEFAULTS.facade_zone_rows):
                gain = grid[orientation][band * DEFAULTS.facade_zone_columns]
                diffuse = gain.sky_diffuse + gain.ground_diffuse
                optics = FacadeOptics(
                    beam_fraction=max(0, gain.incident - diffuse) / gain.incident
                    if gain.incident
                    else 0,
                    sky_fraction=gain.sky_diffuse / diffuse if diffuse else 1,
                    solar_elevation=solar.elevation,
                    solar_azimuth=solar.azimuth,
                    wall_azimuth=gain.azimuth,
                    facade_tilt=request.facade_tilt,
                )
                local_env = replace(
                    env,
                    ghi=gain.incident,
                    cloud=observation.cloud_cover
                    if observation is not None and observation.tick_index == index
                    else env.cloud,
                )
                for probe_index, probe in enumerate(probes_for(orientation, band)):
                    keys.append(
                        (index, zone_for(probe, orientation, band, room), probe_index, probe.kind)
                    )
                    inputs.append((probe, optics, solar, local_env, room))
    curves = curves_for(tuple(inputs), DEFAULTS.daylight_angle_step)
    if curves is None:
        return None
    result = {}
    for (index, zone, probe_index, kind), curve in zip(keys, curves):
        result.setdefault((index, zone), []).append((probe_index, kind, curve))
    return result


def run_scenario(request: SimulationRunRequest) -> SimulationRunResponse:
    site = _site(request)
    environments, weather_context, open_meteo = _prepare_environment(request, site)
    observation = request.vision_observation
    if (
        observation
        and not 0 <= (datetime.now(timezone.utc) - observation.captured_at).total_seconds() <= 60
    ):
        observation = None
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
    # The roof is the same calculation at a different tilt.
    roof_poa = poa_series(
        times,
        position,
        np.array([env.ghi for env in environments]),
        np.array([env.dni for env in environments]),
        np.array([env.dhi for env in environments]),
        tilt=request.roof_pitch,
    )
    suns = [
        sun_position(env.t, site.latitude, site.longitude, site.timezone) for env in environments
    ]
    grids = [
        zone_gains(wall_gains(poa, i), solar_elevation=s.elevation, solar_azimuth=s.azimuth)
        for i, s in enumerate(suns)
    ]
    daylight = _prepare_daylight(request, environments, suns, grids, observation)
    weights = ControllerWeights(**request.weights.model_dump())
    ticks: list[TickPayload] = []
    annotations: list[EventAnnotation] = []
    # Every wall keeps its own actuator position between ticks.
    wall_angles = dict.fromkeys(ORIENTATIONS, 0.0)
    # Every zone keeps its own actuator position too, keyed (wall, zone id).
    zone_angles: dict[tuple[str, str], float] = {}
    zone_ids = [
        f"{orientation[0].upper()}{index + 1}"
        for orientation in ORIENTATIONS
        for index in range(DEFAULTS.facade_zone_rows * DEFAULTS.facade_zone_columns)
    ]
    sensor_streams = {
        zone: np.random.default_rng(np.random.SeedSequence([request.seed, 23041, index]))
        for index, zone in enumerate(zone_ids)
    }
    # ponytail: assumed glazing/room-depth transfer (+/-25%), fixed per zone;
    # replace with measured room calibration when available, never angle offsets.
    daylight_transfer = {
        zone: WALL_LUX_PER_IRRADIANCE * stream.uniform(0.75, 1.25)
        for zone, stream in sensor_streams.items()
    }
    # A window rather than one tick: the moment the primary facade actually wants
    # to move depends on which wall it is and where the sun is, so let the run
    # find it instead of hard-coding a clock time that only suits one facade.
    budget_window = (time(15, 0), time(16, 0))
    budget_annotated = False
    power_loss_start = time(14, 0)
    power_loss_end = time(14, 30)

    for index, env in enumerate(environments):
        vision_cloud = (
            observation.cloud_cover
            if observation is not None and observation.tick_index == index
            else None
        )
        local_time = env.t.time()
        power_ok = request.power_ok
        movement_threshold = DEFAULTS.movement_threshold
        if request.scenario == "budget_failsafe":
            if budget_window[0] <= local_time <= budget_window[1]:
                movement_threshold = 1.0
            if power_loss_start <= local_time <= power_loss_end:
                power_ok = False
        # Resolve the sun once; each controller projects it onto its own aperture.
        gains = wall_gains(poa, index)
        solar = suns[index]
        wall_optics = {
            gain.orientation: FacadeOptics(
                beam_fraction=gain.direct / gain.incident if gain.incident > 0 else 0,
                sky_fraction=(
                    gain.sky_diffuse / (gain.sky_diffuse + gain.ground_diffuse)
                    if gain.sky_diffuse + gain.ground_diffuse > 0
                    else 1.0
                ),
                solar_elevation=solar.elevation,
                solar_azimuth=solar.azimuth,
                wall_azimuth=gain.azimuth,
                facade_tilt=request.facade_tilt,
            )
            for gain in gains
        }
        wall_results = {}
        for gain in gains:
            wall_result = run_tick(
                env,
                wall_angles[gain.orientation],
                weights,
                vision_cloud=vision_cloud,
                power_ok=power_ok,
                movement_threshold=movement_threshold,
                site=site,
                solar=solar,
                gain=gain,
                optics=wall_optics[gain.orientation],
                glazing_shgc=request.glazing_shgc,
                glare_limit_w_m2=request.glare_limit_w_m2,
                actuator_speed_deg_per_min=request.actuator_speed_deg_per_min,
            )
            wall_angles[gain.orientation] = wall_result.decision.angle_final
            wall_results[gain.orientation] = wall_result

        # The primary facade's controller drives the headline metrics.
        result = wall_results[request.facade_orientation]
        decision = result.decision
        breakdown = CostBreakdown(**decision.cost_breakdown)

        # Under each wall's controller sits one controller per zone of its 4 x 4
        # grid, each holding its own actuator position and independent local
        # sensor stream. One shared brain applies the same policy to every zone.
        grid = grids[index]
        zones: dict[str, list[ZoneHeat]] = {}
        for orientation, cells in grid.items():
            heats: list[ZoneHeat] = []
            for cell in cells:
                key = (orientation, cell.zone)
                current_angle = zone_angles.get(key, 0.0)
                # The row's roof-shaded beam split excludes corner-neighbour
                # daylight: that must never invent direct sun on this aperture.
                direct = max(0.0, cell.incident - cell.sky_diffuse - cell.ground_diffuse)
                optics = replace(
                    wall_optics[orientation],
                    beam_fraction=direct / cell.incident if cell.incident > 0 else 0,
                    sky_fraction=(
                        cell.sky_diffuse / (cell.sky_diffuse + cell.ground_diffuse)
                        if cell.sky_diffuse + cell.ground_diffuse > 0
                        else 1.0
                    ),
                )
                stream = sensor_streams[cell.zone]
                sensors = ZoneSensors(
                    sensor_id=cell.zone,
                    irradiance=round(
                        float(np.clip(cell.incident * (1 + stream.normal(0, 0.01)), 0, 1600)), 2
                    ),
                    illuminance=round(
                        float(
                            np.clip(
                                cell.daylight
                                * daylight_transfer[cell.zone]
                                * optics.daylight_transmittance(current_angle)
                                * (1 + stream.normal(0, 0.01)),
                                0,
                                10000,
                            )
                        ),
                        1,
                    ),
                )
                # Always sample first: an override cannot advance another zone's
                # random stream or alter its subsequent observations.
                override = request.zone_sensor_overrides.get(cell.zone)
                if override is not None and override.tick_index == index:
                    sensors = replace(
                        sensors,
                        irradiance=override.irradiance,
                        illuminance=override.illuminance,
                        source="override",
                    )
                zone_result = run_tick(
                    env,
                    current_angle,
                    weights,
                    vision_cloud=vision_cloud,
                    power_ok=power_ok,
                    movement_threshold=movement_threshold,
                    site=site,
                    solar=solar,
                    local_sensors=sensors,
                    daylight_curves=(
                        tuple(daylight.get((index, cell.zone), ()))
                        if daylight is not None
                        else None
                    ),
                    optics=optics,
                    glazing_shgc=request.glazing_shgc,
                    glare_limit_w_m2=request.glare_limit_w_m2,
                    actuator_speed_deg_per_min=request.actuator_speed_deg_per_min,
                    gain=WallGain(
                        orientation=orientation,
                        azimuth=cell.azimuth,
                        incident=cell.incident,
                        sky_diffuse=cell.sky_diffuse,
                        ground_diffuse=cell.ground_diffuse,
                        aoi=cell.aoi,
                    ),
                )
                zone_angles[key] = zone_result.decision.angle_final
                heats.append(
                    zone_heat(
                        cell,
                        WallState(
                            angle=zone_result.decision.angle_final,
                            mode=zone_result.decision.mode,
                            moved=zone_result.decision.moved,
                            lux=zone_result.lux,
                            load_relative=zone_result.load_relative,
                            reason=zone_result.decision.reason,
                        ),
                        outdoor_temp=env.outdoor_temp,
                        wind=env.wind,
                        sensors=sensors,
                        angle_target=zone_result.decision.angle_target,
                        sensor_trusted=zone_result.decision.sensor_trusted,
                        optics=optics,
                        conditions=zone_result.conditions,
                    )
                )
            zones[orientation] = heats

        walls = facade_heat(
            gains,
            {
                orientation: WallState(
                    angle=item.decision.angle_final,
                    mode=item.decision.mode,
                    moved=item.decision.moved,
                    lux=item.lux,
                    load_relative=item.load_relative,
                    reason=item.decision.reason,
                )
                for orientation, item in wall_results.items()
            },
            outdoor_temp=env.outdoor_temp,
            wind=env.wind,
            primary=request.facade_orientation,
            zones=zones,
            optics=wall_optics,
        )
        roof = roof_segments(
            roof_poa,
            index,
            outdoor_temp=env.outdoor_temp,
            wind=env.wind,
            pitch=request.roof_pitch,
        )
        payload = TickPayload(
            daylight=DaylightStatusPayload(
                night=solar.elevation <= DEFAULTS.min_elevation,
                occupied=env.occupancy >= DEFAULTS.daylight_occupied_min,
            )
            if daylight is not None
            else None,
            timestamp=env.t,
            ghi=round(env.ghi, 2),
            expected_ghi=round(result.expected_ghi, 2),
            solar_azimuth=round(result.solar_azimuth, 2),
            solar_elevation=round(result.solar_elevation, 2),
            measured_irradiance=round(env.measured_irradiance, 2),
            cloud=round(env.cloud if vision_cloud is None else vision_cloud, 3),
            cloud_source="environment" if vision_cloud is None else "vision",
            environment_cloud=round(env.cloud, 3),
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
            facade=[FacadeHeatPayload(**asdict(wall)) for wall in walls],
            roof=[RoofSegmentPayload(**vars(segment)) for segment in roof],
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
        if (
            request.scenario == "budget_failsafe"
            and not budget_annotated
            and budget_window[0] <= local_time <= budget_window[1]
            and decision.mode == "HOLD"
            and decision.angle_target != decision.angle_final
        ):
            budget_annotated = True
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
        roof_pitch=request.roof_pitch,
        floors=DEFAULTS.floors,
        synthetic=True,
        data_notice=_data_notice(weather_context, open_meteo, site)
        + (
            " AI vision supplies a demo sky estimate at one selected tick."
            if observation is not None
            else ""
        ),
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
