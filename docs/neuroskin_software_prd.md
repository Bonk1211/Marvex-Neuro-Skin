# Software Technical Implementation Spec — Neuro-Skin Simulation Proof

**The preliminary-round software deliverable: a simulation proof of the decision brain**

| | |
|---|---|
| Document type | Software PRD / technical implementation spec |
| Version | **0.2 — as built** (supersedes 0.1, the pre-build plan) |
| Scope | Preliminary-round **simulation proof** — NOT the production twin |
| Target building | ST Diamond Building (Energy Commission HQ), Precinct 2, Putrajaya |
| Owners | Teammate C (forecast & geometry), Teammate D (decision & trust) |
| Language | Python ≥ 3.10 (backend), TypeScript (frontend) |
| Status | Backend 38 tests + ruff clean · frontend 9 tests + eslint + production build clean |

> Build goal: one self-contained simulation that runs a representative tropical day on a real building and renders three demos — the lie-detector catch, naive-vs-co-optimisation, and movement-budget/fail-shaded — proving the decision logic does something a static system cannot.

**What changed since 0.1.** Version 0.1 planned a Streamlit app with a scikit-learn load predictor. The build went a different way and this document now records what exists, not what was imagined. The four material divergences:

1. **Surface** — Streamlit → FastAPI backend + Next.js console with a three.js building model. The explainability requirement is unchanged; the delivery mechanism is not.
2. **Predictor** — scikit-learn `RandomForestRegressor` → a deterministic physics-inspired predictor. No training pipeline, no model artefacts, no seed-dependent accuracy claims. Determinism turned out to be worth more to this deliverable than learned accuracy.
3. **Real-world data** — added. Location is a request parameter and two live weather providers are wired in. 0.1 assumed purely synthetic input.
4. **Per-facade control** — added, and it **invalidated AC2 as originally written**. See §8.

---

## 0. Scope and non-scope

**In scope (built):** a modelled tropical day at a real site, four independent per-facade controllers running the decision loop each tick, the engine modules, live weather ingestion, and a browser console that shows decisions *and their reasons* over a 3D model of the building. This surface is the lightweight "digital twin" the preliminary round needs (simulated state + explainability).

**Out of scope (describe in the proposal §4.2, do not build):** MQTT, time-series DB, edge controllers (ESP32/RPi), a live-sensor pipeline, all 16 physical zones, authentication, persistence. Per product PRD NG4.

**Hard software guardrails (from product PRD §9 — these shape the code):**
- **G1** — The sim's "cooling load" is a **relative/proxy quantity**, plotted as *load reduction / shift* and **never** converted into an HVAC-kWh saving. Plot axes are: cooling **load** (relative), lux-compliance %, movement count. *Held: `load_unit` is `"relative cooling-load index"`; a frontend test asserts no `kWh` string renders anywhere.*
- **G2** — The thermal model **includes a latent component that shading does not reduce**, so the load-reduction curve honestly shows a floor. *Held: `LoadEstimate.latent`, clamped to 0.12–0.42, is excluded from the shadeable term.*
- **G3** — Every plot title/caption **labels synthetic data as synthetic**. *Held and extended: `metadata.data_notice` now names exactly which channels are measured and which are synthetic, per environment source.*

---

## 1. Target building

The simulation is aimed at a real building, and its published design parameters are the defaults.

| Parameter | Value | Where it lives |
|---|---|---|
| Location | 2.9220 N, 101.6885 E, Precinct 2, Putrajaya | `DEFAULTS.latitude/longitude` |
| Facade tilt | 25° overhang → `facade_tilt = 115` in pvlib surface-tilt terms | `DEFAULTS.facade_tilt` |
| Floors | 7 | `DEFAULTS.floors` |
| Gross floor area | 14,230 m² | 3D massing reconstruction |
| Rooftop PV | 71.4 kWp | context for the segmented roof heat map |
| Design claim | North and south facades fully self-shaded year-round; east/west solar impact cut 41% | reproduced, see below |

**The tilt is the building's passive shading device, and the model reproduces it.** Running pvlib against clear-sky irradiance at the site, the 25° overhang versus an upright wall cuts annual **direct beam on the north facade by 90% and the south by 87%** — that is the "fully self-shaded" claim, independently reproduced. On east and west it cuts direct beam by 54% and total plane-of-array gain by 28%; the published 41% figure sits between those two measures, so both are reported rather than claiming a match.

