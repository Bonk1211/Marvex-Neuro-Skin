# NeuroSkin Product Requirements Document — As Built

| Field            | Value                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Document         | Current-state product requirements and technical baseline                                 |
| Version          | **0.5** — supersedes v0.4                                                                 |
| Code snapshot    | `feat/roof-solar-irradiance-heatmap` at `ac942da` (13 September 2026)                       |
| Audited          | 13 September 2026                                                                         |
| Status           | Demo-ready simulation proof; **not** a production building-control system                 |
| Target building  | ST Diamond Building, Energy Commission HQ, Putrajaya                                      |
| Product surfaces | Product overview, adaptive-facade digital twin, predictive radiant-slab planner, JSON API |

> This document describes the repository as it exists at the audited commit. "Built" means implemented and locally verified in software; it does not mean commissioned against a real building, connected to plant, or validated for energy savings.

## Changes since v0.4

- **Daylight surrogates implemented:** separate Extra Trees models estimate task-plane Et and eye-plane Ev from an independent radiosity oracle. The executed notebook, split design, baselines, transfer results and evaluation history are documented in §14.3.
- **Observe-only display shipped:** the Floor lens colours registered seat/desk probes; the Brains lens presents the fixed oracle comparison. Et/Ev do not change controller decisions, and the feature defaults off (§6.7).
- **Threshold weaknesses quantified:** transfer detects 96.36% of oracle eye-cap exceedances; 358 exceedances are missed. Predicted Et in-band precision is 79.60%. These results limit the model to demonstration use pending further validation (§14.3.2).
- **Acceptance evidence refreshed:** 112 backend and 82 frontend tests pass; local browser checks and the serving benchmark are recorded with their scope and limitations (§10). The uncached inference overhead remains above the proposed target.
- **Product context reconciled:** the snapshot now includes the dashboard lens split, provider observations and the daylight work. Pydantic's declared minimum is 2.12, matching the optional-field serialization used by serving.

## Changes since v0.3

v0.3 was audited on 29 August 2026 against commit `1f1f4ca`. Two feature commits landed after it, one dead module was removed, and the audit numbers and one appendix value were wrong. Corrections:

| # | Change | Evidence |
| - | ------ | -------- |
| 1 | Snapshot advanced `1f1f4ca` → `324670a`; adds per-facade solar-exposure calculations and the CCTV cloud-vision panel | `git log 1f1f4ca..HEAD` |
| 2 | Backend test count **53 → 100** across 8 files | §10 verification run |
| 3 | Frontend test count **22 across 5 files → 67 across 12 files** | §10 verification run |
| 4 | **Appendix A default weights were wrong in v0.3.** Stated "Thermal 0.45, daylight 0.35, movement 0.15, wind risk 0.05"; the code default is thermal 0.45, lux 0.45, movement 0.05, risk 0.05 | `backend/app/domain/types.py:232-235`, matching `DEFAULT_REQUEST` in `NeuroSkinDashboard.tsx` |
| 5 | **Candidate-angle description corrected.** 5° steps are search brackets; the committed final angle is continuous | `config.py` (`angle_step` comment), `main.py:113` (`"continuous_angles": True`) |
| 6 | §6.6 API table was missing `POST /api/v1/vision/clouds` | `backend/app/vision.py:14,139` |
| 7 | §11.3 dead-`GuidedTour` gap **resolved** — 608-line module and 63 lines of `.tour-*` CSS deleted; it had zero imports and 5 of its 17 targets no longer existed | deleted at this audit; 34 `data-tour` anchors deliberately retained |
| 8 | §8 tech stack restated as **installed versions** rather than declared ranges, with a currency column | §8.2 |
| 9 | Runtime is Python **3.13.9** and Node **25.9.0**; the manifests still declare `>=3.10` and `@types/node ^20` | §8.3 |

## 1. Executive summary

NeuroSkin is an explainable building-control simulation with two linked proof applications:

1. **Adaptive facade** — simulates a 24-hour day, checks whether irradiance readings are plausible, chooses louvre angles across four facades and 64 simulated facade zones, enforces hard safety states, and compares the result with a naive threshold controller.
2. **Predictive radiant-slab charging** — uses the facade twin's selected 16-zone forecast plus a 1R1C slab model to plan the next night's charge, compare it with a fixed 22:00–06:00 timer, and expose whether that comparison is eligible to be described as a saving.

The browser experience is primarily a judge- and reviewer-facing proof. It makes the controller's inputs, decisions, trade-offs, safety overrides, provenance, and model limits inspectable. The slab page is shaped like an operator tool, but its output is currently a downloaded JSON plan, not a command sent to a plant controller.

The facade proof now includes learned occupant-plane daylight estimates and an independent
oracle assessment of the shipped controller. The models outperform the tested linear and
scalar baselines, but threshold errors and uncalibrated room assumptions remain. The release
keeps them observe-only; measured comfort and control improvements remain unproven (§14.3).

## 2. Product problem and value

| Problem                                                                                                | NeuroSkin proof                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A threshold controller can act on a failed or dirty irradiance sensor.                                 | Cross-check the reading against solar position, clear-sky expectation, and cloud state before using it.                                        |
| A single-purpose shade rule can reduce heat while destroying useful daylight or overworking actuators. | Score every allowable angle against thermal load, daylight comfort, movement, and wind exposure.                                               |
| Optimisation must not outrank mechanical safety.                                                       | Bypass the optimiser for power loss, critical wind, or rain and return an explicit SAFE decision.                                              |
| A fixed slab timer charges the same amount regardless of tomorrow's demand.                            | Forecast zone demand, choose the lowest-cost tested charge that preserves modelled comfort, and place it in the coolest available night hours. |
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

### 3.3 Facility evaluation; live operation not yet served

The product has no authentication, persisted runs, approvals, live sensors, BMS/MQTT link, actuator acknowledgement, alarm handling, or rollback. It must not be represented as a live operations console.

The Building lens provides a manager-shaped evaluation view over simulated data. Its provenance strip stays visible across all four lenses and makes provider fallback explicit. The AFC workstream (§14.2) remains planned; neither surface establishes live operation.

## 4. Goals, guardrails, and non-goals

### 4.1 Current goals

- **G1 — Explainability:** the primary tick payload exposes trust, target/final angle, mode, movement, cost components, and reason; wall payloads expose final state and reason; zone payloads expose final state and readings. The dashboard surfaces final angle, trust, mode/reason, scenario-specific charts, and the per-tick cost breakdown in the Brains lens.
- **G2 — Repeatability:** an identical synthetic request returns an identical 144-tick result.
- **G3 — Safety precedence:** power, wind, and rain states bypass ordinary cost optimisation.
- **G4 — Spatial fidelity:** solar gain differs by cardinal facade, roof face, facade row, and corner zone; control state differs by wall and facade zone, while roof faces remain unactuated.
- **G5 — Honest comparison:** NeuroSkin and the naive facade baseline share the same environmental realization and wall geometry.
- **G6 — Honest slab claims:** modelled schedule output is separated from proof that the incumbent baseline is fixed and from field-validated savings.
- **G7 — Graceful weather fallback:** upstream weather failure completes with a labelled synthetic fallback instead of failing the run.
- **G8 — Occupant-plane evidence:** expose optional Et/Ev observations, score existing controller decisions independently with the oracle, and disclose generalisation and threshold errors alongside the model's scope.

> **G1 and G7 are surfaced in the browser.** The provenance strip renders the complete `data_notice`, `load_unit`, synthetic seed, provider/dataset, fetch time in the run timezone, and an amber fallback reason. The Brains lens renders `tick.cost_breakdown` and the target-to-final angle delta.

