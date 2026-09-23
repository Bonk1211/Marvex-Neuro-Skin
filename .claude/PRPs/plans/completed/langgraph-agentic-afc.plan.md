# Plan: Local Sensor Assurance and Verified Fault Recovery (Layer 1 → Layer 3)

> **Revision 2 — 2026-09-17.** Supersedes the "LangGraph Agentic AFC" plan written at `ac942da`.
> That plan predates per-zone local sensors (`afa9d18`, `0873417`), the Brains lens, and the ESP32
> bridge (`8af62b1`). Its calibration target (`inject_sensor_fault` on the *roof pyranometer*) is no
> longer read by any zone controller. The path is kept because `docs/neuroskin_software_prd.md:565`
> and `docs/neuroskin_product_prd.md:235,376` link here.

## Summary

Layer 1 is partial: zone sensors pass a finite/range check only (`controller.py:93-98`), so a stuck,
drifting, fouled or dead-in-range sensor is admitted. Layer 3 has no code; the Brains lens shows it
as a static "Planned" card. This plan builds **Layer 1 detection first** (nothing can be recovered
until something is detected), then a **deterministic in-run recovery loop** that detects, authorises,
snapshots, mitigates, verifies against a counterfactual, and retains, rolls back or escalates.
Both phases need no new dependency and **no database**. Persistence and the LLM diagnosis move to a
gated Phase C.

## User Story

As a **controls engineer evaluating NeuroSkin**, I want **each zone's sensor to be checked against
its peers and its own history, and any correction to be authorised, verified against the uncorrected
outcome, and reversed when it does not help**, so that **I can measure false alarms, detection delay
and intervention quality, and confirm that no correction ever outranks mechanical safety**.

## Problem → Solution

**Current:** a zone reading inside 0–1600 W/m² / 0–10000 lx is trusted. `zero is valid shade` is
correct, but it means a dead sensor in full sun is indistinguishable from shade. Injection is one
reading at one tick (`zone_sensor_overrides`), so persistent faults cannot be tested.

**Desired:** windowed, labelled perturbations (dead/stuck/drift/fouled + legitimate shadow). A pure
detector compares each zone against its wall peers and its own lux channel. A deterministic loop turns
detections into episodes with an auditable outcome. A seeded fault matrix reports false positives,
false negatives, detection delay and recovery quality with denominators.

## Metadata

- **Complexity**: XL, split into phases that can ship separately. Phase A (L1) = 6 backend tasks.
  Phase B (L3) = 3 backend tasks + 1 frontend task + 1 docs task. Phase C is deferred and needs
  its own plan.
- **Source PRD**: `docs/neuroskin_software_prd.md` §14.2; requirement IDs from `docs/demo-review.md:145-177`
- **PRD Phase**: L1-01, L1-02, L1-04, ZONE-05 (Phase A); L3-01…L3-06 (Phase B); L3-07 + live rig (Phase C)
- **Estimated Files**: Phase A 10, Phase B 13 (overlapping), ~25 distinct

---

## Ordering decision (why this revision exists)

| Old order (rev 1) | Problem | New order |
|---|---|---|
| 1 confidence scorer on `inject_sensor_fault(env)` | Zone controllers read `ZoneSensors`, not `env.measured_irradiance`; calibrating on the pyranometer calibrates nothing the zones use | **A1** windowed zone perturbations → **A2–A4** zone detector → **A5** fault matrix → **Gate A** |
| 2 SQLite ledger | Every run is one deterministic 144-tick batch; the snapshot and the audit trail can live in the run and the response | **B1–B3** in-run episodes, no DB. Approvals replay statelessly via `approved_episodes` |
| 5 LangGraph `interrupt()` for approval | Stateless replay gives the same approval with G2 intact | Phase C only, and only if live-rig episodes span requests |
| 8 UI depends on lens-split plan | Lens split landed (`8c694ba`); `BrainFlow.tsx` exists | **B4** replaces the static Layer 3 card in place |

## Architecture decisions

1. **Detection before correction.** Phase B consumes `ZoneAssessment` from Phase A. Nothing in Phase B
   runs until Gate A results are published.
2. **Observe before act.** `fault_correction="off"` is the default and reproduces the current response
   bytes exactly. `"monitor"` adds evidence only. `"review"` and `"auto"` may change a zone's input
   source. This mirrors `daylight_model_enabled` (PRD FR-D1).
3. **Ground-truth labels never reach the decision path.** Perturbation kinds feed injection and the
   matrix script only. `assess_zone` and `recovery.*` do not accept a label. A test asserts it.
4. **Safety is a veto, never a weight.** `run_tick` already applies `safety_gate` before any input
   use (`controller.py:190`). Mitigation only changes the input source. Verification excludes SAFE
   ticks; it never counts them for or against a correction.
5. **Rollback restores control configuration, not physical position.** The snapshot is the zone's
   input source and angle at mitigation time. Reverting re-enables sensor input; the louvre returns
   through ordinary rate-limited travel (`controller.py:253-256`). Nothing teleports.
6. **No LLM in the correction path** (unchanged from rev 1). Score, authorisation, verification and
   rollback are arithmetic. Phase C may add a read-only narrator.
7. **No database for the simulation.** The run is replayable from the request (G2), so the response
   is the audit trail. Phase C adds persistence for the live rig. The user has offered Supabase, and
   it is the preferred store there.

## What NeuroSkin already has (at `417eadc`)

| Capability | Code | State |
|---|---|---|
| Per-zone independent sensors | `scenarios.py:357-360` seeded stream per zone; `scenarios.py:454-473` sampling (1% noise) | ✅ |
| One-tick injection, independence preserved | `scenarios.py:474-483`; `schemas.py:17-20`; test `test_api.py:117-171` | ✅ one reading only |
| Local range check + model fallback | `controller.py:90-119` | ✅ in-range faults pass |
| Global pyranometer plausibility | `validation.py:9-28` (wall controllers + headline tick only) | ✅ unchanged by this plan |
| Effective inputs per zone | `ControlInput` `types.py:103-110`; payload `schemas.py:101-105` | ✅ |
| Safety precedence | `safety.py:5-24`; `controller.py:190-218` | ✅ |
| Cost function | `brain.py:38-64` `_breakdown` (private) | ✅ needs public name |
| Byte-preserving additive payloads | `schemas.py:149-151,200` `exclude_if`; test `test_api.py:366-385` | ✅ pattern |
| Rig stale/read-failure handling | `hardware.py:36` `OFFLINE_AFTER_S`; `hardware.py:183-186` null lux → `fault` hold | ✅ rig only |
| Layer 3 UI | `BrainFlow.tsx:228-274` static "Planned" card | ⚠️ design only |
| Episodes, verification, rollback | — | ❌ |

### Simulation facts the detector depends on

- **Row peers share modelled incident.** `facade.py:258-283`: every column in a row gets the same
  `incident`. Only `daylight` differs, because corner columns add neighbour-wall coupling. Rows
  differ by roof-overhang shading.
