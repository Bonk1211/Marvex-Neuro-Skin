# NeuroSkin Product Requirements Document — As Built

| Field            | Value                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Document         | Current-state product requirements and technical baseline                                 |
| Version          | **0.3** — supersedes v0.2                                                                 |
| Code snapshot    | `main` at `1f1f4ca` (15 August 2026)                                                      |
| Audited          | 29 August 2026                                                                            |
| Status           | Demo-ready simulation proof; **not** a production building-control system                 |
| Target building  | ST Diamond Building, Energy Commission HQ, Putrajaya                                      |
| Product surfaces | Product overview, adaptive-facade digital twin, predictive radiant-slab planner, JSON API |

> This document describes the repository as it exists at the audited commit. “Built” means implemented and locally verified in software; it does not mean commissioned against a real building, connected to plant, or validated for energy savings.

## 1. Executive summary

NeuroSkin is an explainable building-control simulation with two linked proof applications:

1. **Adaptive facade** — simulates a 24-hour day, checks whether irradiance readings are plausible, chooses louvre angles across four facades and 64 simulated facade zones, enforces hard safety states, and compares the result with a naive threshold controller.
2. **Predictive radiant-slab charging** — uses the facade twin’s selected 16-zone forecast plus a 1R1C slab model to plan the next night’s charge, compare it with a fixed 22:00–06:00 timer, and expose whether that comparison is eligible to be described as a saving.

The browser experience is primarily a judge- and reviewer-facing proof. It makes the controller’s inputs, decisions, trade-offs, safety overrides, provenance, and model limits inspectable. The slab page is shaped like an operator tool, but its output is currently a downloaded JSON plan, not a command sent to a plant controller.

Version 0.3 records four material additions or corrections since v0.2:

- Predictive slab planning is built end to end: engine, API, UI, tests, baseline audit, and JSON export.
- The facade model now contains four supervisory wall controllers and 64 independent zone controllers, not only four wall-level states.
- The dashboard runs an Input step followed by Tier 1–3 as one sequential analysis; the earlier guided-tour and scenario-tab descriptions are no longer current.
- The no-kWh rule applies to the facade’s relative cooling-load index. The slab model intentionally emits **modelled** electrical kWh, subject to stricter claim rules.

## 2. Product problem and value

| Problem                                                                                                | NeuroSkin proof                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A threshold controller can act on a failed or dirty irradiance sensor.                                 | Cross-check the reading against solar position, clear-sky expectation, and cloud state before using it.                                        |
| A single-purpose shade rule can reduce heat while destroying useful daylight or overworking actuators. | Score every allowable angle against thermal load, daylight comfort, movement, and wind exposure.                                               |
| Optimisation must not outrank mechanical safety.                                                       | Bypass the optimiser for power loss, critical wind, or rain and return an explicit SAFE decision.                                              |
| A fixed slab timer charges the same amount regardless of tomorrow’s demand.                            | Forecast zone demand, choose the lowest-cost tested charge that preserves modelled comfort, and place it in the coolest available night hours. |
| Simulation claims are easy to overstate.                                                               | Carry provenance, keep facade load relative, gate slab baseline claims, and publish a field-measurement protocol.                              |

## 3. Users and jobs to be done

### 3.1 Primary: evaluator or technical reviewer

- Understand the control logic without reading source code.
- Run the same day through sensor-trust, co-optimisation, and fail-safe demonstrations.
- Change one input and see its effect on decisions and comparison metrics.
- Inspect exact tick, surface, and zone readings, events, and the wall/tick reason behind a result.
- Distinguish modelled evidence from provider weather; measured slab evidence remains API-only.

### 3.2 Secondary: controls or energy engineer

- Test another site, facade orientation, geometry, weather source, seed, or control weighting.
- Review the full API payload and model assumptions.
- Check whether the configured or fitted slab model clears the useful-capacity threshold and whether the incumbent schedule is genuinely fixed.
- Inspect and export a 16-zone modelled night-charge schedule for offline review.

### 3.3 Not yet served: live facility operator

The product has no authentication, persisted runs, approvals, live sensors, BMS/MQTT link, actuator acknowledgement, alarm handling, or rollback. It must not be represented as a live operations console.

