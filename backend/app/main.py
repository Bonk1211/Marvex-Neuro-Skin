import logging
import re
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import DEFAULTS
from app.domain.facade import ORIENTATIONS
from app.domain.scenarios import SCENARIO_TITLES, run_scenario
from app.feed_health import feed_health
from app.hardware import router as hardware_router
from app.logging_config import configure_logging
from app.onboarding import router as onboarding_router
from app.schemas import SimulationRunRequest, SimulationRunResponse
from app.section import router as section_router
from app.vision import router as vision_router

configure_logging()
logger = logging.getLogger("neuroskin.api")

app = FastAPI(
    title="NeuroSkin Simulation API",
    version="0.1.0",
    description=(
        "Stateless deterministic simulation for the NeuroSkin decision-brain proof. "
        "Cooling load is a relative proxy, with optional weather and AI sky inputs."
    ),
)
app.include_router(hardware_router)
app.include_router(section_router)
app.include_router(onboarding_router)
app.include_router(vision_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)


def _request_id(request: Request) -> str:
    candidate = request.headers.get("X-Request-ID", "").strip()
    if re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", candidate):
        return candidate
    return str(uuid4())


@app.middleware("http")
async def log_http_request(request: Request, call_next):
    request_id = _request_id(request)
    request.state.request_id = request_id
    started = perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "HTTP request failed",
            extra={
                "event": "http_request_failed",
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "duration_ms": round((perf_counter() - started) * 1000, 2),
            },
        )
        raise

    duration_ms = round((perf_counter() - started) * 1000, 2)
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "HTTP request completed",
        extra={
            "event": "http_request_completed",
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    return response


@app.get("/api/v1/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "neuroskin-api",
        "model": "deterministic",
        "dependencies": feed_health(),
    }


@app.get("/api/v1/config")
def config() -> dict[str, object]:
    return {
        "location": {
            "name": DEFAULTS.location_name,
            "latitude": DEFAULTS.latitude,
            "longitude": DEFAULTS.longitude,
            "timezone": DEFAULTS.timezone,
        },
        "building": {
            "facade_orientation": DEFAULTS.facade_orientation,
            "facade_orientations": list(ORIENTATIONS),
            "facade_tilt": DEFAULTS.facade_tilt,
            "roof_pitch": DEFAULTS.roof_pitch,
            "floors": DEFAULTS.floors,
        },
        "simulation": {
            "tick_minutes": DEFAULTS.tick_minutes,
            "seed": DEFAULTS.seed,
            "angle_range": [DEFAULTS.angle_min, DEFAULTS.angle_max],
            "optimizer_bracket_degrees": DEFAULTS.angle_step,
            "continuous_angles": True,
            "actuator_speed_deg_per_min": DEFAULTS.actuator_speed_deg_per_min,
            "glazing_shgc": DEFAULTS.glazing_shgc,
            "glare_limit_w_m2": DEFAULTS.glare_limit_w_m2,
            "critical_wind": DEFAULTS.critical_wind,
            "movement_threshold": DEFAULTS.movement_threshold,
            "daylight_evaluation_ghi": DEFAULTS.daylight_evaluation_ghi,
            "environment_sources": ["synthetic", "met_anchored", "open_meteo"],
        },
        "scenarios": SCENARIO_TITLES,
        "synthetic": True,
    }


@app.post("/api/v1/simulations/run", response_model=SimulationRunResponse)
def run_simulation(request: SimulationRunRequest, http_request: Request) -> SimulationRunResponse:
    request_id = http_request.state.request_id
    started = perf_counter()
    logger.info(
        "Simulation started",
        extra={
            "event": "simulation_started",
            "request_id": request_id,
            "scenario": request.scenario,
            "seed": request.seed,
            "environment_source": request.environment_source,
        },
    )
    result = run_scenario(request)
    logger.info(
        "Simulation completed",
        extra={
            "event": "simulation_completed",
            "request_id": request_id,
            "scenario": result.scenario,
            "seed": result.metadata.seed,
            "environment_source": result.metadata.environment_source,
            "weather_status": (
                result.metadata.weather_context.status
                if result.metadata.weather_context is not None
                else None
            ),
            "duration_ms": round((perf_counter() - started) * 1000, 2),
            "tick_count": len(result.ticks),
            "movement_count": result.summary["movement_count"],
            "sensor_fault_ticks": result.summary["sensor_fault_ticks"],
            "safe_mode_ticks": result.summary["safe_mode_ticks"],
            "fault_correction": request.fault_correction,
            # Absent (so omitted) unless fault_correction is enabled.
            **{
                key: result.summary.get(key)
                for key in (
                    "assurance_fault_zone_ticks",
                    "assurance_shadow_zone_ticks",
                    "episodes_opened",
                    "episodes_retained",
                    "episodes_rolled_back",
                    "episodes_escalated",
                    "episodes_awaiting_approval",
                    "unmatched_approvals",
                )
            },
            "daylight_model": "extra trees" if any(t.daylight for t in result.ticks) else "off",
            "ev_exceedance_ticks": sum(
                any(
                    p.eye_illuminance is not None and p.eye_illuminance > tick.daylight.ev_cap_lux
                    for wall in tick.facade
                    for zone in wall.zones
                    for p in zone.conditions.daylight_probes or ()
                )
                for tick in result.ticks
                if tick.daylight and tick.daylight.occupied
            ),
            "et_in_band_ticks": sum(
                any(
                    p.task_illuminance is not None
                    and tick.daylight.et_band_low_lux
                    <= p.task_illuminance
                    <= tick.daylight.et_band_high_lux
                    for wall in tick.facade
                    for zone in wall.zones
                    for p in zone.conditions.daylight_probes or ()
                )
                for tick in result.ticks
                if tick.daylight and tick.daylight.occupied
            ),
        },
    )
    return result
