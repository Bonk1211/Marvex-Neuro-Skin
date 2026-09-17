# Plan: LangGraph Agentic Automatic Fault Correction

## Summary

NeuroSkin already implements the *front half* of Automatic Fault Correction deterministically —
`validation.py` detects a contradicted irradiance sensor, `brain.py` chooses a corrected louvre angle,
`safety.py` vetoes optimisation on power/wind/rain. What is missing is the feedback loop that makes it
AFC rather than FDD: **a calibrated confidence score, a persisted prior state, a verification test, and
a rollback**. This plan builds that back half as pure deterministic Python, then wraps it in a LangGraph
state machine whose only LLM node ranks diagnosis hypotheses and talks to the operator.

## User Story

As a **controls engineer evaluating whether a building-control system can safely correct its own faults**,
I want **a fault to be detected, scored for confidence, safety-gated, corrected, verified against a
measured objective, and automatically rolled back when the correction fails**,
so that **I can quantify correction success rate and prove that no correction ever outranks mechanical
safety**.

## Problem → Solution

**Current:** `sensor_trusted` is a boolean. A rejected reading substitutes the almanac estimate for that
tick and nothing checks whether that helped. There is no stored prior state, so nothing can be undone.

**Desired:** a 7-stage loop — detect → diagnose → confidence → safety gate → snapshot+correct → verify →
keep-or-rollback — with the correction decision made by threshold arithmetic, not by a language model.

## Metadata

- **Complexity**: XL — split at the task-5 boundary. Tasks 1-4 are dependency-free and independently
  shippable; tasks 5-8 add LangGraph and an LLM.
- **Source PRD**: `docs/neuroskin_software_prd.md` (v0.3)
- **PRD Phase**: N/A — this is new scope beyond v0.3 and **contradicts §4.3 non-goals**; see Risks.
- **Estimated Files**: 14 (10 create, 4 update)

---

## Architecture Decision: the LLM is not in the correction path

The single load-bearing decision in this plan. An LLM's self-reported confidence is uncalibrated, so it
must never produce the number that authorises a write.

| Stage | Decided by | Why |
|---|---|---|
| Detect | `validation.validate()` — pure | Already deterministic and tested |
| Diagnose | **LLM** — ranks hypotheses | Natural-language synthesis over read-only evidence; proposes only |
| Confidence | physics residuals — pure | Must be calibratable against injected faults |
| Safety gate | `safety.safety_gate()` — pure | A veto must never be probabilistic |
| Correct | threshold arithmetic — pure | Authorisation is a comparison, not a judgement |
| Verify | objective arithmetic — pure | `E_after < E_before` is measurable |
| Rollback | stored prior state — pure | Must work when the LLM is unreachable |

Enforced structurally: **only read-only tools are bound to the model.** If `apply_correction` appears in
the model's tool list, the architecture is broken.

### Graph

```
                    ┌──────────────┐
     tick ─────────▶│    detect    │  validation.validate()          pure
                    └──────┬───────┘
                           │ fault?
                    ┌──────▼───────┐
                    │  diagnose    │  LLM ranks hypotheses           LLM
                    └──────┬───────┘  read-only tools only
                    ┌──────▼───────┐
                    │  confidence  │  residual math → C ∈ [0,1]      pure
                    └──────┬───────┘
              ┌────────────┼────────────┐
          C<0.70       0.70–0.95      C>0.95
              │            │            │
         ┌────▼───┐  ┌─────▼──────┐    │
         │ monitor│  │ interrupt()│    │  LangGraph human-in-loop
         │  only  │  │  Level 2   │    │
         └────────┘  └─────┬──────┘    │
                       approve         │
                           └─────┬─────┘
                    ┌────────────▼─────┐
                    │  safety_gate     │  VETO only, never an override  pure
                    └────────────┬─────┘
                    ┌────────────▼─────┐
                    │  snapshot+write  │  prior_state → checkpointer
                    └────────────┬─────┘
                    ┌────────────▼─────┐
                    │     verify       │  E_after vs E_before over N ticks
                    └────────┬─────────┘
                   pass ◀────┴────▶ fail
                    │                │
                 ┌──▼──┐        ┌────▼─────┐
                 │ keep│        │ rollback │  restore prior_state
                 └─────┘        └──────────┘
```

### Why LangGraph earns its place

1. `interrupt()` **is** the Level-2 human-approved correction — no custom approval queue.
2. The **checkpointer is the rollback store and the audit trail in one**. Rollback = restore the prior
   checkpoint. This is the strongest single argument for the dependency.
3. Conditional edges express the confidence bands declaratively.

**If you drop the LLM node and human approval, you do not need LangGraph** — tasks 1-4 are a plain
state machine. That is why they are sequenced first and carry no new dependency.

---

## What NeuroSkin already has