## 4. Goals, guardrails, and non-goals

### 4.1 Current goals

- **G1 — Explainability:** the primary tick payload exposes trust, target/final angle, mode, movement, cost components, and reason; wall payloads expose final state and reason; zone payloads expose final state and readings. The dashboard surfaces final angle, trust, mode/reason, plus scenario-specific charts, but not the per-tick cost breakdown.
- **G2 — Repeatability:** an identical synthetic request returns an identical 144-tick result.
- **G3 — Safety precedence:** power, wind, and rain states bypass ordinary cost optimisation.
- **G4 — Spatial fidelity:** solar gain differs by cardinal facade, roof face, facade row, and corner zone; control state differs by wall and facade zone, while roof faces remain unactuated.
- **G5 — Honest comparison:** NeuroSkin and the naive facade baseline share the same environmental realization and wall geometry.
- **G6 — Honest slab claims:** modelled schedule output is separated from proof that the incumbent baseline is fixed and from field-validated savings.
- **G7 — Graceful weather fallback:** upstream weather failure completes with a labelled synthetic fallback instead of failing the run.

### 4.2 Hard claim guardrails

- Facade cooling load is a **relative cooling-load index**. It must never be converted into HVAC kWh, carbon, cost, or payback.
- The facade model retains a latent-load floor that shading cannot remove.
- Open-Meteo data is provider forecast or reanalysis, not local building telemetry. MET Malaysia supplies daily context that shapes synthetic ticks.
- Occupancy, indoor lux/temperature/RH, pyranometer noise, injected faults, facade control, and slab behavior remain simulated.
- Slab kWh is a model output from assumed or fitted parameters. `baseline_audit.claim_allowed` only establishes that a fixed-timer comparison is structurally eligible; it does **not** validate the model or prove field savings.
- A result remains modelled until real building history, calibrated parameters, verified incumbent behavior, and a controlled field trial support a measured claim.
- Weather warnings are advisory context and never replace local safety inputs.

### 4.3 Non-goals in the current release

- Live sensors, telemetry ingestion, MQTT, BACnet, BMS, edge devices, or actuator control.
- Database, run history, user accounts, permissions, audit trail, sharing, or multi-tenancy.
- Learned facade-load model, model training pipeline, or ML accuracy claims.
- Full building-energy simulation, CFD, hydronic plant modelling, or financial/carbon analysis.
- Production deployment controls such as TLS, rate limits, job queues, autoscaling, secrets management, or disaster recovery.
- Field validation of actuator timing, sensor calibration, condensation risk, mechanical safety, comfort, or energy savings.

## 5. Product surfaces and user journeys

### 5.1 Shipped surfaces

| Surface             | Route              | Purpose                                                                                                       |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Product overview    | `/`                | Position the product, explain the three facade proofs and cost formula, and route users to both applications. |
| Facade digital twin | `/dashboard`       | Configure, run, compare, replay, and inspect the adaptive-facade simulation.                                  |
| Slab planner        | `/slab`            | Generate, assess, inspect, and export a modelled predictive night-charge plan.                                |
| OpenAPI             | `/docs` on backend | Explore the FastAPI contract.                                                                                 |

### 5.2 Facade journey

1. Opening `/dashboard` automatically runs the default synthetic overview for 21 March 2026, seed 42, the west facade, and the Diamond’s 25° outward lean.
2. The user may change weather source, date, synthetic cloud profile, one of seven site presets, primary facade, tilted/upright geometry, occupancy, wind mean override, power state, controller weights, and seed.
3. **Apply settings and re-run** executes only the currently focused scenario.
4. **Run simulation** executes four same-day requests in order: Input/overview, Tier 1 sensor trust, Tier 2 co-optimisation, and Tier 3 movement restraint plus fail-safe.
5. Completed tier findings and charts remain on the page and can be revisited from in-memory results.
6. The common clock animates all tier charts and the 3D sun path across 144 ticks; the user can pause or scrub it.
7. Event buttons jump to their evidence tick. The inspector shows solar position, surface state, angle, lux/load, trust, mode, weather, and reason.
8. The user can orbit the 3D model, select any facade zone or roof face with a pointer, or use the text table to select one of the four walls or four roof faces.