### 4.2 Hard claim guardrails

- Facade cooling load is a **relative cooling-load index**. It must never be converted into HVAC kWh, carbon, cost, or payback.
- The facade model retains a latent-load floor that shading cannot remove.
- Open-Meteo data is provider forecast or reanalysis, not local building telemetry. MET Malaysia supplies daily context that shapes synthetic ticks.
- Occupancy, indoor lux/temperature/RH, pyranometer noise, injected faults, facade control, and slab behavior remain simulated.
- Cloud-vision coverage is a **demo sky estimate**, not calibrated hemispheric cloud cover; projected cloud shadows are illustrative, not measured shadow locations.
- Slab kWh is a model output from assumed or fitted parameters. `baseline_audit.claim_allowed` only establishes that a fixed-timer comparison is structurally eligible; it does **not** validate the model or prove field savings.
- A result remains modelled until real building history, calibrated parameters, verified incumbent behavior, and a controlled field trial support a measured claim.
- Weather warnings are advisory context and never replace local safety inputs.
- Occupant-plane task illuminance (Et) and vertical eye illuminance (Ev) are modelled
  estimates from an uncalibrated room oracle and its learned surrogates. They are
  never measured occupant comfort. The 1000 lux Ev cap is an illustrative screening
  threshold; exceeding it is not a diagnosis of discomfort. See the reproducible
  [daylight experiment](appendix/daylight-blindness-results.md).
- Surrogate MAE and R² measure agreement with the local oracle. They do not establish
  measured comfort, reliable threshold decisions or suitability for autonomous control.
  The three identical seed-42 runs establish reproducibility, not independent validation.

### 4.3 Non-goals in the current release

- Live sensors, telemetry ingestion, MQTT, BACnet, BMS, edge devices, or actuator control.
- Database, run history, user accounts, permissions, audit trail, sharing, or multi-tenancy.
- Learned facade-load model or field-validated ML accuracy claims. The offline
  daylight surrogate pipeline and optional observe-only display are an explicit exception: they learn room Et/Ev
  from an illustrative radiosity oracle and report only oracle-prediction errors.
- Full building-energy simulation, CFD, hydronic plant modelling, or financial/carbon analysis.
- Production deployment controls such as TLS, rate limits, job queues, autoscaling, secrets management, or disaster recovery.
- Field validation of actuator timing, sensor calibration, condensation risk, mechanical safety, comfort, or energy savings.

> The ESP32 hardware bridge (`hardware/README.md`) is an explicit, demo-scale exception to the first bullet: four BH1750 readings and four servo commands over local WiFi, with no field-validation, safety-certification or energy claims.

> The planned AFC workstream (§14.2) requires a correction ledger and therefore **contradicts the no-database non-goal above.** That contradiction is deliberate and scoped: rollback cannot restore a state that was never stored. If §14.2 ships, this bullet must be amended to "no database beyond AFC correction episodes" rather than silently left standing.

## 5. Product surfaces and user journeys

### 5.1 Shipped surfaces

| Surface             | Route              | Purpose                                                                                                       |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Product overview    | `/`                | Position the product, explain the three facade proofs and cost formula, and route users to both applications. |
| Facade digital twin | `/dashboard`       | Four URL-selected lenses over one shared facade run: Building, Floor, Brains, Feeds.                                  |
| Slab planner        | `/slab`            | Generate, assess, inspect, and export a modelled predictive night-charge plan.                                |
| OpenAPI             | `/docs` on backend | Explore the FastAPI contract.                                                                                 |

### 5.2 Facade journey

1. Opening `/dashboard` automatically runs the default synthetic overview for 21 March 2026, seed 42, the west facade, and the Diamond's 25° outward lean.
2. The user may change weather source, date, synthetic cloud profile, one of seven site presets, primary facade, tilted/upright geometry, occupancy, wind mean override, power state, controller weights, and seed.
3. **Apply settings and re-run** executes only the currently focused scenario.
4. **Run simulation** executes four same-day requests in order: Input/overview, Tier 1 sensor trust, Tier 2 co-optimisation, and Tier 3 movement restraint plus fail-safe.
5. Completed tier findings remain in Building; all completed tier charts appear together in Brains. Switching `?view=` keeps in-flight requests, the shared clock, sky sampler, tier results, and the WebGL scene intact; it does not rerun the simulation.
6. The common clock animates all tier charts and the 3D sun path across 144 ticks; the user can pause or scrub it.
7. Event buttons jump to their evidence tick. The inspector shows solar position, surface state, angle, lux/load, trust, mode, weather, and reason.
8. The user can orbit the 3D model, select any facade zone or roof face with a pointer, or use the text table to select one of the four walls or four roof faces.
9. The CCTV panel loops a sky sample at 0.2× speed, sends frames to the Roboflow segmentation workflow on a 5/15/30/60-second cadence, and feeds the resulting coverage estimate into the controller's solar sensor-trust check. Samples older than 60 seconds or future-dated are ignored.

The provenance strip appears above the rails after a successful run and preserves the backend disclosure verbatim. A provider fallback is amber and includes its reason. With no run or an error it is absent.

- **Building** (the default for missing or invalid `?view=`): gauges, tier findings, impact, facade comparison, building-wide occupancy, and controller settings.
- **Floor**: North, East, South and West each open their own exploded 3D stack of four grouped levels labelled Floors 1–2, Floors 3–4, Floors 5–6 and Floor 7. Every level contains a complete furnished interior and matching HVAC distribution; illustrative office/training/collaboration/studio arrangements vary between levels. Clicking a floor slab or its label selects that group, keeps it in full colour, temporarily greys the other three levels and shows its four facade zones. The matching sidebar buttons provide keyboard access. Show all levels restores colour and all 16 zones for the chosen side. Top down provides an isolated detail view of the selected level; returning to the stack preserves the selection, and resetting restores the full stack. Side switching, rotation, zoom, HVAC toggles and level selection retain the same canvas and simulation run. Facade means use all groups in overview or only the selected group in detail, with transmitted irradiance/load index for the controlled building and incident irradiance for the baseline. Floor geometry, vertical spacing and HVAC are illustrative; they do not imply measured room layouts, room cooling demand, airflow or HVAC energy. Missing zone grids remain unavailable while floor slabs and labels stay selectable. The displayed levels represent grouped floors, not individual floor telemetry.
- **Brains**: four dimensionless objective contributions with normalized applied weights, target/final angle and delta, trust/reason, event jumps, and all completed tier charts.
- **Feeds**: vision, provider last-observed status and last-success time, and model limits. `/health` only reads process-local observations; it makes no outbound calls. Unconfigured Roboflow is labelled “not configured”; an unreachable health endpoint leaves feeds unknown.

Environment controls stay available in every lens. Roof solar irradiation uses MJ/m²; it is not a conversion of facade cooling load to energy.

### 5.3 Slab journey