- **Healthy readings ≈ model × (1 ± 1%).** In the simulation the model *is* the truth, so a
  model-residual detector is unrealistically clean. **Detection must use peer-relative ratios, not
  absolute model agreement.** The matrix's credibility comes from unmodelled legitimate shadow cases.
  Report all results as synthetic upper bounds.
- **Lux reading** = `cell.daylight × daylight_transfer[zone] (fixed ±25%) × transmittance(previous
  angle) × noise` (`scenarios.py:460-472`). The per-zone transfer is unknown to the controller, so
  the lux check must self-normalise against the zone's own trailing history.
- **Zone ids** `f"{orientation[0].upper()}{row * columns + column + 1}"` → row 0 is the bottom and
  ids run 1–16 (`facade.py:275`). 4-neighbour adjacency is derivable from the id.

---

## UX Design

### Before
```
Brains lens · W6
┌ 1 · Check inputs ─────┐ ┌ 2 · Choose an angle ┐ ┌ 3 · Verify recovery  [PLANNED] ┐
│ Accepted              │ │ 23.4° NORMAL         │ │ Detect → … → Verify  (static)  │
│ Local finite/range    │ │                      │ │ Retain  Roll back  Escalate    │
│ "Full local fault     │ │                      │ │ design only                    │
│  diagnosis is planned"│ │                      │ │                                │
└───────────────────────┘ └──────────────────────┘ └────────────────────────────────┘
Floor lens: inject one reading at one tick.
```

### After
```
Brains lens · W6 · fault_correction=review
┌ 1 · Check inputs ─────────────┐ ┌ 2 · Choose an angle ─┐ ┌ 3 · Verify recovery · simulated ────┐
│ Fault · dead sensor  score .92│ │ 18.0° NORMAL          │ │ Episode W6:84:dead                   │
│ 3 ticks isolated from peers   │ │ input: model (isolated)│ │ Detect ✓ Authorise ⏸ …             │
│ Wall peers ×0.98 · W6 ×0.00   │ │                       │ │ Awaiting approval                    │
│ Lux channel disagrees         │ │                       │ │ [Approve and replay]                 │
└───────────────────────────────┘ └───────────────────────┘ │ corrected 0.41 · uncorrected 0.57    │
                                                            │ relative objective · RETAINED        │
Floor lens: inject one reading, OR a 2 h fault window       └──────────────────────────────────────┘
(dead / stuck / drift / fouled / shadow).
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Floor · zone sensor panel | one-tick override | + "Inject 2 h window" with kind select | override flow unchanged |
| Brains · card 1 | range check result | assurance verdict, hypothesis, peer/lux deviation | only when `fault_correction != "off"` |
| Brains · card 3 | static planned stages | episode events lit up to the selected tick; outcome | falls back to the static card when no episode |
| Approval | none | "Approve and replay" reruns with `approved_episodes` | review mode only; hidden for SAFE/escalated |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `backend/app/domain/scenarios.py` | 309-535 | Zone loop: per-zone state, sampling order, override, `run_tick` call, `zone_heat` |
| P0 | `backend/app/domain/controller.py` | 54-119, 190-218, 253-257 | Trust branch to extend, safety short-circuit, rate limit |
| P0 | `backend/app/schemas.py` | 14-20, 45-59, 94-151, 199-200, 296-303 | Request fields, `ZoneId`, zone payload, `exclude_if`, response |
| P0 | `backend/app/domain/types.py` | 93-153 | `ZoneSensors`, `ControlInput`, `ZoneHeat` frozen dataclasses |
| P0 | `backend/tests/test_api.py` | 57-67, 117-171, 366-385 | Reproducibility, zone independence, **legacy byte hash** |
| P0 | `backend/app/config.py` | 4-27 | Threshold convention |
| P1 | `backend/app/domain/facade.py` | 255-291 | Row-shared incident, corner coupling, id formula |
| P1 | `backend/app/domain/brain.py` | 38-64, 148-155 | `_breakdown` → public cost for verification |
| P1 | `backend/app/domain/environment.py` | 218-225 | Injection-function style to mirror |
| P1 | `backend/app/main.py` / `logging_config.py` | 175-192 / 7-35 | Completion log + allowlist |
| P1 | `backend/tests/test_engine.py` | 67-78, 112-183 | Pure-domain test style; local-sensor trust test |
| P2 | `frontend/src/components/neuroskin/BrainFlow.tsx` | 87-158, 228-274 | Cards to change |
| P2 | `frontend/src/components/neuroskin/NeuroSkinDashboard.tsx` | 161-164, 463-485 | Lens-gated request flag; override rerun flow |
| P2 | `frontend/src/components/neuroskin/CostBreakdownPanel.test.tsx` | 170-215 | Existing BrainFlow assertions (`'Planned fault recovery'` region) |
| P2 | `backend/scripts/benchmark_daylight.py` | 1-60 | Appendix script shape |

## External Documentation

No external research needed for Phases A–B. They use established internal patterns and stdlib only.
Phase C (LangGraph / Supabase / Claude API) must research current versions and APIs when its own plan
is written. Rev 1's LangGraph snippets were never verified and are dropped.

---

## Patterns to Mirror

### DOMAIN_DATACLASS
```python
# SOURCE: backend/app/domain/types.py:93-110
@dataclass(frozen=True)
class ZoneSensors:
    """Local facade irradiance and indoor lux measured before this tick's movement."""

    sensor_id: str
    irradiance: float
    illuminance: float
    source: Literal["simulated", "override"] = "simulated"
```
Docstring states the physical meaning. Mutation via `dataclasses.replace`. New optional fields on
`ZoneHeat` get a default of `None` placed after existing defaults.

### PURE_DOMAIN_FUNCTION
```python
# SOURCE: backend/app/domain/validation.py:9-28
def validate(env: Environment, solar: SolarState) -> tuple[bool, str]:
    expected = expected_irradiance(env, solar)
    contradiction = (
        solar.elevation > DEFAULTS.min_elevation
        and expected > DEFAULTS.expected_irradiance_threshold
        and env.measured_irradiance < DEFAULTS.near_zero_irradiance
    )
    if contradiction and env.cloud < DEFAULTS.low_cloud_threshold:
        return (False, "Almanac predicts strong sun while the sensor reads near zero under a clear sky; ...")
    if contradiction:
        return (True, "Low irradiance agrees with heavy cloud despite the sun being above the horizon; ...")
    return True, "Sensor reading is consistent with the solar almanac and cloud state."
```
Module functions, no I/O, no logging, thresholds from `DEFAULTS`, reason is a full physical sentence.

### INJECTION_FUNCTION
```python
# SOURCE: backend/app/domain/environment.py:218-225
def inject_sensor_fault(env: Environment, kind: str) -> Environment:
    if kind == "dead_pyranometer":
        return replace(env, measured_irradiance=0.0)
    ...
    raise ValueError(f"Unsupported sensor fault: {kind}")
```

### SAMPLE_BEFORE_OVERRIDE
```python
# SOURCE: backend/app/domain/scenarios.py:474-483
# Always sample first: an override cannot advance another zone's
# random stream or alter its subsequent observations.
override = request.zone_sensor_overrides.get(cell.zone)
if override is not None and override.tick_index == index:
    sensors = replace(sensors, irradiance=override.irradiance,
                      illuminance=override.illuminance, source="override")