### 5.3 Slab journey

1. Opening `/slab` automatically asks for tomorrow’s ST Diamond plan using Open-Meteo, the default model, no measured slab history, and no baseline log.
2. The user may edit date, fallback sky profile, slab thickness, and choose no log or one of two generated demonstration baseline logs.
3. **Generate plan** runs the selected-day facade twin, folds the selected facade’s 16 zones into hourly demand, identifies or assumes the slab response, and plans the charge.
4. Applicability states whether the supplied or fitted model clears the thermal-mass threshold; the adjacent fit source/note qualifies that result. The baseline audit states whether a fixed-timer comparison is eligible. Neither establishes real-building suitability.
5. The user reviews charge, electrical energy, unmet zone-hours, standby loss, slab/dew-point trajectories, plant timing, forecast provenance, and the 4×4 zone command matrix.
6. A supplied measurement protocol explains how to validate the modelled gap in the real building.
7. **Export controller schedule** downloads the request and plan as JSON. No command is sent to a controller.

## 6. Functional requirements — current implementation

### 6.1 Environment and weather

- **FR-E1:** Build one local calendar day as 144 ten-minute ticks.
- **FR-E2:** Synthetic mode combines pvlib clear-sky irradiance with a seeded clear, scattered, or overcast cloud process.
- **FR-E3:** MET-anchored mode reads Kuala Lumpur location `Tn079`; daily min/max temperature and morning/afternoon/night text conditions shape a seeded synthetic day. Forecast and warning caches last six hours and ten minutes respectively.
- **FR-E4:** Open-Meteo mode requests hourly GHI, DNI, DHI, temperature, cloud cover, wind, and precipitation for arbitrary coordinates, then interpolates them to ten-minute ticks. Forecast or ERA5 reanalysis is selected by date. Cache lifetime is one hour.
- **FR-E5:** Either provider may fall back to a fully synthetic day while returning provider, status, dataset, and fallback reason.
- **FR-E6:** API callers may provide arbitrary latitude, longitude, location name, and valid IANA timezone. The browser offers seven presets.

### 6.2 Facade controller

- **FR-C1:** Calculate solar position once per tick and plane-of-array irradiance for north, east, south, and west surfaces.
- **FR-C2:** Maintain independent actuator state for four supervisory wall controllers and 16 zone controllers per wall: 64 simulated zones total.
- **FR-C3:** Mark one requested facade as primary; only its supervisory state drives headline load, lux, movement, and comparison metrics.
- **FR-C4:** Reject a near-zero pyranometer reading only when the solar almanac expects strong sun and low cloud cannot explain the contradiction. Trust the same low reading under heavy cloud.
- **FR-C5:** Score angles `0°, 5°, …, 60°` using normalized thermal, daylight, movement, and wind-risk weights. Lowest total cost wins; equal costs prefer the smaller angle.
- **FR-C6:** Preserve the current angle when the target changes by less than 5° or its predicted cost improvement is below the movement threshold. This is a per-tick benefit threshold, not a daily movement quota.
- **FR-C7:** Apply safety in this order: power loss → 60° fail-shaded; critical wind at or above 15 m/s → 0°; rain with power → 0°; otherwise optimise.
- **FR-C8:** Compare against a naive controller that selects 60° when the roof pyranometer is at least 550 W/m² and 0° otherwise.
- **FR-C9:** Emit top-level primary-facade target/final/naive angle, load, lux, trust, mode, movement, cost breakdown, and explanation per tick, with the reduced wall and zone contracts nested beside it.

The optimized cost is:

```text
C(θ) = wT·L(θ) + wL·P(lux(θ))²
     + wM·|θ − θprevious|/60
     + wR·(wind/15)²·θ/60
```

### 6.3 Building geometry and visualization data

- **FR-G1:** Use Perez plane-of-array irradiance and ASHRAE-style sol-air surface temperature for each cardinal wall and roof face.
- **FR-G2:** Model the facade as a 4×4 grid per wall. Roof-overhang shadow separates rows; 45% neighbouring-facade daylight coupling separates corner columns.
- **FR-G3:** Run each zone’s own controller and return incident/transmitted gain, sunlit fraction, surface temperature, angle, mode, movement, lux, and load.
- **FR-G4:** Return four roof quadrants with raw gain and no louvres. A flat roof must return identical quadrant values.
- **FR-G5:** Render representative seven-storey Diamond massing, independent zone louvres, surface-temperature colors, sun path, and current sun marker. The massing is reconstructed from published dimensions, not measured drawings.