1. Opening `/slab` automatically asks for tomorrow's ST Diamond plan using Open-Meteo, the default model, no measured slab history, and no baseline log.
2. The user may edit date, fallback sky profile, slab thickness, and choose no log or one of two generated demonstration baseline logs.
3. **Generate plan** runs the selected-day facade twin, folds the selected facade's 16 zones into hourly demand, identifies or assumes the slab response, and plans the charge.
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
- **FR-C5:** Score angles across `0°–60°` using normalized thermal, daylight, movement, and wind-risk weights. 5° is the **search bracket**, not a mechanical increment — the committed final angle is continuous (`continuous_angles: true` in `GET /api/v1/config`). Lowest total cost wins; equal costs prefer the smaller angle.
- **FR-C6:** Preserve the current angle when the target changes by less than 0.1° or its predicted cost improvement is below the movement threshold. This is a per-tick benefit threshold, not a daily movement quota.
- **FR-C7:** Apply safety in this order: power loss → 60° fail-shaded; critical wind at or above 15 m/s → 0°; rain with power → 0°; otherwise optimise.
- **FR-C8:** Compare against a naive controller that selects 60° when the roof pyranometer is at least 550 W/m² and 0° otherwise.
- **FR-C9:** Emit top-level primary-facade target/final/naive angle, load, lux, trust, mode, movement, cost breakdown, and explanation per tick, with the reduced wall and zone contracts nested beside it.
- **FR-C10:** Actuator travel is rate-limited to 1.2°/min, a commissioning assumption rather than a measured hardware specification.

The optimized cost is:

```text
C(θ) = wT·L(θ) + wL·P(lux(θ))²
     + wM·|θ − θprevious|/60
     + wR·(wind/15)²·θ/60
```

### 6.3 Building geometry and visualization data

- **FR-G1:** Use Perez plane-of-array irradiance and ASHRAE-style sol-air surface temperature for each cardinal wall and roof face.
- **FR-G2:** Model the facade as a 4×4 grid per wall. Roof-overhang shadow separates rows; 45% neighbouring-facade daylight coupling separates corner columns.
- **FR-G3:** Run each zone's own controller and return incident/transmitted gain, sunlit fraction, surface temperature, angle, mode, movement, lux, and load.
- **FR-G4:** Return four roof quadrants with raw gain and no louvres. A flat roof must return identical quadrant values.
- **FR-G5:** Render representative seven-storey Diamond massing, independent zone louvres, surface-temperature colors, sun path, and current sun marker. The massing is reconstructed from published dimensions, not measured drawings.
- **FR-G6:** Offer four surface-colouring modes over the same geometry: instantaneous irradiance, plain 3D model, sol-air surface temperature, and daily accumulated roof exposure.
- **FR-G7:** Draw rounded cloud volumes above the building from the latest vision mask, with drifting projected shadows that update architectural lighting and the instantaneous irradiance heatmap while preserving diffuse light. Reduced-motion mode stops drift but still accepts new observations.

**Zone identifiers** are `f"{orientation[0].upper()}{row * columns + column + 1}"` — `W1`…`W16` for the west wall (`facade.py:274`). Rows are **four bands over seven floors**, so a band covers floors `{0,1}`, `{2,3}`, `{4,5}`, `{6}`. The model has no single-floor, room, or core resolution.

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
- **FR-S4:** Forecast hourly demand for the selected facade's 16 zones from transmitted facade gain, occupancy-linked internal gain, and base gain.
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
| `GET /api/v1/health`           | Return liveness, service/model labels, and each provider's configuration, last observed status and last success. Performs no outbound probe; `ok` is backend liveness, not proof of current upstream availability. |
| `GET /api/v1/config`           | Return default site, geometry, simulation limits, weather sources, and scenario titles. |
| `POST /api/v1/simulations/run` | Validate the request and return the complete facade scenario payload.                   |
| `POST /api/v1/slab/plan`       | Validate the request and return the complete predictive slab plan.                      |
| `POST /api/v1/vision/clouds`   | Run one base64 JPEG sky frame through the Roboflow segmentation workflow and return union cloud mask, coverage, detections, and annotated frame. 503 when `ROBOFLOW_API_KEY` is absent. |

Every normally handled response, including validation responses, includes a sanitized or generated `X-Request-ID`; unhandled failures are logged with the ID, but the outer 500 response may not carry it. Application logs are JSON lines and include request timing plus scenario- or slab-specific completion fields.

**`LOG_FIELDS` in `backend/app/logging_config.py:7` is an allowlist.** Structured fields absent from that tuple never reach log output. Any new observability field must be added there or it is silently dropped.

### 6.7 Occupant-plane daylight observations

- **FR-D1:** `daylight_model_enabled` defaults to false. Enabling it adds modelled per-probe Et/Ev and zone summaries without changing the objective, exterior glare screen, safety rules or actuator decisions. Disabled responses preserve the pre-change bytes.
- **FR-D2:** Serve only the evaluated Putrajaya location, 115° facade geometry and artifact-approved orientations. Missing, unreadable or incompatible artifacts, or a missing inference dependency, leave estimates unavailable. No unavailable value becomes zero.
- **FR-D3:** The Floor lens shows numerical readings, chair Ev colours, desk Et colours and the selected-side/floor-group over-cap count. Colour saturation never clamps the reported number. Low-sun/night probes are grey; missing models hide the readings and show an unavailable message. Geometry remains labelled illustrative.
- **FR-D4:** The Brains comparison uses the fixed 12-day oracle experiment, with its seed, sample scope and denominators. It does not substitute surrogate estimates or imply that an Ev-aware controller has been tested.
- **FR-D5:** Preserve reproducible offline training, the executed notebook, append-only evaluation ledger and shared generation/serving feature contract. Record latency and interpolation sensitivity; the unmet uncached inference target remains a documented limitation (§14.3).

## 7. Inputs, outputs, and success metrics

### 7.1 Principal inputs

| Application | Browser inputs                                                                                                             | Additional API-only inputs                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Facade      | Source, date, cloud profile, site preset, primary facade, facade geometry, occupancy, wind mean, power, four weights, seed | Arbitrary coordinates/timezone/name, roof pitch, nullable wind mean override                  |
| Slab        | Date, fallback sky profile, thickness, generated baseline-log choice                                                       | Weather source/site/geometry, all slab constants, measured slab history, real baseline nights |
| Vision      | Sample interval (5/15/30/60 s), canopy visibility                                                                          | Raw base64 JPEG frame, width, height                                                          |

### 7.2 Facade metrics

| Metric              | Definition                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daylight compliance | Percent of occupied ticks with 300–700 lux when the primary wall receives at least 200 W/m² incident daylight. If no occupied tick clears 200 W/m², all occupied ticks form the fallback denominator. |
| Mean relative load  | Mean relative cooling-load index across all occupied ticks; lower is better.                                                                                                                          |
| Movement count      | Number of primary-facade final-angle changes across the full day.                                                                                                                                     |
| Sensor-fault ticks  | Ticks where the almanac/cloud plausibility gate rejects the pyranometer.                                                                                                                               |
| SAFE ticks          | Primary-facade ticks where a hard safety rule bypasses optimisation.                                                                                                                                   |

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

### 8.1 Data flow

```text
Synthetic / MET / Open-Meteo          Roboflow sky segmentation
            │                                    │
            ▼                                    ▼
  144-tick environment + pvlib solar/POA ◄── cloud coverage estimate
            │
            ├──► 4 wall + 64 zone controllers ──► scenario API ──► 3D dashboard
            │
            ├──► optional cached Et/Ev predictions ──► observe-only probe payload
            │
            └──► selected facade's 16 zones ──► 1R1C slab planner
                                                    │
                                                    └──► slab API ──► planner UI / JSON
```

Offline daylight development follows louvre optics + room oracle → Parquet samples →
grouped training/evaluation → local model artifacts, notebook and ledger. Training never
runs in the request path. The controller-blindness experiment separately scores achieved
angles with the oracle; it does not consume surrogate predictions (§14.3).

### 8.2 Installed stack

Versions are what is installed at this audit, not the declared semver range. "Available" is the latest published release on 13 September 2026.

**Frontend** — `frontend/package.json`

