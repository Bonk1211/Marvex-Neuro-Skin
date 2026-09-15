# NeuroSkin demo review

Reviewed against [product PRD v1.0](neuroskin_product_prd.md), 16 September 2026.
This document records the current simulation scope, a judge demonstration, and the
remaining target-release gates. The current simulation demo has been reviewed in code,
tests and the browser.
Target-release capabilities remain explicitly marked partial or planned below.

## What this release demonstrates

**An interactive facade twin with independent simulated zones, solar/cloud sensor checks
and modelled seat daylight, providing the foundation for verified automatic fault correction.**

- One building, four lenses, one selected timeline tick.
- Four facades × sixteen logical zones: **64 independent simulated zone states**.
- Layer 1: global solar/cloud plausibility, fresh usable vision, local finite/range checks.
- Layer 2: incumbent deterministic control, with **observe-only** Extra Trees Et/Ev.
- Layer 3: a **planned** correction workflow, visibly separate from executed control.
- The radiant-slab planner is a supporting simulation application, not a fourth selling point.

Local in-range fouling can still pass validation. There is no persistent correction
episode, calibrated automatic authorisation, independently verified recovery, physical
sensor/actuator integration or measured facade energy/comfort guarantee.

## Six-minute judge story

Use the deterministic baseline: 21 March 2026, seed 42, Synthetic, Putrajaya,
115° facade, 3 m/s wind, power on. Restore it after experiments. Provider feeds and
optional models can be unavailable; their unavailable states are part of the product.

| Stop | Action | Say | What the judge can verify |
| --- | --- | --- | --- |
| **1. See** · landing → Building | Open the twin. Play, pause, scrub morning to afternoon, select a facade and roof. | “The twin shows exposure and action on one simulation timeline.” | Sun position, facade/roof exposure and louvre angle change together. Sources and relative-load units remain visible. |
| **2. Localise** · Floor | Select west W2 at 16:00 (tick 96); compare another zone. | “Each facade has sixteen local sensor pairs and independent actuator histories, under one shared policy.” | Different legitimate local readings/angles; stable zone IDs and selected floor band. The floor plan and people are illustrative. |
| **3. Inspect** · Floor → Brains | Keep W2 and the same tick; inspect raw input, admitted irradiance, open-path lux, target/final and objective. | “This is this zone's evidence and decision.” | Brains uses W2's payload, not the primary controller's objective. Local checks are labelled finite/range. Sources can differ when a closed optical path requires model daylight. |
| **4. Inject** · Floor | Set W2 to 900 W/m² and 1,200 lx, apply this sensor, inspect Brains, then clear it. | “This injected input changes this zone. It does not prove that all sensor faults are detected.” | Override source and intended tick; W2's requested/achieved angle; other sensor histories remain unchanged in the independence regression. Zero is allowed as real shade. |
| **5. Predict and supervise** · Floor → Brains | Load Et/Ev if available. Inspect a seat and a desk, then show the third layer. | “Extra Trees predicts illustrative daylight; those predictions do not choose the angle. Verification and rollback are the next release.” | Mean Et, highest seat Ev, unbounded numeric readings and cap colouring; grey/unavailable night estimates; static planned detect-to-verify workflow and retain/rollback/escalate outcomes. |
| **6. Trust the boundaries** · Building → Brains → Feeds | In Building, run the sensor/optimisation/safety tests. In Brains, select an event; then open Feeds. | “The examples demonstrate current deterministic checks and safety. Here are the source, freshness and fallback conditions.” | Global dead-pyranometer rejection differs from genuine cloud; naive comparison has declared scope; power/wind/rain safety is independent of optimisation; missing vision is unavailable evidence. |

Optional close: open **Slab charging**, generate a modelled schedule, inspect one zone and
download the JSON plan. It demonstrates forecast-based planning and baseline auditing,
not a connection to a real plant. Synthetic sample logs do not establish measured savings.

## Complete current-feature checklist

Checked items were reviewed in code and covered by automated tests or browser checks.
The validation record distinguishes real-API browser checks, replayed responses and
controlled unavailable-provider tests; no external provider availability is asserted.

### Landing and navigation

- [x] The three selling points are twin, independent 4×4 zones and three-layer brain.
- [x] The illustration identifies 64 logical zones and illustrative states.
- [x] Layer 1 is partial, Layer 2 observe-only and Layer 3 planned.
- [x] Landing links open Building, Floor, Brains and Feeds; `/slab` stays supporting.
- [x] Lens changes preserve an active run, selected tick and relevant zone; deep links work.
- [x] Loading, request error/retry and unknown-lens fallback remain usable.

### Building