| AFC stage | Existing code | State |
|---|---|---|
| Detect | `backend/app/domain/validation.py:9` `validate()` → `(trusted, reason)` | ✅ built, tested |
| Diagnose | the `reason` string returned by `validate()` | ⚠️ 3 hardcoded cases, no ranking |
| Confidence | — | ❌ boolean only |
| Safety gate | `backend/app/domain/safety.py:5` `safety_gate()` | ✅ built, exemplary precedence |
| Anti-hunting | `backend/app/domain/safety.py:27` `movement_budget()` | ✅ built — refuses to move below a gain threshold |
| Decide correction | `backend/app/domain/brain.py:67` `optimise_angle()` + `CostBreakdown` | ✅ built |
| Fault injection | `backend/app/domain/environment.py:218` `inject_sensor_fault()` — `dead_pyranometer`, `stuck_lux`, `drift` | ✅ built — this is the labelled ground truth |
| Write to BAS | — | ❌ no BACnet; §4.3 non-goal |
| Verify | — | ❌ nothing compares before/after |
| Rollback | — | ❌ no persistence |

---

## UX Design

### Before

```
brains lens (from the companion plan):
┌──────────────────────────────┐
│ Sensor trust   ● trusted     │  a boolean, and a reason string
│ Cost breakdown ▓▓▓░ 0.42     │  read-only observation
│ Events         3 this day    │
└──────────────────────────────┘
Read-only. Nothing corrects, nothing verifies.
```

### After

```
┌────────────────────────────────────────────────────────────┐
│ AFC LOOP · zone W7 · tick 14:20                            │
│                                                            │
│  detect ──▶ diagnose ──▶ confidence ──▶ gate ──▶ write     │
│    ✅         ✅            C=0.91        ✅       ⏸        │
│                              │                             │
│                       ┌──────▼──────────────────────┐      │
│                       │ 0.70 < C < 0.95             │      │
│                       │ Substitute almanac estimate │      │
│                       │ for W7 irradiance?          │      │
│                       │        [Approve] [Reject]   │      │
│                       └─────────────────────────────┘      │
│                                                            │
│  Top hypothesis  soiled or failed pyranometer on W7        │
│  Evidence        almanac 780 W/m², neighbours 742-791,     │
│                  W7 sensor 12 W/m², cloud 0.18             │
│                                                            │
│  verify ──▶ E_before 0.412 → E_after 0.318   KEPT ✅       │
└────────────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Sensor fault | boolean `sensor_trusted` + reason | 7-stage loop with a confidence number | |
| Correction | implicit, per-tick, invisible | explicit, logged, reversible | |
| Operator role | none | approves the 0.70–0.95 band | LangGraph `interrupt()` |
| Failed correction | impossible to detect | auto-rollback with stored prior state | |
| Audit | none | checkpoint ledger per correction | |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `backend/app/domain/validation.py` | all (26) | The detector. Returns `(bool, str)` — task 1 adds the score beside it without changing this contract |
| P0 | `backend/app/domain/safety.py` | all (38) | The gate. `safety_gate()` returns `tuple[str,float,str] \| None`; `None` means "no override" |
| P0 | `backend/app/domain/types.py` | 1-32 | `@dataclass(frozen=True)` domain-type convention; `Environment`, `Site` |
| P0 | `backend/app/config.py` | 1-45 | `DEFAULTS` frozen dataclass — every threshold lives here, never inline |
| P0 | `backend/app/domain/environment.py` | 218-225 | `inject_sensor_fault()` — the three labelled fault kinds for calibration |
| P0 | `backend/app/logging_config.py` | 7-33 | **`LOG_FIELDS` is an allowlist.** New structured fields not listed here are dropped |
| P1 | `backend/app/domain/facade.py` | 265-320 | Zone construction; zone id format and the row/column grid |
| P1 | `backend/app/schemas.py` | 95-160 | `ZoneHeatPayload` / `ZoneSensorsPayload` — the evidence the tools return |
| P1 | `backend/app/main.py` | 127-152 | Route + structured-logging pattern for the new endpoint |
| P1 | `backend/tests/test_engine.py` | 1-30 | Pure-domain test style: direct module imports, `DEFAULTS`, no client |
| P2 | `backend/app/domain/brain.py` | 67-158 | `optimise_angle()` and `naive_angle()` — the correction chooser |
| P2 | `backend/tests/test_api.py` | 1-32 | `TestClient` pattern and the reproducibility assertion |
| P2 | `backend/app/vision.py` | 140-170 | `HTTPException` + missing-API-key handling, the model for a missing LLM key |

## External Documentation

```
KEY_INSIGHT: LangGraph's checkpointer gives both persistence and time-travel, so the rollback
             store and the audit trail are the same mechanism. Thread a correction episode with a
             stable thread_id (use "<zone>:<tick>") and rollback becomes "restore the prior
             checkpoint" rather than bespoke undo code.
APPLIES_TO:  Tasks 2, 5, 7
GOTCHA:      The SQLite checkpointer ships as a separate distribution from langgraph itself. Pin
             both exactly, and verify the import path against the installed version before writing
             the module — this API moved more than once during 2024-2025.

KEY_INSIGHT: interrupt() pauses a graph mid-node and surfaces a payload to the caller; the run is
             resumed by invoking the graph again with a resume command on the same thread_id.