| Package | Declared | Installed | Available | Note |
| ------- | -------- | --------- | --------- | ---- |
| next | `^15.5.23` | **15.5.23** | 16.3.5 | One major behind |
| react / react-dom | `^19.0.0` | **19.2.6** | 19.3.0 | Current major |
| typescript | `5.8.3` (pinned) | **5.8.3** | 7.0.2 | Majors behind; pinned deliberately |
| tailwindcss | `^3.4.15` | **3.4.19** | 4.3.3 | One major behind; v4 changes the config model |
| three | `^0.185.1` | **0.185.1** | 0.186.0 | One minor behind |
| recharts | `^3.1.0` | **3.8.1** | 3.10.1 | Current major |
| framer-motion | `^11.3.19` | **11.18.2** | 13.2.0 | Two majors behind |
| lucide-react | `^0.525.0` | 0.525.x | 1.45.0 | Now past 1.0 |
| vitest | `^2.1.8` | **2.1.9** | 5.0.0 | Three majors behind |
| eslint | `^9` | 9.x | 10.10.0 | One major behind |
| jsdom | `^25.0.1` | 25.x | 30.0.1 | Majors behind |
| @types/node | `^20.19.9` | 20.x | 22.20.2 | **Mismatched with the Node 25.9.0 runtime** |
| Radix UI primitives | `^1.x`/`^2.x` | as declared | — | 10 packages |

**Backend** — `backend/pyproject.toml`

| Package | Declared | Installed | Available | Note |
| ------- | -------- | --------- | --------- | ---- |
| python | `>=3.10` | **3.13.9** | — | Declaration understates the runtime by three minors |
| fastapi | `>=0.115,<1` | **0.141.1** | 0.141.1 | Current |
| starlette | transitive | **1.6.0** | — | Past 1.0 |
| pydantic | `>=2.12,<3` | **2.13.4** | 2.13.5 | Minimum supports omission of unavailable daylight fields via `exclude_if` |
| uvicorn[standard] | `>=0.30,<1` | **0.52.1** | 0.52.4 | Current |
| numpy | `>=1.26,<3` | **2.5.2** | 2.5.3 | Current |
| pandas | `>=2.2,<3` | **2.3.3** | 3.0.5 | One major behind; the `<3` pin is deliberate |
| pvlib | `>=0.11,<1` | **0.15.2** | 0.15.2 | Current — the load-bearing physics dependency |
| pytest | `>=8,<9` | **8.4.2** | 9.1.1 | One major behind by pin |
| ruff | `>=0.6,<1` | **0.16.2** | 0.16.7 | Current |
| httpx | `>=0.27,<1` | **0.28.1** | 0.28.1 | Current, dev only |
| scipy | `>=1.11,<2` | **1.18.0** | — | Explicit dependency; formerly transitive via pvlib |
| scikit-learn | `>=1.5,<2` | **1.9.1** | — | Daylight surrogate fitting and inference |
| joblib | `>=1.4,<2` | **1.6.0** | — | Local model artifacts, gitignored |
| pyarrow | `>=17,<24` | **23.0.1** | — | Resumable oracle datasets |
| jupyterlab / nbconvert | `>=4,<5` / `>=7,<8` | **4.6.3 / 7.17.1** | — | Dev only; executed training record |
| matplotlib | `>=3.8,<4` | **3.11.2** | — | Dev only; notebook plots, never imported by app code |

**Runtime** — Node 25.9.0, npm 11.12.1, Python 3.13.9, macOS (Darwin 25.5.0) for this audit.

| Layer | Implementation |
| ----- | -------------- |
| Frontend | Next.js App Router, React 19, TypeScript, Tailwind CSS 3, Radix UI, Recharts, three.js, framer-motion |
| API | FastAPI, Pydantic v2, Uvicorn, Starlette |
| Simulation | Python 3.13, NumPy, pandas, pvlib |
| Vision | Roboflow hosted workflow `jias-workspace-tnv49/general-segmentation-api`, COCO RLE mask decode, backend-held API key |
| Weather | Standard-library HTTP clients with process-local TTL cache and per-key locks |
| Tests | pytest (backend), Vitest + Testing Library + jsdom (frontend) |
| Lint/format | Ruff (backend); ESLint + Prettier with the Tailwind plugin (frontend) |
| Local runtime | Make targets or Docker Compose; frontend `:3000`, backend `:8000` |

The API is stateless with respect to runs. Weather responses are cached only in process memory and disappear on restart or differ between workers.

### 8.3 Version-currency decisions

The stack is deliberately behind on four fronts. Each is a decision to record, not drift to fix blindly:

1. **Next 15 → 16 and Tailwind 3 → 4.** Both are breaking upgrades. Tailwind 4 replaces the JS config with CSS-first configuration, and `globals.css` carries roughly 700 lines inside `@layer components` using `@apply`. Do not attempt this alongside the §14.1 lens split.
2. **Vitest 2 → 5.** Three majors, 67 tests, 12 files. Low risk but no current benefit.
3. **TypeScript 5.8.3 is pinned exactly** (no caret) — the only exact pin in the frontend manifest. Keep it until a deliberate upgrade.
4. **pandas pinned `<3` and pytest `<9`.** Intentional ceilings in `pyproject.toml`; pandas 3 is a breaking release and the simulation depends on it via pvlib.
5. **`@types/node ^20` against a Node 25.9.0 runtime** is a genuine mismatch and the cheapest correct fix in this list.

**pvlib 0.15.2 is current, and it is the dependency that matters most** — it supplies solar position, clear-sky irradiance, and Perez transposition, which are the load-bearing physics of every claim in this document.

### 8.4 Planned stack additions

Not installed. Required only by §14.2.

| Package | Available | Purpose |
| ------- | --------- | ------- |
| langgraph | 1.2.11 | AFC state machine, `interrupt()` human-approval band |
| langgraph-checkpoint-sqlite | 3.1.1 | Correction-episode persistence, doubling as the rollback store and audit trail |
| an LLM client (e.g. `langchain-anthropic` 1.7.2 / `anthropic` 1.5.0) | — | The single diagnosis node; read-only tools only |

LangGraph reaching a stable 1.x materially reduces the API-drift risk previously assumed for this work. Pin exact versions regardless and verify the checkpointer import path against the installed release.

## 9. Non-functional requirements and current status

| Requirement               | Current status                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Synthetic reproducibility | Met: identical tested synthetic requests produce identical payloads. External provider data can change over time.                                                                                                  |
| Trust-boundary validation | Met for enum/range limits and IANA timezone; slab history ordering and physical cross-field validity are not checked.                                                                                              |
| Weather resilience        | Met: provider errors and invalid payloads fall back to labelled synthetic data. **The label never reaches the browser.**                                                                                           |
| Vision resilience         | Met: one in-flight inference, 30-second client timeout, retry on the next scheduled scan, expiry past 60 seconds, weather-only refresh on failure.                                                                  |
| Explainability            | Met in the API and Brains lens: primary tick objective contributions, target/final angles, trust/reason, scenario charts and the fixed oracle blindness experiment. Optional Floor probes expose modelled Et/Ev without affecting control.                                                                         |
| Provenance disclosure     | Met: full run disclosure in every lens, explicit amber provider fallback, load-unit scope, synthetic seed and sample freshness.                                                                                                                        |
| Observability             | Basic: request IDs, JSON logs, duration and run summaries; no metrics, tracing backend, dashboards, or alerts. `LOG_FIELDS` is an allowlist that silently drops unlisted fields.                                    |
| Health checking           | Observed status: fast `/api/v1/health` reports configuration, last status and last success for Roboflow, Open-Meteo and MET; unknown before use and reset on process restart.                                                                                                                                 |
| Error recovery            | Basic: component-level loading/error/retry and WebGL fallback; no offline mode or route-level error boundaries.                                                                                                    |
| Accessibility             | Partial: semantic regions, labels, focus rings, native controls, reduced motion, and surface table; zone selection, orbiting, rail resize, and chart interpretation are not fully keyboard/non-visual equivalents. |
| Responsive UI             | Stacked layouts below desktop and fixed multi-column dashboard at `xl`; local daylight checks found no horizontal overflow at 1000 px, without establishing full responsive coverage.                                                                                              |
| Performance               | Synchronous 9,216-zone-tick responses. Daylight benchmark: 1.93 s off, 7.23 s with uncached 5° curves, 2.30 s cached; first model load adds 3.03 s. The proposed ~1 s added latency is unmet; no concurrent load test (§14.3). |
| Production security       | Not met: no auth, authorization, rate limiting, configurable production CORS, TLS termination, or security test suite. CORS is hard-coded to `localhost:3000`.                                                      |
| Deployment readiness      | Local only: images and Compose build, but no health-gated startup, restart policy, locked backend image install, non-root runtime, or production manifest.                                                          |

