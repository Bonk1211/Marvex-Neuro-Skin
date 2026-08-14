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
vertical surfaces. Diffuse comes from pvlib's Perez model, not the isotropic
default: isotropic spreads diffuse evenly over the sky dome, so two walls at the
same tilt read the same diffuse however the sun sits.

Each wall entry also carries `aoi`, `sunlit` and a `zones` array — one entry per
cell of the 4 × 4 facade grid the 3D view draws, row-major from the bottom left,
ids `W1`…`W16`. **Every zone runs its own louvre controller**, 16 per wall and 64
on the building, each holding its own actuator position between ticks and each
reporting its own `angle`, `mode`, `moved`, `lux` and `load_relative`.

Zones separate on two pieces of geometry:

- **Rows** — the roof slab oversails the top of the facade, and its shadow starts
  at the roof line and walks down the wall as the sun climbs, so the top row
  loses the beam first. The same lip hides part of the sky from the rows nearest
  it.
- **Columns** — the bay at each end of a wall wraps a corner of the building, so
  the room behind it is glazed on two sides and its controller answers for the
  neighbouring facade too (`corner_daylight_coupling`, 0.45). On a clear 21 March
  at `facade_tilt: 90`, the east wall's top row settles at 55°, 20°, 20°, 55° —
  corner bays closed, middle bays open. The two middle bays of a wall see one
  facade only, so they read alike; that is the truth about a flat piece of wall,
  not a gap in the model.

The wall-level entry keeps its own supervisory controller, which is what the
headline comparison metrics are measured on.

**Once the sun climbs past about 65°, `sunlit` goes false on every wall and all
four read the same.** That is the overhang doing its job, not a bug: at a 25°
lean the outward normal sits 25° below horizontal, so a sun higher than 65° is
behind every facade (`aoi > 90`) and each wall is left with diffuse only, which
carries no orientation. In Putrajaya that covers roughly 11:00–15:00. Outside
that window the walls separate properly — on 21 June at 10:00 the north wall
reads 189 W/m² against the south wall's 144, and at 17:00 west reads 388 against
east's 124. Set `facade_tilt: 90` to see upright-wall behaviour instead.

Every tick also carries a `roof` array: the same calculation at `roof_pitch`
instead of `facade_tilt`, giving one entry per roof quadrant. Roof faces carry
no louvres, so incident gain is what the surface keeps. **At `roof_pitch: 0` all
four quadrants read identically** — a flat roof has no orientation to
distinguish — and the spread grows with pitch (about 125 W/m² at 10°, 305 W/m²
at 25°, late afternoon).

The dashboard renders all of this as an orbitable 3D building: seven storeys
with walls leaning 25°, four pitched roof faces, every surface shaded on a
single-hue temperature ramp. Click any zone or roof face to inspect it, or use
the surface-readings table for the keyboard equivalent. Every zone runs its own
controller and carries its own louvres at its own angle.

## Three-tier analysis

All three tiers live on the one dashboard — there are no scenario sub-pages to
switch between. **Run simulation** in the left rail runs the whole argument in
order — read the sensor stream, then Tier 1 sensor trust, Tier 2
co-optimisation, Tier 3 movement budget and fail-safe — one request per tier,
with the 3D model, timeline and charts following each result as it lands and a
floating card on the stage saying what that tier is doing and what it found.

The run also **starts the clock**: the timeline walks the 144 ticks at ~45 ms
each, so the sun crosses the sky on the solar positions the run actually
returned while the tiers compute behind it. The 3D view draws the day's whole
solar track as an arc and rides the sun marker along it, the directional light
follows, and the heat map re-shades every zone tick by tick. The toolbar reads
out the live elevation and azimuth, and its play/pause button replays the day
whenever you want. When the analysis finishes, the clock stops on the last
tier's own event.

**Each tier keeps its own charts, all on the page at once** — Tier 1's sensor
cross-check and facade response, Tier 2's load comparison and daylight
compliance, Tier 3's safety response and load floor — so the tiers are read side
by side rather than one chart area swapping its contents as the analysis moves
on. Each set plots its own tier's run.

**The charts run with the clock.** A mint playhead marks the current tick on
every chart at once, and while the clock runs each curve is drawn only as far as
that playhead, so the day plots itself left to right as the sun crosses. The
slots past the playhead are kept but blanked, so the axis never rescales
mid-play. Pause, or scrub the timeline by hand, and the full day comes back with
the playhead parked where you left it.

The run list marks each step `waiting → running → done` and **keeps every
finished tier's findings on the page**, so the three read as one analysis.
Clicking a finished step points the stage, timeline and charts at that tier's
moment, re-shown from its stored result rather than run again; the header says
which tier the stage is currently showing. **Apply settings and re-run** in the
right rail re-runs the focused tier with edited weights and environment.

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
