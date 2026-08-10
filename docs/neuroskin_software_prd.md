# Software Technical Implementation Spec — Neuro-Skin Simulation Proof

**The preliminary-round software deliverable: a simulation proof of the decision brain**

| | |
|---|---|
| Document type | Software PRD / technical implementation spec |
| Version | 0.1 (build reference for C and D) |
| Scope | Preliminary-round **simulation proof** — NOT the production twin |
| Owners | Teammate C (forecast & geometry), Teammate D (decision & trust) |
| Language | Python ≥ 3.10 |

> Build goal: one self-contained Python simulation that runs a representative tropical day and renders three demos — the lie-detector catch, naive-vs-co-optimisation, and movement-budget/fail-shaded — proving the decision logic does something a static system cannot.

---

## 0. Scope and non-scope

**In scope (build this):** a modelled tropical day, a controller that runs the decision loop each tick, the six engine modules, and a Streamlit surface that shows decisions *and their reasons*. This surface is the lightweight "digital twin" the preliminary round needs (simulated state + explainability).

**Out of scope (describe in the proposal §4.2, do not build):** MQTT, time-series DB, edge controllers (ESP32/RPi), a React dashboard, a live-sensor pipeline, all 16 physical zones. Per product PRD NG4. Every hour on a message broker is an hour stolen from the lie-detector, which is what scores.

**Hard software guardrails (from product PRD §9 — these shape the code):**
- **G1** — The sim's "cooling load" is a **relative/proxy quantity**. It is plotted as *load reduction / shift*, and is **never** converted into an HVAC-kWh saving via the affinity cube law. Plot axes are: cooling **load** (relative), lux-compliance %, movement count. No chained thermal-%→HVAC-% number appears anywhere in the output.
- **G2** — The thermal model **includes a latent component that shading does not reduce**, so the load-reduction curve honestly shows a floor. This is a feature, not a bug — it demonstrates you understand tropical physics.
- **G3** — Every plot title/caption **labels synthetic data as synthetic** (e.g. "modelled KL clear-sky day, synthetic diffuse-fraction profile"). Integrity signal.

---

## 1. Tech stack (concrete)

| Purpose | Library | Notes |
|---|---|---|
| Solar position + irradiance | `pvlib` | SPA sun-position; `pvlib.irradiance` for GHI→DNI/DHI decomposition (powers the diffuse-fraction story) |
| Numerics | `numpy`, `pandas` | tick series as a DataFrame |
| Load prediction | `scikit-learn` (`RandomForestRegressor`) | lightweight; LightGBM optional if the boosting story is wanted |
| Angle optimisation | `numpy` grid search (primary) / `scipy.optimize.minimize_scalar` | α is a bounded scalar — grid search is defensible and matches "evaluate allowable angles" |
| Static plots | `matplotlib` | appendix-quality figures |
| Interactive plots | `plotly` | in the Streamlit surface |
| Demo surface | `streamlit` | sliders, naive/co-opt toggle, explainability panel |
| Collaboration | `git` + one repo | module boundary = ownership boundary |

`requirements.txt`:
```
python>=3.10
pvlib
numpy
pandas
scikit-learn
matplotlib
plotly
streamlit
```

---

## 2. Repository structure

```
neuroskin-sim/
├── README.md
├── requirements.txt
├── neuroskin/
│   ├── __init__.py
│   ├── types.py          # SHARED CONTRACT — C and D co-own; agree day one
│   ├── environment.py    # C
│   ├── solar.py          # C
│   ├── thermal.py        # C
│   ├── validation.py     # D
│   ├── brain.py          # D
│   ├── safety.py         # D
│   └── controller.py     # shared (loop orchestration)
├── app.py                # shared (Streamlit surface)
├── scenarios/
│   ├── tier1_liedetector.py
│   ├── tier2_naive_vs_coopt.py
│   └── tier3_budget_failsafe.py
└── tests/
    ├── test_solar.py
    ├── test_validation.py
    └── test_brain.py
```

**`types.py` is the single co-owned file.** It defines the dataclasses that cross the two seams. Freeze it on day one; after that, C and D never edit the same file.

---

## 3. Shared state contract (`types.py`)

Three dataclasses flow through the loop. C produces `Environment` + `SolarState`; D produces `Decision`. The controller assembles them per tick.