## 10. Acceptance evidence at this snapshot

| Acceptance criterion                            | Status and evidence                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 — complete repeatable day                   | Met: 144 ticks and identical parsed response content for repeated synthetic requests.                                                                                                                                                                                                                  |
| AC2 — sensor contradiction versus genuine cloud | Met: dead-sensor ticks are rejected and the equivalent heavy-cloud reading is trusted.                                                                                                                                                                                                                 |
| AC3 — meaningful co-optimisation comparison     | Met: automated test requires more than 3× naive daylight compliance, less than 1.3× naive load, and fewer movements for the default comparison. This is a Pareto trade-off, not dominance on every metric.                                                                                             |
| AC4 — movement restraint and fail-safe          | Met: a marginal target is held and power loss yields SAFE at 60° for four ten-minute ticks.                                                                                                                                                                                                            |
| AC5 — spatial control                           | Met: four facades, 64 zone states, and four roof faces are returned; zones can reach different angles.                                                                                                                                                                                                 |
| AC6 — geometry behavior                         | Met for automated equinox/solstice reduction thresholds, overhang row shading, corner coupling, and flat/pitched roof invariants. Exact annual percentage claims in older prose do not have a checked-in reproduction script.                                                                          |
| AC7 — weather modes                             | Met with mocked provider contracts, provenance, arbitrary-site handling, and fallback tests; live-provider contract tests are absent.                                                                                                                                                                  |
| AC8 — slab plan                                 | Met for the 16-zone/24-hour endpoint, synthetic-fit recovery, coolest-hour scheduling, and floor enforcement. "No worse than the fixed timer" is tested only in one constructed one-zone mild-day case; measured-history fitting is not directly tested.                                               |
| AC9 — baseline honesty gate                     | Met: no/short/fixed/compensated logs are distinguished and only fixed schedules allow the comparison flag.                                                                                                                                                                                             |
| AC10 — browser workflow                         | Partially met: component tests cover landing routing, dashboard loading/error/retry, tier order/storage/playback, chart reveal, geometry helpers, solar exposure, cloud canopy, building comparison, zone sensors, controller calibration, slab grid, draft controls, and claim logic. Full slab auto-fetch, response rendering, API failure, charts, and JSON export are not component-tested. |
| AC11 — cloud vision                             | Met for mask decode, confidence union, overlap counting, freshness expiry, and controller hand-off. Coverage accuracy against calibrated sky measurement is untested and out of scope.                                                                                                                 |
| AC12 — daylight model evidence                  | Met within the synthetic oracle scope: physical invariants, feature parity, linear/scalar baselines, structural holdout, untouched orientation transfer and three reproducible training runs. Threshold errors remain material (§14.3). |
| AC13 — daylight display and fallback            | Met locally: optional Floor readings/colours and Brains oracle table; unchanged legacy response values, repeatability in both flag states, null night values and missing-model fallback. No control or field-validation claim. |

**Verification for the daylight/dashboard delivery on 13 September 2026** (implementation
through `c3618d6`; documentation checkpoint `ac942da`). These are completed checks from
that delivery and batch-commit verification, not a new full-suite run for this PRD edit.

| Check                                         | Result                                                          |
| --------------------------------------------- | --------------------------------------------------------------- |
| Backend tests                                 | **112 passed** across 9 files                                  |
| Backend Ruff                                  | Passed across app, tests, scripts and notebook (`E,F,I,UP`)    |
| Frontend tests                                | **82 passed** across 16 files; affected tests rechecked after final UI edits |
| Frontend ESLint                               | Earlier v0.4 audit passed; no new whole-tree ESLint result claimed for this delivery |
| Next.js production build and TypeScript check | Passed; `/`, `/dashboard`, `/slab` prerendered as static        |
| Local Chromium / WebGL checks                 | Seat count matches API (43/70 west seats); selected floor, night, Brains and real missing-model response checked; no page errors or overflow at 1000 px |
| Training reproducibility                     | Three clean-kernel runs; 21 ledger evaluations with identical metrics, parameters and dataset fingerprint |
| Serving parity and latency                   | Real artifacts; off/on legacy-field parity, identical repeats, missing-model fallback and 1°/5° timing/interpolation comparison |

No coverage threshold is configured. The local browser/WebGL checks above are not a
checked-in continuous browser suite. Live-provider contract, container-startup, concurrent
load, accessibility-audit, security, hardware and field-calibration suites remain absent.
Frontend component tests emit expected jsdom WebGL and Recharts layout warnings. Appendix A
defaults remain manually maintained; the daylight reports have executable generation paths
and the bundled oracle comparison is checked against its source JSON.

## 11. Known gaps and risks

### 11.1 Priority 0 — blocks pilot or production claims

- **No real control path:** JSON export is not BMS/plant integration, and no command acknowledgement or approval exists.
- **No field calibration:** facade lux/load constants (including `WALL_LUX_PER_IRRADIANCE = 1.7`), daylight room reflectances (wall 0.5, floor 0.2, ceiling 0.8), full-wall aperture, room geometry, fixed 110 lm/W efficacy, actuator behavior, humidity proxy, COP, and safety thresholds remain assumptions. Real slab observations can fit only capacity and surface UA; baseline-night logs only classify incumbent behavior.
- **Unchecked slab fit:** coefficient sign is the only fit-acceptance gate. Reported R² does not gate use, and positive fitted capacity/UA are not plausibility-bounded before planning.
- **Savings flags are advisory:** `applicable=false` and `claim_allowed=false` do not suppress the returned slab schedule or savings fields. Generated demonstration baseline logs can also set `claim_allowed=true`; that proves the audit classifier path, not a real baseline.
- **Simplified slab scope:** the selected facade's 16 zones represent the configured 12,000 m² floor area. Other facades, roof/conduction, detailed ventilation and latent loads, pumps, hydronics, tariffs, and measured humidity are omitted.
- **Safety is uncommissioned:** combined power loss and critical wind resolves to the 60° power-loss state because power loss has precedence. The physically safe state and passive mechanism require engineering validation.
- **No production trust boundary:** there is no identity, role, audit, rate, tenancy, persistence, or deployment security layer.
- **Health is observational, not an active readiness probe:** `/api/v1/health` includes provider outcomes and last success, but top-level `ok` only reports backend liveness. Observations can be stale and reset on restart.

### 11.2 Priority 1 — affects correctness or evidence integrity