```
Order for this plan: **sample → perturb → override.**

### PER_RUN_ZONE_STATE
```python
# SOURCE: backend/app/domain/scenarios.py:349-351
wall_angles = dict.fromkeys(ORIENTATIONS, 0.0)
# Every zone keeps its own actuator position too, keyed (wall, zone id).
zone_angles: dict[tuple[str, str], float] = {}
```
Assurance history, stuck values, episodes and counterfactual angles are per-run dicts like this one.
Never module globals: G2 needs every run to start clean.

### REQUEST_FIELD
```python
# SOURCE: backend/app/schemas.py:14-20, 57-59
ZoneId = Annotated[str, Field(pattern=r"^[NESW](?:[1-9]|1[0-6])$")]

class ZoneSensorOverride(BaseModel):
    tick_index: int = Field(ge=0, le=143, strict=True)
    irradiance: float = Field(ge=0, le=1600, allow_inf_nan=False)
    illuminance: float = Field(ge=0, le=10000, allow_inf_nan=False)

zone_sensor_overrides: dict[ZoneId, ZoneSensorOverride] = Field(default_factory=dict, max_length=64)
```

### ADDITIVE_OPTIONAL_PAYLOAD
```python
# SOURCE: backend/app/schemas.py:149-151, 200
task_illuminance: float | None = Field(None, exclude_if=lambda v: v is None)
daylight: DaylightStatusPayload | None = Field(None, exclude_if=lambda v: v is None)
```
Every new response field uses this, so `fault_correction="off"` keeps the legacy hash test passing
**without editing its hash**.

### STRUCTURED_LOGGING + ALLOWLIST
```python
# SOURCE: backend/app/main.py:175-192 ; backend/app/logging_config.py:7-35
logger.info("Simulation completed", extra={"event": "simulation_completed", ...,
            "sensor_fault_ticks": result.summary["sensor_fault_ticks"], ...})
LOG_FIELDS = (..., "sensor_fault_ticks", "safe_mode_ticks", ...,
    # Live hardware bridge.
    "hardware_mode",
)
```
Fields not in `LOG_FIELDS` are silently dropped.

### DOMAIN_TEST
```python
# SOURCE: backend/tests/test_engine.py:67-78
def test_dead_sensor_is_rejected_under_clear_sky_but_cloud_gate_is_trusted() -> None:
    env = generate_day(date(2026, 3, 21), cloud_profile="clear")[72]
    solar = sun_position(env.t)
    fault = inject_sensor_fault(replace(env, cloud=0.05), "dead_pyranometer")
    trusted, reason = validate(fault, solar)
    assert trusted is False
    assert "failed pyranometer" in reason
```
Direct imports, no fixtures, sentence-length names, `-> None`.

### INDEPENDENCE_AND_BYTES_TEST
```python
# SOURCE: backend/tests/test_api.py:141-146, 375-385
for old, new in zip(old_wall["zones"], new_wall["zones"]):
    if old["zone"] != "W2":
        assert old == new