```python
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class Environment:
    """Ground truth + (possibly corrupted) sensor readings for one tick. Owner: C."""
    t: datetime
    # --- true environment ---
    ghi: float            # global horizontal irradiance, W/m^2
    dni: float            # direct normal
    dhi: float            # diffuse horizontal
    diffuse_fraction: float
    cloud: float          # 0..1
    wind: float           # m/s
    rain: bool
    outdoor_temp: float   # deg C
    occupancy: float      # 0..1 (drives internal + latent load)
    # --- sensor readings (may be faulted in scenarios) ---
    measured_irradiance: float   # what the pyranometer reports (can be corrupted)
    indoor_lux: float
    indoor_temp: float
    indoor_rh: float

@dataclass
class SolarState:
    """Astronomical ground-truth for one tick. Owner: C. SEAM 1 -> D.validation."""
    azimuth: float        # deg
    elevation: float      # deg (>0 = above horizon)
    clear_sky_ghi: float  # expected GHI under clear sky (the lie-detector reference)

@dataclass
class Decision:
    """Controller output for one tick. Owner: D."""
    mode: str             # "NORMAL" | "SAFE" | "FAULT_HOLD" | "HOLD"
    sensor_trusted: bool
    angle_target: float   # from brain, before local trim
    angle_final: float    # after safety / budget / trim
    moved: bool
    reason: str           # explainability string for the twin surface
    cost_breakdown: dict = field(default_factory=dict)  # {thermal, lux, move, risk}
```

---

## 4. The two interface seams (freeze these signatures first)

Everything else is parallelisable once these two functions are agreed.

**Seam 1 — sun position (C → D):**
```python
# solar.py  (C)
def sun_position(t: datetime, lat: float, lon: float) -> SolarState: ...
```
Consumed by `validation.py` (D): `clear_sky_ghi` and `elevation` are the reference the lie-detector checks `measured_irradiance` against.

**Seam 2 — predicted load (C → D):**
```python
# thermal.py  (C)
def predict_load(env: Environment, solar: SolarState,
                 history: "pd.DataFrame | None") -> float: ...
```
Consumed by `brain.py` (D): the returned load index is the `Q_pred` term in `J(α)`.

---

## 5. Module specifications

### 5.1 `environment.py` — Environment generator (C)

**Responsibility:** produce a realistic synthetic tropical day as a series of `Environment` ticks, and inject faults on demand for scenarios.

Key functions:
```python
def generate_day(date, lat, lon, *, cloud_profile="scattered",
                 tick_minutes=10) -> list[Environment]: ...
def inject_sensor_fault(env: Environment, kind: str) -> Environment:
    # kind: "dead_pyranometer" | "stuck_lux" | "drift"
```
Notes:
- Irradiance from `pvlib` clear-sky, then attenuated by a synthetic cloud process (add stochastic cloud events for the cloud-gating story).
- Compute `diffuse_fraction` explicitly and keep it high — this is the tropical signature.
- `occupancy` drives internal and **latent** load in the thermal model (G2).

**Acceptance:** a plotted day shows plausible GHI/DNI/DHI, a high diffuse fraction, and at least one cloud event; `inject_sensor_fault("dead_pyranometer")` zeroes `measured_irradiance` while true `ghi` stays high.

### 5.2 `solar.py` — Sun position (C) — SEAM 1

**Responsibility:** wrap `pvlib` to return `SolarState` per tick.

```python
def sun_position(t, lat, lon) -> SolarState:
    # pvlib.solarposition.get_solarposition -> azimuth, elevation
    # pvlib clear-sky model (e.g. Ineichen) -> clear_sky_ghi
```
Notes: this is trivial compute. Its value is as **ground-truth for the lie-detector**, not as a feature. Do not dress it up.

**Acceptance:** elevation ≤ 0 before sunrise / after sunset; `clear_sky_ghi` peaks near solar noon and matches `pvlib` reference within tolerance.

### 5.3 `thermal.py` — Thermal + slab model (C) — SEAM 2

**Responsibility:** predict near-horizon cooling load; optionally model slab charge.

```python
def predict_load(env, solar, history=None) -> float:
    # sensible facade gain (shadeable) + internal + LATENT (not shadeable, G2)
def slab_state(history, forecast) -> float:   # OPTIONAL, gated on O1
```
Notes:
- Load = shadeable sensible gain **+ a latent/outdoor-air floor that shading cannot remove** (G2). The load-reduction plots must bottom out at this floor.
- Prediction can start rule-based, then upgrade to a `RandomForestRegressor` trained on generated days (FR-11).
- **Slab charging is gated on open question O1** (thermal-mass building?). If O1 fails, `slab_state` is dropped and C deepens the generic load forecast instead — C is never stranded.