`facade_tilt = 90` runs the upright counterfactual. The dashboard exposes both as a toggle, which is the cleanest way to show a judge what the geometry buys.

**Honesty note.** The 3D massing is reconstructed from published figures, not measured drawings. Solving 7 floors, a 25° tilt and 14,230 m² together gives a ~34.6 m square at ground flaring to ~54.7 m at roof over 3.6 m floors. The published "+12% floor area per storey" implies a 2.7 m floor-to-floor, which is too low for an office — the four published numbers are not mutually exact. Treat the geometry as representative; the tilt physics is the load-bearing part.

---

## 2. Tech stack (as built)

| Purpose | Library | Notes |
|---|---|---|
| Solar position + irradiance | `pvlib` | SPA sun-position; `get_total_irradiance` for per-wall plane-of-array; `erbs` for GHI→DNI/DHI |
| Numerics | `numpy`, `pandas` | tick series as arrays; vectorised POA (4 pvlib calls per run, not per tick) |
| API | `fastapi`, `pydantic`, `uvicorn` | stateless; request validation at the trust boundary |
| Load prediction | **none — deterministic** | `DeterministicLoadPredictor` behind a `LoadPredictor` Protocol; swap in a learned model later without touching callers |
| Angle optimisation | `numpy` grid search | α is a bounded scalar on a 5° grid — defensible and matches "evaluate allowable angles" |
| Frontend | `next` 15, `react` 19, `typescript`, `tailwindcss` | console-style dashboard |
| 2D charts | `recharts` | time series |
| 3D model | `three` | building massing + surface heat map, no React wrapper |
| Tests | `pytest`, `vitest`, `@testing-library/react` | 38 backend, 9 frontend |
| Lint | `ruff`, `eslint`, `prettier` | |

**Dropped from 0.1:** `scikit-learn`, `matplotlib`, `plotly`, `streamlit`.

---

## 3. Repository structure (as built)

```
Marvex-DIAMOND-PROMAX/
├── Makefile                      # runs frontend + backend together
├── compose.yml
├── docs/neuroskin_software_prd.md
├── backend/
│   ├── app/
│   │   ├── config.py             # DEFAULTS — every tuning constant
│   │   ├── main.py               # FastAPI app, 3 routes, request-ID middleware
│   │   ├── schemas.py            # Pydantic request/response contract
│   │   ├── weather.py            # MET Malaysia + Open-Meteo adapters, TTL cache
│   │   ├── logging_config.py     # one JSON object per line
│   │   └── domain/
│   │       ├── types.py          # SHARED CONTRACT — C and D co-own
│   │       ├── environment.py    # C
│   │       ├── solar.py          # C
│   │       ├── thermal.py        # C
│   │       ├── facade.py         # C — per-wall POA + sol-air temperature
│   │       ├── validation.py     # D
│   │       ├── brain.py          # D
│   │       ├── safety.py         # D
│   │       ├── controller.py     # shared — per-tick, per-wall orchestration
│   │       └── scenarios.py      # shared — day loop, scenarios, payload assembly
│   └── tests/                    # test_api, test_engine, test_weather,
│                                 # test_realworld, test_logging
└── frontend/src/
    ├── lib/types.ts              # mirrors schemas.py
    ├── lib/api-client.ts
    └── components/neuroskin/
        ├── NeuroSkinDashboard.tsx    # console shell
        ├── BuildingHeatmap.tsx       # three.js stage + FacadeReadout
        ├── SimulationControls.tsx    # environment + site inputs
        ├── ControllerPanel.tsx       # weights + run
        ├── SimulationCharts.tsx      # Recharts panels
        ├── NeuroSkinLanding.tsx
        └── GuidedTour.tsx
```

`domain/types.py` remains the single co-owned file.

---

## 4. Shared state contract (`domain/types.py`)

0.1 defined three dataclasses. The build has eight. `Environment`, `SolarState` and `Decision` are unchanged in shape; the five additions carry site, real weather, and per-wall state.