- [x] Orbit/inspect the building, facade and roof; play/pause/scrub the sun timeline.
- [x] Distinguish the selected wall/roof, simulated angle, mode and source-labelled readings.
- [x] Compare controlled and hardware-removed buildings under the same geometry/weather;
      the hardware-removed view does not invent controller or actuator readings.
- [x] Understand that headline naive comparison metrics concern the **primary reporting
      facade**, whereas the fixed offline oracle study has its own building-wide scope.
- [x] Select date, synthetic/MET/Open-Meteo source, supported site preset, cloud profile,
      primary reporting facade, tilted/upright geometry and occupancy.
- [x] Adjust wind, power, objective weights, direct-sun screening, glazing SHGC, actuator
      speed and seed; apply deliberately and reset. Formulas stay attached to their controls.
- [x] Applied evidence uses the applied weights, including after revisiting cached tests;
      edited drafts do not silently relabel an earlier result.
- [x] Wind at 15 m/s and rain choose 0°; loss of power takes precedence at 60° in simulation.
- [x] Ordinary travel is rate-limited; a mechanical safety pose is not promised to follow
      the ordinary rate limit or a real commissioned mechanism.

### Floor

- [x] Switch facade side and floor band; show all levels; use one clear local-zone selector.
- [x] Grid order matches the spatial view: upper row first, columns left to right.
- [x] Inspect raw simulated/injected irradiance and illuminance, trust, reason,
      requested angle and simulated achieved angle.
- [x] Inspect incumbent indoor lux, transmitted irradiance, solar heat gain and direct-sun
      screening. “Within screening limit” is not a DGP or glare-free guarantee.
- [x] Apply/clear one sensor override at the selected tick without applying unrelated
      unsaved settings. Native validation rejects invalid ranges and the API validates again.
- [x] Load optional Et/Ev; inspect seat/desk values and scoped aggregate readings. Check
      night, missing artifact and unsupported site/geometry states.
- [x] Bright values retain their numeric magnitude when the colour scale saturates.
- [x] Mock people remain visibly scripted; occupancy is shared synthetic context, not
      cloud-camera detection. Furniture, rooms, HVAC routes and floor bands are illustrative.

### Brains

- [x] Choose W2 directly or arrive from Floor; the same zone and tick are retained.
- [x] Inspect raw vs admitted irradiance and reconstructed open-path lux with independent
      sensor/model source labels. Missing old payload evidence displays unavailable.
- [x] Inspect the selected zone's cost components, normalised applied weights, target,
      achieved position and movement/safety reason. Primary-controller mode is explicit.
- [x] Extra Trees Et/Ev is visibly observe-only; the relative thermal proxy is separate.
- [x] Expand evidence/limits and planned authority/verification without confusing them
      with executed recovery. The planned stages are static and have no success animation.
- [x] Run demonstrations and revisit cached results in Building; in Brains,
      inspect their charts and jump to event ticks. These **tests** are distinct from the three brain layers.
- [x] Compare current controlled/naive series; expand the separately labelled fixed oracle
      benchmark. Offline oracle evidence does not update with the current timeline.

### Feeds

- [x] See provider/dataset, fetch timestamp, synthetic notice and fallback reason for the run.
- [x] Distinguish Open-Meteo forecast/reanalysis from building telemetry and MET daily
      context from independently measured ten-minute local sensors.
- [x] Inspect Roboflow, Open-Meteo and MET configuration/last-observed status. Unknown and
      unconfigured are distinct from successful observations; health polling is not a live probe.
- [x] The prerecorded sky feed, captured frame, segmentation/coverage and sample age are
      labelled. It estimates sky cloud, not per-aperture irradiance or occupancy.
- [x] Failed, unusable, stale or future-dated vision cannot become assumed clear sky.
- [x] Vision's admitted cloud percentage matches `tick.cloud`; weather context, if shown
      separately, matches `tick.environment_cloud`.
- [x] Model limits remain available without repeating long explanations in every panel.

### Supporting slab planner

- [x] Open `/slab` and return to the twin. The page identifies a modelled planning application.
- [x] Change target date, sky, slab thickness and sample incumbent-log case as drafts;
      generate the plan deliberately and inspect loading/error states.
- [x] Inspect applicability/capacity, baseline audit, charge, modelled electricity,
      unmet zone-hours and minimum slab-temperature floor.
- [x] Compare 24-hour predictive/fixed-timer temperatures, dew point, charge power,
      air-side trim and forecast load; modelled chart labels remain visible.
- [x] Select among the planner's 16 zones; inspect target, charge hours, delivered charge,
      minimum temperature and modelled energy. These are the planner's zones, not a claim
      that the facade twin contains only sixteen zones.