...
legacy = to_json(payload)
assert hashlib.sha256(legacy).hexdigest() == ("3a2e9e02…42210")
```

### FRONTEND_RERUN_FLOW
```tsx
// SOURCE: frontend/src/components/neuroskin/NeuroSkinDashboard.tsx:463-485
const overrides = { ...appliedRequest.current.zone_sensor_overrides }
if (reading) overrides[zoneId] = { ...reading, tick_index: sensorTick }
else delete overrides[zoneId]
const nextRequest = { ...appliedRequest.current, zone_sensor_overrides: overrides }
setPlaying(false)
setRequest((draft) => ({ ...draft, zone_sensor_overrides: overrides }))
setTierResults({}); setTierStatus({}); setActiveTier(null)
await execute(nextRequest, sensorTick)
```
Perturbation injection and episode approval both reuse this shape.

---

## Files to Change

| File | Action | Phase | Justification |
|---|---|---|---|
| `backend/app/config.py` | UPDATE | A, B | `assurance_*` and `recovery_*` thresholds |
| `backend/app/domain/types.py` | UPDATE | A, B | `ZoneAssessment`; `ZoneHeat.assurance` |
| `backend/app/schemas.py` | UPDATE | A, B | `ZonePerturbation`, `fault_correction`, `approved_episodes`, assurance/episode payloads |
| `backend/app/domain/environment.py` | UPDATE | A | `perturb_zone_sensors()` beside `inject_sensor_fault` |
| `backend/app/domain/assurance.py` | CREATE | A | Pure detector: ratios, adjacency, `assess_zone` |
| `backend/app/domain/scenarios.py` | UPDATE | A, B | Two-pass wall sampling; assessment; episode loop; counterfactual |
| `backend/app/domain/controller.py` | UPDATE | B | `isolate_sensor` reason forces the model-fallback branch |
| `backend/app/domain/brain.py` | UPDATE | B | Rename `_breakdown` → `cost_breakdown` (one caller) |
| `backend/app/domain/recovery.py` | CREATE | B | Pure episode transitions and verdict |
| `backend/app/main.py`, `logging_config.py` | UPDATE | A, B | Log counts |
| `backend/scripts/assurance_matrix.py` | CREATE | A, B | Seeded fault matrix → appendix |
| `Makefile` | UPDATE | A | `assurance-matrix` target |
| `backend/tests/test_assurance.py` | CREATE | A | Detector + injection tests |
| `backend/tests/test_recovery.py` | CREATE | B | Transition truth tables, veto, replay |
| `backend/tests/test_api.py` | UPDATE | A, B | Off-mode bytes, monitor no-op, independence under `auto` |
| `frontend/src/lib/types.ts` | UPDATE | B | Request + payload types |
| `frontend/src/components/neuroskin/BrainFlow.tsx` | UPDATE | B | Cards 1 and 3 |
| `frontend/src/components/neuroskin/ZoneSensorPanel.tsx` | UPDATE | B | Fault-window injection control |
| `frontend/src/components/neuroskin/NeuroSkinDashboard.tsx` | UPDATE | B | Lens flag, perturbation + approval reruns |
| `frontend/src/components/neuroskin/CostBreakdownPanel.test.tsx`, `NeuroSkinDashboard.test.tsx` | UPDATE | B | Card/flow tests |
| `docs/appendix/assurance-matrix-results.{json,md}` | CREATE | A, B | Generated evidence |
| `docs/demo-review.md`, `docs/neuroskin_software_prd.md`, `docs/neuroskin_product_prd.md`, `README.md` | UPDATE | B | Status matrix, §14.2, §4.3, API params, plan links |

## NOT Building

- **Lux-channel-only faults** (e.g. rev 1's `stuck_lux`). Lux is used only to corroborate the
  irradiance channel. Add after Gate B if the matrix shows the need.
- **Separate "stale" detection in simulation.** Simulated zone sensors have no capture timestamps,
  so stale = stuck. The rig already detects staleness (`hardware.py:36`).
- **Changing `validate()` or the roof pyranometer path.** The wall controllers and the `lie_detector`
  scenario keep their current behaviour and bytes.
- **Any database, LangGraph, or LLM in Phases A–B.** See Phase C.
- **Physical repair claims.** Isolation substitutes the model. The maintenance flag says a person
  must fix the sensor (L3-02).
- **Two simultaneous faults on adjacent zones.** They look like shadow. That is a documented false
  negative, not something to design around.
- **Daylight-model (Et/Ev) inputs to verification.** Layer 2 stays observe-only.
- **kWh, carbon, cost savings.** Verification objectives are relative-index costs.

---

## Phase A — Layer 1 local assurance (no new dependencies)

### Task A1: Windowed zone perturbations (labelled ground truth)
- **ACTION**: Add request schema + domain injection; wire into the zone loop after sampling.
- **IMPLEMENT**:
  - `schemas.py`:
    ```python
    PerturbationKind = Literal["dead", "stuck", "drift", "fouled", "shadow"]

    class ZonePerturbation(BaseModel):
        """Declared test input. Faults corrupt the reading; shadow is a real, unmodelled drop."""
        kind: PerturbationKind
        start_tick: int = Field(ge=0, le=143, strict=True)
        end_tick: int = Field(ge=0, le=143, strict=True)
        severity: float = Field(0.5, gt=0, le=1, allow_inf_nan=False)
        # model_validator(mode="after"): end_tick >= start_tick
    ```
    `SimulationRunRequest.zone_perturbations: dict[ZoneId, ZonePerturbation] = Field(default_factory=dict, max_length=64)`.
  - `environment.py`, beside `inject_sensor_fault`:
    ```python
    def perturb_zone_sensors(sensors: ZoneSensors, kind: str, severity: float,
                             progress: float, stuck: ZoneSensors | None) -> ZoneSensors:
    ```
    `dead` → irradiance 0. `stuck` → irradiance and illuminance of `stuck`. `drift` → irradiance ×
    `(1 - severity * progress)` (linear ramp over the window). `fouled` → irradiance ×
    `(1 - severity)`. `shadow` → **both** channels × `(1 - severity)`. Keep `source="simulated"`; the
    perturbation is not a manual override. Raise `ValueError` for an unknown kind.
  - `scenarios.py`: per-run `stuck_values: dict[str, ZoneSensors] = {}`. After sampling (line 473),
    if a perturbation covers `index`: capture `stuck_values[zone]` at `start_tick`, compute
    `progress = (index - start) / max(1, end - start)`, apply. Then the existing override block.
- **MIRROR**: REQUEST_FIELD, INJECTION_FUNCTION, SAMPLE_BEFORE_OVERRIDE.
- **IMPORTS**: `from pydantic import model_validator`; `from app.domain.environment import perturb_zone_sensors`.
- **GOTCHA**: Apply **after** both `stream.normal` draws for the zone, or that zone's later noise
  shifts. A perturbation must not touch `cell.incident`: the model stays unaware, which is the
  point. Round like the sampler (irradiance 2 dp, illuminance 1 dp).
- **VALIDATE**: `test_assurance.py`: each kind's reading inside and outside its window. `test_api.py`:
  a `W6` `dead` window changes only W6 (extend the independence loop). The legacy-bytes test still
  passes when the field is absent.

### Task A2: Assurance thresholds and domain type
- **ACTION**: Add config fields and `ZoneAssessment`.
- **IMPLEMENT**:
  ```python
  # config.py — preregistered starting values; Gate A may retune from calibration seeds only.
  assurance_min_model_irradiance: float = 100.0   # below: peers cannot discriminate
  assurance_min_peers: int = 3
  assurance_peer_deviation: float = 0.35          # |k_zone / median(k_peers) - 1|
  assurance_lux_deviation: float = 0.35           # |q_now / median(q_history) - 1|
  assurance_shadow_similarity: float = 0.25       # adjacent zone ratio within this of the suspect
  assurance_persist_ticks: int = 3                # consecutive suspect ticks before "fault"
  assurance_window_ticks: int = 6                 # one hour of history
  assurance_stuck_change: float = 0.5             # W/m² total change over the window
  assurance_stuck_peer_change: float = 20.0       # peers' median change that makes flatness suspicious
  ```
  ```python
  # types.py
  @dataclass(frozen=True)
  class ZoneAssessment:
      """Evidence about one zone's reading before its controller acts. Not a repair."""
      verdict: Literal["consistent", "legitimate_condition", "suspect", "fault", "insufficient"]
      hypothesis: Literal["dead", "stuck", "drift_or_fouling", "local_shadow", "ambiguous"] | None
      score: float                  # 0-1 routing number, not an accuracy claim
      peer_deviation: float | None
      lux_deviation: float | None
      reason: str
  ```
  Add `assurance: ZoneAssessment | None = None` as the **last** field of `ZoneHeat`.
- **MIRROR**: CONFIG_THRESHOLD, DOMAIN_DATACLASS.
- **GOTCHA**: Keep field order: `FacadeHeatPayload(**asdict(wall))` must still map fields. A new
  field appended last with a default is safe.
- **VALIDATE**: `uv run pytest -q -k "prechange or reproducible"` still passes.

### Task A3: Pure detector
- **ACTION**: Create `backend/app/domain/assurance.py`.
- **IMPLEMENT**:
  ```python
  def adjacent_zones(zone: str) -> tuple[str, ...]:
      """4-neighbours on the same wall from the id formula (facade.py:275)."""

  def peer_ratios(readings: Mapping[str, float], models: Mapping[str, float]) -> dict[str, float | None]:
      """k = reading / model incident; None when the model is below assurance_min_model_irradiance."""

  def assess_zone(zone: str, ratios: Mapping[str, float | None], lux_ratio: float | None,
                  history: Sequence[tuple[float | None, float | None, float]]) -> ZoneAssessment:
      """history: prior (peer_deviation, lux_ratio, irradiance) for this zone, oldest first."""
  ```
  Decision table, evaluated in order:
  | # | Condition | verdict | hypothesis |
  |---|---|---|---|
  | 1 | own `k` is None, or fewer than `min_peers` non-None peers | insufficient | None |
  | 2 | `|k/median(peers) − 1| ≤ peer_deviation` **and** not stuck | consistent | None |
  | 3 | stuck: irradiance changed < `stuck_change` over `window_ticks` while peers' median reading changed > `stuck_peer_change` | suspect→fault | stuck |
  | 4 | deviating **and** ≥1 adjacent zone's `k` within `shadow_similarity` of this zone's `k` **and** lux also deviates the same direction | legitimate_condition | local_shadow |
  | 5 | deviating, no similar adjacent, lux deviates the same direction | insufficient | ambiguous |
  | 6 | deviating, lux does **not** corroborate (or unavailable) | suspect→fault | `dead` if `k < 0.05` else `drift_or_fouling` |
  "suspect→fault": `fault` when the previous `persist_ticks − 1` history entries were also deviating,
  otherwise `suspect`. `lux_ratio` q = `illuminance / (model_open_lux × transmission)`. Lux deviation
  compares q with `median` of history q (needs ≥3 history values, else None). Score =
  `min(1, peer_dev / (2 × peer_deviation)) × min(1, consecutive / persist_ticks)`; 0 for rows 1–2
  and 4. Reason sentences name the zone ratio, peer median and lux evidence.
- **MIRROR**: PURE_DOMAIN_FUNCTION.
- **IMPORTS**: `from statistics import median`; `from app.config import DEFAULTS`; `from app.domain.types import ZoneAssessment`.
- **GOTCHA**: Zones with an open episode are excluded from peers in Phase B, not in A3; Phase B
  passes a filtered mapping. Median of peers **excludes the zone itself**. Guard `median == 0`
  (all peers dark) → insufficient. Whole-wall cloud shifts every `k` together and must read
  **consistent**. The function accepts no perturbation label; keep it that way.
- **VALIDATE**: `test_assurance.py` hand-built tables, one test per row. Whole-wall ×0.3 → consistent.
  Zone + neighbour ×0.5 with lux down → legitimate_condition. Single zone ×0.0 for 3 ticks → fault
  dead. Flat reading while peers rise → stuck. Two peers only → insufficient. Night → insufficient.

### Task A4: Observe-only wiring behind `fault_correction`
- **ACTION**: Assess every zone in the run loop when enabled; expose evidence; change no decision.
- **IMPLEMENT**:
  - `schemas.py`: `FaultCorrectionMode = Literal["off", "monitor", "review", "auto"]`;
    `SimulationRunRequest.fault_correction: FaultCorrectionMode = "off"`. `ZoneAssurancePayload`
    mirrors `ZoneAssessment` (+ `episode_id: str | None = Field(None, exclude_if=...)` for B).
    `ZoneHeatPayload.assurance: ZoneAssurancePayload | None = Field(None, exclude_if=lambda v: v is None)`.
  - `scenarios.py`: split the per-wall zone loop (`437-535`) into **pass 1** (sample → perturb →
    override for all 16 cells, store `sensors` + `optics` per cell) and **pass 2** (assess, `run_tick`,
    `zone_heat`). When `fault_correction != "off"`: build `peer_ratios` from pass-1 readings and
    `cell.incident`, then `assess_zone` with `lux_ratio` from
    `wall_open_lux(WallGain(... incident=cell.incident ...)) × optics.daylight_transmittance(current_angle)`
    (guard transmission `> 1e-6` like `controller.py:110`). Append to per-run
    `assurance_history[zone]` (keep the last `window_ticks`). Attach via
    `replace(heat, assurance=assessment)`.
  - `summary`: **only when enabled**, add `assurance_fault_zone_ticks` and `assurance_shadow_zone_ticks`.
    Log both in `main.py` and add them to `LOG_FIELDS` under `# Local sensor assurance.`