```python
@dataclass(frozen=True)
class Site:
    """Where the facade is. pvlib is location-agnostic, so this is all it takes."""
    name: str; latitude: float; longitude: float; timezone: str

@dataclass(frozen=True)
class ObservedWeather:
    """Hourly measured/forecast weather for one local day. 24 values per channel."""
    ghi: tuple[float, ...]; dni: ...; dhi: ...; temperature: ...
    cloud: ...; wind: ...; precipitation: ...

@dataclass(frozen=True)
class EnvironmentAnchor:
    """Official daily context used to shape, never replace, synthetic ticks."""
    min_temp: float; max_temp: float
    morning_cloud / afternoon_cloud / night_cloud: float
    morning_rain / afternoon_rain / night_rain: bool

@dataclass(frozen=True)
class WallGain:
    """Unshaded plane-of-array gain on one wall, before its louvres act."""
    orientation: str; azimuth: float
    incident: float; sky_diffuse: float; ground_diffuse: float
    @property
    def direct(self) -> float: ...

@dataclass(frozen=True)
class WallState:
    """One wall's control outcome for a tick."""
    angle: float; mode: str; moved: bool
    lux: float; load_relative: float; reason: str

@dataclass(frozen=True)
class FacadeHeat:
    """What one wall sees, and what its own controller did about it."""
    orientation, azimuth, incident, transmitted, sky_diffuse, ground_diffuse,
    sol_air_temp, angle, mode, moved, lux, load_relative, reason, primary
```

All dataclasses are `frozen=True`. Every state transition returns a new value.

---

## 5. Interface seams

**Seam 1 — sun position (C → D)** — gained a timezone so non-Malaysian sites work:
```python
def sun_position(t, lat=DEFAULTS.latitude, lon=DEFAULTS.longitude,
                 tz=DEFAULTS.timezone) -> SolarState: ...
```

**Seam 2 — predicted load (C → D)** — the `history` parameter of 0.1 was never needed and was dropped:
```python
def predict_load(env: Environment, solar: SolarState) -> LoadEstimate: ...
```
Returns a `LoadEstimate(total, shadeable, latent)` rather than a bare float, so G2's latent floor is structural rather than a convention.

**Seam 3 — per-wall gain (C → D)** — new, and the reason per-facade control is possible:
```python
def poa_series(times, solar_position, ghi, dni, dhi,
               tilt=DEFAULTS.facade_tilt) -> dict[str, dict[str, np.ndarray]]: ...
def wall_gains(series, index) -> list[WallGain]: ...
```

---

## 6. Module specifications (deltas from 0.1)

Modules whose behaviour is unchanged from 0.1 — `validation.py`, `safety.py` — are not restated. Their acceptance criteria still hold and are still tested.

### 6.1 `environment.py` (C)

```python
def generate_day(day, *, cloud_profile="scattered", tick_minutes=10, seed=42,
                 occupancy_scale=1.0, wind_override=None,
                 weather_anchor=None, observed=None, site=None) -> list[Environment]
def solar_frame(day, *, site=None, tick_minutes=10) -> (times, position, location)
```
Three environment sources:
- **`synthetic`** — pvlib clear-sky attenuated by a seeded stochastic cloud process. As 0.1.
- **`met_anchored`** — MET Malaysia's official daily min/max temperature and morning/afternoon/night conditions shape the seeded day. Does not turn forecast text into telemetry.
- **`open_meteo`** — measured hourly GHI/DNI/DHI, temperature, cloud, wind and precipitation replace the modelled sky, interpolated onto the 10-minute grid. Past dates come from the ERA5 archive endpoint, recent and future from the forecast endpoint; the switch is automatic on a ~6-day boundary.

Under every source, **occupancy, indoor readings and all injected sensor faults stay synthetic**, so the lie-detector keeps a known ground truth.

### 6.2 `facade.py` (C) — new module

Per-wall plane-of-array irradiance and surface temperature for the four cardinal walls.

```python
ORIENTATIONS = {"north": 0.0, "east": 90.0, "south": 180.0, "west": 270.0}
SOLAR_ABSORPTANCE = 0.6

def sol_air_temp(outdoor_temp, poa_global, wind) -> float:
    # ASHRAE: T_sol-air = T_air + (a * I) / (5.7 + 3.8 * v)
    # Long-wave sky correction taken as zero for vertical surfaces.
```
`surface_tilt` is a parameter, not a constant: 90 is a plain wall, above 90 leans outward and self-shades. Vectorised — four pvlib calls per run rather than four per tick.

**Acceptance:** at the site, tilt 115 reduces north and south plane-of-array gain against tilt 90 on equinox and both solstices, and reduces east/west by 15–50%. *Tested.*

**Segmented roof.** The roof is the same calculation at a different tilt, so `poa_series` is called a second time with `roof_pitch` and `roof_segments` reads off one face per quadrant. Roof faces carry no louvres, so incident gain is what the surface keeps.