- **Surrogate threshold errors:** the direct-model transfer check misses 358/9,848 oracle Ev exceedances; one missed value is 2,264.89 lux. Only 79.60% of predicted Et in-band rows are actually in band. These errors block treating the display as a comfort guarantee or using aggregate MAE as the sole control-readiness gate (§14.3.2).
- **Limited surrogate validation:** one synthetic site/room configuration, seed 42 and three transfer days do not establish performance under measured conditions or changed geometry. Inference adds 5.29 s uncached after coarsening; model files total about 316 MiB compressed (§14.3).
- **Provenance disclosure resolved by §14.1:** the shared strip and Brains objective panel now render all five formerly omitted fields; fallback is visually distinct and its notice is preserved verbatim.
- **Mixed-run dashboard state:** rerunning the focused scenario after changing settings does not invalidate stored results for the other tiers, so visible comparisons can combine different inputs.
- **Non-Malaysia chart time:** chart labels are hard-coded to `Asia/Kuala_Lumpur` even when another site/timezone is selected; the stage inspector uses the requested timezone correctly.
- **Measured slab input is API-only:** the UI cannot upload or enter slab observation history or real baseline nights; it exposes only generated demonstration logs.
- **Unchecked API responses:** the frontend casts successful JSON responses to TypeScript types without runtime schema validation, a request timeout, or automatic retry; malformed payloads can fail during rendering.
- **Slab input coupling:** the planner does not accept or forward facade controller weights, occupancy scale, wind override, or power state; its internal twin always runs `overview` with those facade defaults.
- **Slab-history units:** observation `charge_w` is treated as W/m², while baseline-night charge and next-day cooling are building kWh; the API field names do not encode that distinction.
- **MET/site mismatch:** `met_anchored` always uses Kuala Lumpur `Tn079`, even when another site is requested, and combines that Kuala Lumpur anchor with the selected site's solar geometry.
- **Slab date approximation:** a null date uses the backend server's local "tomorrow," not the selected site timezone. The planner also borrows 22:00–23:00 weather from the planned day instead of fetching the preceding day.
- **Large synchronous response:** a full simulation calculates all controllers and returns every zone for every tick in one request, with no job control, pagination, quota, or load target.
- **Partial accessibility:** no keyboard/non-visual equivalent exists for zone-level 3D inspection, chart data, or rail resizing.
- **Vision pipeline is sample-dependent:** the bundled clip is an all-sky view; coverage on a differently framed or obstructed camera is unvalidated.

### 11.3 Priority 2 — copy, documentation, and edge cases

- The dashboard control hint says only the primary wall carries louvres, while the backend and 3D view run controllers and louvres on all four walls; only headline metrics are primary-only.
- The FastAPI description says all inputs are synthetic despite Open-Meteo forecast/reanalysis and Roboflow vision support.
- The slab UI can say "Thermal-mass building confirmed" when the capacity came from assumed constants and synthetic recovery; "model assumption passes O1" would be accurate.
- "Export for the plant controller" currently means download a JSON file only.
- The landing-page decision loop is a hard-coded illustrative preview, not live simulation output; it is not explicitly labelled as illustrative.
- Open-Meteo parsing requires at least 24 matching hourly rows and takes the first 24, while the simulation always emits 144 ticks. A 23-hour daylight-saving day falls back; a 25-hour day is truncated.
- Process-local weather caches are lost on restart and duplicated across workers.
- A dashboard wind override still receives seeded Gaussian noise (σ = 0.25 m/s), so selecting 15 m/s does not force every tick into critical-wind mode.
- **Product version strings still read `0.1.0`** in FastAPI and both package manifests while this PRD is v0.4.
- **`README.md:127` still describes this document as v0.2.** Update it alongside this file.
- 34 `data-tour` attributes remain on live components with no consumer. They are deliberately retained as anchors for the §14.1 lens navigation; if §14.1 is abandoned, delete them.

**Resolved since v0.3:** the dead `GuidedTour.tsx` module (608 lines, zero imports, 5 of 17 targets stale) and its 63 lines of `.tour-*` CSS were deleted. Stale README and design-doc text promising an 18-step tutorial should be removed with it.

## 12. Release classification and next decisions

| Readiness level                      | Status                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Local software demonstration         | **Ready** at this snapshot                                                                               |
| Daylight observation demo            | **Ready with caveats** within the evaluated synthetic geometry; keep the flag opt-in and decisions unchanged |
| Daylight-driven controller          | **Not validated**; threshold, independent-physics and controller-intervention checks remain open (§14.3.4) |
| Controlled pilot preparation         | **Not ready** until measured inputs, calibration, safety design, and integration requirements are agreed |
| Live building operation              | **Not ready**                                                                                            |
| Measured energy/carbon/payback claim | **Not supported**                                                                                        |

The next product decisions, before more feature work, are:

1. Choose the positioning: retrofit value on upright facades, with the Diamond as a passive-design control, or active value on the Diamond itself.
2. Choose the pilot facade, physical zone mapping, available sensors, actuator interface, and safe mechanical states.
3. Define measured acceptance thresholds for daylight, relative/absolute load, actuator movement, sensor-fault latency, condensation margin, and plant comfort.
4. Decide which incumbent slab behavior is the real baseline and collect at least the slab/zone/charge and next-day cooling logs required to identify it.
5. Decide whether the next deliverable is still a judge-facing proof or a secured operator workflow; the latter requires persistence, approvals, auditability, and integration before UI expansion.
6. Decide whether the AFC workstream (§14.2) is in scope, since it is the first item that deliberately breaks a §4.3 non-goal.

## 13. Traceability map

| Area                       | Primary source                                                                                | Main verification                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| API and logging            | `backend/app/main.py`, `backend/app/schemas.py`, `backend/app/logging_config.py`              | `backend/tests/test_api.py`, `backend/tests/test_logging.py`       |
| Weather and environment    | `backend/app/weather.py`, `backend/app/domain/environment.py`                                 | `backend/tests/test_weather.py`, `backend/tests/test_realworld.py` |
| Facade controller          | `backend/app/domain/{validation,brain,safety,controller,thermal}.py`                          | `backend/tests/test_engine.py`, `backend/tests/test_api.py`        |
| Geometry and zones         | `backend/app/domain/facade.py`, `backend/app/domain/scenarios.py`                             | `backend/tests/test_realworld.py`                                  |
| Optics                     | `backend/app/domain/optics.py`                                                                | `backend/tests/test_optics.py`                                     |
| Slab planner               | `backend/app/domain/slab.py`                                                                  | `backend/tests/test_slab.py`                                       |
| Cloud vision               | `backend/app/vision.py`, `frontend/.../CloudVisionPanel.tsx`, `cloudCanopy.ts`                | `backend/tests/test_vision.py`, `CloudVisionPanel.test.tsx`, `cloudCanopy.test.ts` |
| Product overview           | `frontend/src/components/neuroskin/NeuroSkinLanding.tsx`                                      | `NeuroSkinLanding.test.tsx`                                        |
| Facade dashboard           | `NeuroSkinDashboard.tsx`, `TierAnalysis.tsx`, `SimulationControls.tsx`, `ControllerPanel.tsx` | `NeuroSkinDashboard.test.tsx`, `ControllerPanel.test.tsx`          |
| 3D and charts              | `BuildingHeatmap.tsx`, `SimulationCharts.tsx`, `solarExposure.ts`, `buildingComparison.ts`    | `BuildingHeatmap.zones.test.ts`, `SimulationCharts.reveal.test.ts`, `solarExposure.test.ts`, `buildingComparison.test.ts` |
| Zone inspection            | `ZoneSensorPanel.tsx`, `louvreAssembly.ts`                                                    | `ZoneSensorPanel.test.tsx`, `louvreAssembly.test.ts`               |
| Slab UI                    | `PredictiveSlab.tsx`                                                                          | `PredictiveSlab.zones.test.ts`                                     |
| Current synthetic evidence | `docs/appendix/neuroskin-synthetic-results.md`                                                | Seeded requests and audit dataset in `docs/appendix/`              |
| Daylight oracle and training | `backend/app/domain/daylight/`, `backend/scripts/generate_daylight_dataset.py`, `backend/notebooks/daylight_surrogate_training.ipynb` | `backend/tests/test_daylight.py`, `docs/appendix/daylight-training-results.md`, `daylight-runs.jsonl` |
| Daylight observations and evidence | `DaylightPanel.tsx`, `bandPlan.ts`, `backend/scripts/ablation_glare_blindness.py`, `backend/scripts/benchmark_daylight.py` | `DaylightPanel.test.tsx`, API parity checks, `docs/appendix/daylight-threshold-results.json` and serving/oracle reports |