- **MIRROR**: PER_RUN_ZONE_STATE, ADDITIVE_OPTIONAL_PAYLOAD, STRUCTURED_LOGGING.
- **GOTCHA**: The two-pass split must keep per-zone draw order (irradiance then lux) and read
  `current_angle` from `zone_angles` **before** pass 2 mutates it. Per-zone streams are
  independent, so the order *across* zones is free. `summary` keys added in off mode break the
  byte hash. Use `wall_open_lux` from `controller.py:31`, not `cell.daylight`: the controller
  cannot see corner coupling truth.
- **VALIDATE**: `test_api.py`: (1) off-mode bytes unchanged. (2) `monitor` run with assurance fields
  stripped equals the off run exactly. (3) seed 42 clean `monitor` run has zero `fault` verdicts on
  the default day (a regression floor for false positives). (4) `W6 dead 78–96` under `monitor`
  reaches `fault` by tick 80 and nothing else changes.

### Task A5: Fault matrix script and appendix (Gate A evidence)
- **ACTION**: Create `backend/scripts/assurance_matrix.py`; Makefile `assurance-matrix` target.
- **IMPLEMENT**: Call `run_scenario(SimulationRunRequest(...))` in-process (no HTTP). Declared design:
  - Splits: **calibration seeds (1, 2, 3)** and **evaluation seeds (7, 11, 13)**. Seed 42 is excluded
    (demo/hash seed). Cloud profiles `clear`, `scattered`. Date 2026-03-21, west primary.
  - Zones: `W6` interior, `W5` corner, `W14` top row, `W2` bottom row. Window ticks 78–96
    (13:00–16:00, west sun).
  - Cases per zone: `dead`, `stuck`, `drift` (0.5), `fouled` (0.4), `shadow` single (0.5),
    `shadow` cluster (zone + one adjacent, 0.5), plus one clean run per seed × cloud.
  - Metrics per split × kind: detection rate (fault verdict inside the window), detection delay in
    ticks (median, max), clean false-positive rate per assessed zone-tick, shadow classified as
    fault, `insufficient` share. Always print denominators.
  - `--smoke`: one seed, one cloud, one zone. Write `docs/appendix/assurance-matrix-results.json`
    + `.md` with the declared design, the git commit, and a "synthetic upper bound" caveat.
  - Makefile: `assurance-matrix:` → `cd backend && uv run python -m scripts.assurance_matrix $(ARGS)`.
- **MIRROR**: `scripts/benchmark_daylight.py` shape (module docstring with the run command, `main()`,
  JSON + markdown outputs like `docs/appendix/daylight-*`).
- **GOTCHA**: Tune thresholds on calibration seeds only, then run evaluation once and record it.
  Retuning after seeing evaluation numbers makes them validation numbers; say so if it happens.
  ~150 runs per split at ~2 s ≈ 10 min, so keep `--smoke` fast for CI-style checks.
- **VALIDATE**: `make assurance-matrix ARGS=--smoke` exits 0 and writes both files.

### Task A6: Gate A
Proposed pass criteria (evaluation split). **Confirm them before running evaluation:**
- dead and stuck detected in ≥ 95% of cases, median delay ≤ 3 ticks.
- drift (0.5) and fouled (0.4) detected in ≥ 70%, median delay ≤ 6 ticks.
- clean false positives ≤ 0.1% of assessed zone-ticks.
- cluster shadow classified as `fault` in ≤ 5%. Single-zone shadow is reported, not gated
  (expected `insufficient`).
- Full backend suite green; legacy hash unchanged.

> **Shippable boundary.** Commit Phase A and update `docs/demo-review.md` L1-01, L1-02 and ZONE-05
> with the measured numbers before Phase B.

---

## Phase B — Layer 3 deterministic recovery (no new dependencies, no database)

