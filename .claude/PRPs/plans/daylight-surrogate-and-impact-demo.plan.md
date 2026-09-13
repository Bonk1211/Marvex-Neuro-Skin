# Plan: Daylight Surrogate Model and Impact Demo

## Implementation record — 13 September 2026

- Tasks 1–4 implemented and checked: all four oracle invariants pass; probe frames include
  nested desk-island rotations and the facade's exterior-left-to-right bay numbering.
  Coarse probe view factors are normalised to a complete hemisphere to prevent near-patch
  quadrature from amplifying a uniform light field.
- Smoke generation produced 36,673 rows; the complete 12-day training / 3-day transfer sweep
  produced 192,829 rows. Resume fingerprints match the current generation code.
- The feature contract adds incident POA, lateral position, facade tilt and sky fraction.
  These are necessary to distinguish physical inputs omitted from the proposed list;
  absolute compass direction remains excluded. `env.ghi` at this seam means local POA.
- Tasks 5a and 5b completed: two clean-kernel five-fold runs produced identical metrics,
  parameters and fingerprints (14 ledger evaluations).
  Structural holdout uses unseen days AND unseen zones. Cross-strata are excluded and
  counted. Model selection uses holdout MAE; transfer never selects a model. Transfer
  tolerance was set before fitting to 1.5 × holdout MAE + 50 lux for each target.
- Task 6 completed twice, with byte-identical Markdown/JSON reports. NeuroSkin: 747/786
  occupied daylight building ticks (95.0382%) have any seat over cap; naive: 740/786
  (94.1476%). Seat-hour exceedance is 38.3506% vs 14.7196%. All 16 illustrative rooms
  are included; the headline counts their union at each tick, not separate room-hours.
- Current checks: 107 backend tests and 79 frontend tests pass; ruff passes across app,
  tests, scripts and notebook. The default overview response is byte-identical to the
  saved pre-change response. Phase A revalidated after crash recovery: notebook execution succeeded, full dataset
  resume verified, raw report numerators independently reconciled, and a third ablation run
  reproduced both reports byte-for-byte. Phase B follows the Phase A commit.
- Correct smoke command: `make daylight-data ARGS=--smoke`; `--smoke` is not a make option.

This record reports current evidence; the unchecked acceptance checklist below remains
the completion contract, including the executed notebook, Phase A commit and Phase B.

## Summary

The entire interior daylight transfer in NeuroSkin is one constant: `WALL_LUX_PER_IRRADIANCE = 1.7`
(`controller.py:22-32`), whose own comment says "re-tune it against a real lux meter". This plan
replaces it with two learned surrogates — Task Illuminance (`Et`) at desks and Vertical Eye
Illuminance (`Ev`) at seated eye positions — trained on a slow multi-bounce radiosity oracle that
uses the existing `optics.py` as its boundary condition. The deliverable is not the model; it is the
evidence that the shipped controller is **blind to glare**, measured by re-scoring its own decisions
with the oracle.

## User Story

As a **controls engineer judging whether an adaptive-facade controller actually protects occupants**,
I want **the controller's decisions scored against occupant-plane daylight metrics it never computed**,
so that **I can see how many occupied hours it left someone squinting, and whether a learned interior
model would have avoided them**.

## Problem → Solution

**Current:** `lux` is one scalar per zone, derived by multiplying plane-of-array irradiance by 1.7.
`lux_penalty()` returns `0.0` anywhere in 300–700 lux, so a tick with a well-lit desk and direct sun
in an occupant's eyes scores as **zero daylight cost**. The glare proxy, `glare_risk`, compares
exterior direct beam against `glare_limit_w_m2 = 25.0` at the facade — not at anyone's eye.

**Desired:** `Et` and `Ev` predicted per occupied seat, with `Ev` exceedance measured for every
controller variant on identical seeded days, and the result rendered on the furnished floor plan
the Floor lens already draws.

## Metadata

- **Complexity**: XL — split at the Phase A/B boundary. Phase A (tasks 1-6) is offline and backend
  only, and delivers the decisive result on its own. Phase B (tasks 7-10) puts it on screen.
- **Source PRD**: `docs/neuroskin_software_prd.md` (v0.4)
- **PRD Phase**: N/A — new scope beyond v0.4; see "PRD consequences" in Notes
- **Estimated Files**: 22 (13 create, 9 update)
- **Training surface**: Jupyter notebook for tracking and diagnostics, sitting on an importable
  training module. The split is described below and is not optional.

### Notebook split — read before task 5

Training happens in a notebook so model performance is visible and tracked run over run. But a
notebook is a **view**, not a home for logic. Logic that lives only in cells cannot be unit-tested,
cannot be linted as a unit, cannot be imported by the ablation script, and silently depends on the
order someone happened to execute cells in.

| Concern | Lives in | Why |
|---|---|---|
| Split construction, fitting, metric computation, ledger append | `app/domain/daylight/training.py` | Importable, ruff-checked, unit-tested, reusable by task 6 |
| Plots, tables, run-over-run charts, narrative, saved outputs | `notebooks/daylight_surrogate_training.ipynb` | The tracking record a human reads |
| Per-run metrics history | `docs/appendix/daylight-runs.jsonl` | Append-only, greppable, diffable in git |

The notebook imports the module and renders. It defines no estimator, no split, and no metric of
its own. If a cell starts growing a function definition, that function belongs in `training.py`.

**App code must never import the notebook.** Nothing under `backend/app/` may reference
`notebooks/`.

---

## Why this is not circular — read first

A surrogate trained on data generated by `lux_at_angle()` learns `lux_at_angle()`, and a reviewer
kills it in one question. The oracle must compute something the runtime model **cannot**:

| Layer | Who computes it | Keep or learn |
|---|---|---|
| Beam/diffuse transmission through the louvre bank | `optics.py` — real geometric raycast, 8×16 cosine-weighted quadrature | **Keep.** Feed as a feature |
| Flux arriving at the glazing plane | `optics.solar_transmittance(θ)` | **Keep.** Feed as a feature |
| Interior field after multi-bounce inter-reflection | **nothing** — `daylight_transmittance()` returns `solar_transmittance()` unchanged | **Learn.** No closed form |
| `Et` at a desk at depth *d* | `WALL_LUX_PER_IRRADIANCE * incident` — depth-independent | **Learn** |
| `Ev` at an eye at depth *d* facing direction *φ* | does not exist | **Learn** |

Interior illuminance depends on inter-reflection between room surfaces — a global calculation. That
is the only thing the model learns, and it is why the model is needed.

---

## UX Design

### Before

```
FLOOR LENS (shipped)
┌──────────────────────────────────────────────────┐
│  Individual floor plans                          │
│  ┌────────────────────────────────────────────┐  │
│  │   furnished cutaway, bandPlan.ts           │  │
│  │   desks, chairs, plants, booths            │  │
│  │                                            │  │
│  │   group.name = "Illustrative office        │  │
│  │   interior — not measured drawings"        │  │
│  │                                            │  │
│  │   ▓▓▓ perimeter zones carry data           │  │
│  │   ░░░ interior carries NOTHING             │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
Every chair is decoration. No occupant-plane metric exists.
```

### After