## 14. Implemented model development and planned AFC workstream

The dashboard lens split (§14.1) and daylight surrogate development (§14.3) are implemented
at this snapshot. The AFC workstream (§14.2) remains planned and unbuilt.

### 14.1 Dashboard lens split and provenance disclosure

Plan: [`.claude/PRPs/plans/dashboard-lens-split-and-provenance.plan.md`](../.claude/PRPs/plans/dashboard-lens-split-and-provenance.plan.md) — Large, 13 files, 10 tasks.

Implemented: four lenses (`building`, `floor`, `brains`, `feeds`) selected by `?view=` over one shared run, full provenance disclosure, primary-tick objective contributions, and a furnished cutaway/top-down floor camera in the existing scene. Health reports cached adapter observations without outbound probes. The corresponding journeys, browser explainability/provenance status, and operator limitations are reflected above.

### 14.2 LangGraph agentic automatic fault correction

Plan: [`.claude/PRPs/plans/langgraph-agentic-afc.plan.md`](../.claude/PRPs/plans/langgraph-agentic-afc.plan.md) — XL, 14 files, 8 tasks, with a deliberate no-new-dependency boundary after task 4.

Adds the back half of an AFC loop to the existing front half. `validation.py` already detects, `brain.py` already decides, `safety.py` already gates; missing are a calibrated confidence score, a persisted prior state, a verification objective, and a rollback.

**Architecture constraint:** the LLM is not in the correction path. It ranks diagnosis hypotheses over read-only tools and speaks to the operator. The confidence number, the safety veto, the write authorisation, the verification test, and the rollback are deterministic arithmetic. Only read-only tools are bound to the model.

Consequences for this document if it ships:

- §4.3 "no database" must become "no database beyond AFC correction episodes".
- §3.2 gains an AFC job to be done.
- §4.2 gains a guardrail that corrections are simulated and uncommissioned; `E_before`/`E_after` are relative-index objectives and never kWh.
- §8.4 dependencies move into §8.2.
- G2 reproducibility must be re-verified after every AFC task — the AFC path must not perturb the deterministic simulation.

`inject_sensor_fault()` (`environment.py:218`) plus G2 determinism provides reproducible labelled fault ground truth, which a real-building AFC study cannot offer. That is the strongest methodological asset available for this workstream.

### 14.3 Daylight surrogate development and assessment — implemented

Plan: [daylight surrogate and impact demo](../.claude/PRPs/plans/daylight-surrogate-and-impact-demo.plan.md).
The current product decision is to retain Extra Trees for the optional observe-only demo.
The training result is a promising approximation of the oracle; the threshold and physical
validation results do not yet support using it to drive the controller.

#### 14.3.1 Training design and generalisation

The independent empty-room radiosity oracle uses existing louvre optics as its boundary
condition. Its multi-bounce interior calculation produces Et and Ev targets; it does not
learn labels from the incumbent lux scalar. Furniture positions identify probes but
furniture occlusion is absent. Room/material assumptions remain those in Appendix A.

The full dataset contains 192,829 probe/day/tick/angle rows: 12 training-pool days on west
and south, plus three east/north transfer days. Features encode facade-relative direction,
local probe geometry, incident flux and optical transmission, without absolute compass
azimuth. The two target models use Extra Trees, selected against Random Forest and linear
regression; the existing scalar is also scored for Et.

Five-fold tuning groups by training day. The structural holdout contains both unseen days
and unseen zones; cross-strata are excluded and counted. Model-family selection uses its
MAE, so this holdout is a validation set. East/north transfer never enters fitting or model
selection. Reported values below are mean absolute prediction errors against the oracle,
in lux; they are not percentage accuracy or measured room errors.

| Selected model | Shuffled MAE | Unseen-day/zone MAE | East/north transfer MAE |
| --- | ---: | ---: | ---: |
| Ev — Extra Trees | 18.13 | 106.98 | 141.35 |
| Et — Extra Trees | 28.57 | 105.89 | 94.60 |

The linear holdout errors are 563.62 lux Ev and 442.78 lux Et. Extra Trees improves those
errors by 81.02% and 76.08%, respectively. The incumbent Et scalar has 1,131.56 lux holdout
MAE, reduced by 90.64%. Extra Trees is the best of the tested candidates, not proof of a
universally optimal model. Full comparisons, R², MSE and sample counts are in the
[training report](appendix/daylight-training-results.md).

The shuffled-to-structural error increase is 5.90× for Ev and 3.71× for Et; the harder
results are the meaningful generalisation headline. Both targets pass the preregistered
transfer tolerance of `1.5 × holdout MAE + 50 lux`, supporting the four-orientation scope
within this synthetic configuration. Passing that tolerance is not a control-safety gate.

The [executed notebook](../backend/notebooks/daylight_surrogate_training.ipynb) and
[append-only ledger](appendix/daylight-runs.jsonl) contain three clean-kernel seed-42 runs,
with seven target/model evaluations per run and matching metrics, parameters and dataset
fingerprint. These repetitions demonstrate reproducibility; they do not add independent
validation days, sites or split seeds. The diagnostic plots preserve heavy-tail errors.

#### 14.3.2 Threshold assessment and remaining model weaknesses

The [threshold evidence](appendix/daylight-threshold-results.json) records a post-training
assessment of the saved models applied directly to the held-out feature rows, with no
refitting or threshold adjustment. The transfer dates are 20 March, 21 June and 21 December
2026. Each observation is a probe/time/angle sample; correlated angle samples are not
independent occupants or occupied hours. Ev evaluates seats only. Et evaluates horizontal
work-plane estimates at both seat and desk probe positions.

| Diagnostic | Structural validation | East/north transfer |
| --- | ---: | ---: |
| Ev evaluated rows | 6,656 | 30,030 |
| Ev exceedance recall — fraction of oracle Ev > 1000 detected | 98.10% | 96.36% |
| Missed Ev exceedances / oracle exceedances | 37 / 1,952 | 358 / 9,848 |
| Ev exceedance precision — fraction of predicted exceedances confirmed | 97.26% | 91.14% |
| Highest oracle Ev among missed exceedances | 1,096.69 lux | 2,264.89 lux |
| Et evaluated rows | 8,320 | 39,039 |
| Et in-band precision — fraction of predicted [300, 500] confirmed | 86.03% | 79.60% |
| Et in-band recall — fraction of oracle [300, 500] detected | 84.67% | 79.19% |

For transfer, the model misses 3.64% of oracle eye-cap exceedances. The 2,264.89 lux missed
sample shows that the misses are not confined to values just above the cap. Approximately
one in five Et predictions labelled in-band is outside the oracle band. Aggregate R² or
MAE alone therefore cannot establish the reliability of those comfort labels.