### Task B1: Pure episode transitions
- **ACTION**: Create `backend/app/domain/recovery.py`; add recovery thresholds.
- **IMPLEMENT**:
  ```python
  # config.py
  recovery_auto_hypotheses: tuple[str, ...] = ("dead", "stuck")
  recovery_auto_score: float = 0.8
  recovery_verify_ticks: int = 6
  recovery_min_valid_ticks: int = 4
  recovery_cost_margin: float = 0.01       # relative-objective units summed over the window
  recovery_max_episode_ticks: int = 36     # 6 h open → escalate for maintenance
  recovery_cooldown_ticks: int = 6
  ```
  ```python
  EpisodeStatus = Literal["monitoring", "awaiting_approval", "mitigating",
                          "retained", "rolled_back", "escalated", "closed"]

  @dataclass(frozen=True)
  class Episode:
      episode_id: str            # f"{zone}:{opened_tick}:{hypothesis}", stable under replay
      zone: str
      hypothesis: str
      score: float
      opened_tick: int
      status: EpisodeStatus
      snapshot_angle: float | None = None
      mitigated_tick: int | None = None
      valid_ticks: int = 0
      e_corrected: float = 0.0
      e_uncorrected: float = 0.0
      closed_tick: int | None = None
      maintenance_flag: bool = False
      events: tuple[tuple[int, str, str], ...] = ()   # (tick, stage, detail)

  def authorise(mode: str, hypothesis: str, score: float, episode_id: str,
                approved: frozenset[str]) -> tuple[EpisodeStatus, str]
  def may_transition(safe_now: bool, reading_present: bool) -> bool          # L3-04 guard
  def verdict(episode: Episode, fault_evidence_cleared: bool, elapsed: int) -> tuple[EpisodeStatus, str] | None
  ```
  `authorise`: monitor → `monitoring`. auto + hypothesis in auto set + score ≥ auto → `mitigating`.
  Otherwise review/auto → `awaiting_approval`, unless `episode_id in approved` → `mitigating`.
  `verdict` (only while `mitigating` or `retained`), first match wins:
  1. `fault_evidence_cleared` → `rolled_back` ("sensor agrees with peers again; restore its input").
  2. `elapsed ≥ max_episode_ticks` → `escalated`, maintenance flag.
  3. `valid_ticks < min_valid_ticks` and `elapsed ≥ 2 × verify_ticks` → `escalated` ("unverifiable").
  4. `valid_ticks ≥ verify_ticks` and `e_corrected ≤ e_uncorrected − margin` → `retained`.
  5. `valid_ticks ≥ verify_ticks` → `rolled_back` ("isolation did not improve the objective").
  6. else `None` (keep verifying).
- **MIRROR**: PURE_DOMAIN_FUNCTION, DOMAIN_DATACLASS.
- **GOTCHA**: No label argument anywhere. `escalated` keeps the model fallback. It is the safe
  state for a sensor known to disagree, and it is never re-trusted inside the run. Retained episodes
  keep being re-evaluated so a recovered sensor is restored (rule 1).
- **VALIDATE**: `test_recovery.py` truth tables for `authorise` (4 modes × auto-eligible × approved),
  and for `verdict` covering each rule and its precedence (e.g. rule 1 beats rule 4). Episode ids are
  identical for identical inputs.

### Task B2: Controller hook, public cost, and the in-run loop
- **ACTION**: Let a zone be isolated, run a counterfactual, and drive episodes in `run_scenario`.
- **IMPLEMENT**:
  - `brain.py`: rename `_breakdown` → `cost_breakdown` (definition line 38, only caller line 80).
  - `controller.py`: `run_tick(..., isolate_sensor: str | None = None)`. In the local-sensor branch,
    `trusted = <range checks> and isolate_sensor is None`. When isolated but in range, append
    `isolate_sensor` (a full sentence) instead of the out-of-range text. Everything else is unchanged.
  - `scenarios.py` (only when `fault_correction in {"monitor","review","auto"}`), per zone per tick:
    1. No open episode, not in cooldown, assessment `fault` → open `Episode` with `detect`, then
       `authorise(...)`. If this zone's previous episode was `rolled_back` and it re-flags after cooldown → open directly as
       `escalated` ("persistent ambiguous fault").
    2. `mitigating` with no `mitigated_tick` and `may_transition(safety_gate(env, power_ok) is not None, True)`
       → record `snapshot` (current angle) and `mitigate` events; set `counterfactual_angles[key] = current_angle`.
    3. While mitigated (`mitigating`/`retained`/`escalated`): call `run_tick(..., isolate_sensor=reason)`
       for the real zone. For `mitigating`/`retained` also run the **uncorrected branch**:
       `run_tick(env, counterfactual_angles[key], ..., local_sensors=sensors)` (no isolation), and
       store its `angle_final`.
    4. Verification tick is valid when not SAFE and `cell.incident ≥ assurance_min_model_irradiance`.
       Reference input = `cell.incident × median(k of peers without open episodes)` and
       `wall_open_lux(...)` scaled by the zone's pre-episode median lux ratio. Add
       `sum(cost_breakdown(angle, load_ref, open_lux_ref, previous_angle, env.wind, weights, optics=optics, glazing_shgc=...).values())`
       for both branches' achieved angles, with `load_ref = predict_load(replace(env, ghi=incident_ref), solar)`.
    5. `verdict(...)` with `fault_evidence_cleared` = the last `persist_ticks` assessments were
       `consistent`. `rolled_back` → drop isolation next tick, start cooldown. Append `verify` and
       outcome events.
    6. Peers for `peer_ratios` exclude zones whose episode is mitigating/retained/escalated.
    `approved = frozenset(request.approved_episodes)`. Attach `episode_id` to the zone's assurance payload.
  - `schemas.py`: `EpisodeId = Annotated[str, Field(pattern=r"^[NESW](?:[1-9]|1[0-6]):(?:1[0-3]\d|14[0-3]|[1-9]?\d):[a-z_]+$")]`;
    `approved_episodes: list[EpisodeId] = Field(default_factory=list, max_length=64)`;
    `EpisodeEventPayload(tick_index, stage, detail)`, `RecoveryEpisodePayload` mirroring `Episode`
    (`events: list[EpisodeEventPayload]`);
    `SimulationRunResponse.episodes: list[RecoveryEpisodePayload] = Field(default_factory=list, exclude_if=lambda v: not v)`.
  - `summary` (enabled only): `episodes_opened`, `episodes_retained`, `episodes_rolled_back`,
    `episodes_escalated`, `episodes_awaiting_approval`, `unmatched_approvals` (approved ids never
    opened). Log them and add them to `LOG_FIELDS` under `# Verified fault recovery.`
- **MIRROR**: PER_RUN_ZONE_STATE, VETO_RETURNS_NONE, ADDITIVE_OPTIONAL_PAYLOAD.
- **GOTCHA**: The counterfactual must not advance any random stream or touch `zone_angles`; it has
  its own angle dict. Never mitigate or revert on a SAFE tick (`may_transition`); the safety angle
  already wins inside `run_tick`. Rev 1 said a SAFE tick in the window forces rollback. **Wrong:**
  a wind gust says nothing about the sensor, so SAFE ticks are excluded from the window. The
  `wall_results` and headline tick fields stay untouched: episodes are zone-level only. The renamed
  `cost_breakdown` function shares a name with the `cost_breakdown` *field* on `Decision`/`ZoneHeat`.
  They never meet in one scope, but grep before renaming.