**Acceptance:** predicted load rises with irradiance × exposure and with occupancy; the latent floor is visible (load never drops to zero under full shading).

### 5.4 `validation.py` — Sensor cross-check / lie-detector (D)

**Responsibility:** decide whether to trust the irradiance sensor, using the almanac as reference. **This is the headline feature.**

```python
def validate(env: Environment, solar: SolarState) -> tuple[bool, str]:
    expected = solar.clear_sky_ghi * (1 - CLOUD_ATTEN * env.cloud)
    sun_up   = solar.elevation > MIN_ELEVATION
    # contradiction: almanac says sun is up and strong, sensor reads ~0
    if sun_up and expected > EXPECT_THRESHOLD and env.measured_irradiance < NEAR_ZERO:
        if env.cloud < CLOUD_LOW:
            return False, ("almanac predicts strong sun, sensor reads ~0 and sky is "
                           "clear -> dirty/failed pyranometer; ignore sensor, use "
                           "almanac estimate (do NOT open)")
        else:
            return True,  ("almanac predicts sun but heavy cloud measured -> genuine "
                           "cloud-gating; safe to admit daylight")
    return True, "sensor consistent with almanac"
```
Notes — the sophistication is **disambiguation**: a contradiction under *clear* sky is a fault (distrust the sensor, fall back to the almanac); the same reading under *heavy cloud* is genuine cloud-gating (trust it, admit daylight). Say this in the demo — it's what separates a real cross-check from a naive threshold.

**Acceptance:** `inject_sensor_fault("dead_pyranometer")` under low cloud → `trusted=False` with the dirty-sensor reason; the same near-zero reading under high cloud → `trusted=True` with the cloud-gating reason.

### 5.5 `brain.py` — Co-optimisation `J(α)` (D)

**Responsibility:** select the macro angle by minimising the single multi-objective cost (FR-13).

```python
def optimise_angle(predicted_load, lux_error_fn, alpha_current, wind,
                   weights) -> tuple[float, dict]:
    alphas = np.arange(ALPHA_MIN, ALPHA_MAX + STEP, STEP)
    best_a, best_J, best_bd = None, np.inf, None
    for a in alphas:
        bd = {
            "thermal": weights.w_T * thermal_cost(a, predicted_load),
            "lux":     weights.w_L * lux_error_fn(a) ** 2,
            "move":    weights.w_M * abs(a - alpha_current),
            "risk":    weights.w_A * mech_risk(a, wind),
        }
        J = sum(bd.values())
        if J < best_J:
            best_a, best_J, best_bd = a, J, bd
    return best_a, best_bd     # breakdown feeds the explainability panel
```
Notes: weights are schedulable (occupied vs unoccupied, working hours — FR-14). The naive baseline (`naive_angle`) for Tier 2 lives here too: a single-objective "block direct sun" function.

**Acceptance:** with high `w_L` the optimiser favours daylight; with high `w_T` it favours shading; the returned `cost_breakdown` sums to the selected cost.

### 5.6 `safety.py` — Safety override + movement budget (D)

**Responsibility:** enforce the priority ladder above the brain, and ration movement.

```python
SHADED_DEFAULT = 60.0   # deg, fail-shaded geometry (power loss)
RETRACT_FLAT   = 0.0    # deg, active retract (high wind / rain)

def safety_gate(env, power_ok) -> tuple[str, float] | None:
    if not power_ok:                       return "SAFE", SHADED_DEFAULT  # fail-shaded
    if env.wind >= V_CRIT or env.rain:     return "SAFE", RETRACT_FLAT    # active retract
    return None                            # safe to optimise

def movement_budget(angle_target, alpha_current, predicted_gain) -> tuple[float, bool]:
    if predicted_gain < MOVE_THRESHOLD:
        return alpha_current, False        # HOLD — not worth the mechanical cost
    return angle_target, True
```
Notes: `safety_gate` runs **before** the brain each tick and short-circuits it (FR-6). Fail-shaded vs active-retract reconciliation is explicit here (product PRD C3): power-loss → shaded; wind/rain (with power) → flat.

**Acceptance:** `power_ok=False` → mode SAFE, angle = SHADED_DEFAULT; `wind ≥ V_CRIT` → mode SAFE, angle = RETRACT_FLAT; a 3° target with negligible gain → `moved=False`.

### 5.7 `controller.py` — Loop orchestration (shared)

**Responsibility:** run the per-tick sequence, assembling `Environment` + `SolarState` → `Decision`.