APPLIES_TO:  Task 5 (the 0.70-0.95 approval band)
GOTCHA:      interrupt() requires a checkpointer to be configured — without one the graph cannot
             suspend. Task 2 must land before task 5. Resume semantics and the exact Command/resume
             call signature must be confirmed against the pinned version at implementation time.

KEY_INSIGHT: Bind only read-only tools to the model. Tool-calling models will invoke any tool they
             are given if the prompt seems to call for it.
APPLIES_TO:  Task 6
GOTCHA:      This is a structural guarantee, not a prompt instruction. Do not attempt to prevent a
             write by asking the model not to write.
```

**Verify before coding**: LangGraph's public API (`StateGraph`, `add_conditional_edges`, `interrupt`,
checkpointer import path, resume-command signature) has changed across minor versions and my knowledge
has a cutoff. Read the installed package's own docs after pinning, and treat the snippets in this plan
as shape, not as verified call signatures.

---

## Patterns to Mirror

### DOMAIN_DATACLASS
```python
# SOURCE: backend/app/domain/types.py:6-21
@dataclass(frozen=True)
class Environment:
    t: datetime
    ghi: float
    dni: float
    dhi: float
    diffuse_fraction: float
    cloud: float
    wind: float
    rain: bool
```
Frozen dataclasses, plain builtin types, no methods. Mutation via `dataclasses.replace`.

### PURE_DOMAIN_FUNCTION
```python
# SOURCE: backend/app/domain/validation.py:1-26
from app.config import DEFAULTS
from app.domain.types import Environment, SolarState


def expected_irradiance(env: Environment, solar: SolarState) -> float:
    return max(0.0, solar.clear_sky_ghi * (1.0 - DEFAULTS.cloud_attenuation * env.cloud))


def validate(env: Environment, solar: SolarState) -> tuple[bool, str]:
    expected = expected_irradiance(env, solar)
    contradiction = (
        solar.elevation > DEFAULTS.min_elevation
        and expected > DEFAULTS.expected_irradiance_threshold
        and env.measured_irradiance < DEFAULTS.near_zero_irradiance
    )
    if contradiction and env.cloud < DEFAULTS.low_cloud_threshold:
        return (
            False,
            "Almanac predicts strong sun while the sensor reads near zero under a clear sky; "
            "ignore the likely dirty or failed pyranometer and use the almanac estimate.",
        )
    return True, "Sensor reading is consistent with the solar almanac and cloud state."
```
Module-level functions, no classes, no I/O, no logging. Every threshold from `DEFAULTS`. Verdicts
returned as `(value, human_reason)` tuples where the reason is a full sentence explaining the physics.
**The new confidence scorer must follow this shape exactly.**

### VETO_RETURNS_NONE
```python
# SOURCE: backend/app/domain/safety.py:5-25
def safety_gate(env: Environment, power_ok: bool) -> tuple[str, float, str] | None:
    if not power_ok:
        return (
            "SAFE",
            DEFAULTS.shaded_default,
            "Power loss detected; fail-safe mechanics settle the facade at the shaded default.",
        )
    if env.wind >= DEFAULTS.critical_wind:
        return ("SAFE", DEFAULTS.retract_flat, "Critical wind overrides optimisation; ...")
    return None
```
`None` means "nothing to override". The AFC gate node must call this unchanged and treat any non-`None`
result as an absolute veto — never weigh it against confidence.

### CONFIG_THRESHOLD
```python
# SOURCE: backend/app/config.py:3-27
@dataclass(frozen=True)
class SimulationDefaults:
    min_elevation: float = 8.0
    expected_irradiance_threshold: float = 250.0
    near_zero_irradiance: float = 25.0
    low_cloud_threshold: float = 0.35
    cloud_attenuation: float = 0.72
```
Every tunable is a field on the frozen `SimulationDefaults` with a comment when the value is an
assumption rather than a measurement. AFC thresholds (`afc_auto_confidence`, `afc_ask_confidence`,
`afc_verify_ticks`) go here — **never inline in the graph**.

### STRUCTURED_LOGGING
```python
# SOURCE: backend/app/main.py:133-147
    logger.info(
        "Slab plan completed",
        extra={
            "event": "slab_plan_completed",
            "request_id": request_id,
            "planned_date": result.date.isoformat(),
            "applicable": result.applicable,
            "duration_ms": round((perf_counter() - started) * 1000, 2),
        },
    )
```
Human message first, machine fields in `extra` with a snake_case `event` key.

### LOG_FIELD_ALLOWLIST
```python
# SOURCE: backend/app/logging_config.py:7-33
LOG_FIELDS = (
    "event",
    "request_id",
    ...
    # Predictive slab charging.
    "planned_date",
    "forecast_status",
    "claim_allowed",
)
```
**Fields absent from this tuple never reach the log output.** Add an `# Automatic fault correction.`
comment block with `zone`, `fault_kind`, `confidence`, `afc_verdict`, `e_before`, `e_after`.

