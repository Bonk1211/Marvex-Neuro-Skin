# NeuroSkin Simulation Proof

NeuroSkin is a stateless, deterministic proof of an explainable adaptive-facade controller. It models one synthetic Kuala Lumpur day and demonstrates:

1. A solar-almanac cross-check that catches a failed irradiance sensor.
2. A multi-objective angle controller compared with a naive reactive baseline.
3. Movement rationing and a passive fail-shaded power-loss response.

All environmental and sensor data are synthetic. Cooling load is reported only as a relative proxy; the application does not infer HVAC energy savings.

## Architecture

- `frontend/` — Next.js 15, TypeScript, Tailwind CSS, and Recharts.
- `backend/` — FastAPI, Pydantic, pvlib, NumPy, and pandas.
- `docs/neuroskin_software_prd.md` — source implementation specification.

The backend intentionally uses a deterministic, physics-inspired `LoadPredictor`. No learned model, training pipeline, database, authentication, or hardware integration is included.

## Run locally

### Backend

```bash
cd backend
uv sync --extra dev
uv run uvicorn app.main:app --reload --port 8000
```

The API and OpenAPI documentation are available at:

- `http://localhost:8000/api/v1/health`
- `http://localhost:8000/docs`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

The first successful run opens a six-step judge tour. It walks through the
lie-detector contradiction, genuine cloud gating, co-optimisation comparison,
safety events, and per-tick explanation. Use **Guided tour** in the header to
restart it; event cards jump the timeline inspector to the relevant evidence.

Lux compliance is evaluated during occupied ticks with at least 200 W/m² of
available daylight. Relative cooling load is averaged across every occupied
tick, and movement counts cover the full synthetic day.

### Docker Compose

```bash
docker compose up --build
```

## API

Run a seeded scenario:

```bash
curl -X POST http://localhost:8000/api/v1/simulations/run \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"lie_detector","seed":42}'
```

Supported scenarios are `overview`, `lie_detector`, `co_optimization`, and `budget_failsafe`.

## Verification

```bash
cd backend
uv run pytest
uv run ruff check app tests

cd ../frontend
npm run lint
npm test
npm run build
```