- **VALIDATE**: `test_recovery.py` via `run_scenario`:
  - `W6 dead 78–120`, `auto` → one episode `W6:…:dead`, `mitigating` → `retained`, W6 control input
    `irradiance_source == "model"` after mitigation, every other zone identical to the `off` run.
  - Same request with `power_ok=False` → no `mitigate` event on any SAFE tick; SAFE angles are identical
    to the `off` run.
  - `review` without approval → `awaiting_approval`, decisions identical to `off`. Rerun with that
    `episode_id` in `approved_episodes` → `mitigating`. The same request twice → identical JSON (G2).
    A duplicate id in the list changes nothing.
  - Cluster shadow under `auto` → no episode.
  - Fault window 78–84 then healthy → `rolled_back` via rule 1, sensor input restored, louvre travel
    still ≤ rate limit.
  - `test_api.py` legacy hash still passes (off mode).

### Task B3: Recovery quality in the matrix (Gate B evidence)
- **ACTION**: Extend `assurance_matrix.py` with `fault_correction="auto"` runs of the same cases.
- **IMPLEMENT**: Per split × kind: episodes opened / cases, outcome counts (`retained`,
  `rolled_back`, `escalated`, unresolved at end of day), **false interventions** (mitigated while
  no fault perturbation was active on that zone: clean and shadow cases), median ticks from window
  start to `mitigate`. Add a truth-scored input error: mean `|admitted irradiance − truth|` over
  mitigated ticks for the isolated vs uncorrected branch, where truth = `zone.incident` for faults
  and `incident × (1 − severity)` for shadow. Label it clearly: **the controller never sees truth.**
- **GOTCHA**: The truth score and the controller's own `e_corrected`/`e_uncorrected` measure
  different things. Report both and never merge them into one "accuracy".
- **VALIDATE**: `--smoke` still exits 0; appendix gains a "Recovery quality" table with denominators.

**Gate B (evaluation split, confirm before running):** false interventions ≤ 5% of episodes; zero
mitigations on SAFE ticks; every rollback leaves the zone trusting its sensor on the next tick;
G2 equality with `auto`; zone independence holds for all non-episode zones.

### Task B4: Brains and Floor UI
- **ACTION**: Replace static card 3 with episode evidence; show assurance on card 1; add fault-window
  injection and approval replay.