### PYDANTIC_SCHEMA
```python
# SOURCE: backend/app/schemas.py:102-120
class ZoneHeatPayload(BaseModel):
    """One cell of one wall's 4 x 4 zone grid, with its own controller's state."""

    row: int
    column: int
    zone: str
    incident: float
    sensor_trusted: bool
    reason: str
```
Docstring stating the physical meaning; flat scalar fields; `Field(...)` with `ge`/`le` bounds on
request models (see `schemas.py:291-307`).

### DOMAIN_TEST
```python
# SOURCE: backend/tests/test_engine.py:1-30
from app.config import DEFAULTS
from app.domain.brain import optimise_angle
from app.domain.safety import movement_budget, safety_gate
from app.domain.validation import validate


def test_solar_is_dark_at_midnight_and_peaks_during_day() -> None:
    tz = ZoneInfo(DEFAULTS.timezone)
    midnight = sun_position(datetime(2026, 3, 21, 0, 0, tzinfo=tz))
    assert midnight.elevation <= 0
```
Direct module imports, no client, no fixtures, no mocks. Test names are full behavioural sentences.
Typed `-> None`. Pure-domain tests go in `test_engine.py` style files; API tests use `TestClient`.

### API_ROUTE
```python
# SOURCE: backend/app/main.py:152-160
@app.post("/api/v1/simulations/run", response_model=SimulationRunResponse)
def run_simulation(request: SimulationRunRequest, http_request: Request) -> SimulationRunResponse:
    request_id = http_request.state.request_id
    started = perf_counter()
```
Decorator with explicit `response_model`, sync `def`, `http_request: Request` second for the request id.

### MISSING_KEY_HANDLING
```python
# SOURCE: backend/app/vision.py:143
        raise HTTPException(503, "Cloud vision needs ROBOFLOW_API_KEY on the backend.")
```
A missing credential is a 503 with a sentence naming the variable. **Never a `NEXT_PUBLIC_` variable.**

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `backend/app/domain/afc/__init__.py` | CREATE | New subpackage; keeps AFC out of the deterministic sim modules |
| `backend/app/domain/afc/confidence.py` | CREATE | Pure residual-agreement scorer — task 1 |
| `backend/app/domain/afc/ledger.py` | CREATE | Correction records + prior-state snapshot/restore — task 2 |
| `backend/app/domain/afc/verify.py` | CREATE | `E_before` / `E_after` objective — task 3 |
| `backend/app/domain/afc/loop.py` | CREATE | Deterministic 7-stage state machine, no LangGraph — task 4 |
| `backend/app/domain/afc/tools.py` | CREATE | Read-only evidence tools — task 6 |
| `backend/app/domain/afc/graph.py` | CREATE | LangGraph wiring of the task-4 nodes — task 5 |
| `backend/app/domain/afc/diagnose.py` | CREATE | The single LLM node — task 6 |
| `backend/app/schemas.py` | UPDATE | `AfcEpisodeRequest` / `AfcEpisodeResponse` / `AfcStagePayload` |
| `backend/app/config.py` | UPDATE | `afc_auto_confidence`, `afc_ask_confidence`, `afc_verify_ticks`, `afc_neighbour_radius` |
| `backend/app/logging_config.py` | UPDATE | Extend `LOG_FIELDS` — otherwise AFC logs silently vanish |
| `backend/app/main.py` | UPDATE | `POST /api/v1/afc/episode` + resume route |
| `backend/pyproject.toml` | UPDATE | Pin `langgraph`, the SQLite checkpointer, and one LLM client |
| `backend/tests/test_afc.py` | CREATE | Confidence calibration, verify/rollback, gate precedence |

## NOT Building

- **Any LLM authority over a write.** The model proposes and explains. It never emits the confidence
  number and never holds a write tool.
- **A real BACnet / BMS / MQTT adapter.** §4.3 non-goal, and no hardware exists (`hardware/` holds only
  a README). The write target is the simulator. Name the writer so the seam is obvious; do not build an
  interface abstraction for one implementation.
- **Seven correction algorithms.** LBNL shipped seven because they had four real buildings and three BAS
  platforms. Build **one fault, one correction, end to end**. A second fault type is task-9 scope, after
  the loop is proven.
- **PID retuning, static-pressure reset, SAT reset, rogue-zone mitigation, schedule rewriting,
  economizer tuning.** All require an HVAC/plant model that does not exist anywhere in this repo.
- **Learned or trained diagnosis models.** §4.3 non-goal. Confidence is physics arithmetic.
- **Multi-tenant persistence, accounts, permissions, approvals audit UI.** The checkpointer stores
  correction episodes only.
- **Any claim of measured energy saving from a correction.** §4.2 — facade load stays a relative index.
  `E_before`/`E_after` are relative-index objectives, never kWh.
- **Streaming/token-level UI for the LLM node.** One request, one ranked hypothesis list.

---

## Step-by-Step Tasks