### 6.4 Three-tier facade analysis

- **FR-T1:** Input/overview establishes the common 144-tick day.
- **FR-T2:** Tier 1 injects a dead pyranometer from 11:30–13:00 and a genuine heavy-cloud gate from 15:00–15:30.
- **FR-T3:** Tier 2 exposes the ongoing NeuroSkin-versus-naive comparison; its engine path is the ordinary simulation with a different scenario label.
- **FR-T4:** Tier 3 forces a high movement threshold from 15:00–16:00 and a power outage from 14:00–14:30, producing HOLD and SAFE evidence.
- **FR-T5:** Store completed tier responses in browser memory, retain their findings/charts, and focus a stored response without another request.
- **FR-T6:** Show loading, inline failure detail, and retry for an unavailable simulation API.

### 6.5 Predictive radiant-slab planner

- **FR-S1:** Accept planned date, seed, environment/site/geometry, slab model parameters, up to 8,760 hourly slab observations, and up to 1,000 baseline nights.
- **FR-S2:** Treat adjacent list entries as consecutive hourly observations without validating chronology. With fewer than eight rows, discard those rows and fit 72 hours of fixed-seed synthetic behavior; retain supplied model constants only when the fit is non-physical.
- **FR-S3:** Declare the application model-applicable when slab capacity is at least 60 Wh/m²K. This is an advisory flag; the current API still returns a plan when false.
- **FR-S4:** Forecast hourly demand for the selected facade’s 16 zones from transmitted facade gain, occupancy-linked internal gain, and base gain.
- **FR-S5:** Model 24 ordered hours from 22:00 before the planned day through 21:00 on the planned day.
- **FR-S6:** Place charge in the coolest available hours between 22:00 and 06:00, preferring later hours when temperature ties.
- **FR-S7:** Search 25 evenly spaced charge targets and choose the fewest unmet hours first and lowest modelled electrical use second. This is a coarse grid result, not an exact minimum.
- **FR-S8:** Never drive the slab below `max(structural minimum, maximum 24-hour proxy indoor dew point + 1°C)`.
- **FR-S9:** Compare with a fixed timer commanding full charge power for every charging hour.
- **FR-S10:** Audit baseline logs: fewer than five nights are insufficient; less than 5% charge variation is considered fixed; otherwise absolute load correlation of at least 0.5 is considered load-compensated. Only the fixed result sets `claim_allowed=true`.
- **FR-S11:** Return model fit, applicability, baseline audit, modelled kWh, charge, peak, comfort, floor, rejected-command and standby-loss metrics, 24 hourly rows, 16 zone plans, and the measurement protocol.

### 6.6 API

| Method and path                | Requirement                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `GET /api/v1/health`           | Return liveness, service name, and deterministic model label.                           |
| `GET /api/v1/config`           | Return default site, geometry, simulation limits, weather sources, and scenario titles. |
| `POST /api/v1/simulations/run` | Validate the request and return the complete facade scenario payload.                   |
| `POST /api/v1/slab/plan`       | Validate the request and return the complete predictive slab plan.                      |

Every normally handled response, including validation responses, includes a sanitized or generated `X-Request-ID`; unhandled failures are logged with the ID, but the outer 500 response may not carry it. Application logs are JSON lines and include request timing plus scenario- or slab-specific completion fields.

## 7. Inputs, outputs, and success metrics

### 7.1 Principal inputs

| Application | Browser inputs                                                                                                             | Additional API-only inputs                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Facade      | Source, date, cloud profile, site preset, primary facade, facade geometry, occupancy, wind mean, power, four weights, seed | Arbitrary coordinates/timezone/name, roof pitch, nullable wind mean override                  |
| Slab        | Date, fallback sky profile, thickness, generated baseline-log choice                                                       | Weather source/site/geometry, all slab constants, measured slab history, real baseline nights |