- **IMPLEMENT**:
  - `types.ts`: request `zone_perturbations?`, `fault_correction?`, `approved_episodes?`.
    `ZoneHeat.assurance?`, `SimulationRunResponse.episodes?`.
  - `NeuroSkinDashboard.tsx`: initial request `fault_correction: lens === 'brains' ? 'review' : 'off'`
    next to the daylight flag at line 164, and mirror whatever line 729-734 does when the lens changes.
    `updateZonePerturbation(zoneId, kind | null)` and `approveEpisode(id)` copy the
    FRONTEND_RERUN_FLOW. The perturbation window starts at the current tick and runs 12 ticks (2 h),
    clamped to 143. Pass `episodes` and `onApproveEpisode` to `BrainFlow`.
  - `ZoneSensorPanel.tsx`: beside the override controls, a `<select>` of the five kinds (label "Fault
    window") + "Inject 2 h" / "Clear" buttons. Prop names follow `onOverride`/`onClearOverride`.
  - `BrainFlow.tsx` card 1: if `zone?.assurance`, show verdict + hypothesis + score and peer/lux
    deviation. Replace the "Full local fault diagnosis is planned." line with the assurance reason.
    Keep the old text when assurance is absent.
  - `BrainFlow.tsx` card 3: find the episode for the selected zone whose `opened_tick ≤ tick index`.
    If found, light the `RECOVERY` chips that have an event at or before the selected tick, and show
    status, `e_corrected`/`e_uncorrected` labelled "relative objective", and the maintenance flag.
    For `awaiting_approval`, add a button "Approve and replay". Change the region `aria-label` to
    `'Fault recovery'` and the badge to "Simulated". With no episode, keep the existing static
    design-only content and label.
- **MIRROR**: existing card markup in `BrainFlow.tsx:87-158`; override buttons in `ZoneSensorPanel.tsx`.
- **GOTCHA**: `BrainFlow` receives `tick` but not its index. Pass the selected index or compare
  timestamps; do not guess from array position. Never render the approval button for `escalated`,
  `retained`, `rolled_back` or while `mode === 'SAFE'`. Show the score thresholds next to the score,
  or `0.92` reads as accuracy. `CostBreakdownPanel.test.tsx:198-200` asserts the old region name.
  Update it in the same change.
- **VALIDATE**: Vitest: awaiting episode renders the approve button and calls the handler with its id.
  Escalated episode renders no button and shows the maintenance flag. No episode renders the static
  card. Dashboard test: injecting a window posts `zone_perturbations` with a 12-tick window; approving
  posts `approved_episodes`.

### Task B5: Documentation
- **ACTION**: Update status and claims to match measured evidence.
- **IMPLEMENT**:
  - `docs/demo-review.md:151-177`: DT-04, DT-06, ZONE-03, ZONE-04, ZONE-05, L1-01, L1-02, L1-04 and
    L3-01…L3-06 → Implemented (simulation) with appendix links. L3-07 stays Planned. Update the
    "Input assurance", "Recovery quality" and "Safety and authorisation" gate rows (`:183-189`).
  - `docs/neuroskin_software_prd.md`: rewrite §14.2 (`:563-580`) as this plan's phases and fix the
    `:565` summary ("XL, 14 files, 8 tasks" → phases A/B/C). §4.3: the simulation needs **no**
    database (the contradiction note at `:133` is resolved for simulation; a persistence note moves
    to Phase C). Remove `langgraph-checkpoint-sqlite` from §8.4 or mark it Phase C. Add FR entries
    for `zone_perturbations`, `fault_correction`, `approved_episodes`, and a §4.2 guardrail:
    corrections are simulated, uncommissioned, and relative-index only.
  - `docs/neuroskin_product_prd.md:235,376`: reword "proposed episode persistence" to "in-run
    episodes, verification and rollback; persistence deferred to the live rig".
  - `README.md`: request-parameter table rows for the three new fields.
- **VALIDATE**: `grep -rn "kWh\|carbon\|payback" backend/app/domain/assurance.py backend/app/domain/recovery.py` → no hits.

---

## Phase C — Deferred (needs its own plan after Gate B)

| Item | Requirement | Notes |
|---|---|---|
| C1 Rig assurance | L1 on hardware | 4 BH1750 panels = 2×2 block W9/W10/W13/W14 (`hardware.py:29`), **lux only**, so reuse `assess_zone` on the lux channel with 3 peers (the minimum). Physical fault tests: tape over a sensor (fouled), unplug (dead → already `fault` hold). |
| C2 Persistent episode ledger | L3-01 across requests | **Supabase Postgres** (user-offered) instead of rev 1's SQLite. One `afc_episodes` table keyed by `episode_id` (upsert = idempotent), `events jsonb`, RLS on, backend-only service key in `backend/.env` (never `NEXT_PUBLIC_`). **Rig commands must never wait on the DB**: compute the command, respond, then write; on write failure log `afc_ledger_write_failed` and keep going. |
| C3 Diagnosis narrator | L3-07 | Read-only tools over episode + zone evidence; one Claude API call is enough unless multi-step pauses are needed. LangGraph only if that need appears. Architecture test: no write tool bound; episodes complete with the key unset. Load the `claude-api` skill when planning. |

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| perturbation kinds | each kind inside/outside window | readings per A1 rules | yes: drift progress at start = 1.0× |
| stuck captures start value | stuck 78–90 | ticks 79–90 equal tick 78 reading | no |
| whole-wall cloud | all `k` × 0.3 | consistent | **yes: false-positive trap** |
| cluster shadow | zone + neighbour × 0.5, lux down | legitimate_condition | **yes** |
| single dead sensor | `k` 0 for 3 ticks, lux normal | fault / dead | no |
| thin evidence | 2 peers | insufficient | yes |
| night | model incident < 100 | insufficient, no episode | yes |
| median zero | all peers 0 | insufficient, no ZeroDivisionError | yes |
| detector ignores labels | signature inspection | no `kind`/label parameter | **architectural** |
| authorise table | 4 modes × eligible × approved | per B1 | yes |
| verdict precedence | cleared + beneficial | rolled_back (rule 1 first) | yes |
| off-mode bytes | default request | legacy sha256 unchanged | **G2** |
| monitor is a no-op | monitor vs off | equal after stripping `assurance` | **yes** |
| auto independence | W6 dead, auto | only W6 differs from off | **ZONE-04** |
| SAFE veto | power off during episode | no mitigate on SAFE ticks; SAFE angles equal | **G3** |
| approval replay | review → approve id → rerun twice | identical JSON; duplicate id no-op | **L3-01** |
| rollback restores input | fault clears | next tick `irradiance_source == "sensor"`; travel ≤ rate limit | yes |
| UI approval affordance | awaiting / escalated / none | button / flag / static card | yes |

### Edge Cases Checklist
- [ ] Empty input — no perturbations; `fault_correction="off"`; night ticks
- [ ] Maximum size — 64 perturbations (max_length), all zones faulted: every `k` shifts together → consistent. Document it as a known blind spot.
- [ ] Invalid types — `end_tick < start_tick`, unknown kind, malformed episode id → 422
- [ ] Concurrent access — none (stateless run); Phase C only
- [ ] Network failure — none in A/B; Phase C ledger write must not block rig commands
- [ ] Permission denied — N/A in A/B
- [ ] Window crosses sunset — valid-tick count falls → `escalated` "unverifiable", never a silent retain
- [ ] Override and perturbation on the same zone and tick — override wins (applied last)
- [ ] Corner zones (W1, W4, W5…) — lux ratio drifts with neighbour coupling; covered by matrix zone W5

---

## Validation Commands

### Static Analysis
```bash
cd backend && uv run ruff check app tests scripts
cd frontend && npm run lint && npx tsc --noEmit
```
EXPECT: Zero errors.

### Unit Tests
```bash
cd backend && uv run pytest tests/test_assurance.py tests/test_recovery.py
```
EXPECT: All pass.

### Determinism / independence / bytes guard (run after every task)
```bash
cd backend && uv run pytest tests/test_api.py -k "reproducible or prechange or override"
```
EXPECT: Pass, legacy hash unedited.

### Full Test Suite
```bash
make test
```
EXPECT: No regressions (backend pytest + frontend vitest).

### Evidence
```bash
make assurance-matrix ARGS=--smoke   # fast
make assurance-matrix                # full, ~20 min; writes docs/appendix/assurance-matrix-results.*
```
EXPECT: Exit 0; appendix states the declared design, commit, denominators, synthetic caveat.

### Browser Validation
```bash
make dev
```
EXPECT: `/dashboard?view=floor`, inject `dead` on W6 at 13:00 → `?view=brains`, select W6, scrub
forward: card 1 shows fault, card 3 shows `awaiting_approval` → approve → replay shows mitigate,
verify, outcome.

### Manual Validation
- [ ] Default dashboard load is visually unchanged in Building/Floor lenses
- [ ] Cluster shadow on W10+W11 → card 1 "legitimate condition", no episode
- [ ] Power-off during an episode → SAFE banner; no mitigate event on those ticks
- [ ] A fault window that ends early rolls back and the louvre travels back at the normal rate

---

## Acceptance Criteria
- [ ] Phase A tasks complete; Gate A criteria met and recorded in the appendix
- [ ] Phase B tasks complete; Gate B criteria met and recorded
- [ ] Off-mode response bytes unchanged (legacy hash untouched)
- [ ] Detector and recovery accept no ground-truth label (test)
- [ ] No mitigation on a SAFE tick (test)
- [ ] Approval replay idempotent and reproducible (test)
- [ ] `LOG_FIELDS` extended; enabled runs log assurance and episode counts
- [ ] No lint/type errors; no new dependencies in `pyproject.toml` or `package.json`

## Completion Checklist
- [ ] Code follows discovered patterns (frozen dataclasses, pure domain modules, `DEFAULTS`)
- [ ] Error handling: `ValueError` in domain, 422 via schema validation
- [ ] Logging via `extra` + allowlist
- [ ] Tests follow `test_engine.py` / `test_api.py` styles
- [ ] No inline thresholds
- [ ] demo-review, both PRDs and README updated
- [ ] Phase C untouched

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Circular evidence: sim model = truth makes detection look perfect | **High** | High | Peer-relative ratios only; unmodelled shadow cases; "synthetic upper bound" label on every result |
| Thresholds tuned on the evaluation seeds | Medium | High | Disjoint calibration/evaluation seeds declared in A5; record any retune |
| Two-pass loop reorder perturbs RNG draws → G2/bytes break | Medium | High | Keep per-zone draw order; bytes guard after every task |
| Single-zone real shadow isolated as a fault | Medium | Medium | Lux corroboration row 4/5 → `insufficient`, not `fault`; matrix reports it |
| Correction outranks safety | Low | **Critical** | `may_transition` guard + SAFE exclusion + test |
| Oscillating detect/rollback on a flaky sensor | Medium | Medium | Cooldown + re-flag after rollback → escalate |
| Response size/latency growth with counterfactual runs | Low | Medium | Counterfactual only for mitigated zones; episodes excluded when empty |
| UI reads the score as accuracy or the objective as energy | Medium | Medium | Thresholds beside score; "relative objective" label; "Simulated" badge |
| Scope creep into Phase C during B | Medium | Medium | Phase C needs its own plan after Gate B |

## Notes

- **Why no database now.** Rev 1 argued that "you cannot roll back to a state you never stored". That
  is still true, but inside a deterministic 144-tick run the snapshot lives in memory and the response
  is the audit trail. Approval becomes a replay input (`approved_episodes`), not a paused process. A
  database becomes necessary only when episodes outlive a request, i.e. the live rig (Phase C, Supabase).
- **Methodology asset (kept from rev 1, retargeted).** Windowed zone perturbations plus G2
  determinism give reproducible, labelled fault ground truth, which a field study cannot offer. The
  matrix is now calibrated on the sensors the zone controllers actually read.
- **Honest scope.** One simulated building, four irradiance-channel fault kinds, one legitimate
  condition, one mitigation (isolate → model fallback), verified against a same-conditions
  counterfactual. That is a complete loop on a narrow fault set, not a general self-healing BMS.
- `movement_budget()` (`safety.py:27-36`) remains the shipped anti-hunting control; cite it and do
  not rebuild it.