- [x] Inspect fitted/assumed slab response, fit-source note, forecast/fallback and physical
      measurement protocol. Sample fixed/compensated logs remain labelled demonstrations.
- [x] Export JSON containing the applied request and plan. Downloading is not dispatching
      an actuator command; sample evidence is not a verified physical saving.

## Numbered PRD coverage

**Implemented** means available simulation behavior with inspectable code evidence.
**Partial** identifies the shipped baseline and remaining target scope. **Planned** is
intentionally absent from executed control. UI claims refer to the reviewed simulation and reconciled browser results, with
physical integration and future correction gates kept separate.

| ID | Status | Current evidence / remaining scope |
| --- | --- | --- |
| DT-01 | Implemented | Dashboard retains run/tick/zone across lenses; navigation/cached-run tests and real-API Floor/Brains reconciliation. |
| DT-02 | Implemented presentation | Shared provenance, local simulated/injected source, modelled daylight, provider/fallback disclosure. Physical measured telemetry is absent. |
| DT-03 | Implemented current scope | `run_tick` captures effective inputs; zone API adds `control_input` and `cost_breakdown`; BrainFlow and CostBreakdownPanel use selected-zone state. Raw pair, trust, target, achieved and reason remain available. |
| DT-04 | Implemented current comparisons | Seeded replay, naive series and fault scenarios; fixed oracle is separate. Scenario perturbations must be declared; no proposed recovery replay exists. |
| DT-05 | Implemented | Missing/incompatible/out-of-scope models return unavailable, night is grey/null, numbers stay unclamped. |
| DT-06 | Planned execution; design shown | BrainFlow labels detect/diagnose/score/authorise/snapshot/mitigate/verify and retain/rollback/escalate as planned. No action is implied to have executed. |
| ZONE-01 | Implemented | Stable N/E/S/W1–16 IDs, row/column, raw pairs, trust and separately retained actuator position. |
| ZONE-02 | Implemented current policy | Shared policy uses local aperture POA/optics/roof shading; zero remains valid shade. Full local plausibility belongs to L1-01. |
| ZONE-03 | Partial | `run_scenario` owns the cycle and independent states; persistent correction ownership/episodes are planned. Reference wall controllers supply reporting metrics. |
| ZONE-04 | Implemented override; correction planned | One-zone/one-tick injection and independent RNG preserve unrelated histories. Shared power/wind/rain explain broader action; no correction ledger yet. |
| ZONE-05 | Planned assurance | Geometry accounts for corner daylight; no exposure-aware neighbour fault cross-check exists. These are distinct capabilities. |
| ZONE-06 | Implemented simulation; pilot planned | Angle limits, normal rate/movement constraints and shared safety exist. Bus/power budgets and physical commissioning are unvalidated. |
| L1-01 | Partial | Global solar/cloud contradiction exists; per-aperture cloud/shadow residual checks are planned. |
| L1-02 | Partial | Local finite/range checks and API validation exist. Missing/stale/temporal/in-range-fault detection, calibrated scores and fault-matrix results are planned. |
| L1-03 | Implemented demo | Usable cloud masks and 0–60-second timestamps admitted at a selected tick; unusable observations are null. Prerecorded full-frame estimate is uncalibrated. |
| L1-04 | Partial | Invalid local pair falls back to modelled incident/daylight; global suspect input uses the declared almanac path. Mechanical safety remains available. Comprehensive evidence-insufficient hold/escalation is planned. |
| L1-05 | Partial, evidence improved | Raw pair, trust/reason and actual admitted irradiance/open-lux/source now exposed. Local capture freshness and calibrated uncertainty are not available. |
| L2-01 | Implemented observation | Shared feature contract/artifact dataset/target validation, supported geometry/site/orientations and unavailable behavior. |
| L2-02 | Planned integration | Incumbent lux objective and thermal proxy choose angles; Extra Trees Et/Ev does not enter the objective. Hard safety/optical constraints already exist. |
| L2-03 | Implemented declared baseline | Occupancy is shared synthetic context in the thermal proxy; mock people are labelled. No zone occupancy sensors or preference learning. |
| L2-04 | Partial evidence | Current objective weights, mean Et/max Ev aggregation, offline oracle and threshold evidence exist. Validated control-use uncertainty/aggregation tolerances remain planned. |
| L2-05 | Partial incumbent; target planned | Current candidate/final, local cost and relative load are visible; observed Et/Ev is evaluated at achieved positions. No Et/Ev-driven candidate or supervisory disposition exists. |
| L2-06 | Implemented | Model serving is opt-in and observe-only; unavailable/scope fallback leaves decisions intact. Added inspection fields preserve every pre-existing payload value and ordering. |
| L3-01 | Planned | Persistent zone episodes, stable identity/evidence/prior state/outcome and duplicate/replay idempotency. |
| L3-02 | Planned | Declared isolate/fallback/hold mitigations and maintenance flags; substitution is not physical repair. |
| L3-03 | Planned | Calibrated policy authorisation for monitor/operator-review/bounded automatic modes, independent of LLM confidence. |
| L3-04 | Planned | Snapshot and safe, fresh apply/revert transition guards. |
| L3-05 | Planned | Independent observation window and corrected/uncorrected verification under identical conditions. |
| L3-06 | Planned | Evidence-backed retention, safe rollback and escalation for ambiguous/persistent faults. |
| L3-07 | Planned | Read-only diagnosis tools and deterministic writes/guards; agent outages cannot block safety/fallback/rollback. Existing no-LLM safety is a baseline. |