```python
def roof_segments(series, index, *, outdoor_temp, wind, pitch) -> list[RoofSegment]
```

The building has a **71.4 kWp rooftop PV array**, but no source publishes the roof geometry or the array tilt, so `roof_pitch` is an assumption shaped like a real low-latitude array (default 10°). Measured per-face spread on a clear equinox day:

| Roof pitch | 08:00 | 12:00 | 17:00 |
|---|---|---|---|
| 0° (flat) | 0 W/m² | 0 W/m² | 0 W/m² |
| 10° | 5 | 81 | 125 |
| 25° | 7 | 197 | 305 |

**A flat roof reads identically on every quadrant, by definition** — there is no orientation to distinguish. That degenerate case is pinned by a test, because a heat map that invented differences on a flat roof would be lying. At 12:00 the *east* faces lead, which is correct: solar noon at 101.69 E falls near 13:11 local time.

The roof is also the hottest surface on the building by a wide margin — at noon it reads ~55 °C sol-air against ~38 °C on the self-shaded walls. That contrast is the clearest single argument for the tilted facade.

### 6.3 `thermal.py` (C)

`shade_transmittance(angle)` was extracted so the louvre model has one definition shared by the load calculation and the facade heat map. `DeterministicLoadPredictor` sits behind a `LoadPredictor` Protocol — the seam a learned model would slot into.

### 6.4 `brain.py` (D)

Unchanged in structure from 0.1: a bounded grid search over `J(α)` returning the cost breakdown that feeds the explainability panel. Weights are request parameters.

### 6.5 `controller.py` (shared) — now orientation-aware

```python
def run_tick(env, current_angle, weights, *, power_ok=True,
             movement_threshold=..., site=None,
             solar=None, gain=None) -> TickResult
```
Two optional parameters carry the change:
- **`solar`** — a precomputed `SolarState`, so running four walls per tick costs one sun-position call, not four.
- **`gain`** — when supplied, the angle optimisation reads that wall's plane-of-array irradiance instead of horizontal GHI, and its daylight instead of the horizontal proxy.

**Sensor trust and the safety gate stay building-level.** The pyranometer is on the roof; wind, rain and power loss are not per-wall. Only the angle optimisation is orientation-aware — a wall is shaded for the sun that actually strikes it, not for the sun on a flat roof.

```python
WALL_LUX_PER_IRRADIANCE = 1.7   # work-plane lux per W/m2 of POA — calibration knob
```

### 6.6 `scenarios.py` (shared) — the day loop

Per tick: build the four `WallGain`s, run `run_tick` once per wall carrying that wall's own actuator position across ticks, then assemble `FacadeHeat` from the four outcomes. **The primary facade's controller drives the headline metrics** — one controller, not two.

### 6.7 API (`main.py`, `schemas.py`)

| Route | Purpose |
|---|---|
| `GET /api/v1/health` | liveness |
| `GET /api/v1/config` | location, building, scenario and simulation defaults |
| `POST /api/v1/simulations/run` | run a seeded scenario, return the full tick series |

Request parameters beyond 0.1: `latitude`, `longitude`, `timezone`, `location_name`, `facade_orientation`, `facade_tilt`, `environment_source`. `timezone` is validated against the IANA database before it can reach an outbound query string. Every response carries an `X-Request-ID`; logs are one JSON object per line.

### 6.8 Frontend console (`NeuroSkinDashboard.tsx` and friends)

Replaces 0.1's `app.py`. A four-column control-panel shell:

```
┌──┬──────────────┬──────────────────────┬──────────────┐
│▪ │ Overview     │  ST Diamond Bldg  ☀  │ Environment  │
│▪ │ ◔ ◔ ◔  KPIs  │     ▛▀▀▀▀▀▀▀▀▜       │  source/date │
│▪ │ Impact       │    ▟ 3D DIAMOND ▙    │  site/tilt   │
│▪ │ Wall reads   │   ▟▟▟▟▟▟▟▟▟▟▟▟▙      │ Controller   │
│▪ │ Events       │  ═══ timeline ═══    │  weights/run │
└──┴──────────────┴──────────────────────┴──────────────┘
```
- **Icon rail** — scenario tabs.
- **Left rail** — arc gauges, impact vs baseline, per-wall readings, events, charts.
- **Stage** — the three.js model: seven storeys, walls leaning 25°, each wall shaded on a single-hue sol-air temperature ramp with its own louvres at its own angle. **Click any wall to inspect that facade's decision**; the readings table is the keyboard equivalent.
- **Right rail** — environment and controller inputs.