```
FLOOR LENS
┌──────────────────────────────────────────────────┐
│  Daylight at occupied seats      modelled ⓘ      │
│  ┌────────────────────────────────────────────┐  │
│  │   ▓▓▓ perimeter zones (unchanged)          │  │
│  │                                            │  │
│  │    ▪ desk  Et  412 lux   ✓ in band         │  │
│  │    ● chair Ev 1840 lux   ✗ over 1000       │  │
│  │    ● chair Ev  340 lux   ✓                 │  │
│  │                                            │  │
│  │   seats coloured by Ev, desks by Et        │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  This tick: 6 of 18 seats over the 1000 lux cap  │
└──────────────────────────────────────────────────┘

BRAINS LENS — the point of the whole plan
┌──────────────────────────────────────────────────┐
│  GLARE BLINDNESS            modelled, seeded day │
│                                                  │
│   Controller        Ev>1000   Et in band   moves │
│   naive threshold     31.4%       22.1%      18  │
│   NeuroSkin (shipped) 12.7%       68.4%       9  │
│                       ▲                          │
│         never computed Ev — measured after       │
│                                                  │
│  "The shipped controller spent 12.7% of occupied │
│   hours above the eye-illuminance cap and had no │
│   signal that told it so."                       │
└──────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Furnished interior | Decoration, `group.name` says illustrative | Seats/desks carry modelled Et/Ev | Keep the illustrative label; geometry is still not measured |
| Glare signal | `glare_risk` = exterior beam > 25 W/m² at facade | `Ev` lux at seated eye, cap 1000 | Literature-backed; see External Documentation |
| Daylight cost | One `lux` scalar, flat 0 across 300–700 | Two quantities that can conflict | Makes the trade-off representable |
| Comparison | `naive_lux` vs `lux` already charted | `naive_ev` vs `ev` in the same chart | Reuses shipped `TickPayload` comparison fields |
| Controller behaviour | — | **Unchanged by default** | Surrogate is observe-only behind a flag; see task 8 |

### Edge Cases for UX

- Night ticks (`solar.elevation <= 0`): no Ev/Et rendered, seats grey, not zero-coloured.
- Surrogate artifact missing: Floor lens hides seat probes entirely, shows "daylight model not
  loaded" — never renders a silent zero.
- Band with no chairs in its program (`floorProgram` rotates four programs): show zone data only.
- Ev is heavy-tailed; a single direct-beam hit can read >20,000 lux. Clamp the **colour ramp**, never
  the reported number.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `backend/app/domain/controller.py` | 22-32 | `WALL_LUX_PER_IRRADIANCE = 1.7` — the constant being replaced, and its own "re-tune" comment |
| P0 | `backend/app/domain/controller.py` | 107-131 | `conditions_at()` builds `ComfortState`; this is the insertion seam for Et/Ev |
| P0 | `backend/app/domain/optics.py` | all (121) | The oracle's boundary condition. `beam_transmittance`, `diffuse_transmittance`, `_diffuse_curves` lru_cache + per-degree interpolation |
| P0 | `backend/app/domain/brain.py` | 21-34, 38-63 | `daylight_transmittance`, `lux_at_angle`, `lux_penalty`, `_breakdown` — the incumbent baseline the surrogate must beat |
| P0 | `backend/app/config.py` | 1-45 | `DEFAULTS` frozen dataclass; every threshold lives here |
| P0 | `backend/app/logging_config.py` | 7-33 | `LOG_FIELDS` is an **allowlist** — unlisted fields are dropped |
| P1 | `backend/app/domain/types.py` | 1-32 | `@dataclass(frozen=True)` convention; `ComfortState` shape |
| P1 | `backend/app/schemas.py` | 125-133 | `ComfortStatePayload` — where `task_illuminance`/`eye_illuminance` are added |
| P1 | `backend/tests/test_engine.py` | 1-30 | Pure-domain test style: direct imports, `DEFAULTS`, no mocks, `-> None` |
| P1 | `frontend/src/components/neuroskin/bandPlan.ts` | 70-98 | `at()`, `chair(x, z, rotation)`, `desk()` — chairs already carry position **and** facing |
| P1 | `frontend/src/components/neuroskin/FloorPanel.tsx` | 1-40 | Floor lens props and zone filtering by `focusedBand` |
| P2 | `backend/app/domain/facade.py` | 265-320 | Zone construction; `zone=f"{orientation[0].upper()}{row*columns+column+1}"` → `W1`…`W16` |
| P2 | `Makefile` | all | Target style for the new offline script targets |
| P2 | `docs/appendix/neuroskin-synthetic-results.md` | all | The existing evidence-artifact format the ablation report should mirror |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Ev as glare metric | Tabatabaei Manesh et al. (2025), *Automation in Construction* 179, 106474, https://doi.org/10.1016/j.autcon.2025.106474 | Cites Yun et al. and Konstantzos et al. that vertical eye illuminance outperforms DGP **and** work-plane illuminance for glare. Comfort 500 lux, cap 1000 lux. Their NSGA-II uses Ev<1000 as a hard constraint, not a cost term |
| Surrogate + evolutionary control | same | Radiance oracle → ML surrogate → optimiser. Extra Trees won their **grid** test (0.95 mean R², std 0.06); LightGBM collapsed (0.28, std 6.19) |
| Holdout design | same, §3.3 | ANN scored R²=0.9888 on a shuffled split and **0.87 (std 0.89)** on structurally held-out grids. Same model, opposite verdict |
| Selection metric | same, §4.1 | They chose **MAE over R²** because targets are heavy-tailed (Ev mean 2,217, std 3,182, max 52,647) |
| Their open data | https://github.com/Mhtaba76/ML_Facade_Control_System | Public, Python, **no license file** — readable for method reference, not legally reusable |

```
KEY_INSIGHT: Their model was trained at latitudes 29.72-47.61 N on nine US cities.
APPLIES_TO:  Any temptation to reuse their weights or dataset.
GOTCHA:      Putrajaya is 2.92 N — near-equatorial sun altitudes, much higher diffuse fraction.
             Their trained model will NOT transfer. Cite the method, generate your own data.

KEY_INSIGHT: Their own conclusion reports the optimiser prevented glare but task illuminance
             stayed outside the standard range, "requiring either a better facade design or
             the use of artificial lighting."
APPLIES_TO:  How the result is framed in the report.
GOTCHA:      Do not cite this paper as proof the approach delivers comfort. It is precedent for
             the method, not evidence of the outcome.
```

---

## Patterns to Mirror

### PURE_DOMAIN_FUNCTION
```python
# SOURCE: backend/app/domain/validation.py:1-14
from app.config import DEFAULTS
from app.domain.types import Environment, SolarState


def expected_irradiance(env: Environment, solar: SolarState) -> float:
    return max(0.0, solar.clear_sky_ghi * (1.0 - DEFAULTS.cloud_attenuation * env.cloud))
```
Module-level functions, no classes, no I/O, no logging. Every threshold from `DEFAULTS`.

### DOMAIN_DATACLASS
```python
# SOURCE: backend/app/domain/types.py:6-21
@dataclass(frozen=True)
class Environment:
    t: datetime
    ghi: float
    dni: float
```
Frozen, builtin types, no methods. Mutation via `dataclasses.replace`.

### CACHED_CURVE_WITH_DEGREE_INTERPOLATION
```python
# SOURCE: backend/app/domain/optics.py:33-36, 101-112
@lru_cache(maxsize=16)
def _diffuse_curves(tilt: float) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """Cosine-weighted isotropic sky/ground transmission at each whole degree."""
    ...

    def diffuse_transmittance(self, angle: float) -> float:
        sky, ground = _diffuse_curves(_clamp(self.facade_tilt, 180.0))
        bounded = _clamp(angle, DEFAULTS.angle_max)
        low = int(bounded)
        high = min(low + 1, len(sky) - 1)
        fraction = bounded - low
        sky_value = sky[low] + fraction * (sky[high] - sky[low])
```
**This is the exact pattern the surrogate must use for its inference budget** — precompute a curve
over the angle range once per (zone, tick), interpolate between whole degrees. See task 7 GOTCHA.

### PONYTAIL_CEILING_COMMENT
```python
# SOURCE: backend/app/domain/optics.py:93-95
        # ponytail: periodic-bank average omits finite ends/side gaps; use the
        # existing mesh raycast when a spatial shadow map is required.