## Acceptance gates

| Gate | Existing evidence | Open target work |
| --- | --- | --- |
| Twin fidelity | API/component/geometry tests, selected-zone evidence contract | Browser reconciliation passed; physical twin/feedback unvalidated. |
| Zone independence | Exact unrelated-zone equality through a one-zone override; local geometry/state tests | Extend to the future correction path. |
| Input assurance | Clear-sky contradiction vs cloud, local range and shade tests | Predeclared clean/cloud/shadow/fouled/stuck/drift/stale matrix; false positives/negatives and detection delay. |
| Daylight decision quality | Oracle invariants, parity, night/scope/artifact tests and direct-model threshold report | Deployed-angle cap misses/false comfort/tail errors against predeclared control tolerances. |
| Control benefit | Current naive comparison and independent shipped/naive oracle study | Proposed-control intervention on identical independent conditions, occupied seat-hour outcomes, load/movements and trade-off budgets. |
| Recovery quality | Planned workflow presentation only | Verified retention, failed/rolled-back/false interventions, delay and unresolved episodes with denominators. |
| Safety and authorisation | Mechanical precedence and bounded ordinary movement tests | Correction idempotency/authority/transition and diagnosis-outage regression. |
| Reproducibility | Seeded equality, independent streams, observation-only test and legacy-value hash | Future correction/diagnosis replay must preserve recorded decisions. |
| Performance | Existing single-request surrogate benchmark | Current deployed build's end-to-end uncached/cached latency, memory and concurrency; operational cycle budget. |

The approved baseline remains the simulation. Local assurance, deterministic recovery,
daylight-aware control and bounded diagnosis must pass their own gates before enabling
the target-release claim. A physical pilot remains separate.

## Inspectable evidence and validation

### Code and tests

- [Controller and effective inputs](../backend/app/domain/controller.py),
  [zone orchestration](../backend/app/domain/scenarios.py),
  [zone schema](../backend/app/schemas.py),
  [BrainFlow](../frontend/src/components/neuroskin/BrainFlow.tsx),
  [selected objective](../frontend/src/components/neuroskin/CostBreakdownPanel.tsx).
- [API tests](../backend/tests/test_api.py): reproducibility, complete 64-zone records,
  exact override isolation, trust-boundary validation, source fallback and original-payload hash.
- [Engine tests](../backend/tests/test_engine.py): genuine shade, invalid-pair/model fallback,
  closed-path daylight reconstruction, observe-only values and safety precedence.
- [Geometry/zone tests](../backend/tests/test_realworld.py),
  [optics tests](../backend/tests/test_optics.py),
  [daylight tests](../backend/tests/test_daylight.py),
  [vision tests](../backend/tests/test_vision.py).
- [Dashboard tests](../frontend/src/components/neuroskin/NeuroSkinDashboard.test.tsx),
  [zone input tests](../frontend/src/components/neuroskin/ZoneSensorPanel.test.tsx),
  [daylight UI tests](../frontend/src/components/neuroskin/DaylightPanel.test.tsx),
  [provenance tests](../frontend/src/components/neuroskin/ProvenanceStrip.test.tsx),
  [feed tests](../frontend/src/components/neuroskin/FeedsPanel.test.tsx).
- [Slab backend tests](../backend/tests/test_slab.py) and
  [slab UI tests](../frontend/src/components/neuroskin/PredictiveSlab.zones.test.ts):
  model/temperature constraints, baseline audit, 16-zone order and draft/apply behavior.
- Offline evidence: [training results](appendix/daylight-training-results.md),
  [threshold results](appendix/daylight-threshold-results.json),
  [oracle study](appendix/daylight-blindness-results.md),
  [serving benchmark](appendix/daylight-inference-results.md). These are prior fixed studies,
  not live measurements or proof that the planned controller solves the observed misses.