### 7.2 Facade metrics

| Metric              | Definition                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daylight compliance | Percent of occupied ticks with 300–700 lux when the primary wall receives at least 200 W/m² incident daylight. If no occupied tick clears 200 W/m², all occupied ticks form the fallback denominator. |
| Mean relative load  | Mean relative cooling-load index across all occupied ticks; lower is better.                                                                                                                          |
| Movement count      | Number of primary-facade final-angle changes across the full day.                                                                                                                                     |
| Sensor-fault ticks  | Ticks where the almanac/cloud plausibility gate rejects the pyranometer.                                                                                                                              |
| SAFE ticks          | Primary-facade ticks where a hard safety rule bypasses optimisation.                                                                                                                                  |

The current seeded reference results and bounded ten-seed check live in [`appendix/neuroskin-synthetic-results.md`](appendix/neuroskin-synthetic-results.md). They demonstrate logic, not measured building performance.

### 7.3 Slab metrics

| Metric                  | Meaning                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Predictive/baseline kWh | Modelled electrical energy for delivered slab charge and air-side trim using temperature-dependent COP.          |
| Charge Wh/m²            | Thermal energy actually accepted by the slab.                                                                    |
| Unmet zone-hours        | Zone-hours where remaining load exceeded configured air-side trim capacity.                                      |
| Floor hours             | Hours where a charge command was constrained by the dew-point/structural floor.                                  |
| Rejected Wh/m²          | Commanded charge the slab could not safely accept.                                                               |
| Standby-loss Wh/m²      | Modelled stored cooling lost outside useful zone demand.                                                         |
| Saving percent          | Modelled difference from the fixed timer; not a field claim and meaningful only with the audit status beside it. |

## 8. Architecture and implementation baseline

```text
Synthetic / MET / Open-Meteo
            │
            ▼
  144-tick environment + pvlib solar/POA
            │
            ├──► 4 wall + 64 zone controllers ──► scenario API ──► 3D dashboard
            │
            └──► selected facade's 16 zones ──► 1R1C slab planner
                                                    │
                                                    └──► slab API ──► planner UI / JSON
```

| Layer         | Current implementation                                                       |
| ------------- | ---------------------------------------------------------------------------- |
| Frontend      | Next.js 15, React 19, TypeScript, Tailwind CSS, Recharts, three.js           |
| API           | FastAPI, Pydantic, Uvicorn                                                   |
| Simulation    | Python 3.10+, NumPy, pandas, pvlib                                           |
| Weather       | Standard-library HTTP clients with process-local TTL cache and per-key locks |
| Tests         | pytest; Vitest and Testing Library                                           |
| Local runtime | Make targets or Docker Compose; frontend `:3000`, backend `:8000`            |

The API is stateless with respect to runs. Weather responses are cached only in process memory and disappear on restart or differ between workers.

## 9. Non-functional requirements and current status

| Requirement               | Current status                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Synthetic reproducibility | Met: identical tested synthetic requests produce identical payloads. External provider data can change over time.                                                                                                  |
| Trust-boundary validation | Met for enum/range limits and IANA timezone; slab history ordering and physical cross-field validity are not checked.                                                                                              |
| Weather resilience        | Met: provider errors and invalid payloads fall back to labelled synthetic data.                                                                                                                                    |
| Explainability            | Met in the API; partial in the dashboard, which shows final state/reason and scenario charts but not the returned per-tick cost breakdown.                                                                         |
| Observability             | Basic: request IDs, JSON logs, duration and run summaries; no metrics, tracing backend, dashboards, or alerts.                                                                                                     |
| Error recovery            | Basic: component-level loading/error/retry and WebGL fallback; no offline mode or route-level error boundaries.                                                                                                    |
| Accessibility             | Partial: semantic regions, labels, focus rings, native controls, reduced motion, and surface table; zone selection, orbiting, rail resize, and chart interpretation are not fully keyboard/non-visual equivalents. |
| Responsive UI             | Implemented through stacked layouts below desktop and fixed multi-column dashboard at `xl`; not browser-E2E verified.                                                                                              |
| Performance               | No target or load test. Default scenario responses contain 9,216 zone-tick records plus wall/roof data and are processed synchronously.                                                                            |
| Production security       | Not met: no auth, authorization, rate limiting, configurable production CORS, TLS termination, or security test suite.                                                                                             |
| Deployment readiness      | Local only: images and Compose build, but no health-gated startup, restart policy, locked backend image install, non-root runtime, or production manifest.                                                         |

