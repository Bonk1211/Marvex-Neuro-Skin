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
3. Rate-limited continuous-angle tracking, direct-sun screening and safety overrides.

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
tick, and movement counts cover the full synthetic day. Continuous tracking can
make more small adjustments than the binary baseline; move count alone is not
actuator travel, wear or energy consumption.

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

Each zone now has its own simulated irradiance and indoor-illuminance sensor
pair (`sensors.sensor_id`, e.g. `W2`), independent seeded measurement noise and
a fixed, assumed local daylight-transfer factor. The shared mechatronic brain
uses these readings to choose that zone's `angle_target`; movement restraint
and wind/rain/power safety determine its final `angle`. Sensor streams are
synthetic even when the outdoor weather is measured; no hardware is connected.

Normal motion is solar-responsive, not a timed 0°/60° switch. The controller
refines fractional-angle targets over 0–60°, then limits travel to
`actuator_speed_deg_per_min` (default 1.2°/min, or 12° per 10-minute sample).
The 3D actuator interpolates the achieved samples. This is sampled simulation,
not a live hardware control loop; stable conditions can legitimately hold an
angle. Wind/rain/power safety bypasses the normal travel limit.
Movement cost is quadratic in angular change, making small corrections cheap;
daylight cost is piecewise linear outside the comfort band. After sunset the
actuators return gradually to the flat parking position.

Each zone evaluates three conditions at its **achieved** angle:

- Indoor daylight: the existing 300–700 lux target band, using its own sensor.
- Solar heat: direct beam projected against the actual blade pitch/chord/tilt,
  plus an approximate diffuse transmission. `conditions.solar_heat_gain` is
  estimated W/m² of glazing: post-louvre irradiance × `glazing_shgc` (default
  0.4, an assumption to replace with the installed glass rating). Internal and
  latent loads are not reduced by moving the blades.
- Potential glare: `conditions.direct_sun` is direct irradiance reaching the
  glazing, screened against `glare_limit_w_m2` (default 25 W/m², a tunable
  screening assumption, **not a glare standard**). A failing screen can justify
  movement despite the normal movement budget; a rate-limited or safety-forced
  pose still reports any remaining exposure.

The beam model averages repeated blades; finite ends, side gaps, reflections,
occupant eye position and view-dependent luminance are not resolved by this
controller. A larger blade angle does **not** always block more direct sun.
Diffuse transmission integrates separate isotropic sky and ground hemispheres
against the same blade geometry, weighted by each zone's sky/ground irradiance.
The assumed daylight-transfer factor is unchanged: deeper blades can leave a
zone below its daylight target even at the best available angle. The inspector
reports that shortfall rather than inventing sufficient daylight.
Glare screening must not be read as “glare-free”: a full
[Radiance evalglare assessment](https://www.radiance-online.org/learning/documentation/manual-pages/pdfs/evalglare.pdf)
uses occupant-view luminance imagery. SHGC is the admitted solar heat fraction,
not visible-light transmission ([US DOE](https://bsesc.energy.gov/energy-basics/energy-star-windows)).
The existing `transmitted` field remains **pre-glazing** W/m² for the slab model;
zone comfort predictions use the local sensor, while the spatial heat map uses
modelled physical irradiance. The slab's separate `solar_to_floor` factor still
contains its own glazing/area calibration and is not changed by this control.

Select a zone in the dashboard's 4 × 4 sensor matrix (or in the 3D model), then
use **Apply only this sensor** to inject irradiance and illuminance at the
selected tick. The request's `zone_sensor_overrides` maps a zone ID to
`{tick_index, irradiance, illuminance}`. Only that zone's subsequent state can
change; **Clear override** restores its seeded stream. Equal readings can
legitimately produce equal angles, and building-wide safety can move all zones
together. The mesh never substitutes a wall-level target for a missing zone.

Zones separate on two pieces of geometry:

- **Rows** — the roof slab oversails the top of the facade, and its shadow starts
  at the roof line and walks down the wall as the sun climbs, so the top row
  loses the beam first. The same lip hides part of the sky from the rows nearest
  it.
- **Columns** — the bay at each end of a wall wraps a corner of the building, so
  the room behind it is glazed on two sides and its controller answers for the
  neighbouring facade too (`corner_daylight_coupling`, 0.45). This contributes
  to the corner's indoor-light sensor model, not a shared actuator command.
  Middle bays can receive the same outdoor irradiance while their local
  daylight-transfer factors and sensor readings differ.

The wall-level entry keeps its own supervisory controller, which is what the
headline comparison metrics are measured on.

Once the sun climbs past about 65°, direct beam cannot reach the outward-leaning
115° facade planes. Diffuse irradiance can still vary with orientation, sky
conditions and roof obstruction, so neither sensor readings nor actuator
angles must become identical. Set `facade_tilt: 90` to see upright-wall behaviour.

Every tick also carries a `roof` array: the same calculation at `roof_pitch`
instead of `facade_tilt`, giving one entry per roof quadrant. Roof faces carry
no louvres, so incident gain is what the surface keeps. **At `roof_pitch: 0` all
four quadrants read identically** — a flat roof has no orientation to
distinguish — and the spread grows with pitch (about 125 W/m² at 10°, 305 W/m²
at 25°, late afternoon).

The dashboard renders all of this as an orbitable 3D building: seven storeys
with walls leaning 25°, four pitched roof faces and a fixed multicolour
irradiance ramp (0–1,000 W/m²), with temperature and architectural views available.
Click any zone or roof face to inspect it, or use
the surface-readings table for the keyboard equivalent. Every zone runs its own
controller and carries its own louvres at its own angle.

### Compare the same building without external shading

Use **Monitored building** above the centre model to switch between
**NeuroSkin — Controlled Facade** and **Baseline — No External Facade**.
The baseline removes the complete external louvre/actuator assemblies and
their raycast shadows, not just their rotation. Both variants retain the same
glazing, tilted walls, roof, skylight, weather, sun position, selected zone and
camera. The fixed 0–1,000 W/m² irradiance scale also stays unchanged.

The comparison card shows both buildings at the displayed tick: a selected
zone, an equal-weight mean of the wall's 16 zones, or the unchanged roof.
Wall values estimate irradiance before glazing: passive-roof-adjusted
`zone.incident` without louvres versus `zone.transmitted` with louvres. The mesh
heatmap resolves local direct-beam shadows, with per-zone diffuse shading;
point probes need not equal the analytical zone means. This is not a measured
energy-savings or indoor-comfort comparison. Baseline mode therefore hides
controller/sensor-editing and controlled-building comfort results.

The separate **Impact · vs binary controller** benchmark still compares two
controllers with external louvres; it is not this no-external-facade building.

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