### Task 1: Confidence scorer — pure, zero new dependencies
- **ACTION**: Create `backend/app/domain/afc/confidence.py`.
- **IMPLEMENT**: Three independent estimates of one zone's irradiance, then score the suspect:
  ```python
  def zone_confidence(
      suspect: float,           # zone sensors.irradiance
      almanac: float,           # validation.expected_irradiance(env, solar)
      neighbours: tuple[float, ...],  # adjacent zones, same wall, sunlit-scaled
  ) -> tuple[float, str]:
  ```
  The sensor is the faulty one **iff the other two estimators agree with each other and both disagree
  with it**. Compute neighbour median and MAD; score = (almanac↔neighbour agreement) × (suspect
  disagreement), each term normalised to `[0,1]` and clamped. Return `(confidence, reason)` where the
  reason is a full sentence naming the three values, mirroring `validate()`.
- **MIRROR**: PURE_DOMAIN_FUNCTION, CONFIG_THRESHOLD.
- **IMPORTS**: `from app.config import DEFAULTS`; `from app.domain.types import Environment, SolarState`.
  No numpy needed for a 16-element median — use `statistics.median`.
- **GOTCHA**: Return `0.0` when fewer than 3 neighbours are sunlit — a single neighbour cannot establish
  agreement, and a high score from thin evidence is the exact failure mode that makes AFC dangerous.
  Guard MAD = 0 (all neighbours identical, common at night) before dividing. Do **not** score at all
  when `solar.elevation <= DEFAULTS.min_elevation`; at night every estimator reads zero and agreement is
  meaningless.
- **VALIDATE**: Calibration test using `inject_sensor_fault` (`environment.py:218`) — inject
  `dead_pyranometer` and assert confidence > `afc_auto_confidence`; inject `drift` (0.42×) and assert it
  lands in the ask band; a clean environment must score below `afc_ask_confidence`. Because PRD G2
  guarantees identical output for an identical seeded request, these thresholds are reproducible —
  **this is the methodology contribution, write it up.**

### Task 2: Correction ledger and prior-state store
- **ACTION**: Create `backend/app/domain/afc/ledger.py`.
- **IMPLEMENT**: A frozen `CorrectionRecord` dataclass (`zone`, `tick`, `fault_kind`, `confidence`,
  `point`, `value_from`, `value_to`, `verdict`, `e_before`, `e_after`) plus `snapshot()` / `restore()`
  over a SQLite file. Verdict is a `Literal["monitoring","awaiting_approval","applied","kept","rolled_back","vetoed"]`.
- **MIRROR**: DOMAIN_DATACLASS for the record; `Literal` usage as in `schemas.py:99`.
- **IMPORTS**: stdlib `sqlite3`, `dataclasses`, `datetime`, `typing.Literal`. No ORM.
- **GOTCHA**: §4.3 lists "no database" as a non-goal and every existing endpoint is stateless — this
  task deliberately breaks that, and it is unavoidable: **you cannot roll back to a state you never
  stored.** Keep the scope to correction episodes only; do not start persisting simulation runs.
  Put the DB path in `DEFAULTS` and default it under a gitignored directory. Store timestamps as
  ISO-8601 UTC strings, matching `result.date.isoformat()` usage at `main.py:137`.
- **VALIDATE**: Round-trip test — snapshot, mutate, restore, assert the original value returns. Use
  `tmp_path` so no test writes to the repo.

### Task 3: Verification objective
- **ACTION**: Create `backend/app/domain/afc/verify.py`.
- **IMPLEMENT**:
  ```python
  def objective(ticks: Sequence[TickPayload], zone: str) -> float:
      """Σ |load_relative − naive_load_relative| over the window. Lower is better."""
  ```
  plus `def verdict(e_before: float, e_after: float, residual_collapsed: bool, safe_fired: bool) -> str`
  returning `"kept"` or `"rolled_back"`. Keep only when **all three** hold: `e_after < e_before`, the
  neighbour residual from task 1 collapsed, and no `SAFE` mode fired in the window.
- **MIRROR**: PURE_DOMAIN_FUNCTION.
- **IMPORTS**: `from app.schemas import TickPayload`.
- **GOTCHA**: The window is `DEFAULTS.afc_verify_ticks` ticks at 10 minutes each — confirm the window
  stays inside daylight, or a correction applied at 18:00 verifies against darkness and always "passes".
  Both objectives are **relative-index sums, never kWh** (§4.2). A correction that improves the
  objective while tripping a safety state is a **rollback**, not a keep — safety is not a tiebreaker.
- **VALIDATE**: Table test over the eight `(e_after<e_before, residual_collapsed, safe_fired)`
  combinations; assert only `(True, True, False)` returns `"kept"`.

### Task 4: Deterministic loop — still no LangGraph
- **ACTION**: Create `backend/app/domain/afc/loop.py`.
- **IMPLEMENT**: A plain function threading the seven stages, returning an ordered list of stage
  results. Diagnosis is the hardcoded `validate()` reason at this stage — no LLM yet. Confidence bands
  route to `monitoring` / `awaiting_approval` / straight through. `safety_gate()` is consulted
  immediately before the write and any non-`None` result short-circuits to `vetoed`.