### Reproduce the checks

Run backend commands in `backend/`:

```sh
uv run pytest
uv run ruff check app tests
```

Run frontend commands in `frontend/`:

```sh
npm test
npm run lint
npm run build
```

For exact zone reconciliation, inspect the response to `POST /api/v1/simulations/run`:

```text
ticks[96].facade[orientation == "west"].zones[zone == "W2"]
  sensors.{irradiance, illuminance, source}   raw simulated/injected pair
  control_input.irradiance                  actual admitted W/m²
  control_input.open_lux                    reconstructed/modelled pre-louvre lux
  control_input.{irradiance_source, daylight_source}
  sensor_trusted, reason, mode              validation and movement explanation
  angle_target, angle                      requested and simulated achieved degrees
  cost_breakdown                           local incumbent objective components
  conditions.daylight_probes                optional observe-only Et/Ev
```

For an override use `zone_sensor_overrides.W2 =
{"tick_index":96,"irradiance":900,"illuminance":1200}` with the same baseline request.
Only W2's tick-96 raw pair is injected; its future actuator state can legitimately differ.
Every other zone must retain identical payloads. The existing API regression verifies this.

### Validation record

| Evidence | Recorded result |
| --- | --- |
| Backend formatting/static check for changed files | Ruff: **passed**. |
| Control preservation | Original pre-change payload hash matched after removing only additive `control_input` and local `cost_breakdown`; all pre-existing values/decisions/order preserved. |
| Complete backend suite | `uv run pytest`: **112 passed**, including override isolation, safety, observe-only parity and model scope. |
| Frontend tests | `npm test`: **89 passed** across 16 files; selected-zone evidence, scenario-cache invalidation and cross-lens selection included. |
| Frontend static checks and production build | ESLint, TypeScript and production build passed. Build output was isolated from the running dev server. |
| Real-API Floor/Brains/Feeds browser | All **16 side/floor groups** match returned Et/Ev probes; W2 raw/admitted input and objective match; W2 override/clear, E7 cross-lens selection, primary reset, night/unavailable and zero mock occupants passed. Vision was deliberately stubbed unavailable; the controller/daylight API was real. |
| Responsive browser | 1720px and 1000px live-API checks, plus 390px/1000px replay of that saved API response: no horizontal overflow or page errors. The main visual precedes panels; phone scene controls collapse. |
| Landing and supporting slab browser | Desktop, 390px and 320px layout checks; all 16 slab zones, sample-log rerun, protocol disclosure and downloaded request/plan JSON passed against the real local slab API. |
| Building browser | Eight wall/roof selections, four colour modes, orbit/focus, controlled/baseline, six formula disclosures, exact advanced draft/apply/reset payloads, scenario ordering/cached weights/events and loading/503/retry passed. Provider choices were inspected as drafts only. |
| Safety browser/API reconciliation | All 64 zones returned 0° on 71 ticks with actual wind ≥15 m/s and on the synthetic rainy tick; power loss took precedence at 60°. **9,152** ordinary zone transitions respected the 12° per-tick limit. No page errors across the completed Building review. |
| Physical acceptance | Outside this release; not evaluated. |

No code inspection, planned stage or passing component test establishes live recovery.
The future assurance and recovery gates above remain open.

### Review fixes

- Replaced duplicate Floor lists/readouts with one zone matrix, compact Et/Ev summaries
  and a keyboard-accessible wall/roof selector. Scene controls collapse on phones.
- Brains uses the selected zone's actual admitted inputs and objective. Primary mode
  restores its facade; aggregated facade daylight explicitly uses each zone's own angle.
- Applying changed settings clears stale scenario results. Scenario tests are named
  separately from the three brain layers; chart scope is the primary reporting controller.
- Labelled prerecorded sky, simulated sensors, observe-only daylight and planned recovery.
  Slab sample logs and exported plans explicitly remain simulation evidence.
- Kept the 3D instance mounted across lenses and skipped its hidden rendering work.

### Completed change batches

| Commit | Scope |
| --- | --- |
| `a7a5197` | Four-group/side Et/Ev cutaway with mock walking and seated occupants. |
| `27151eb` | Three-point landing story and current/planned scope. |
| `c097eab` | Compact, inspectable source/provenance/model-limit panels. |
| `afa9d18` | Actual per-zone admitted inputs and objective costs; no decision changes. |
| `d7d6c67` | Supporting slab planner layout and truthful simulation/export labels. |
| `0873417` | Selected-zone Brains, one Floor picker, cache correction and responsive visuals. |