```
Deliberate simplifications carry a `ponytail:` comment naming the ceiling and the upgrade path.
The oracle's bounce count and the surrogate's angle grid both need one.

### CONFIG_THRESHOLD
```python
# SOURCE: backend/app/config.py:20-22
    # Direct solar exposure screen, not an occupant-view glare index (DGP).
    glare_limit_w_m2: float = 25.0
    min_elevation: float = 8.0
```
Assumptions carry a comment saying they are assumptions. New fields (`ev_comfort_lux`,
`ev_cap_lux`, `et_band_low_lux`, `et_band_high_lux`, `daylight_model_enabled`) go here.

### COMFORT_STATE_CONSTRUCTION
```python
# SOURCE: backend/app/domain/controller.py:117-131
        return ComfortState(
            daylight_status="low"
            if round(lux, 1) < 300
            else "high"
            if round(lux, 1) > 700
            else "useful",
            transmitted=transmitted,
            solar_heat_gain=transmitted * glazing_shgc,
            direct_sun=direct,
            glare_risk=direct > glare_limit_w_m2 + 1e-6,
            glare_limit_w_m2=glare_limit_w_m2,
            glazing_shgc=glazing_shgc,
        )
```
The seam. Et/Ev are added as optional fields here, defaulting to `None` when the model is off.

### DOMAIN_TEST
```python
# SOURCE: backend/tests/test_engine.py:1-30
from app.config import DEFAULTS
from app.domain.brain import optimise_angle
from app.domain.validation import validate


def test_solar_is_dark_at_midnight_and_peaks_during_day() -> None:
    tz = ZoneInfo(DEFAULTS.timezone)
    midnight = sun_position(datetime(2026, 3, 21, 0, 0, tzinfo=tz))
    assert midnight.elevation <= 0
```
Direct imports, no fixtures, no mocks. Names are full behavioural sentences. Typed `-> None`.

### STRUCTURED_LOGGING
```python
# SOURCE: backend/app/main.py:133-147
    logger.info(
        "Slab plan completed",
        extra={
            "event": "slab_plan_completed",
            "request_id": request_id,
            "duration_ms": round((perf_counter() - started) * 1000, 2),
        },
    )
```
Human message first, machine fields in `extra` with a snake_case `event` key.

### MAKEFILE_TARGET
```makefile
# SOURCE: Makefile:14-15
backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000 $(if $(wildcard backend/.env),--env-file .env,)
```
Plain commands, no process manager, `ponytail:` comments where a shortcut is deliberate.

### FRONTEND_COMPONENT
```tsx
// SOURCE: frontend/src/components/neuroskin/FloorPanel.tsx:1-16
'use client'

import type { FacadeOrientation, TickPayload } from '@/lib/types'
import { FLOOR_PLANS, floorGroupLabel, floorProgram } from './floorWorkspaces'