## 10. Acceptance evidence at this snapshot

| Acceptance criterion                            | Status and evidence                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC1 — complete repeatable day                   | Met: 144 ticks and identical parsed response content for repeated synthetic requests.                                                                                                                                                                                                                  |
| AC2 — sensor contradiction versus genuine cloud | Met: dead-sensor ticks are rejected and the equivalent heavy-cloud reading is trusted.                                                                                                                                                                                                                 |
| AC3 — meaningful co-optimisation comparison     | Met: automated test requires more than 3× naive daylight compliance, less than 1.3× naive load, and fewer movements for the default comparison. This is a Pareto trade-off, not dominance on every metric.                                                                                             |
| AC4 — movement restraint and fail-safe          | Met: a marginal target is held and power loss yields SAFE at 60° for four ten-minute ticks.                                                                                                                                                                                                            |
| AC5 — spatial control                           | Met: four facades, 64 zone states, and four roof faces are returned; zones can reach different angles.                                                                                                                                                                                                 |
| AC6 — geometry behavior                         | Met for automated equinox/solstice reduction thresholds, overhang row shading, corner coupling, and flat/pitched roof invariants. Exact annual percentage claims in older prose do not have a checked-in reproduction script.                                                                          |
| AC7 — weather modes                             | Met with mocked provider contracts, provenance, arbitrary-site handling, and fallback tests; live-provider contract tests are absent.                                                                                                                                                                  |
| AC8 — slab plan                                 | Met for the 16-zone/24-hour endpoint, synthetic-fit recovery, coolest-hour scheduling, and floor enforcement. “No worse than the fixed timer” is tested only in one constructed one-zone mild-day case; measured-history fitting is not directly tested.                                               |
| AC9 — baseline honesty gate                     | Met: no/short/fixed/compensated logs are distinguished and only fixed schedules allow the comparison flag.                                                                                                                                                                                             |
| AC10 — browser workflow                         | Partially met: component tests cover landing routing, dashboard loading/error/retry, tier order/storage/playback, chart reveal, geometry helpers, slab grid, draft controls, and claim logic. Full slab auto-fetch, response rendering, API failure, charts, and JSON export are not component-tested. |

Verification run on 29 August 2026:

| Check                                         | Result                                                          |
| --------------------------------------------- | --------------------------------------------------------------- |
| Backend tests                                 | **53 passed**                                                   |
| Backend Ruff                                  | Passed                                                          |
| Frontend tests                                | **22 passed** across 5 files                                    |
| Frontend ESLint                               | Passed                                                          |
| Next.js production build and TypeScript check | Passed; `/`, `/dashboard`, and `/slab` prerendered successfully |

No coverage threshold is configured. There is no browser E2E, real-WebGL visual, live-provider contract, container-startup, load, accessibility-audit, security, hardware, or field-calibration suite. Frontend component tests emit expected jsdom/Recharts warnings because the test runtime has no WebGL canvas or real layout dimensions. Appendix A is a static evidence artifact; no executable regeneration or snapshot check ties its exact values to current code.

## 11. Known gaps and risks

### 11.1 Priority 0 — blocks pilot or production claims

- **No real control path:** JSON export is not BMS/plant integration, and no command acknowledgement or approval exists.
- **No field calibration:** facade lux/load constants, geometry, actuator behavior, humidity proxy, COP, and safety thresholds remain assumptions. Real slab observations can fit only capacity and surface UA; baseline-night logs only classify incumbent behavior.
- **Unchecked slab fit:** coefficient sign is the only fit-acceptance gate. Reported R² does not gate use, and positive fitted capacity/UA are not plausibility-bounded before planning.
- **Savings flags are advisory:** `applicable=false` and `claim_allowed=false` do not suppress the returned slab schedule or savings fields. Generated demonstration baseline logs can also set `claim_allowed=true`; that proves the audit classifier path, not a real baseline.
- **Simplified slab scope:** the selected facade’s 16 zones represent the configured 12,000 m² floor area. Other facades, roof/conduction, detailed ventilation and latent loads, pumps, hydronics, tariffs, and measured humidity are omitted.
- **Safety is uncommissioned:** combined power loss and critical wind resolves to the 60° power-loss state because power loss has precedence. The physically safe state and passive mechanism require engineering validation.
- **No production trust boundary:** there is no identity, role, audit, rate, tenancy, persistence, or deployment security layer.