- **MIRROR**: PURE_DOMAIN_FUNCTION; VETO_RETURNS_NONE.
- **IMPORTS**: `from app.domain.safety import safety_gate`; `from app.domain.validation import validate`;
  the three new afc modules.
- **GOTCHA**: **Safety is a veto, never a weight.** Do not let a 0.99 confidence override a `SAFE`
  return — that inverts PRD G3, the product's central safety claim. This function must remain callable
  with no LLM and no network so rollback works when the model is unreachable.
- **VALIDATE**: End-to-end test with an injected `dead_pyranometer`: assert the stage sequence, the
  applied correction, and a `kept` verdict. Second test with `power_ok=False`: assert `vetoed` and that
  **no write was recorded in the ledger**.

> **Shippable boundary.** Tasks 1-4 add zero dependencies and deliver detect → confidence → gate →
> correct → verify → rollback. Run the full suite and commit here before touching `pyproject.toml`.

### Task 5: LangGraph wiring
- **ACTION**: Create `backend/app/domain/afc/graph.py`; pin dependencies in `pyproject.toml`.
- **IMPLEMENT**: A `TypedDict` state and a `StateGraph` whose nodes call the **task-4 functions
  unchanged**. Conditional edges implement the confidence bands; the ask band calls `interrupt()` with
  the proposed correction as its payload. Configure the SQLite checkpointer from task 2's path, thread
  id `f"{zone}:{tick}"`.
  ```python
  class AfcState(TypedDict):
      zone: str
      tick: str
      fault: str | None
      hypotheses: list[dict]
      confidence: float
      correction: dict | None
      prior_state: dict | None
      verdict: str
      e_before: float
      e_after: float | None
  ```
- **MIRROR**: DOMAIN_DATACLASS conventions for any helper; CONFIG_THRESHOLD for band edges.
- **IMPORTS**: `langgraph` + the SQLite checkpointer, both pinned exactly.
- **GOTCHA**: `interrupt()` **requires a configured checkpointer** — task 2 must be done first. Nodes
  must stay thin adapters; if business logic starts living in graph nodes instead of the task-1-to-4
  modules, the loop is no longer testable without LangGraph. Verify the checkpointer import path and
  the resume-command signature against the installed version — these moved across minor releases and
  the snippets here are shape only. Add `langgraph` to the main dependency list, not `dev`.
- **VALIDATE**: Graph-level test asserting an ask-band episode suspends and that resuming with approval
  reaches `kept` while resuming with rejection reaches `monitoring` with no ledger write.

### Task 6: Read-only tools and the LLM diagnose node
- **ACTION**: Create `tools.py` and `diagnose.py`.
- **IMPLEMENT**: Read-only tools only:
  ```python
  get_zone_readings(zone, tick)      -> ZoneHeatPayload
  get_neighbour_zones(zone, tick)    -> list[ZoneHeatPayload]
  get_almanac_expectation(tick)      -> float
  get_zone_history(zone, start, end) -> list[dict]
  get_cost_breakdown(tick)           -> CostBreakdown
  get_safety_state(tick)             -> str | None
  ```
  `diagnose.py` binds **only these** and asks for a ranked hypothesis list, each entry
  `{cause, evidence, rank}`. It must not be asked for a probability.
- **MIRROR**: PURE_DOMAIN_FUNCTION for tool bodies (they read a run payload, no I/O);
  MISSING_KEY_HANDLING for an absent LLM key.
- **IMPORTS**: `from app.schemas import CostBreakdown, ZoneHeatPayload`; the LLM client.
- **GOTCHA**: **Do not bind `apply_correction`, `rollback`, or any write tool to the model.** Enforce by
  what you pass to `bind_tools`, not by prompt wording. If the LLM is unavailable or unkeyed, the graph
  must fall through to the task-4 hardcoded `validate()` reason and continue — a missing model degrades
  diagnosis quality, it must never block a correction or a rollback. Zone ids are `W1`…`W16`
  (`facade.py:274` → `f"{orientation[0].upper()}{row * columns + column + 1}"`), not `W-r2-c3`.
  Read the API key from a backend env var; never a `NEXT_PUBLIC_` name.
- **VALIDATE**: Test that the bound tool list contains no write tool. Test that with the LLM key unset,
  an episode still completes with the deterministic reason and a `kept` verdict.

### Task 7: API endpoint
- **ACTION**: Add `POST /api/v1/afc/episode` and a resume route to `main.py`; add schemas; extend
  `LOG_FIELDS`.
- **IMPLEMENT**: Request takes a simulation request plus target zone and optional injected fault kind.
  Response returns the ordered stage payloads, confidence, verdict, and both objectives. Log once per
  episode with `event="afc_episode_completed"`.
