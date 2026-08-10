from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import DEFAULTS
from app.domain.scenarios import SCENARIO_TITLES, run_scenario
from app.schemas import SimulationRunRequest, SimulationRunResponse

app = FastAPI(
    title="NeuroSkin Simulation API",
    version="0.1.0",
    description=(
        "Stateless deterministic simulation for the NeuroSkin decision-brain proof. "
        "Cooling load is always a relative proxy and all inputs are synthetic."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "neuroskin-api", "model": "deterministic"}


@app.get("/api/v1/config")
def config() -> dict[str, object]:
    return {
        "location": {
            "name": "Kuala Lumpur, Malaysia",
            "latitude": DEFAULTS.latitude,
            "longitude": DEFAULTS.longitude,
            "timezone": DEFAULTS.timezone,
        },
        "simulation": {
            "tick_minutes": DEFAULTS.tick_minutes,
            "seed": DEFAULTS.seed,
            "angle_range": [DEFAULTS.angle_min, DEFAULTS.angle_max],
            "angle_step": DEFAULTS.angle_step,
            "critical_wind": DEFAULTS.critical_wind,
            "movement_threshold": DEFAULTS.movement_threshold,
            "daylight_evaluation_ghi": DEFAULTS.daylight_evaluation_ghi,
        },
        "scenarios": SCENARIO_TITLES,
        "synthetic": True,
    }


@app.post("/api/v1/simulations/run", response_model=SimulationRunResponse)
def run_simulation(request: SimulationRunRequest) -> SimulationRunResponse:
    return run_scenario(request)
