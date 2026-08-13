# NeuroSkin Simulation Proof

## Target building

The simulation is aimed at the **ST Diamond Building**, the Energy Commission
headquarters in Precinct 2, Putrajaya (approximately 2.9220 N, 101.6885 E). Its
published design parameters drive the defaults:

| Parameter | Value | Source |
|---|---|---|
| Facade tilt | 25° overhang (`facade_tilt = 115` in pvlib terms) | Energy Commission |
| Floors | 7 | Energy Commission |
| Gross floor area | 14,230 m² | Energy Commission |
| Design intent | North and south facades fully self-shaded year-round; east/west solar impact cut 41% | Energy Commission |

The tilt is the building's passive shading device, and the model reproduces it.
Running pvlib against clear-sky irradiance at the site, the 25° overhang cuts
**annual direct beam on the north facade by 90% and the south by 87%** against an
upright wall, which is the "fully self-shaded" claim. On the east and west it
cuts direct beam by 54% and total plane-of-array gain by 28%; the published 41%
figure sits between those two measures. Set `facade_tilt` to `90` to run the
upright counterfactual — the dashboard exposes both as a toggle.

The 3D massing is reconstructed from the published figures, not from measured
drawings: solving 7 floors, a 25° tilt and 14,230 m² together gives a ~34.6 m
square at ground flaring to ~54.7 m at roof level. Treat the geometry as
representative and the tilt physics as the load-bearing part.

Sources: [Diamond Building, Suruhanjaya Tenaga](https://www.st.gov.my/about-us/diamond-building),
[ST Diamond Building, IEN Consultants](https://www.ien.com.my/projects/st-diamond-building),
[Malaysia Energy Commission Headquarters, HPB Magazine](https://www.hpbmagazine.org/malaysia-energy-commission-headquarters-putrajaya-malaysia/).

## Overview

NeuroSkin is a stateless, deterministic proof of an explainable adaptive-facade controller. It models one synthetic tropical day and demonstrates:

1. A solar-almanac cross-check that catches a failed irradiance sensor.
2. A multi-objective angle controller compared with a naive reactive baseline.
3. Movement rationing and a passive fail-shaded power-loss response.

All environmental and sensor data are synthetic. Cooling load is reported only as a relative proxy; the application does not infer HVAC energy savings.

The optional **Open-Meteo** environment mode replaces the modelled sky with
measured data. It reads hourly global, direct-normal and diffuse irradiance plus
temperature, cloud cover, wind and precipitation for the requested date and
coordinates, and interpolates them onto the 10-minute tick grid. Past dates come
from the ERA5 reanalysis archive and recent or future dates from the forecast
endpoint; the switch happens automatically. Occupancy, indoor readings and every
injected sensor fault stay synthetic, so the lie-detector demonstration still has
a known ground truth. No API key is required. Responses are cached for one hour,
and an unavailable upstream falls back to the fully synthetic environment with
the reason reported in `metadata.weather_context`.

Any location works. `latitude`, `longitude`, `timezone` and `location_name` are
request parameters, and pvlib resolves the solar geometry for whatever site is
given. The dashboard ships a short preset list; the API accepts any coordinates.

The optional **MET-anchored** environment mode reads the official seven-day
Kuala Lumpur town forecast (`Tn079`) from `api.data.gov.my`. It uses the daily
minimum/maximum temperature and morning/afternoon/night conditions to shape a
seeded 10-minute scenario. It does not turn forecast text into live telemetry:
irradiance, cloud variation, wind, rain events, indoor readings, and sensor
faults remain synthetic and are labelled as such. MET warnings are displayed
as advisory context only and never bypass the controller's local safety inputs.

## Architecture

- `frontend/` — Next.js 15, TypeScript, Tailwind CSS, Recharts, and three.js.
- `backend/` — FastAPI, Pydantic, pvlib, NumPy, and pandas.
- `docs/neuroskin_software_prd.md` — as-built implementation specification (v0.2).

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

Backend application logs are emitted as one JSON object per line. Set
`LOG_LEVEL=DEBUG`, `INFO`, `WARNING`, `ERROR`, or `CRITICAL` to control
verbosity. Every HTTP response includes an `X-Request-ID`; callers may provide
their own safe identifier in the same header. Simulation completion logs include
scenario, seed, duration, tick count, movements, rejected-sensor ticks, and
safety-mode ticks.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

The first successful run opens an 18-step interactive dashboard tutorial. It
teaches the scenario tabs, environmental controls, controller weights,
run/reset workflow, KPIs, charts, lie-detector contradiction, genuine cloud
gating, co-optimisation comparison, safety events, timeline scrubber, and
per-tick explanation. Use **Guided tour** in the header to restart it or jump
directly to any component; event cards move the inspector to their evidence.

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

Run a measured-weather scenario anywhere:

```bash
curl -X POST http://localhost:8000/api/v1/simulations/run \
  -H 'Content-Type: application/json' \
  -d '{
        "scenario": "overview",
        "date": "2026-03-21",
        "environment_source": "open_meteo",
        "latitude": 2.9220,
        "longitude": 101.6885,
        "timezone": "Asia/Kuala_Lumpur",
        "location_name": "ST Diamond Building, Putrajaya",
        "facade_orientation": "west",
        "facade_tilt": 115
      }'
```

`facade_tilt` is the pvlib surface tilt in degrees: `90` is a plain vertical
wall and anything above 90 leans outward and self-shades. Any other site works
too — `latitude`, `longitude` and `timezone` are free parameters.

## Surface heat map

Every tick carries a `facade` array: one entry per cardinal wall with the
plane-of-array irradiance pvlib resolves for that azimuth and `facade_tilt`, the fraction the
louvres still transmit, and the ASHRAE sol-air surface temperature

```
T_sol-air = T_air + (a x I) / (5.7 + 3.8 x v)
```

with absorptance `a = 0.6` and the long-wave correction taken as zero for
vertical surfaces.

Every tick also carries a `roof` array: the same calculation at `roof_pitch`
instead of `facade_tilt`, giving one entry per roof quadrant. Roof faces carry
no louvres, so incident gain is what the surface keeps. **At `roof_pitch: 0` all
four quadrants read identically** — a flat roof has no orientation to
distinguish — and the spread grows with pitch (about 125 W/m² at 10°, 305 W/m²
at 25°, late afternoon).

The dashboard renders all of this as an orbitable 3D building: seven storeys
with walls leaning 25°, four pitched roof faces, every surface shaded on a
single-hue temperature ramp. Click any wall or roof face to inspect it, or use
the surface-readings table for the keyboard equivalent. Each wall runs its own
controller and carries its own louvres at its own angle.

Run a MET-informed synthetic scenario for a date inside the current official
seven-day forecast window:

```bash
MET_DATE="$(TZ=Asia/Kuala_Lumpur date +%F)"
curl -X POST http://localhost:8000/api/v1/simulations/run \
  -H 'Content-Type: application/json' \
  -d "{\"scenario\":\"overview\",\"date\":\"${MET_DATE}\",\"environment_source\":\"met_anchored\",\"seed\":42}"
```

The official API requires no token. Forecast responses are cached for six
hours and warnings for ten minutes to stay within the upstream four-request
per-minute weather limit. If the API is unavailable or the selected date is
outside its forecast window, the run completes using the normal fully
synthetic environment and returns the fallback reason in
`metadata.weather_context`.

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