- **MIRROR**: API_ROUTE, STRUCTURED_LOGGING, PYDANTIC_SCHEMA, LOG_FIELD_ALLOWLIST.
- **IMPORTS**: new schemas from `app.schemas`; `from app.domain.afc.graph import run_episode`.
- **GOTCHA**: Add `zone`, `fault_kind`, `confidence`, `afc_verdict`, `e_before`, `e_after` to
  `LOG_FIELDS` in `logging_config.py` under an `# Automatic fault correction.` comment — **fields not
  in that tuple are silently dropped**, and a silent audit trail is worse than none. The endpoint is
  now stateful, unlike every existing route; say so in its docstring. An episode awaiting approval must
  return 200 with `verdict="awaiting_approval"` and the thread id, not block the request.
- **VALIDATE**: `TestClient` test asserting a `dead_pyranometer` episode returns the full stage list and
  `verdict` in `{"kept","rolled_back"}`; a `power_ok=False` episode returns `"vetoed"`.

### Task 8: AFC loop panel in the brains lens
- **ACTION**: Replace the read-only brains-lens content from the companion plan with the loop view.
- **IMPLEMENT**: Seven stage chips lit in order; the confidence number with its band thresholds; the
  ask-band approval rendered as inline Approve/Reject calling the resume route; top hypothesis with its
  evidence; `E_before → E_after` and the keep/rollback verdict.
- **MIRROR**: the companion plan's CARD_SECTION and BUTTON_GROUP_FROM_CONFIG patterns; API_CLIENT_FUNCTION
  for the two new client calls.
- **IMPORTS**: new response types in `frontend/src/lib/types.ts` mirroring the task-7 schemas.
- **GOTCHA**: Depends on `.claude/PRPs/plans/dashboard-lens-split-and-provenance.plan.md` task 5 having
  landed — build that plan first. Show the confidence *band thresholds* next to the number, or `0.91`
  reads as an accuracy claim rather than a routing decision. Label every objective as a relative index.
- **VALIDATE**: Test that an `awaiting_approval` episode renders both buttons and that a `vetoed`
  episode renders no approval affordance at all.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| confidence high on dead sensor | `inject_sensor_fault(env,'dead_pyranometer')` | `C > afc_auto_confidence` | no |
| confidence mid on drift | `inject_sensor_fault(env,'drift')` (0.42×) | `afc_ask_confidence < C < afc_auto_confidence` | no |
| confidence low when clean | untouched env | `C < afc_ask_confidence` | no |
| thin evidence scores zero | 2 sunlit neighbours | `C == 0.0` | **yes — dangerous case** |
| night is not scored | `solar.elevation <= min_elevation` | `C == 0.0`, no diagnosis | yes |
| identical neighbours | MAD == 0 | no ZeroDivisionError | yes |
| ledger round-trip | snapshot → mutate → restore | original value returns | no |
| verify truth table | 8 combinations | only `(True,True,False)` → `kept` | yes |
| safety vetoes high confidence | `C=0.99`, `power_ok=False` | `vetoed`, **no ledger write** | **yes — G3** |
| rollback on failed correction | `e_after > e_before` | `rolled_back`, prior state restored | yes |
| loop runs without LLM | LLM key unset | completes with deterministic reason | **yes** |
| no write tool bound | inspect bound tools | list contains no write tool | **yes — architectural** |
| ask band suspends | `C` in ask band | graph interrupts, thread id returned | yes |
| resume approve | approval on the thread | reaches `kept` | yes |
| resume reject | rejection on the thread | `monitoring`, no ledger write | yes |
| episode endpoint | `POST` with `dead_pyranometer` | stage list + verdict | no |
| reproducibility preserved | same seed twice | identical simulation payload | **yes — G2** |

### Edge Cases Checklist
- [ ] Empty input — zone with no sunlit neighbours; night ticks
- [ ] Maximum size input — all 64 zones faulted at once; episodes must not fan out unbounded
- [ ] Invalid types — unknown `fault_kind` → `inject_sensor_fault` raises `ValueError` (`environment.py:225`); surface as 422, not 500
- [ ] Concurrent access — two episodes on the same zone; SQLite write lock and thread-id collision
- [ ] Network failure — LLM unreachable mid-episode; must degrade, never block rollback
- [ ] Permission denied — SQLite path unwritable; fail loudly at startup, not at correction time
- [ ] Missing credential — LLM key unset → 503 naming the variable, per `vision.py:143`
- [ ] Verify window runs past sunset — correction applied late in the day

---

## Validation Commands

### Static Analysis
```bash
cd backend && uv run ruff check app tests
```
EXPECT: Zero errors. `ruff` selects `E,F,I,UP` with `line-length = 100` (`pyproject.toml`).

### Unit Tests — AFC only
```bash
cd backend && uv run pytest tests/test_afc.py -q
```
EXPECT: All pass.

### Full Test Suite
```bash
cd backend && uv run pytest -q
cd frontend && npm test
```
EXPECT: No regressions. `test_api.py::test_simulation_is_reproducible_and_complete` must still pass —
**AFC must not perturb the deterministic simulation path (PRD G2).**

### Determinism Guard
```bash
cd backend && uv run pytest tests/test_api.py -q -k reproducible
```
EXPECT: Pass. Run after every AFC task, not just at the end.

### Dependency Audit
```bash
cd backend && uv run python -c "import langgraph; print(langgraph.__version__)"
```
EXPECT: The exact pinned version. Confirm the checkpointer import path against it before task 5.