### 11.2 Priority 1 — affects correctness or evidence integrity

- **Mixed-run dashboard state:** rerunning the focused scenario after changing settings does not invalidate stored results for the other tiers, so visible comparisons can combine different inputs.
- **Non-Malaysia chart time:** chart labels are hard-coded to `Asia/Kuala_Lumpur` even when another site/timezone is selected; the stage inspector uses the requested timezone correctly.
- **Reduced dashboard provenance:** provider warnings and detailed fallback context are returned by the API but not shown; chart badges always say Synthetic.
- **Measured slab input is API-only:** the UI cannot upload or enter slab observation history or real baseline nights; it exposes only generated demonstration logs.
- **Unchecked API responses:** the frontend casts successful JSON responses to TypeScript types without runtime schema validation, a request timeout, or automatic retry; malformed payloads can fail during rendering.
- **Slab input coupling:** the planner does not accept or forward facade controller weights, occupancy scale, wind override, or power state; its internal twin always runs `overview` with those facade defaults.
- **Slab-history units:** observation `charge_w` is treated as W/m², while baseline-night charge and next-day cooling are building kWh; the API field names do not encode that distinction.
- **MET/site mismatch:** `met_anchored` always uses Kuala Lumpur `Tn079`, even when another site is requested, and combines that Kuala Lumpur anchor with the selected site’s solar geometry.
- **Slab date approximation:** a null date uses the backend server’s local “tomorrow,” not the selected site timezone. The planner also borrows 22:00–23:00 weather from the planned day instead of fetching the preceding day.
- **Large synchronous response:** a full simulation calculates all controllers and returns every zone for every tick in one request, with no job control, pagination, quota, or load target.
- **Partial accessibility:** no keyboard/non-visual equivalent exists for zone-level 3D inspection, chart data, or rail resizing.

### 11.3 Priority 2 — copy, documentation, and edge cases

- The dashboard control hint says only the primary wall carries louvres, while the backend and 3D view run controllers and louvres on all four walls; only headline metrics are primary-only.
- `GuidedTour.tsx` and `data-tour` hooks remain in the repo but no route imports the tour. Older README/design text that promises an 18-step tutorial is stale.
- The FastAPI description says all inputs are synthetic despite Open-Meteo forecast/reanalysis support.
- The slab UI can say “Thermal-mass building confirmed” when the capacity came from assumed constants and synthetic recovery; “model assumption passes O1” would be accurate.
- “Export for the plant controller” currently means download a JSON file only.
- The landing-page decision loop is a hard-coded illustrative preview, not live simulation output; it is not explicitly labelled as illustrative.
- Open-Meteo parsing requires at least 24 matching hourly rows and takes the first 24, while the simulation always emits 144 ticks. A 23-hour daylight-saving day falls back; a 25-hour day is truncated.
- Process-local weather caches are lost on restart and duplicated across workers.
- A dashboard wind override still receives seeded Gaussian noise (σ = 0.25 m/s), so selecting 15 m/s does not force every tick into critical-wind mode.
- This PRD is v0.3, while FastAPI and both package manifests still report product version `0.1.0`.

## 12. Release classification and next decisions

| Readiness level                      | Status                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Local software demonstration         | **Ready** at this snapshot                                                                               |
| Controlled pilot preparation         | **Not ready** until measured inputs, calibration, safety design, and integration requirements are agreed |
| Live building operation              | **Not ready**                                                                                            |
| Measured energy/carbon/payback claim | **Not supported**                                                                                        |

The next product decisions, before more feature work, are:

1. Choose the positioning: retrofit value on upright facades, with the Diamond as a passive-design control, or active value on the Diamond itself.
2. Choose the pilot facade, physical zone mapping, available sensors, actuator interface, and safe mechanical states.
3. Define measured acceptance thresholds for daylight, relative/absolute load, actuator movement, sensor-fault latency, condensation margin, and plant comfort.
4. Decide which incumbent slab behavior is the real baseline and collect at least the slab/zone/charge and next-day cooling logs required to identify it.
5. Decide whether the next deliverable is still a judge-facing proof or a secured operator workflow; the latter requires persistence, approvals, auditability, and integration before UI expansion.

## 13. Traceability map

| Area                       | Primary source                                                                                | Main verification                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| API and logging            | `backend/app/main.py`, `backend/app/schemas.py`, `backend/app/logging_config.py`              | `backend/tests/test_api.py`, `backend/tests/test_logging.py`       |
| Weather and environment    | `backend/app/weather.py`, `backend/app/domain/environment.py`                                 | `backend/tests/test_weather.py`, `backend/tests/test_realworld.py` |
| Facade controller          | `backend/app/domain/{validation,brain,safety,controller,thermal}.py`                          | `backend/tests/test_engine.py`, `backend/tests/test_api.py`        |
| Geometry and zones         | `backend/app/domain/facade.py`, `backend/app/domain/scenarios.py`                             | `backend/tests/test_realworld.py`                                  |
| Slab planner               | `backend/app/domain/slab.py`                                                                  | `backend/tests/test_slab.py`                                       |
| Product overview           | `frontend/src/components/neuroskin/NeuroSkinLanding.tsx`                                      | `NeuroSkinLanding.test.tsx`                                        |
| Facade dashboard           | `NeuroSkinDashboard.tsx`, `TierAnalysis.tsx`, `SimulationControls.tsx`, `ControllerPanel.tsx` | `NeuroSkinDashboard.test.tsx`                                      |
| 3D and charts              | `BuildingHeatmap.tsx`, `SimulationCharts.tsx`                                                 | `BuildingHeatmap.zones.test.ts`, `SimulationCharts.reveal.test.ts` |
| Slab UI                    | `PredictiveSlab.tsx`                                                                          | `PredictiveSlab.zones.test.ts`                                     |
| Current synthetic evidence | `docs/appendix/neuroskin-synthetic-results.md`                                                | Seeded requests and audit dataset in `docs/appendix/`              |

## Appendix A — Key defaults

### Facade simulation

| Parameter                 |                                                    Default |
| ------------------------- | ---------------------------------------------------------: |
| Date                      |                                              21 March 2026 |
| Resolution                |                                     10 minutes / 144 ticks |
| Site                      |                    2.9220 N, 101.6885 E, Asia/Kuala_Lumpur |
| Environment source        |                                     Synthetic in dashboard |
| Primary facade            |                                                       West |
| Facade tilt               |                         115° pvlib tilt = 25° outward lean |
| Roof pitch                |                                                        10° |
| Candidate angles          |                                         0°–60° in 5° steps |
| Weights                   | Thermal 0.45, daylight 0.35, movement 0.15, wind risk 0.05 |
| Lux comfort band          |                                                300–700 lux |
| Daylight evaluation floor |                          200 W/m² incident on primary wall |
| Critical wind             |                                                     15 m/s |
| Power-loss state          |                                            60° fail-shaded |
| Powered wind/rain state   |                                               0° retracted |

### Slab planner

| Parameter                 |                                           Default |
| ------------------------- | ------------------------------------------------: |
| Planned date              | Tomorrow according to backend server when omitted |
| Environment source        |                             Open-Meteo in browser |
| Zones                     |                        Selected facade’s 4×4 grid |
| Floor area                |                                         12,000 m² |
| Slab thickness            |                                            0.20 m |
| Density / specific heat   |                           2,300 kg/m³ / 880 J/kgK |
| Surface UA / loss UA      |                                   8.0 / 1.5 W/m²K |
| Charge power              |                                           70 W/m² |
| Minimum slab temperature  |                      19°C before dew-point margin |
| Zone setpoint             |                                              24°C |
| Air-side trim capacity    |                                           55 W/m² |
| Charging hours            |                                       22:00–06:00 |
| Useful-capacity threshold |                                         60 Wh/m²K |