Rare numerical errors also remain substantial: structural-validation 95th-percentile
absolute errors are 398.53 lux Ev and 320.02 lux Et; maxima are 4,437.28 and 7,832.59 lux.
These are empirical error summaries, not calibrated prediction intervals. The threshold
assessment excludes runtime interpolation; the separate serving benchmark below measures
sensitivity to the coarser grid. Neither assessment compares against measured daylight.

#### 14.3.3 Serving, display and independent controller evidence

The optional Floor lens colours each registered chair cushion by Ev and each desk by Et,
with numeric readings and a per-side/per-floor-group count. Coordinates include nested
furnishing rotations and match the oracle's facade-local frame. The geometry remains
labelled illustrative. Night/low-sun ticks (elevation ≤ 8°) have null illuminance and grey
seats; missing/unreadable/incompatible artifacts or missing scikit-learn hide the overlay
and show “Daylight model not loaded for this run.”
Serving is limited to the evaluated Putrajaya site and 115° facade geometry, across all
four orientations because both transfer checks held. Other geometries remain unscored.

`ComfortState` carries optional per-probe readings plus zone summaries (mean Et, maximum
seat Ev). New fields are omitted when unavailable so the disabled model preserves the
pre-change response bytes. The Brains comparison is the fixed 12-day oracle experiment,
not a live surrogate experiment. Its bundled JSON is regenerated by `make daylight-ablate`.
No Et/Ev value enters the controller objective, glare screen or movement logic.

The [serving benchmark](appendix/daylight-inference-results.md) measures a 144-tick,
64-zone run including serialization: about 1.93 s disabled, 7.23 s with uncached 5° curves,
and 2.30 s with matching cached curves. Initial model load adds about 3.03 s. The requested
~1 s uncached overhead was not reached after coarsening; the feature remains opt-in.
Coarsening added Et/Ev MAE 1.91/0.82 lux against 1° predictions, with 6 changed cap
classifications in 18,200 daylight seat-ticks. Rare errors are larger; this is a demo
screening model, not a field-calibrated comfort guarantee. The oracle report is unaffected
by surrogate or interpolation errors. Structured logs include `daylight_model`,
`ev_exceedance_ticks` and `et_in_band_ticks` (any compliant probe at an occupied tick).

The independent oracle experiment finds any-seat Ev exceedance during 95.04% of eligible
occupied daylight building ticks for NeuroSkin, versus 94.15% for naive. The corresponding
seat-hour exceedance is 38.35% versus 14.72%. These denominators differ from the training
samples above. The [oracle report](appendix/daylight-blindness-results.md) states the
geometry, seed and population. It identifies a signal missing from the shipped decisions;
it does not show that adding Ev would prevent those exposures.

#### 14.3.4 Conditions before using daylight predictions for control

The following work is required before changing the current observe-only product decision;
it is not implemented or validated by this release:

1. Define acceptable missed-exceedance and false-comfort rates before another model or
   controller comparison. Evaluate Ev near and well above 1,000 lux, Et around both band
   boundaries, and the deployed continuous-angle prediction path.
2. Evaluate additional independently held-out days, split seeds and intended operating
   conditions. Changed room/material geometry or a new site requires new applicability
   evidence; the current transfer result only tests orientation within the fixed setup.
3. Validate the oracle against an independent higher-fidelity lighting reference, then
   calibrate and assess predictions against measured illuminance before any field claim.
4. Compare an Ev-aware controller with the shipped and naive controllers on identical
   independent scenarios, including movement/load trade-offs and mechanical safety.
   Demonstrate that the intervention improves the intended outcome before enabling it.
5. Reassess memory and uncached latency before enabling the model by default or serving
   concurrent users. The current compressed artifacts total about 316 MiB and the added
   latency target remains unmet.

## Appendix A — Key defaults

### Facade simulation

| Parameter                 |                                                    Default |
| ------------------------- | ---------------------------------------------------------: |
| Date                      |                                              21 March 2026 |
| Resolution                |                                     10 minutes / 144 ticks |
| Site                      |                    2.9220 N, 101.6885 E, Asia/Kuala_Lumpur |
| Seed                      |                                                         42 |
| Primary facade            |                                                       West |
| Facade tilt               |                         115° pvlib tilt = 25° outward lean |
| Floors                    |                                        7, 3.6 m per storey |
| Roof pitch                |                                                        10° |
| Roof overhang             |                                                      1.6 m |
| Zone grid                 |                           4×4 per wall (`W1`…`W16`) |
| Candidate angles          |          0°–60°, 5° search brackets, continuous final angle |
| Weights                   |      Thermal 0.45, lux 0.45, movement 0.05, wind risk 0.05 |
| Lux comfort band          |                                                300–700 lux |
| Daylight evaluation floor |                          200 W/m² incident on primary wall |
| Glazing SHGC              |                                                       0.40 |
| Glare screen              |                                            25 W/m² direct |
| Actuator speed            |                                                  1.2 °/min |
| Movement threshold        |                                                     0.0002 |
| Critical wind             |                                                     15 m/s |
| Power-loss state          |                                            60° fail-shaded |
| Powered wind/rain state   |                                               0° retracted |
| Min solar elevation       |                                 8° for plausibility gating |
| Cloud attenuation         |                                                       0.72 |

> v0.3 recorded the weights as "Thermal 0.45, daylight 0.35, movement 0.15, wind risk 0.05". That was wrong. The code default is in `backend/app/domain/types.py:232-235` and is mirrored by `DEFAULT_REQUEST` in `NeuroSkinDashboard.tsx`.

### Occupant-plane daylight

These defaults are separate from the incumbent's 300–700 lux band:

| Daylight parameter | Default |
| --- | ---: |
| Ev comfort reference / cap | 500 / 1000 lux |
| Et task band | 300–500 lux |
| Model enabled | false; opt in with `daylight_model_enabled` or the Modelled seat daylight checkbox, then run |
| Serving angle grid | 5° samples, whole-degree curves and continuous-angle interpolation |
| Room width / depth / height | 6.4 / 6.4 / 3.6 m, illustrative |
| Eye / work-plane height | 1.2 / 0.75 m |
| Wall / floor / ceiling reflectance | 0.5 / 0.2 / 0.8, assumed |
| Luminous efficacy | 110 lm/W, assumed |
| Oracle | 4 diffuse passes, 4×4 patches per surface |

Training metrics, threshold assessment and control-readiness conditions are in §14.3 and
[daylight-training-results.md](appendix/daylight-training-results.md). The executed
notebook and append-only JSONL history record dataset/code fingerprints and seed.

### Slab planner

| Parameter                 |                                           Default |
| ------------------------- | ------------------------------------------------: |
| Planned date              | Tomorrow according to backend server when omitted |
| Environment source        |                             Open-Meteo in browser |
| Zones                     |                        Selected facade's 4×4 grid |
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

### Cloud vision

| Parameter          |                                                  Default |
| ------------------ | -------------------------------------------------------: |
| Workflow           | `jias-workspace-tnv49/general-segmentation-api`, `classes=cloud` |
| Confidence floor   |                                                     0.50 |
| Sample interval    |                          15 s (5 / 15 / 30 / 60 options) |
| Playback rate      |                                      0.2× of source clip |
| Sample expiry      |                                                     60 s |
| Client timeout     |                                                     30 s |
| Concurrency        |                                  One inference in flight |
| Credential         |    `ROBOFLOW_API_KEY`, backend only, never `NEXT_PUBLIC_` |