### Manual Validation
- [ ] `POST /api/v1/afc/episode` with `dead_pyranometer` on `W7` — confidence above the auto band,
      correction applied, `kept`
- [ ] Same with `power_ok: false` — `vetoed`, and the ledger holds **no** applied record
- [ ] Force `e_after > e_before` (invert the objective temporarily) — `rolled_back`, prior state restored
- [ ] Unset the LLM key — episode still completes end to end
- [ ] `drift` fault — suspends in the ask band; resume approve → `kept`; resume reject → no write
- [ ] Kill the process mid-episode, restart, resume the thread — checkpoint recovers
- [ ] `grep -r "kWh\|carbon\|payback" backend/app/domain/afc/` — no hits

---

## Acceptance Criteria
- [ ] All 8 tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing
- [ ] No lint errors
- [ ] Matches the graph diagram above
- [ ] Confidence thresholds calibrated against all three `inject_sensor_fault` kinds and recorded
- [ ] **No write tool is bound to the LLM** — asserted by a test
- [ ] **`safety_gate()` is a veto that no confidence can override** — asserted by a test
- [ ] Loop completes with the LLM unavailable — asserted by a test
- [ ] `LOG_FIELDS` extended; an episode produces a complete structured log line
- [ ] Simulation reproducibility (G2) unaffected
- [ ] No kWh, carbon, or cost figure anywhere in the AFC package

## Completion Checklist
- [ ] Code follows discovered patterns
- [ ] Error handling matches codebase style (`HTTPException` with a sentence, `ValueError` in domain)
- [ ] Logging follows codebase conventions and `LOG_FIELDS` is updated
- [ ] Tests follow `test_engine.py` pure-domain style
- [ ] No hardcoded thresholds — all in `DEFAULTS`
- [ ] `docs/neuroskin_software_prd.md` updated: §4.3 no longer accurate (a DB now exists), §3.2 gains
      the AFC job, §4.2 gains a guardrail that corrections are simulated and not commissioned
- [ ] No unnecessary scope additions
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM ends up authorising writes as the graph grows | Medium | **Critical** | Read-only `bind_tools` + an architectural test; write tools live outside the model's reach |
| Confidence score uncalibrated, correcting healthy sensors | High | **Critical** | Task 1 calibration against all three injected faults; thin-evidence floor returns 0.0 |
| Confidence weighed against safety instead of gated by it | Medium | **Critical** | `safety_gate()` short-circuits before any write; explicit test with `C=0.99` |
| Persistence contradicts PRD §4.3 non-goal | Certain | Medium | Scope the DB to correction episodes only; update the PRD in the same PR |
| LangGraph API drift against this plan's snippets | High | Medium | Pin exact versions; verify import paths and resume signature before task 5; snippets are shape only |
| AFC perturbs the deterministic simulation, breaking G2 | Medium | High | Determinism guard command run after every task |
| Verify window falls in darkness, passing every correction | Medium | High | Task 3 GOTCHA — assert the window is in daylight |
| Scope creep into PID/SAT/static-pressure algorithms | High | High | Explicit NOT-Building list; none of those have a model in this repo |
| Demo read as a live self-healing BMS | Medium | High | There is no BAS; the write target is the simulator. Keep the provenance strip from the companion plan visible |
| SQLite lock contention across concurrent episodes | Low | Medium | One episode per zone; thread id `zone:tick` |

## Notes

- **The contribution is the back half.** Detect, diagnose, decide and safety-gate already exist and are
  tested (`validation.py`, `brain.py`, `safety.py`). Confidence, verify and rollback do not. Framing the
  work that way is both accurate and a stronger story than "we built an AI fault detector".
- `safety.py:27` `movement_budget()` already refuses to move an actuator unless predicted gain clears
  `DEFAULTS.movement_threshold` — that is the facade cousin of LBNL's control-hunting correction, and it
  is already shipped. Cite it rather than rebuilding it.
- `inject_sensor_fault()` (`environment.py:218`) plus PRD G2 determinism gives **reproducible labelled
  fault ground truth**. That is something a real-building AFC study cannot offer and is the strongest
  methodological claim available here — calibrate thresholds against it and report the sweep.
- Berkeley Lab's 2022 field study covered seven algorithms across four buildings and three BAS platforms.
  Scope honestly against that: one fault, one correction, one simulated building, with a verified
  feedback loop. A complete loop on one fault is a stronger result than seven detectors with no loop.
- **Deliberate ponytail boundary at task 4.** Tasks 1-4 need no new dependency and already deliver the
  full AFC loop. LangGraph buys `interrupt()`-based approval, checkpoint persistence and LLM
  orchestration; if the operator-approval band and the LLM diagnosis are cut, the graph is not needed.
  Ship and commit at the task-4 line before adding dependencies.
- Companion plan: `.claude/PRPs/plans/dashboard-lens-split-and-provenance.plan.md` — build it first;
  its brains lens (task 5) is where this plan's task 8 renders.