Colour rules follow the sequential-encoding convention: one hue light→dark for magnitude, never a rainbow, fixed 24–70 °C domain so a colour means the same thing at every tick, and every value also present as text so the map is never colour-alone. No WebGL degrades to the table.

---

## 7. The three demo scenarios

Unchanged in intent. Tier 1 (`lie_detector`) injects a dead pyranometer under low cloud and the same near-zero reading under heavy cloud, proving disambiguation rather than thresholding. Tier 2 (`co_optimization`) runs naive versus `J(α)` on one day — **see §8 for the corrected claim**. Tier 3 (`budget_failsafe`) shows a declined marginal move and a fail-shaded power-loss response; the movement-budget window is now 15:00–16:00 and the annotation fires on the first genuinely declined move rather than a hard-coded tick, because which clock time a facade wants to move depends on which facade it is.

---

## 8. Overall acceptance criteria

- **AC1** — Tier 1 visibly catches a dirty sensor the naive controller falls for. **Met.**
- **AC2 (revised)** — ~~Tier 2 shows ours beating naive on all three axes.~~ **This is no longer true and the criterion was wrong to assume it.** Once each facade is scored on its own daylight rather than a horizontal proxy, the two strategies sit on a genuine Pareto trade-off: the naive controller shades off a roof sensor, so it over-shades walls the sun is not on. That *does* win on cooling load (0.457 vs 0.557 relative) and it destroys the daylight it was supposed to protect (13.5% vs 100% lux compliance). The revised criterion: **ours holds daylight compliance at more than 3× naive while staying within 1.3× of its cooling load, and moves less.** Met and tested. Retuning the thermal/lux weights moves where the system sits on that curve; it does not remove the curve.
- **AC3** — Tier 3 shows a declined marginal move and a fail-shaded power-loss response. **Met.**
- **AC4** — No plot converts load into an HVAC-kWh figure (G1); the latent floor is visible (G2); synthetic data is labelled (G3). **Met.**
- **AC5** — The explainability surface shows a human-readable reason for the current angle — now per facade. **Met.**
- **AC6 (new)** — The 25° tilt's self-shading is reproduced from first principles, not asserted. **Met.**
- **AC7 (new)** — Different facades reach different angles under the same tick's conditions. **Met** (upright facade, 17:00: north 0°, east 20°, south 0°, west 55°).
- **AC8 (new)** — Every wall and every roof face is individually inspectable, and the roof heat map is per-face rather than a single flat value. **Met**: eight selectable surfaces, click in 3D or select the table row. A flat roof correctly returns one value across all four quadrants.

---

## 9. Open questions

- **O1 (was: does the building have thermal-mass cooling?)** — **Answered: yes.** The ST Diamond Building uses radiant slab cooling. `slab_state` was still not built, and that remains the right call for a preliminary-round deliverable, but the option is now known to be physically justified rather than speculative. This is the strongest candidate for the next increment.
- **O2 (tuning)** — Partly answered, and the list of constants needing real measurement has grown. Provisional values now live in `DEFAULTS` and two module constants. The ones a real deployment must calibrate:

  | Constant | Value | What it controls |
  |---|---|---|
  | `WALL_LUX_PER_IRRADIANCE` | 1.7 | where the 300–700 lux band bites |
  | `SOLAR_ABSORPTANCE` | 0.6 | sol-air surface temperature |
  | `roof_pitch` | 10° | per-face roof POA spread; 0 makes every face identical |
  | `movement_threshold` | 0.025 | how marginal a move must be to be declined |
  | `critical_wind` | 15.0 m/s | safety retract |
  | `cloud_attenuation` | 0.72 | synthetic sky only |
  | controller weights | 0.45 / 0.35 / 0.15 / 0.05 | position on the AC2 trade-off curve |

- **O3 (new)** — With the 25° tilt as built, every wall peaks near the middle of the lux comfort band and the louvres correctly hold open almost all day. Divergent per-facade angles only appear on the upright counterfactual. Is the adaptive layer therefore best pitched as *retrofit value for conventional vertical facades*, with the Diamond as the control case that shows how much good geometry already achieves? This is a positioning question, not a code one, and it is the most interesting thing the build surfaced.