interface FloorPanelProps {
  tick: TickPayload
  floors: number
  focusedBand: number | null
}
```
`'use client'`, `import type`, `interface <Name>Props`, named export.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `backend/app/domain/daylight/__init__.py` | CREATE | New subpackage; keeps the oracle out of the per-tick hot path |
| `backend/app/domain/daylight/room.py` | CREATE | Room geometry + seat/desk probe positions mirrored from `bandPlan.ts` |
| `backend/app/domain/daylight/oracle.py` | CREATE | Multi-bounce radiosity solver — the slow ground truth |
| `backend/app/domain/daylight/features.py` | CREATE | Feature vector assembly, shared by generation and inference |
| `backend/app/domain/daylight/surrogate.py` | CREATE | Model load + batched predict + angle-curve cache |
| `backend/app/domain/daylight/training.py` | CREATE | Splits, fitting, metrics, ledger append — all training logic, importable and testable |
| `backend/scripts/generate_daylight_dataset.py` | CREATE | Offline dataset generation |
| `backend/notebooks/daylight_surrogate_training.ipynb` | CREATE | **Training and performance-tracking surface.** Imports `training.py`, renders diagnostics, saves artifacts |
| `backend/scripts/ablation_glare_blindness.py` | CREATE | **The decisive experiment** |
| `backend/tests/test_daylight.py` | CREATE | Oracle invariants, feature parity, surrogate determinism, ledger round-trip |
| `docs/appendix/daylight-blindness-results.md` | CREATE | Evidence artifact produced by task 6 |
| `docs/appendix/daylight-runs.jsonl` | CREATE | Append-only per-run metrics ledger; the run-over-run tracking record |
| `backend/app/domain/controller.py` | UPDATE | `conditions_at()` populates Et/Ev when the model is enabled |
| `backend/app/domain/types.py` | UPDATE | `ComfortState` gains two optional fields |
| `backend/app/schemas.py` | UPDATE | `ComfortStatePayload` gains optional `task_illuminance`, `eye_illuminance` |
| `backend/app/config.py` | UPDATE | Ev/Et thresholds, model path, `daylight_model_enabled` flag |
| `backend/app/logging_config.py` | UPDATE | Extend `LOG_FIELDS` or the new fields vanish |
| `backend/pyproject.toml` | UPDATE | Add `scikit-learn`, `joblib`, `pyarrow`; dev extra gains `jupyterlab`, `matplotlib`, `nbconvert`; **declare `scipy` explicitly** |
| `backend/.gitignore` (or root) | UPDATE | Ignore `*.joblib`, `data/daylight/*.parquet`; **do not** ignore the notebook or the ledger |
| `Makefile` | UPDATE | `daylight-data`, `daylight-train`, `daylight-ablate` targets |
| `frontend/src/components/neuroskin/bandPlan.ts` | UPDATE | Register seat/desk probes as they are created (one line in `chair()`) |
| `frontend/src/components/neuroskin/FloorPanel.tsx` | UPDATE | Render seat Ev / desk Et readout |
| `frontend/src/lib/types.ts` | UPDATE | Mirror the two new `ComfortStatePayload` fields |

## NOT Building

- **NSGA-II in the request path.** 2,500 evaluations per decision × 144 ticks × 64 zones ≈ 23M
  evaluations per request, in an endpoint that already returns 9,216 zone-tick records synchronously.
  Offline weight derivation only, and not in this plan.
- **Changing controller behaviour by default.** The surrogate is observe-only behind
  `daylight_model_enabled`. The whole argument depends on measuring what the *shipped* controller did.
- **Reusing the paper's trained model or dataset.** Wrong latitudes (29.72–47.61 N vs 2.92 N), and
  the repo has no license file.
- **Grasshopper, Honeybee, Rhino, or Ladybug.** The oracle is plain numpy.
- **Occupant tracking, schedules, or per-person preference.** Seats are fixed positions from
  `bandPlan.ts`.
- **Furniture, screens, or partitions in the oracle.** The paper omits these too and says so.
- **Training data for all four orientations.** Two are trained (west, south — one per self-shading
  regime); east and north exist only as a thin, never-trained transfer set. If transfer fails, the
  answer is to scope the claim, not to generate two more full sweeps.
- **Absolute compass direction as a model input.** Removed in task 3. Every feature is
  facade-relative, which is the property the transfer test exists to verify.
- **Paper-scale data volume.** ~187k rows, not 783k. Their input space included nine climates and a
  continuous 2-D attractor point; this one is a 1-D louvre angle on fixed geometry at one latitude.
- **Radiosity superposition and form-factor caching.** Both are real optimisations — the solve is
  linear in source flux, so two unit solves would cover all 13 angles, and `F` depends only on room
  geometry. At 9,360 solves neither is needed. Documented in Notes as the upgrade path if the sweep
  is ever widened.
- **Replacing `optics.py`.** It is the oracle's boundary condition, not its competitor.
- **Any kWh, carbon, cost, or payback figure.** PRD §4.2. Et/Ev are lux and stay lux.
- **A four-model bake-off for its own sake.** Extra Trees + RF + **linear baseline**; the linear
  baseline exists to falsify the ML, not to pad a comparison table.

---

## Step-by-Step Tasks

### PHASE A — the model and the evidence (offline, backend only)

### Task 1: Room and probe geometry
- **ACTION**: Create `backend/app/domain/daylight/room.py`.
- **IMPLEMENT**: Frozen dataclasses `RoomGeometry` (width, depth, height, surface reflectances) and
  `Probe` (`kind: Literal["seat","desk"]`, `x`, `z`, `height_m`, `view_rad | None`). A function
  `probes_for(orientation, band) -> tuple[Probe, ...]` returning the seat/desk positions that mirror
  `bandPlan.ts`. Seats: eye height 1.2 m, `view_rad` from the chair rotation. Desks: work-plane
  0.75 m, `view_rad = None`.
- **MIRROR**: DOMAIN_DATACLASS, PURE_DOMAIN_FUNCTION.
- **IMPORTS**: `from dataclasses import dataclass`; `from typing import Literal`.
- **GOTCHA**: `bandPlan.ts` builds chairs inline and `desk()` calls `chair()` with a computed
  offset (`x + sin(rotation)*0.47, z + cos(rotation)*0.47`) — so desk chairs must be mirrored too,
  not just standalone ones. Reflectances follow the paper's Radiance table (wall 0.5, floor 0.2,
  ceiling 0.8) — put them in `DEFAULTS` with a comment marking them as assumptions, since they are.
  Room dimensions are illustrative, matching `bandPlan.ts`, **not** measured drawings.
- **VALIDATE**: Test that `probes_for` returns ≥1 seat with a finite `view_rad` for every
  (orientation, band) pair that `floorProgram` can produce, and that every probe lies inside the room
  bounds.

### Task 2: The radiosity oracle
- **ACTION**: Create `backend/app/domain/daylight/oracle.py`.
- **IMPLEMENT**:
  ```python
  def illuminance_at_probes(
      room: RoomGeometry,
      probes: tuple[Probe, ...],
      *,
      beam_flux: float,       # W/m2 through glazing, direct
      diffuse_flux: float,    # W/m2 through glazing, diffuse
      solar_elevation: float,
      solar_azimuth: float,
      wall_azimuth: float,
      bounces: int = DEFAULTS.daylight_oracle_bounces,
  ) -> tuple[tuple[float, float], ...]:   # (et_lux, ev_lux) per probe
  ```
  Discretise the six room surfaces into patches, compute form factors, distribute the entering beam
  and diffuse flux, iterate radiosity for `bounces` passes, then integrate at each probe: **Et** =
  cosine-weighted hemispherical over the upward horizontal plane; **Ev** = cosine-weighted over the
  vertical plane whose normal is `view_rad`, **plus direct beam if the unobstructed sun vector falls
  within that hemisphere**.
- **MIRROR**: PURE_DOMAIN_FUNCTION, PONYTAIL_CEILING_COMMENT.
- **IMPORTS**: `numpy as np`; `from app.config import DEFAULTS`; `from app.domain.daylight.room import Probe, RoomGeometry`.
- **GOTCHA**: **This function must never import from `brain.py` or `controller.py`.** Touching
  `lux_at_angle` or `WALL_LUX_PER_IRRADIANCE` makes the whole exercise circular. Add a `ponytail:`
  comment naming the bounce count as the accuracy ceiling and Radiance as the upgrade path. The
  direct-beam term is what makes Ev heavy-tailed — a beam hit is a genuine order-of-magnitude jump,
  so do not smooth or clamp it. Luminous efficacy (lm/W) converting flux to lux is another assumption:
  put it in `DEFAULTS`, comment it, cite a standard daylight value.
- **VALIDATE**: Four physical invariants as tests — (a) zero flux in → zero lux out; (b) Et decreases
  monotonically with depth from the facade under diffuse-only light; (c) a seat facing away from the
  window has strictly lower Ev than the same seat facing it, under identical flux; (d) raising
  `bounces` from 1 to 4 increases Et at the deepest probe (inter-reflection is doing work — if this
  fails, the oracle is effectively single-bounce and the surrogate has nothing to learn).

### Task 3: Feature assembly
- **ACTION**: Create `backend/app/domain/daylight/features.py`.
- **IMPLEMENT**: `FEATURE_NAMES: tuple[str, ...]` and
  `build_features(probe, optics, angle, solar, env, room) -> np.ndarray`. Columns:
  ```
  beam_transmittance(θ), diffuse_transmittance(θ), θ,
  solar_elevation, aoi, beam_fraction, cloud,
  relative_azimuth_sin, relative_azimuth_cos,      # (solar_azimuth − wall_azimuth)
  depth_m, height_m, view_rad_sin, view_rad_cos, probe_is_seat
  ```
  **Every feature is facade-relative. No absolute compass direction appears anywhere.**
- **MIRROR**: PURE_DOMAIN_FUNCTION.
- **IMPORTS**: `from app.domain.optics import FacadeOptics`.
- **GOTCHA**: **Transmittances are features, not targets.** You already compute them exactly; learning
  them is the circular mistake. Encode angles as `sin`/`cos` pairs — raw radians make 0 and 2π look
  maximally distant to a tree split.

  **Absolute azimuth must not be a feature.** An earlier draft carried `solar_azimuth`,
  `wall_azimuth_sin` and `wall_azimuth_cos`; all three are removed. Absolute compass direction makes
  the model orientation-*specific*: train on one facade and those columns have zero variance, so
  trees ignore them and every other facade becomes silent extrapolation. The physics only ever
  depends on sun position **relative to the wall plane**, which `aoi` and `relative_azimuth_*`
  already carry. Getting this right is what makes the task-4 transfer test meaningful.

  **Verify probe coordinates are facade-local, not world.** `depth_m` must mean "distance from the
  glazing plane" and `view_rad` must be measured from the wall normal. `bandPlan.ts` builds each
  band per orientation, so its local frame is probably already facade-relative — confirm it rather
  than assume, because a world-frame `view_rad` reintroduces exactly the bug this task removes.

  One assembly function serves both generation and inference; if the two ever diverge, training/
  serving skew silently destroys accuracy. Task 9 tests this.
- **VALIDATE**: Test `len(build_features(...)) == len(FEATURE_NAMES)` and that the same inputs
  produce a bit-identical vector on repeat calls. **Rotation-invariance test: a west probe at sun
  azimuth 250° and a south probe at sun azimuth 160° — the same relative geometry — must produce
  identical feature vectors.** That test is the contract the transfer split depends on.

### Task 4: Dataset generation

**Sweep size is deliberately small.** The paper needed 783,000 rows because it covered nine climates
and a *continuous two-dimensional* attractor-point search space. This project has one building, one
latitude, fixed geometry, fixed seat positions, and a **one-dimensional** control variable. The
effective input space is roughly 6-D (sun position 2, louvre angle 1, probe position 3), so tens of
thousands of rows are ample for a tree ensemble.

| Axis | Value | Reasoning |
|---|---|---|
| Days | **12** train, **3** transfer, spread by solar declination | `day_id` is a **holdout unit** — 12 supports a meaningful 9/3 split; 3 days does not. Must include both solstices and both equinoxes |
| Orientation | **west + south** train · **east + north** transfer | The building has two regimes, not four rotations — see below |
| Bands | **2** (top and a middle) | Bands differ by roof-overhang shading, already captured in `sunlit_fraction`; two preserves seat-layout diversity since `floorProgram` rotates |
| Ticks | **12 per day**, hourly | Daylight varies smoothly over 10 minutes and solar position is a feature, so the model interpolates. The paper sampled hourly too |
| Angles | **13** (0–60° in 5°) — **do not cut** | This is the control variable, the axis the surrogate must be accurate along. Cutting here is the wrong economy |
| Probes | **all (~20)** | One oracle solve evaluates every probe; they are free |

**Why two orientations and not one or four.** The 25° overhang creates two distinct physical regimes,
and the building's own published figures say so: it cuts annual direct beam **90% on north and 87% on
south**, but only **54% on east and west** (README, "Target building"). North/south are effectively
self-shaded; east/west are where direct beam reaches a seated eye. One orientation per regime spans
the physics. All four would be 2× the cost for rotations the features already handle.

**Why not west alone.** `SimulationControls.tsx:53` renders all four orientations as user-selectable
buttons in the shipped UI, so a west-only model leaves three of four user choices with blank or
extrapolated probes. Training on a single facade also gives the orientation features zero variance —
which is precisely why task 3 removes absolute azimuth in favour of facade-relative geometry.

```
train     12 days x 2 orient (W,S) x 2 bands x 12 ticks x 13 angles x ~20 probes = 149,760 rows
transfer   3 days x 2 orient (E,N) x 2 bands x 12 ticks x 13 angles x ~20 probes =  37,440 rows
                                                                          total   187,200 rows
oracle solves = (12 x 2 + 3 x 2) x 2 x 12 x 13                                  =   9,360
```

Roughly 16 min at 100 ms/solve, 78 min at 500 ms. The transfer slice is deliberately thin — 3 days is
ample to detect whether rotation-invariance holds, and it is never trained on. **Start with a 2-day
smoke run** (~24,960 rows, 1,248 solves, about a minute) to prove the pipeline end to end.

- **ACTION**: Create `backend/scripts/generate_daylight_dataset.py`; add `make daylight-data`.
- **IMPLEMENT**: Sweep the axes above, call `optics.py` for the boundary flux, call the oracle, write
  Parquet with columns `zone, orientation, split_role, tick, theta_deg, depth_m, height_m, view_rad,
  probe_kind, <features...>, et_lux, ev_lux, day_id, seed`. `split_role` is `"train"` for west/south
  rows and `"transfer"` for east/north rows. Put the sweep bounds in `DEFAULTS`
  (`daylight_train_orientations`, `daylight_transfer_orientations`, `daylight_dataset_days`,
  `daylight_transfer_days`, `daylight_dataset_tick_stride`, `daylight_dataset_bands`) with
  `--days` / `--smoke` CLI overrides.
- **MIRROR**: MAKEFILE_TARGET, STRUCTURED_LOGGING, CONFIG_THRESHOLD.
- **IMPORTS**: `pandas as pd`, the three daylight modules, `app.domain.solar.sun_position`.
- **GOTCHA**: **Keep `day_id`, `zone`, `orientation` and `split_role` in the output.** They are the
  holdout keys in task 5a; losing them forces a shuffled split, which is exactly the failure the
  paper documents. **`split_role="transfer"` rows must never enter training** — assert it in
  `build_splits` rather than trusting the caller. Skip ticks with
  `solar.elevation <= DEFAULTS.min_elevation` — every estimator reads zero at night and those rows
  teach nothing while dominating the row count. **Pick days by solar declination, not calendar
  convenience**: at 2.92 N the sun crosses overhead twice a year, and a model that never saw those
  days will be wrong on them. Make it resumable (skip days whose Parquet already exists). Do **not**
  scale up "just in case"; if holdout MAE is acceptable at 12 days, more rows buy nothing.
- **VALIDATE**: `make daylight-data --smoke` (2 days) produces a Parquet whose row count equals
  `days × orientations × bands × daylight_ticks × angle_steps × probes`, with no NaN and no negative
  lux, and where `split_role` partitions cleanly by orientation. Full run completes in under 90 min
  on a laptop.

### Task 5a: Training module — all the logic, none of the plots
- **ACTION**: Create `backend/app/domain/daylight/training.py`.
- **IMPLEMENT**: Pure, importable functions with no plotting and no notebook imports:
  ```python
  def build_splits(frame, *, target, seed) -> Splits:
      """Three evaluation sets from one frame, in increasing order of difficulty:
         1. shuffled rows            - the optimistic number
         2. whole-day + whole-zone   - the honest number
         3. orientation transfer     - split_role == "transfer", never trained on
      """

  def fit_and_evaluate(splits, estimator, *, label) -> RunMetrics:
      """Fit on train only, then MAE/MSE/R2 on all three sets. No selection, no side effects."""

  def incumbent_metrics(splits) -> RunMetrics:
      """WALL_LUX_PER_IRRADIANCE * incident scored against oracle Et."""

  def append_run(metrics, *, ledger_path, dataset_sha256, git_sha) -> None:
      """One JSON object per line. Append-only. Never rewrites history."""
  ```
  `RunMetrics` is a frozen dataclass carrying `target`, `model`, `params`, `mae_shuffled`,
  `mae_holdout`, `mae_transfer`, `r2_shuffled`, `r2_holdout`, `r2_transfer`, `mse_shuffled`,
  `mse_holdout`, `mse_transfer`, `n_train`, `n_test`, `n_transfer`, `train_orientations`, `seed`.
- **MIRROR**: DOMAIN_DATACLASS, PURE_DOMAIN_FUNCTION.
- **IMPORTS**: `from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score`;
  `pandas as pd`; `json`; `subprocess` for the git SHA.
- **GOTCHA**: Guard the `sklearn` import so the app package still imports when scikit-learn is
  absent — `app/domain/daylight/` is inside the deployed package, and a hard import would make the
  API fail to boot on a machine that only serves. Keep **all** matplotlib out of this module; plots
  belong to the notebook. `build_splits` must raise, not warn, if `day_id`, `zone`, `orientation` or
  `split_role` is missing from the frame — a silent fallback to a shuffled split is the exact failure
  the paper documents. **Assert that no `split_role == "transfer"` row reaches the training set**;
  a transfer score computed on data the model trained on is worse than no transfer score, because it
  looks like evidence.
- **VALIDATE**: Unit test that `build_splits` puts no `day_id` in both train and test, that zero
  transfer rows appear in train, that `append_run` on a fresh file then a second call yields exactly
  two lines, and that a frame missing `zone` or `split_role` raises.

### Task 5b: Training notebook — the tracking surface
- **ACTION**: Create `backend/notebooks/daylight_surrogate_training.ipynb`; add `make daylight-train`
  running it headless via `nbconvert --execute --inplace`.
- **IMPLEMENT**: Cells in this order, each importing from `training.py` rather than defining logic:
  1. **Params cell** — dataset path, `seed`, target (`"ev"` first), model grid. One cell, top of
     notebook, so a reader can see every knob without scrolling.
  2. **Load + dataset fingerprint** — row count, date span, zone coverage, `sha256` of the Parquet.
  3. **Target distribution** — histogram and the five-number summary. Ev will be visibly
     heavy-tailed; this cell is what justifies choosing MAE over R² later, so keep it before the
     metrics.
  4. **Fit + tune** — `RandomizedSearchCV`, 5-fold, over Extra Trees / Random Forest / Linear, using
     the paper's tuned values as starting priors:
     ```python
     # Et:  n_estimators=100, min_samples_split=5
     # Ev:  n_estimators=200, min_samples_split=2, min_samples_leaf=1, max_depth=30
     ```
  5. **Metrics table** — shuffled, holdout and **transfer** side by side, every model plus
     `incumbent_metrics()`. The **gaps between columns are the headline**, not the shuffled number.
     Read left to right: shuffled → holdout measures generalisation to unseen days and zones;
     holdout → transfer measures whether the facade-relative features actually made the model
     rotation-invariant.
  6. **Feature importance** — bar chart per target. Mirrors the paper's Fig. 6; expect spatial
     features to outrank weather ones, and say so in a markdown cell if they do.
  7. **Predicted vs actual + residuals** — scatter, with the heavy tail left unclamped.
  8. **Best and worst predicted probe sets** — mirrors the paper's Figs. A.1–A.4. The worst case is
     the diagnostic that matters; a model with good mean MAE and a structurally broken worst case is
     not deployable.
  9. **Run-over-run history** — read `daylight-runs.jsonl`, plot `mae_holdout` and `mae_transfer`
     against `run_at` per target. **This cell is the "track model performance" deliverable.**
  9b. **Transfer verdict** — one markdown cell stating plainly whether east/north transfer held, with
     the number. This is a claim the report will make, so write it where the evidence is. If
     `mae_transfer` is close to `mae_holdout`, the facade-relative features worked and the model
     serves all four orientations. If it blows up, **say so and scope the model to west and south** —
     that is a finding about rotation-invariance, not a failure to hide.
  10. **Save** — `joblib.dump` both artifacts, `append_run()` to the ledger, and write the markdown
      metrics summary the acceptance criteria reference.
- **MIRROR**: MAKEFILE_TARGET for the `make` entry point.
- **IMPORTS**: `from app.domain.daylight import training`; `joblib`; `matplotlib.pyplot as plt`.
- **GOTCHA**: **Commit the notebook with outputs.** Executed outputs are the tracking record and the
  reason the notebook exists — stripping them defeats the purpose. But that makes the file a poor
  diff, so the ledger JSONL is the machine-readable history and the notebook is the human-readable
  one; keep both. **Restart and Run All before every commit** — a notebook that only passes in the
  order you happened to click is not a record of anything, and `make daylight-train` runs it headless
  precisely to enforce that. Never `joblib.dump` into the notebook directory; artifacts go to
  `DEFAULTS.daylight_model_dir` and are gitignored. Ruff 0.16.2 lints `.ipynb` natively, cell by
  cell — include `notebooks` in the lint path or the notebook silently escapes the gate. Pin
  `random_state` on every estimator and record it in the ledger row, or G2 breaks when the model is
  wired in at task 8.
- **VALIDATE**: `make daylight-train` completes headless from a clean kernel. Re-running at the same
  seed and dataset produces identical metrics and appends a second ledger line with the same numbers.
  Notebook cell 9 renders a history with at least two points after the second run. **If
  `LinearRegression` matches Extra Trees on holdout MAE, stop and report that** — the relationship is
  linear and the ML is unjustified.

### Task 6: The glare-blindness experiment
- **ACTION**: Create `backend/scripts/ablation_glare_blindness.py`; add `make daylight-ablate`.
- **IMPLEMENT**: Run the **shipped, unmodified** controller over seeded days. For every occupied
  daylight tick, take the angle it actually chose, and score that angle with the **oracle** for Ev and
  Et at every seat. Same for `naive_angle`. Report per controller: % occupied hours with any seat
  `Ev > DEFAULTS.ev_cap_lux`, % seat-hours with `Et` in band, movement count, mean relative load.
  Write `docs/appendix/daylight-blindness-results.md`.
- **MIRROR**: `docs/appendix/neuroskin-synthetic-results.md` artifact format; PURE_DOMAIN_FUNCTION.
- **IMPORTS**: `from app.domain.controller import run_tick`; oracle and room modules.
- **GOTCHA**: **Use the oracle here, not the surrogate.** This measures ground truth against the
  controller's real decisions; introducing surrogate error into the headline number invites the
  obvious objection. Do not modify the controller — the argument is about what the shipped system
  already does. Report `naive` alongside NeuroSkin: if NeuroSkin already beats naive on Ev by
  accident, say so plainly, because it weakens the case and the reader will find it anyway.
- **VALIDATE**: Report produced, numbers reproducible across runs at fixed seed. **Pre-registered
  failure condition: if NeuroSkin's Ev exceedance is near zero, glare is not a real problem in this
  geometry and the rest of this plan is unnecessary. Report that outcome rather than burying it.**

> **PHASE A SHIPPABLE BOUNDARY.** Tasks 1-6 deliver the decisive evidence with zero controller change
> and zero UI work. Run the full suite and commit here before starting Phase B.

### PHASE B — showing impact in the running build

### Task 7: Surrogate inference with an angle-curve cache
- **ACTION**: Create `backend/app/domain/daylight/surrogate.py`; update `config.py`, `pyproject.toml`.
- **IMPLEMENT**: Lazy-load the two joblib artifacts. Expose
  `curve_for(probe, optics, solar, env, room) -> tuple[float, ...]` returning predicted lux at each
  whole degree 0–60, plus `at_angle(curve, angle)` interpolating between them. Add `DEFAULTS` fields
  `daylight_model_enabled: bool = False`, `daylight_model_dir`, `ev_comfort_lux = 500.0`,
  `ev_cap_lux = 1000.0`, `et_band_low_lux = 300.0`, `et_band_high_lux = 500.0`,
  `daylight_oracle_bounces`, `luminous_efficacy_lm_per_w`.
- **MIRROR**: **CACHED_CURVE_WITH_DEGREE_INTERPOLATION** — copy the `_diffuse_curves` + interpolation
  shape from `optics.py:33-36,101-112` exactly.
- **IMPORTS**: `joblib`, `numpy as np`, `from functools import lru_cache`.
- **GOTCHA**: Naive inference is ~370k predictions per request (9,216 zone-ticks × ~20 candidate
  angles evaluated by `minimize_scalar` × 2 models) and will add seconds to an already synchronous
  endpoint. The curve cache converts that to **one batched predict of 61 rows per (probe, tick)**,
  then pure interpolation — the same trick `optics.py` already uses for diffuse transmittance.
  Missing artifact must degrade to `None`, never to zero, and never raise. Default the flag **off**.
- **VALIDATE**: Benchmark a default `overview` run with the flag on and off; record the delta in the
  report. Test that a missing artifact returns `None` and leaves the run otherwise byte-identical.

### Task 8: Controller and schema wiring
- **ACTION**: Update `controller.py:107-131`, `types.py` `ComfortState`, `schemas.py`
  `ComfortStatePayload`, `logging_config.py`.
- **IMPLEMENT**: Add `task_illuminance: float | None = None` and `eye_illuminance: float | None = None`
  to `ComfortState` and `ComfortStatePayload`. Populate in `conditions_at()` when the flag is on.
  Extend `LOG_FIELDS` with an `# Occupant-plane daylight.` block: `ev_exceedance_ticks`,
  `et_in_band_ticks`, `daylight_model`.
- **MIRROR**: COMFORT_STATE_CONSTRUCTION, DOMAIN_DATACLASS, STRUCTURED_LOGGING.
- **IMPORTS**: `from app.domain.daylight.surrogate import at_angle, curve_for`.
- **GOTCHA**: **Do not change `lux_penalty`, `_breakdown`, or `optimise_angle`.** Et/Ev are
  observe-only in this plan; feeding them into the cost function is a separate decision with its own
  evidence requirement. Optional fields with `None` defaults keep `test_api.py`'s reproducibility
  assertion passing when the flag is off. Fields absent from `LOG_FIELDS` are silently dropped.
- **VALIDATE**: `uv run pytest tests/test_api.py -k reproducible` passes with the flag off **and** on.
  With the flag off, the response is byte-identical to the pre-change baseline.

### Task 9: Training/serving parity test
- **ACTION**: Add to `backend/tests/test_daylight.py`.
- **IMPLEMENT**: Build one feature vector through the generation path and one through the inference
  path for identical inputs; assert exact equality.
- **MIRROR**: DOMAIN_TEST.
- **IMPORTS**: `from app.domain.daylight.features import FEATURE_NAMES, build_features`.
- **GOTCHA**: This is the single highest-value test in the plan. Training/serving skew produces a
  model that scores beautifully offline and garbage in production, with **no error message**. Column
  order counts as much as column values.
- **VALIDATE**: Test fails if any feature is reordered, rescaled, or added on one side only.

### Task 10: Floor lens probes and the blindness panel
- **ACTION**: Update `bandPlan.ts`, `FloorPanel.tsx`, `lib/types.ts`; add a blindness readout to the
  Brains lens.
- **IMPLEMENT**: In `bandPlan.ts`, push `{x, z, rotation, kind}` to a returned registry inside
  `chair()` and `desk()` — one line each, no rendering change. Colour seats by Ev against
  `ev_cap_lux`, desks by Et against the 300–500 band. In `FloorPanel`, add "N of M seats over the
  eye-illuminance cap" for the current tick. In the Brains lens, render the task-6 comparison table.
- **MIRROR**: FRONTEND_COMPONENT; the existing `console-card` / `console-card-title` and
  `SURFACE_MODES` button-group patterns.
- **IMPORTS**: `import type { ComfortStatePayload } from '@/lib/types'`.
- **GOTCHA**: `desk()` already calls `chair()` internally, so registering inside `chair()` captures
  both — do not register twice. **Keep `group.name = 'Illustrative office interior — not measured
  drawings'`**; adding modelled data to illustrative geometry makes that label more necessary, not
  less. Clamp the colour ramp for Ev but print the true number. Night ticks render grey, not zero.
  Missing model → hide probes entirely.
- **VALIDATE**: Component test that a tick with `eye_illuminance: 1840` flags the seat and one with
  `null` renders no probe. Existing `BuildingHeatmap.zones.test.ts` still passes.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| oracle zero in zero out | beam=0, diffuse=0 | Et=0, Ev=0 | yes |
| Et falls with depth | diffuse only, probes at 1/3/5 m | monotonically decreasing | no |
| facing away lowers Ev | same probe, `view_rad` ±π | Ev(toward) > Ev(away) | no |
| bounces do work | bounces 1 vs 4, deepest probe | Et increases | **yes — if this fails the oracle is trivial** |
| oracle imports nothing circular | static check | no import of `brain`/`controller` | **yes — architectural** |
| probe registry covers desks | every `floorProgram` combo | ≥1 seat with finite `view_rad` | yes |
| feature vector length | any input | `== len(FEATURE_NAMES)` | no |
| **train/serve parity** | identical inputs, both paths | bit-identical vectors | **yes — silent-failure class** |
| surrogate determinism | same input twice, pinned seed | identical prediction | **yes — G2** |
| missing artifact | no joblib present | returns `None`, run completes | **yes** |
| flag off is inert | full run, flag off | byte-identical to baseline | **yes — G2** |
| curve interpolation | angle 42.5 | between whole-degree 42 and 43 | yes |
| night tick | elevation ≤ min_elevation | no Et/Ev computed | yes |
| linear baseline recorded | training run | report contains linear MAE | **yes — falsification** |
| heavy tail preserved | beam hit on seat | Ev reported unclamped | yes |
| split leaks no day | `build_splits` output | no `day_id` in both train and test | **yes — the paper's documented trap** |
| transfer never trained on | `build_splits` output | zero `split_role=="transfer"` rows in train | **yes — a leaked transfer score looks like evidence** |
| missing split key raises | frame without `zone` or `split_role` | raises, does not fall back to shuffled | **yes — silent-failure class** |
| rotation invariance | west @ sun az 250° vs south @ sun az 160° | identical feature vectors | **yes — the contract transfer depends on** |
| no absolute azimuth | `FEATURE_NAMES` | contains no `wall_azimuth*` or bare `solar_azimuth` | **yes — architectural** |
| ledger appends | two `append_run` calls | exactly two lines, first unchanged | yes |
| sklearn absent | import `app.domain.daylight` with no scikit-learn | package still imports, flag forced off | **yes — deploy without training deps** |

### Edge Cases Checklist
- [ ] Empty input — band whose program has no chairs
- [ ] Maximum size input — all 64 zones × 144 ticks × 61 angles × 2 models; measure, don't assume
- [ ] Invalid types — `view_rad` NaN from a malformed probe
- [ ] Concurrent access — two requests sharing the lazily-loaded model; load once, treat as read-only
- [ ] Network failure — N/A, no network in this path
- [ ] Permission denied — model directory unreadable → degrade to `None`, log once, never raise
- [ ] Missing dependency — `scikit-learn` absent → import guarded, flag forced off

---

## Validation Commands

### Static Analysis
```bash
cd backend && uv run ruff check app tests scripts notebooks
```
EXPECT: Zero errors. `E,F,I,UP`, line length 100. Ruff 0.16.2 lints `.ipynb` cell by cell — verified
against this repo's config; omitting `notebooks` from the path lets the notebook skip the gate.

### Notebook Reproducibility
```bash
cd backend && uv run jupyter nbconvert --to notebook --execute --inplace \
  notebooks/daylight_surrogate_training.ipynb
```
EXPECT: Completes from a clean kernel with no manual cell ordering. This is what `make daylight-train`
runs, and it is the only thing that proves the notebook is a record rather than a session transcript.

### Run Ledger
```bash
wc -l docs/appendix/daylight-runs.jsonl
tail -1 docs/appendix/daylight-runs.jsonl | python3 -m json.tool
```
EXPECT: One line per training run; the last row carries `target`, `model`, `mae_shuffled`,
`mae_holdout`, `git_sha`, `dataset_sha256`, `seed`.

### Unit Tests — daylight only
```bash
cd backend && uv run pytest tests/test_daylight.py -q
```
EXPECT: All pass.

### Determinism Guard — run after EVERY task
```bash
cd backend && uv run pytest tests/test_api.py -q -k reproducible
```
EXPECT: Pass. PRD G2 must survive both flag states.

### Full Test Suite
```bash
cd backend && uv run pytest -q
cd frontend && npm test
```
EXPECT: Backend ≥100 passing (current baseline), frontend ≥67. No regressions.

### Circularity Check
```bash
cd backend && grep -rn "lux_at_angle\|WALL_LUX_PER_IRRADIANCE\|from app.domain.brain\|from app.domain.controller" app/domain/daylight/
```
EXPECT: **No output.** Any hit means the oracle learned from the thing it is supposed to replace.

### Offline Pipeline
```bash
make daylight-data      # generation, resumable
make daylight-train     # models + metrics report
make daylight-ablate    # the decisive experiment
```
EXPECT: Report at `docs/appendix/daylight-blindness-results.md` with a per-controller Ev exceedance table.

### Inference Budget
```bash
cd backend && uv run python -c "
import time, urllib.request, json
body = json.dumps({'scenario':'overview','seed':42}).encode()
req = urllib.request.Request('http://localhost:8000/api/v1/simulations/run', body,
                             {'Content-Type':'application/json'})
t = time.perf_counter(); urllib.request.urlopen(req).read()
print(round(time.perf_counter()-t, 2), 's')"
```
EXPECT: Run once with the flag off and once on; record the delta in the report. If flag-on overhead
exceeds ~1 s, coarsen the angle grid before wiring further.

### Manual Validation
- [ ] `make daylight-ablate`, read the Ev exceedance for the shipped controller — **this number is the
      whole deliverable**
- [ ] Confirm the linear baseline is in the training report, whatever it says
- [ ] Confirm shuffled and holdout metrics are both present and the gap is stated
- [ ] Flag off → run `/dashboard`, response identical to before
- [ ] Flag on → Floor lens, seats coloured, over-cap count matches the tick payload
- [ ] Delete the joblib files, reload → probes hidden, no crash, no zeros
- [ ] Night tick → seats grey
- [ ] `group.name` still reads "Illustrative office interior — not measured drawings"

---

## Acceptance Criteria
- [ ] All 11 tasks completed (5a and 5b count separately)
- [ ] All validation commands pass, circularity check included
- [ ] Oracle satisfies its four physical invariants
- [ ] Training report states shuffled, whole-day/whole-zone holdout, **and** orientation-transfer metrics
- [ ] Transfer verdict written explicitly, and the model's orientation scope stated to match it
- [ ] No absolute compass direction in `FEATURE_NAMES`
- [ ] Linear baseline and the incumbent `WALL_LUX_PER_IRRADIANCE` baseline both reported
- [ ] MAE is the stated selection criterion
- [ ] Notebook executes clean via `nbconvert --execute` from a fresh kernel
- [ ] Notebook is committed **with** outputs; no estimator, split, or metric is defined in a cell
- [ ] `daylight-runs.jsonl` has a row per run and the history cell plots it
- [ ] Blindness report exists with a per-controller Ev exceedance table
- [ ] Controller decision logic unchanged; flag defaults off
- [ ] G2 reproducibility holds in both flag states
- [ ] `LOG_FIELDS` extended
- [ ] No kWh, carbon, or cost figure anywhere in the daylight package
- [ ] Model artifacts gitignored

## Completion Checklist
- [ ] Code follows discovered patterns
- [ ] `ponytail:` comments on the bounce count and the angle grid
- [ ] No matplotlib import anywhere under `backend/app/`
- [ ] Nothing under `backend/app/` references `notebooks/`
- [ ] Tests follow `test_engine.py` style
- [ ] No hardcoded thresholds — all in `DEFAULTS`
- [ ] `scipy` declared explicitly in `pyproject.toml` (currently transitive via pvlib, version 1.18.0)
- [ ] PRD updated — see Notes
- [ ] Paper cited where its method is used
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Oracle is effectively single-bounce → surrogate learns a closed form | Medium | **Critical** | Invariant (d) in task 2; circularity grep |
| Training/serving feature skew | High | **Critical** | Task 9 parity test; one shared assembly function |
| Shuffled split hides generalisation failure | High | High | Whole-day + whole-zone holdout mandatory; paper documents 0.9888 → 0.87 collapse |
| Orientation transfer fails, model serves only 2 of 4 facades | Medium | Medium | Pre-registered in task 5b cell 9b; scope the claim rather than generating two more sweeps. The shipped UI must then hide probes on untrained facades |
| An absolute-azimuth feature creeps back in | Medium | High | `FEATURE_NAMES` assertion test; rotation-invariance test in task 3 |
| Linear baseline matches Extra Trees | Medium | Medium | Pre-registered; report it and stop rather than proceeding |
| Ev exceedance turns out near zero | Medium | High | Pre-registered in task 6; a negative result is still the answer |
| Inference cost makes the endpoint unusable | High | Medium | Angle-curve cache mirroring `optics.py`; flag off by default; benchmark gate |
| Model artifact too large to distribute | Medium | Medium | Cap depth, record MAE cost; gitignore binaries |
| Logic migrates into notebook cells, becoming untestable | **High** | High | Notebook split is stated up front; `training.py` is unit-tested; task 5b forbids defining estimators in cells |
| Notebook only runs in the click order someone used | High | Medium | `make daylight-train` runs `nbconvert --execute` headless; Restart-and-Run-All before every commit |
| Committed notebook outputs make unreadable diffs | Certain | Low | Accepted deliberately — outputs are the record; JSONL ledger carries the machine-readable history |
| `sklearn` import breaks API boot on a serve-only machine | Medium | High | Guarded import in `training.py`; package must import without scikit-learn |
| G2 reproducibility broken by the model | Medium | High | Pinned `random_state`, determinism guard after every task |
| Demo read as measured occupant comfort | Medium | High | Keep the illustrative label; §4.2 wording; "modelled" badge on the panel |
| Scope creep into feeding Et/Ev to the optimiser | High | Medium | Explicit NOT-Building; observe-only in this plan |

## Notes

- **The deliverable is task 6, not the model.** Everything before it exists to make one sentence
  defensible: *"the shipped controller spent N% of occupied hours above the eye-illuminance cap and
  had no signal that told it so."* That sentence needs the oracle and the seats; it does **not** need
  the surrogate, Phase B, or any optimiser change. If the plan stalls, that is the thing to finish.
- **Why the surrogate exists at all**, in one line: the oracle is too slow for 9,216 zone-ticks, so it
  is distilled into a model that runs in microseconds. Standard surrogate-modelling argument — the
  paper's Radiance step took 48 hours and never runs during control.
- `optics.py` is genuinely good work: real geometric raycast through the louvre bank with 8×16
  cosine-weighted diffuse quadrature. The gap is entirely on the **interior** side, where
  `daylight_transmittance()` returns `solar_transmittance()` unchanged and
  `WALL_LUX_PER_IRRADIANCE = 1.7` carries the whole room. Frame the work as extending a sound model
  inward, not as fixing a broken one.
- **Build Ev before Et.** Ev alone powers the decisive experiment; Et mostly re-derives what the
  incumbent constant already approximates.
- **On tracking performance.** The notebook shows one run in depth; `daylight-runs.jsonl` shows every
  run over time. Both are needed — the notebook answers "is this model any good and why", the ledger
  answers "did it get better or worse than last week". Deliberately no MLflow or Weights & Biases: a
  JSONL append plus a plot cell covers the whole requirement at this scale, and a tracking server is
  another service to run during a demo. If the run count passes a few hundred, or several people
  start training concurrently, that is the moment to revisit — not before.
- The ledger's `git_sha` and `dataset_sha256` are what make a row meaningful. A metric with no record
  of which code and which data produced it cannot be compared against anything, which is the usual
  reason notebook-based tracking decays into screenshots.
- **Upgrade path if generation ever becomes the bottleneck** (it should not at ~9,360 solves): the
  radiosity solve is `(I − ρF)·B = E`, linear in `E`, so two unit solves — one for unit beam entry,
  one for unit diffuse — cover every louvre angle by linear combination, since the angle only scales
  the entering flux. That is 13 solves → 2. Separately, the form-factor matrix `F` depends only on
  room geometry, so it can be computed once per floor program and cached across every tick and day.
  Together roughly an order of magnitude. Deliberately **not** built now: at the scaled-down sweep
  the whole run is minutes, and both add real complexity to the oracle's signature.
- **The transfer test is the best experiment in this plan.** It mirrors what the paper did with
  cities it never trained on — "testing the model with data from cities not included in the training
  dataset demonstrated its ability to generalize" — and it costs one thin 3-day slice because the
  features were designed facade-relative from the start. Either outcome is publishable: transfer
  holding proves rotation-invariance, transfer failing locates a real limit of the feature set.
- **Resist growing the dataset.** The instinct when holdout MAE disappoints is more rows; it is
  usually more *diversity* that is missing — another season, another band, another facade — not more
  samples of what is already covered. The ledger makes that testable: add one axis, retrain, compare
  `mae_holdout` against the previous row.
- The Floor lens already renders a furnished cutaway whose `group.name` says *"Illustrative office
  interior — not measured drawings"*, and whose chairs carry position **and** rotation. Those chairs
  are Ev probes that already exist on screen. That is why the demo cost here is low — the geometry is
  drawn, it just carries no data.
- `TickPayload` already ships `naive_angle`, `naive_lux`, `naive_load_relative`, and
  `SimulationCharts` already plots the comparison. Adding a naive-vs-controlled Ev series is one more
  chart series on shipped machinery, not new infrastructure.
- **PRD consequences if this ships:** §4.2 gains a guardrail that Et/Ev are modelled occupant-plane
  estimates from an uncalibrated room model, never measured comfort; §9 "Explainability" gains the
  occupant-plane metric; §11.1 "No field calibration" should name `WALL_LUX_PER_IRRADIANCE` and the
  room reflectances explicitly; Appendix A gains the Ev/Et thresholds; §8.2 gains `scikit-learn` and
  `joblib`, and `scipy` moves from transitive to declared.
- Companion plans: `dashboard-lens-split-and-provenance.plan.md` (**shipped** — Floor/Brains lenses,
  `ProvenanceStrip`, `CostBreakdownPanel`, `bandPlan.ts` all exist, which is what makes Phase B cheap)
  and `langgraph-agentic-afc.plan.md` (planned). The paper's holdout lesson applies to the AFC
  confidence scorer too: hold out whole days and whole zones there as well.