```python
def run_tick(env, lat, lon, alpha_current, weights, power_ok=True) -> Decision:
    solar = sun_position(env.t, lat, lon)               # C, seam 1
    trusted, reason = validate(env, solar)              # D
    gate = safety_gate(env, power_ok)                   # D
    if gate:
        mode, angle = gate
        return Decision(mode, trusted, angle, angle, angle != alpha_current, reason)
    load = predict_load(env, solar)                     # C, seam 2
    irr  = env.measured_irradiance if trusted else estimate_from_almanac(solar)
    target, bd = optimise_angle(load, make_lux_fn(env, irr),
                                alpha_current, env.wind, weights)   # D
    final, moved = movement_budget(target, alpha_current,
                                   predicted_gain(target, alpha_current, load))
    final = local_trim(final, env.indoor_lux)           # optional FR-18
    return Decision("NORMAL" if moved else "HOLD", trusted, target, final, moved,
                    reason, bd)

def run_day(day: list[Environment], **cfg) -> "pd.DataFrame": ...
```

**Acceptance:** `run_day` returns a per-tick DataFrame (mode, angle, moved, trusted, load, lux, reason) with no exceptions across a full generated day.

### 5.8 `app.py` — Streamlit twin surface (shared)

Renders: sliders (wind, cloud, occupancy, power on/off); a naive/co-opt toggle; three plot panels; and the **explainability panel** showing the current tick's `reason` and `cost_breakdown` (FR-22). This is the "run in front of a judge" surface.

---

## 6. The three demo scenarios

### Tier 1 — lie-detector catch (build first; highest originality-per-hour)
`scenarios/tier1_liedetector.py`. Inject `dead_pyranometer` under low cloud. Render measured vs almanac-expected irradiance with the caught tick flagged, and the resulting angle for **naive** (opens — wrong) vs **ours** (holds / uses almanac fallback). Proves FR-4. → feeds proposal §4.2, §4.4.

### Tier 2 — naive vs co-optimisation (the central claim)
`scenarios/tier2_naive_vs_coopt.py`. Run one generated day twice: naive single-objective vs `J(α)`. Three panels: **lux-compliance %**, **cooling load (relative, G1)**, **movement count**. Target result: ours holds lux *and* cuts load *and* moves less. → feeds proposal §4.3, §9 appendix.

### Tier 3 — movement-budget + fail-shaded (maturity)
`scenarios/tier3_budget_failsafe.py`. Annotated timeline: a marginal-gain tick where ours declines to move, and a `power_ok=False` tick where ours goes to `SHADED_DEFAULT`. Proves FR-16, FR-7. → feeds proposal §4.3, §6.3.

---

## 7. Build order and ownership

| Order | Task | Owner | Blocks |
|---|---|---|---|
| 0 | Agree `types.py` + the two seam signatures | C + D | everything |
| 1 | `environment.py` + `solar.py` | C | Tier 1 |
| 1 | `validation.py` | D | Tier 1 |
| 2 | Tier 1 demo | D (C supplies solar) | — |
| 3 | `thermal.py` | C | Tier 2 |
| 3 | `brain.py` + `safety.py` | D | Tier 2/3 |
| 4 | `controller.py` | C + D | Tier 2/3 |
| 5 | Tier 2, then Tier 3 | D-led | — |
| 6 | `app.py` Streamlit surface | whoever finishes column first | demo |

Critical path: **`solar.py` (C) and `validation.py` (D) gate Tier 1**, which is the hook — protect those two.

---

## 8. Overall acceptance criteria

- **AC1** — Tier 1 visibly catches a dirty sensor the naive controller falls for.
- **AC2** — Tier 2 shows ours beating naive on all three axes (lux %, load, movements) on the same day.
- **AC3** — Tier 3 shows a declined marginal move and a fail-shaded power-loss response.
- **AC4** — No plot anywhere converts load into an HVAC-kWh figure (G1); the latent floor is visible (G2); all synthetic data is labelled (G3).
- **AC5** — The Streamlit explainability panel shows a human-readable reason for the current angle.

---

## 9. Open questions

- **O1 (gates §5.3 slab)** — Does the target building have thermal-mass cooling? Confirm before C commits `slab_state`; the generic load-forecast fallback keeps C productive either way.
- **O2** — Tuning: `V_CRIT`, `MOVE_THRESHOLD`, `SHADED_DEFAULT`, cost weights — set provisional values, refine against Tier 2 output.
