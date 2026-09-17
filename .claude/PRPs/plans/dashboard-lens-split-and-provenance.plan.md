# Plan: Dashboard Lens Split and Provenance Disclosure

## Summary

`/dashboard` renders every panel at once across three rails, so an evaluator must scan the whole
screen to answer any single question. This plan splits it into four navigable lenses over one shared
simulation run, and surfaces the provenance metadata the backend already sends but the UI currently
throws away (`data_notice`, `load_unit`, `synthetic`, `weather_context`, `cost_breakdown` — all
rendered zero times today).

## User Story

As a **technical evaluator judging whether the NeuroSkin simulation can be believed**,
I want **one question answered per screen, with the data's origin always visible**,
so that **I can tell a provider-anchored run from a synthetic fallback, and audit each decision layer
without reading source code**.

## Problem → Solution

**Current:** one page, three rails, 12+ panels competing for attention; a silent Open-Meteo fallback
to synthetic data looks pixel-identical to a live provider run.

**Desired:** four lenses (`building` / `floor` / `brains` / `feeds`) selected by URL param over the
same in-memory run, plus an always-visible provenance strip that names the data source, its
freshness, and the load unit.

## Metadata

- **Complexity**: Large
- **Source PRD**: `docs/neuroskin_software_prd.md` (v0.3)
- **PRD Phase**: N/A — standalone, derived from PRD §2 row 5, §4.1 G1/G7, §4.2
- **Estimated Files**: 13 (7 create, 6 update)

---

## UX Design

### Before

```
┌──┬──────────────────────────┬──────────────────┬───────────────┐
│  │ LEFT RAIL (380px)        │ STAGE            │ RIGHT (310px) │
│N │ 24-hour result header    │                  │ SimControls   │
│A │ TierRunner               │  BuildingHeatmap │ (date, cloud, │
│V │ Facade comparison        │  + TierCard      │  site, tilt,  │
│  │ CloudVisionPanel         │  + stage toolbar │  occupancy,   │
│  │ FacadeReadout            │                  │  wind, power) │
│  │ ZoneSensorPanel          │                  │ ControllerPanel│
│  │ Events                   │                  │ (4 weights)   │
│  │ SimulationCharts x2      │                  │               │
└──┴──────────────────────────┴──────────────────┴───────────────┘
   Everything, always. 12+ panels. No data-origin label beyond
   "Synthetic · seed 42" at NeuroSkinDashboard.tsx:493.
```

### After

```
┌──┬────────────────────────────────────────────────────────────┐
│  │ PROVENANCE STRIP (always visible, full width)              │
│  │ ● Open-Meteo forecast · fetched 12:04 · relative index     │
│N ├──────────────────────┬──────────────────┬──────────────────┤
│A │ LEFT RAIL            │ STAGE            │ RIGHT RAIL       │
│V │                      │                  │                  │
│  │ ─ lens content ─     │ BuildingHeatmap  │ SimControls      │
│⬛│                      │ (persists across │ ControllerPanel  │
│⬛│                      │  every lens)     │  (building lens) │
│⬛│                      │                  │                  │
│⬛│                      │                  │                  │
└──┴──────────────────────┴──────────────────┴──────────────────┘

 NAV        LEFT RAIL SHOWS                      STAGE MODE
 ───────────────────────────────────────────────────────────────
 building   gauges, ImpactStrip, comparison      3D orbit
 floor      band selector, zone list, glare      plan (overhead)
 brains     CostBreakdownPanel, trust, events    3D orbit
 feeds      FeedsPanel, CloudVisionPanel, limits 3D orbit
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Data origin | `sourceLabels[...]` + seed, one line, left rail only | Provenance strip, always visible, names source + fetch time + fallback reason + load unit | Closes PRD G7 |
| Panel count on screen | 12+ | 3-5 per lens | Stage never unmounts |
| Lens switch | none | nav button → `?view=` | Shallow, no refetch |
| Cost breakdown | not rendered | `CostBreakdownPanel` in brains lens | Closes PRD §4.1 G1 admission |
| Model limits | 2 inline sentences | `ModelLimitsPanel` in feeds lens | Mirrors `/slab` claim gating |
| Floor inspection | click zone in 3D only | band selector + overhead plan view | Rows band floors, labelled as such |
| Upstream health | invisible | `FeedsPanel` per-feed last-success | Needs backend task 9 |

### Edge Cases for UX

- `?view=` absent or unknown → fall back to `building`, do not error.
- `weather_context === null` (pure synthetic) → strip shows "Synthetic" + `data_notice`, no fetch time.
- `weather_context.status === 'fallback'` → strip turns amber and shows `fallback_reason`. **This is the
  case the whole plan exists for.** Must be visually distinct from `applied`.
- Floor lens with `ticks[].facade[].zones` empty → show "zone grid unavailable for this run".
- Lens switch mid-tier-run → tier run must continue; it lives in `NeuroSkinDashboard` state, not in a lens.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `frontend/src/components/neuroskin/NeuroSkinDashboard.tsx` | 437-935 | The shell being split; rail/stage/nav JSX and all inline components |
| P0 | `frontend/src/lib/types.ts` | 360-383 | `SimulationRunResponse.metadata` — every provenance field already typed |
| P0 | `frontend/src/lib/types.ts` | 176-200 | `WeatherContextPayload` — status/fallback_reason/fetched_at |
| P0 | `frontend/src/app/globals.css` | 59-175 | `@layer components` console classes to extend, not replace |
| P1 | `frontend/src/components/neuroskin/ControllerPanel.tsx` | 1-45 | Canonical small-component shape: `'use client'`, props interface, module-level config array |
| P1 | `frontend/src/components/neuroskin/ControllerPanel.test.tsx` | 1-35 | Canonical test: literal request fixture, `describe`/`it`, `vi.fn()` callbacks |
| P1 | `frontend/src/components/neuroskin/BuildingHeatmap.tsx` | 93-99, 1745-1800 | `SURFACE_MODES` tuple array + its button group — the pattern for `CAMERA_MODES` |
| P1 | `frontend/src/components/neuroskin/CloudVisionPanel.tsx` | 140-225 | Freshness pattern: `age`, `fresh` (≤60s), error surfacing |
| P2 | `frontend/src/components/neuroskin/PredictiveSlab.tsx` | 370-380, 960-970 | How `/slab` already gates claims; `synthetic-badge` class |
| P2 | `backend/app/domain/scenarios.py` | 172-199 | Exact `data_notice` strings the strip must render |
| P2 | `backend/app/main.py` | 87-90 | The stub health endpoint task 9 replaces |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| `useSearchParams` needs Suspense | Next.js App Router docs | A client component calling `useSearchParams()` under a statically-rendered route must sit inside `<Suspense>`, or `next build` warns and bails out of static generation. `/dashboard` is currently `○ (Static)`. See GOTCHA in task 3. |
| Three.js orthographic camera | three.js docs, `OrthographicCamera` | Swapping camera type requires re-creating the camera and re-pointing the render loop; do not mutate a `PerspectiveCamera` into an orthographic one. |

No other external research needed — every other change uses established internal patterns.

---

## Patterns to Mirror

### NAMING_CONVENTION
```tsx
// SOURCE: frontend/src/components/neuroskin/ControllerPanel.tsx:1-13
'use client'

import { BrainCircuit, Play, SlidersHorizontal } from 'lucide-react'
import type { ControllerWeights, SimulationRunRequest } from '@/lib/types'
import { RangeControl } from './SimulationControls'

interface ControllerPanelProps {
  value: SimulationRunRequest
  loading: boolean
  onChange: (value: SimulationRunRequest) => void
  onRun: () => void
}
```
PascalCase component + file name; `interface <Name>Props` directly above; `import type` for types;
`@/lib/...` for lib, relative `./` for siblings. Named exports only — no default exports anywhere
in `components/neuroskin/`.

### MODULE_LEVEL_CONFIG_ARRAY
```tsx
// SOURCE: frontend/src/components/neuroskin/BuildingHeatmap.tsx:93-99
const SURFACE_MODES = [
  ['irradiance', 'Irradiance'],
  ['model', '3D model'],
  ['temp', 'Surface temp'],
  ['exposure', 'Daily sun'],
] as const
type SurfaceMode = (typeof SURFACE_MODES)[number][0]
```
Option sets live at module scope as `as const` tuple arrays with the union type derived from them.
`LENSES` and `CAMERA_MODES` must follow this exactly.

### BUTTON_GROUP_FROM_CONFIG
```tsx
// SOURCE: frontend/src/components/neuroskin/BuildingHeatmap.tsx:1751-1768
<div aria-label='Surface colouring' className='mt-2 flex flex-wrap gap-1' role='group'>
  {SURFACE_MODES.map(([mode, label]) => (
    <button
      aria-pressed={surfaceMode === mode}
      className={
        surfaceMode === mode
          ? 'rounded-md bg-primary px-2 py-1.5 text-[10px] font-semibold text-primary-foreground'
          : 'rounded-md border border-border px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-secondary/60'
      }
      key={mode}
      onClick={() => setSurfaceMode(mode)}
      type='button'
    >
      {label}
    </button>
  ))}
</div>
```
`aria-pressed` for toggle state, `role='group'` + `aria-label` on the wrapper, ternary className.

### CARD_SECTION
```tsx
// SOURCE: frontend/src/components/neuroskin/NeuroSkinDashboard.tsx:625-627
<section className='console-card' data-tour='events'>
  <p className='console-card-title'>Events</p>
```
Every rail panel is `<section className='console-card'>` with a `<p className='console-card-title'>`
heading. Keep the `data-tour` attributes — `GuidedTour.tsx` was deleted this session but the 34
attributes remain as free anchors for the lens nav.

### ERROR_AND_LOADING_STATE
```tsx
// SOURCE: frontend/src/components/neuroskin/NeuroSkinDashboard.tsx:696-701
{error ? (
  <ErrorState message={error} onRetry={() => void execute(request)} />
) : loading && !data ? (
  <LoadingState />
) : data && selectedTick ? (
```
Nested ternary in the stage; `void execute(...)` for fire-and-forget async in JSX handlers.

### CSS_LAYER_COMPONENT
```css
/* SOURCE: frontend/src/app/globals.css:155-161 */
  .console-card {
    @apply rounded-2xl border border-border/70 bg-white p-3 shadow-[0_8px_28px_rgba(15,45,38,.05)];
  }

  .console-card-title {
    @apply text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground;
  }
```
All shared classes live in `@layer components` in `globals.css` as `@apply` bundles. New classes go
in the same layer near their siblings. Do not create a separate CSS file.

### TEST_STRUCTURE
```tsx
// SOURCE: frontend/src/components/neuroskin/ControllerPanel.test.tsx:1-30
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SimulationRunRequest } from '@/lib/types'
import { ControllerPanel } from './ControllerPanel'

const request: SimulationRunRequest = {
  scenario: 'overview',
  date: '2026-03-21',
  seed: 42,
  /* ...full literal fixture, no factory helpers... */
}

describe('controller calibration', () => {
  it('shows defaults and submits each changed calibration through the existing request callback', () => {
    const onChange = vi.fn()
```
Co-located `*.test.tsx` beside the component. Full literal fixtures, no builders. `describe` names a
behaviour area, `it` names a user-visible outcome in a full sentence. Query by role/text, never by
`data-testid`.

### API_CLIENT_FUNCTION
```ts
// SOURCE: frontend/src/lib/api-client.ts:55-60
export function runSimulation(
  request: SimulationRunRequest,
  signal?: AbortSignal
): Promise<SimulationRunResponse> {
  return post('/api/v1/simulations/run', request, 'Simulation', signal)
}
```
Thin named wrapper over the private `post`/`get` helper with a human label for error text and an
optional `AbortSignal`. Task 9 adds `getHealth` in this shape (needs a `get` helper — there is none
yet; add it mirroring `post` at `api-client.ts:33-52`).

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `frontend/src/components/neuroskin/ProvenanceStrip.tsx` | CREATE | Renders `metadata.data_notice` / `load_unit` / `synthetic` / `weather_context` |
| `frontend/src/components/neuroskin/ProvenanceStrip.test.tsx` | CREATE | Must cover applied vs fallback vs null weather_context |
| `frontend/src/components/neuroskin/DashboardCards.tsx` | CREATE | Extract `GaugeCard`, `ImpactStrip`, `StatusBadge`, `LoadingState`, `ErrorState` from dashboard L918-1096 |
| `frontend/src/components/neuroskin/CostBreakdownPanel.tsx` | CREATE | Renders `tick.cost_breakdown`, currently 0 references in frontend |
| `frontend/src/components/neuroskin/CostBreakdownPanel.test.tsx` | CREATE | Weights-sum and selected-tick behaviour |
| `frontend/src/components/neuroskin/ModelLimitsPanel.tsx` | CREATE | PRD §4.2 guardrails as UI, mirroring `/slab` claim gating |
| `frontend/src/components/neuroskin/FeedsPanel.tsx` | CREATE | Per-feed last-success from `/health` + vision age |
| `frontend/src/components/neuroskin/NeuroSkinDashboard.tsx` | UPDATE | Add `view` param, lens switch, mount strip; delete the 5 extracted inline components |
| `frontend/src/components/neuroskin/BuildingHeatmap.tsx` | UPDATE | Add `cameraMode` prop + orthographic overhead plan mode |
| `frontend/src/app/dashboard/page.tsx` | UPDATE | Wrap in `<Suspense>` for `useSearchParams` |
| `frontend/src/app/globals.css` | UPDATE | Add `.provenance-strip`, `.provenance-dot`, `.lens-nav-button` to `@layer components` |
| `frontend/src/lib/api-client.ts` | UPDATE | Add `get` helper + `getHealth` |
| `backend/app/main.py` | UPDATE | Replace stub `/api/v1/health` with real dependency probes |

**No change to `frontend/src/lib/types.ts`.** Every field this plan renders is already typed at
`types.ts:340-383`. Verified: `data_notice:346,376`, `load_unit:377`, `synthetic:350,375`,
`weather_context:378`, `WeatherContextPayload:176-200`, `CostBreakdown` on `TickPayload`.

## NOT Building

- **Energy / kWh / carbon / cost / payback anywhere on `/dashboard`.** PRD §4.2: facade load is a
  *relative cooling-load index* and "must never be converted into HVAC kWh, carbon, cost, or payback".
- **Per-floor occupancy.** `TickPayload.occupancy` is one global float. Do not fan it into 7 fake
  per-floor values. Deferred to a backend schema change.
- **An HVAC panel.** No AHU, supply-air temp, static pressure, or setpoint is modelled anywhere on the
  facade side. §4.3 lists hydronic plant modelling as a non-goal. The floor lens shows thermal load
  index + glare/daylight status instead.
- **Separate Next.js routes per lens.** One `?view=` param over shared state; four routes would mean
  four simulation calls. Promote only if a lens needs its own data.
- **Alert acknowledgement, work orders, maintenance history, run history, accounts.** PRD §4.3 non-goals;
  all need persistence that does not exist.
- **A new three.js scene.** The plan view is a camera mode on the existing renderer.
- **Re-mounting a guided tour.** `GuidedTour.tsx` was deleted this session (608 lines, zero imports,
  5 of 17 targets stale). The lens nav replaces it.
- **Rewriting `BuildingHeatmap.tsx`.** 2073 lines; this plan adds one prop and one camera branch.

---

## Step-by-Step Tasks

### Task 1: Extract inline dashboard components
- **ACTION**: Create `DashboardCards.tsx`; move `GaugeCard` (L918-976), `formatMetric` (L977-980),
  `ImpactStrip` (L981-1023), `StatusBadge` (L1024-1039), `LoadingState` (L1040-1051),
  `ErrorState` (L1052-1096) out of `NeuroSkinDashboard.tsx`.
- **IMPLEMENT**: Named exports for all five components plus `formatMetric`. Copy the bodies verbatim —
  behaviour must not change. Keep the existing doc comments (`/** Bounded value as a 270-degree arc... */`,
  `/** "70%" but "1 moves" — only a bare symbol sits tight against its number. */`).
- **MIRROR**: NAMING_CONVENTION. File needs `'use client'` — `GaugeCard` and `ImpactStrip` are pure but
  `ErrorState` takes an `onRetry` handler.
- **IMPORTS**: `import type { ComparisonMetric } from '@/lib/types'`; `LoaderCircle`, `AlertTriangle`
  from `lucide-react` (check which icons the moved bodies actually use and move only those).
- **GOTCHA**: `NeuroSkinDashboard.tsx` imports from `lucide-react` at L6-16 for both its own JSX and
  these components. After the move, delete only the icons no longer referenced in the dashboard —
  `npm run lint` will flag unused imports.
- **VALIDATE**: `npm test` — all 67 tests still pass, especially the 13 in `NeuroSkinDashboard.test.tsx`.

### Task 2: Provenance strip
- **ACTION**: Create `ProvenanceStrip.tsx` + test.
- **IMPLEMENT**:
  ```tsx
  interface ProvenanceStripProps {
    metadata: SimulationRunResponse['metadata']
    visionAgeSeconds: number | null
  }
  ```
  Render one horizontal row:
  1. **Status dot + source**: `weather_context === null` → neutral dot, `sourceLabels[environment_source]`.
     `weather_context.status === 'applied'` → green dot, `provider` + `dataset`.
     `weather_context.status === 'fallback'` → **amber dot**, `"Fallback"`, and `fallback_reason`.
  2. **Fetch time**: `weather_context.fetched_at` formatted with the existing `timeLabel` helper
     (`NeuroSkinDashboard.tsx:135`) — export it from `DashboardCards.tsx` in task 1 or duplicate the
     3-line `Intl.DateTimeFormat` call.
  3. **`data_notice`** verbatim, in full. This is the sentence `scenarios.py:172` composes.
  4. **`load_unit`** verbatim (`"relative cooling-load index"`) as a claim-scope label.
  5. **`seed`** when `synthetic === true`.
  6. **Vision age** when `visionAgeSeconds !== null`: `"sky sample Ns ago"`, amber past 60s.
- **MIRROR**: CARD_SECTION for the wrapper; CSS_LAYER_COMPONENT for `.provenance-strip` / `.provenance-dot`.
- **IMPORTS**: `import type { SimulationRunResponse } from '@/lib/types'`.
- **GOTCHA**: Render `data_notice` in full — do not truncate or paraphrase. Its exact wording
  ("the run fell back to a fully synthetic ... day") is the disclosure. `fetched_at` is an ISO string;
  pass `metadata.timezone` to the formatter, not the browser default.
- **VALIDATE**: Three tests — applied shows provider, fallback shows `fallback_reason` and the amber
  class, `weather_context: null` shows neither but still shows `data_notice`.

### Task 3: Lens param and nav
- **ACTION**: Add lens state to `NeuroSkinDashboard.tsx`; wrap `/dashboard` in `<Suspense>`.
- **IMPLEMENT**:
  ```tsx
  const LENSES = [
    ['building', 'Building', Building2],
    ['floor', 'Floor', Layers],
    ['brains', 'Brains', BrainCircuit],
    ['feeds', 'Feeds', Radio],
  ] as const
  type Lens = (typeof LENSES)[number][0]
  ```
  Read with `useSearchParams().get('view')`, validate against `LENSES`, default `'building'` on
  unknown. Add four `<Link href={'/dashboard?view=' + id}>` buttons to `console-nav` (L439-462),
  using `console-nav-button-active` (already defined at `globals.css:110`) for the current lens.
  In `page.tsx`:
  ```tsx
  export default function DashboardPage() {
    return (
      <Suspense fallback={null}>
        <NeuroSkinDashboard />
      </Suspense>
    )
  }
  ```
- **MIRROR**: MODULE_LEVEL_CONFIG_ARRAY, BUTTON_GROUP_FROM_CONFIG.
- **IMPORTS**: `useSearchParams` from `next/navigation`; `Suspense` from `react`; icons from `lucide-react`.
- **GOTCHA**: **`useSearchParams()` in a client component under a static route makes `next build`
  bail out of static generation** unless a `<Suspense>` boundary wraps it. `/dashboard` currently
  builds as `○ (Static)` — confirm it still does after this task. Also: the nav already holds a `/slab`
  link and a back link with `ml-auto xl:ml-0 xl:mt-auto` (L453); insert lens buttons *before* that
  wrapper so the back link stays pinned.
- **VALIDATE**: `npm run build` — `/dashboard` still listed `○ (Static)`, no `useSearchParams` warning.
  Add a test asserting `?view=brains` shows the cost breakdown heading and `?view=nonsense` shows the
  building lens.

### Task 4: Lens-gate the left rail
- **ACTION**: Wrap each existing left-rail section in `NeuroSkinDashboard.tsx` (L463-691) in a lens condition.
- **IMPLEMENT**: Distribute existing panels — `building`: header, `TierRunner`, gauges, `ImpactStrip`,
  facade comparison (L516). `floor`: `FacadeReadout` (L596), `ZoneSensorPanel` (L606), band selector
  (task 8). `brains`: `CostBreakdownPanel` (task 5), trust readout, Events (L625), `SimulationCharts`
  (L657-691). `feeds`: `CloudVisionPanel` (L590), `FeedsPanel` (task 9), `ModelLimitsPanel` (task 6).
  Right rail: `SimulationControls` always; `ControllerPanel` only in `building`.
- **MIRROR**: ERROR_AND_LOADING_STATE ternary style.
- **IMPORTS**: none new.
- **GOTCHA**: The stage (`<section className='console-stage'>`, L692) and `BuildingHeatmap` must sit
  **outside** every lens conditional — unmounting it destroys the WebGL context and rebuilds the
  scene on each lens switch. Same for tier-run state (`tierStatus`, `tierResults`, `requestController`):
  it lives in the dashboard, so a lens switch mid-run must not interrupt it.
- **VALIDATE**: `npm test` — the existing test "keeps the three tiers on one page instead of separate
  scenario views" (`NeuroSkinDashboard.test.tsx`) must still pass; tiers stay in the `building` lens.

### Task 5: Cost breakdown panel
- **ACTION**: Create `CostBreakdownPanel.tsx` + test.
- **IMPLEMENT**: Props `{ tick: TickPayload; weights: ControllerWeights }`. Render the four
  `tick.cost_breakdown` components (`thermal`, `lux`, `movement`, `risk`) as a stacked proportional
  bar plus a numeric row, with `angle_target` → `angle_final` and the delta. Reuse the weight colours
  already defined in `ControllerPanel.tsx:24-45` (`bg-emerald-500`, `bg-sky-500`, …) — import the
  array or restate it; do not invent a second palette.
- **MIRROR**: CARD_SECTION, NAMING_CONVENTION.
- **IMPORTS**: `import type { ControllerWeights, TickPayload } from '@/lib/types'`.
- **GOTCHA**: PRD §4.1 G1 states the dashboard surfaces "not the per-tick cost breakdown" — this task
  closes that. The four components are *costs*, so **lower is better**; label the axis to say so or the
  bar reads backwards. Values can be 0 for every component at night; guard division by a zero total.
- **VALIDATE**: Test that a tick with `{thermal: 0.3, lux: 0.1, movement: 0, risk: 0}` renders all
  four labels and that an all-zero breakdown does not produce `NaN%`.

### Task 6: Model limits panel
- **ACTION**: Create `ModelLimitsPanel.tsx`.
- **IMPLEMENT**: Static PRD §4.2 guardrails plus three live values from `metadata`: `load_unit`,
  `synthetic`, `facade_tilt` (with "115 = the Diamond's 25° outward lean, 90 = upright counterfactual").
  Include, as plain sentences: facade load is a relative index and is never converted to kWh/carbon/cost;
  the latent-load floor shading cannot remove; Open-Meteo is provider forecast, not building telemetry;
  occupancy, indoor lux/temp/RH, pyranometer noise and facade control are simulated; the 3D massing is
  reconstructed from published figures, not measured drawings (README "Target building").
- **MIRROR**: `PredictiveSlab.tsx:370-380` claim-gating tone; the `synthetic-badge` class (`globals.css`)
  already exists — reuse it.
- **IMPORTS**: `import type { SimulationRunResponse } from '@/lib/types'`.
- **GOTCHA**: Do not soften the wording. This panel is the difference between a proof and a pitch;
  it exists to *limit* claims, so hedging it defeats the purpose.
- **VALIDATE**: Renders `metadata.load_unit` verbatim; no test beyond a smoke render needed (static content).

### Task 7: Plan camera mode in BuildingHeatmap
- **ACTION**: Add a `cameraMode` prop and an overhead orthographic mode to `BuildingHeatmap.tsx`.
- **IMPLEMENT**: Add `const CAMERA_MODES = [['orbit', 'Orbit'], ['plan', 'Floor plan']] as const`
  near `SURFACE_MODES` (L93). Accept `cameraMode?: 'orbit' | 'plan'` and `band?: number` (0-3).
  In `plan`: build a second `THREE.OrthographicCamera` looking straight down, disable orbit rotation,
  and dim wall zones whose `row !== band` so one 16-cell perimeter ring reads clearly. Keep the
  existing `SURFACE_MODES` colour ramp.
- **MIRROR**: MODULE_LEVEL_CONFIG_ARRAY; BUTTON_GROUP_FROM_CONFIG for the toggle.
- **IMPORTS**: already has `* as THREE`.
- **GOTCHA**: Do not mutate the existing `PerspectiveCamera` — create the orthographic camera once and
  switch which one the render loop uses. Zone `row` is one of **4** bands over **7** floors
  (`config.py`: `floors: 7`, 4×4 zone grid), so bands cover floors `{0,1}{2,3}{4,5}{6}`. Label the
  selector "Band 2 · floors 3-4", **never "Floor 3"** — claiming per-floor resolution the model does
  not have. Zone ids are `f"{orientation[0].upper()}{row * columns + column + 1}"`
  (`facade.py:274`) → `W1`…`W16`, not `W-r2-c3`. Interior/core is not modelled: draw it hatched and
  labelled "core not modelled".
- **VALIDATE**: `npm test` — `BuildingHeatmap.zones.test.ts` must still pass. jsdom has no WebGL
  (tests already log "Error creating WebGL context" harmlessly), so assert on the band-selector DOM,
  not on rendered pixels.

### Task 8: Floor lens content
- **ACTION**: Add the band selector and zone list to the `floor` lens.
- **IMPLEMENT**: Four band buttons driving `BuildingHeatmap`'s `band` prop and `cameraMode='plan'`.
  Below them, list the selected band's 16 zones per selected wall with `load_relative`,
  `conditions.daylight_status` (low/useful/high), `conditions.glare_risk`, `angle`, `mode`,
  `sensor_trusted`. Reuse `ZoneSensorPanel` for the selected zone's detail.
- **MIRROR**: CARD_SECTION; BUTTON_GROUP_FROM_CONFIG.
- **IMPORTS**: `import type { ZoneHeatPayload } from '@/lib/types'`.
- **GOTCHA**: Call the panel **"Thermal & daylight"**, not "HVAC" — there is no HVAC model. Occupancy
  is global (`tick.occupancy`), so show it once at building level, never per band.
- **VALIDATE**: Test that selecting band 2 lists 16 zones and that a `glare_risk: true` zone is flagged.

### Task 9: Real health endpoint and feeds panel
- **ACTION**: Replace `backend/app/main.py:87-90`; add `get` + `getHealth` to `api-client.ts`; create
  `FeedsPanel.tsx`.
- **IMPLEMENT**: Backend returns per-dependency status for Roboflow (is `ROBOFLOW_API_KEY` set),
  Open-Meteo, and MET Malaysia, each with `configured`, `last_status`, `last_success_at`. Keep the
  existing top-level `{"status", "service", "model"}` keys so `test_api.py:12` still passes. Frontend
  panel lists each feed with its age, plus vision sample age from `CloudVisionPanel`'s existing
  `age`/`fresh` state.
- **MIRROR**: Backend — the `logger.info(..., extra={"event": ...})` structured-logging pattern from
  `main.py:127-150`, and `HTTPException` from `vision.py:143`. Frontend — API_CLIENT_FUNCTION.
- **IMPORTS**: backend `from app.config import DEFAULTS`; frontend nothing new.
- **GOTCHA**: `/health` must stay **fast and non-blocking** — do not make live outbound calls to
  Open-Meteo or MET on every probe. Report the last observed status from in-process state; a health
  check that hangs on a dead upstream is worse than a stub. There is no `get` helper in
  `api-client.ts` yet — add one mirroring `post` (L33-52), keeping the `label`-based error text.
- **VALIDATE**: `cd backend && uv run pytest tests/test_api.py -q` — `test_health_and_config` passes
  unchanged. Frontend test asserts an unconfigured feed renders as "not configured", not as an error.

### Task 10: CSS
- **ACTION**: Add `.provenance-strip`, `.provenance-dot`, `.provenance-dot-warn`, `.lens-nav-button`,
  `.band-button` to `globals.css` inside `@layer components`.
- **IMPLEMENT**: `@apply` bundles matching neighbouring density (10px uppercase tracked labels,
  `rounded-2xl`, `border-border/70`).
- **MIRROR**: CSS_LAYER_COMPONENT.
- **GOTCHA**: Place new classes next to `.console-*` siblings (around `globals.css:155`), not at the
  end of the layer. The `.tour-*` classes were deleted this session — do not reintroduce them.
- **VALIDATE**: `node -e` brace-balance check on `globals.css` (must report depth 0), then `npm run build`.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| strip shows provider when applied | `weather_context.status='applied'`, `provider='Open-Meteo'` | provider + dataset + fetch time visible | no |
| strip warns on fallback | `status='fallback'`, `fallback_reason='timeout'` | amber dot + reason text rendered | **yes — core case** |
| strip handles pure synthetic | `weather_context: null`, `synthetic: true` | `data_notice` + seed shown, no fetch time | yes |
| strip shows load unit verbatim | `load_unit='relative cooling-load index'` | exact string present | no |
| stale vision sample | `visionAgeSeconds: 95` | amber, "95s ago" | yes |
| lens default | no `?view=` | building lens content | yes |
| lens unknown value | `?view=nonsense` | building lens, no crash | yes |
| lens switch keeps tiers | run tiers, switch lens, return | tier results still present | **yes — regression risk** |
| cost breakdown renders four components | `{thermal:.3,lux:.1,movement:0,risk:0}` | four labels + bar | no |
| cost breakdown all-zero | all components 0 | no `NaN`, no division error | yes |
| band selector lists 16 zones | band 2, west wall | 16 zone rows | no |
| band labelled as band | band 2 | "floors 3-4" wording, never "Floor 2" | yes |
| glare flagged | zone with `glare_risk: true` | zone marked | no |
| health keeps legacy keys | GET `/api/v1/health` | `status == "ok"` | **yes — existing test** |
| unconfigured feed | `ROBOFLOW_API_KEY` unset | "not configured", not an error | yes |

### Edge Cases Checklist
- [ ] Empty input — `data` null on first paint; strip must not render before a run completes
- [ ] Maximum size input — 144 ticks × 4 walls × 16 zones in the band list; virtualise only if it janks
- [ ] Invalid types — `?view=` arbitrary string
- [ ] Concurrent access — lens switch during an in-flight tier run (`requestController.current`)
- [ ] Network failure — `/health` unreachable; `FeedsPanel` degrades to "unknown", never blocks the page
- [ ] Permission denied — N/A, no auth
- [ ] WebGL unavailable — jsdom and some CI browsers; band selector must render without the canvas

---

## Validation Commands

### Static Analysis
```bash
cd frontend && npm run lint
```
EXPECT: Zero errors. Watch for unused `lucide-react` imports after task 1.

### Unit Tests
```bash
cd frontend && npx vitest run src/components/neuroskin/ProvenanceStrip.test.tsx
```
EXPECT: All pass.

### Full Test Suite
```bash
cd frontend && npm test
cd backend && uv run pytest -q
```
EXPECT: Frontend ≥67 passing (67 is the current baseline after the `GuidedTour` deletion), zero
failures. Backend all pass, `test_health_and_config` included.

### CSS Integrity
```bash
cd frontend && node -e "const s=require('fs').readFileSync('src/app/globals.css','utf8');let d=0,m=0;for(const c of s){if(c==='{')d++;if(c==='}'){d--;m=Math.min(m,d)}}console.log('depth',d,'min',m)"
```
EXPECT: `depth 0 min 0`

### Build
```bash
cd frontend && npm run build
```
EXPECT: Compiles; route table still shows `/dashboard` as `○ (Static)`; no `useSearchParams` warning.

### Browser Validation
```bash
make backend   # port 8000
cd frontend && npm run dev   # port 3000
```
EXPECT: `/dashboard?view=brains` shows the cost breakdown; all four lenses reachable from the nav.

### Manual Validation
- [ ] Open `/dashboard` — provenance strip visible above the rails before touching anything
- [ ] Switch all four lenses — 3D model never flickers or reloads
- [ ] Start a tier run, switch lens mid-run, return — run completed, results intact
- [ ] Stop the backend, reload — `ErrorState` shows, strip absent, no crash
- [ ] Set `environment_source: open_meteo` with the network blocked — **strip must turn amber and print
      the fallback reason.** This is the single most important manual check in this plan.
- [ ] `?view=brains` — cost breakdown numbers change as the clock scrubs
- [ ] Floor lens — plan view overhead, one band lit, core hatched, label reads "floors N-M"
- [ ] Resize to 1279px — rails stack, lens nav still reachable

---

## Acceptance Criteria
- [x] All 10 tasks completed
- [x] All validation commands pass
- [x] Tests written and passing
- [x] No type errors
- [x] No lint errors
- [x] Matches UX design above
- [x] `data_notice`, `load_unit`, `synthetic`, `weather_context`, `cost_breakdown` each rendered at
      least once (all are currently 0-reference)
- [x] No kWh, carbon, cost, or payback figure anywhere on `/dashboard`
- [x] No per-floor occupancy value anywhere
- [x] Band labels never claim single-floor resolution

## Completion Checklist
- [x] Code follows discovered patterns
- [x] Error handling matches codebase style
- [x] Logging follows codebase conventions (backend `extra={"event": ...}`)
- [x] Tests follow test patterns (co-located, literal fixtures, role/text queries)
- [x] No hardcoded values that belong in `config.py` or `DEFAULT_REQUEST`
- [x] `docs/neuroskin_software_prd.md` §5.2 updated — the facade journey description changes
- [x] No unnecessary scope additions
- [x] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `useSearchParams` breaks static generation of `/dashboard` | High | Medium | `<Suspense>` in task 3; assert route stays `○ (Static)` in build output |
| Lens gating unmounts `BuildingHeatmap`, destroying the WebGL context | Medium | High | Task 4 GOTCHA — stage sits outside every conditional; verified by the flicker check |
| Task 1 extraction silently changes a moved component | Medium | Medium | Copy bodies verbatim; 13 existing dashboard tests are the guard |
| Provenance strip paraphrases `data_notice` and weakens disclosure | Medium | High | Render verbatim; test asserts the exact string |
| Orthographic camera work balloons inside a 2073-line file | Medium | Medium | One prop, one branch; if it exceeds ~150 lines, stop and split the file first |
| Band-to-floor mapping read as per-floor truth | Medium | High | Labelling rule in tasks 7-8 + a test asserting the wording |
| `/health` probe blocks on a dead upstream | Low | High | Report cached in-process status; never call out synchronously |
| Someone adds a kWh figure to the manager view | Medium | High | Explicit NOT-Building entry + acceptance criterion |

## Notes

- `GuidedTour.tsx` (608 lines) and 63 lines of `.tour-*` CSS were deleted earlier in this session:
  zero imports anywhere, and 5 of its 17 `data-tour` targets no longer existed. The 34 `data-tour`
  attributes on live components were deliberately kept as anchors for this lens nav. Verified after
  deletion: 67/67 tests pass, `next build` clean, `globals.css` brace depth 0.
- PRD §3.3 says the live facility operator is "not yet served" and §4.3 lists operations features as
  non-goals. This plan deliberately adds a manager-shaped entry view, which makes the provenance strip
  **load-bearing rather than optional** — a manager-shaped UI over simulated occupancy reads as live
  telemetry unless the data's origin is on screen. §3.3 and §5.1 of the PRD need rewriting alongside
  this work.
- Backend already composes the exact disclosure sentence at `scenarios.py:172-199`, including
  "Open-Meteo data was requested but unavailable; the run fell back to a fully synthetic ... day."
  That sentence has never been visible to a user. Task 2 is the highest-value item in this plan.
- Companion plan: `.claude/PRPs/plans/langgraph-agentic-afc.plan.md`. The brains lens in task 5 is
  the read-only precursor to that plan's AFC loop view — build this one first.


## Implementation verification — 13 September 2026

Implemented all ten tasks. The floor list follows the actual payload: **four zones per wall per band, 16 around all four walls**, not 16 on one wall. The existing scene owns a second orthographic camera and a schematic band projection in `bandPlan.ts`, reusing wall colour samples; the core is hatched and explicitly unmodelled. The sky sampler stays mounted across navigation. Cached tier requests retain the weights used to produce their objective breakdowns.

Validation:

- Frontend: **79 tests pass**, including applied/fallback/synthetic provenance, zero objectives, cached applied weights, unknown/deep-linked lenses, in-flight tier navigation, band/glare details, unavailable feeds, and overhead geometry picking.
- Backend: **101 tests pass**, including unchanged legacy health keys, no outbound health calls, configuration disclosure, adapter observations and last-success preservation.
- `npm run lint`, `tsc --noEmit`, backend Ruff and `git diff --check`: clean. CSS integrity: `depth 0 min 0`.
- Production build: succeeds, `/dashboard` remains `○ (Static)` with no Suspense warning. Final verification used the existing `NEXT_DIST_DIR` option to avoid conflicting with the running preview; generated config changes were restored afterward.
- Playwright against the local app: all lenses, the same canvas and sky-video elements across navigation, 16 Band 2 zones, timeline-dependent objective values, completed tiers after switching mid-run, deep links and invalid values, and stacked rails at 1279px pass.
- Failure checks: aborted simulation requests reproduce an unavailable backend with ErrorState and no strip. A response produced by the real weather adapter with `urlopen` blocked displays the complete synthetic fallback notice and reason with the amber dot. No shared server was stopped for these checks.
- Screenshots and command logs are retained under `/private/tmp/neuroskin-lens-*`; the isolated production build is under `/private/tmp/neuroskin-dashboard-lens-production-build`.

No packages added. PRD §§3.3, 4.1, 5.1–5.2, 9, 11.2 and 14.1 now describe the implemented surfaces and their claim limits. Solar irradiation in the existing Daily sun view is displayed in MJ/m²; no facade cooling-energy or financial figures are introduced.


### Floor-view clarification — furnished cutaway

The user clarified the floor-plan intent with an architectural dollhouse reference. The floor view now renders a furnished office cutaway: low walls, rooms, desks, meeting tables, a pantry, lounge seating, plants and wood floors. It retains the existing scene and provides an angled orthographic camera with rotation/zoom plus a top-down option. The selected band's 16 facade zones appear on a single perimeter; interior geometry is illustrative and carries no invented room measurements. This replaces the original concentric ring/core-hatching presentation.

Verified the clarified cutaway with 79 frontend tests, lint/type checks, a static production build, and browser checks for both viewing angles, rotation/zoom, facade-band selection, and canvas persistence. Preview: `/private/tmp/neuroskin-cutaway.png`.


### Distinct workspaces and overhead HVAC

Each facade now has its own illustrative interior: north meeting suites, east café lounge, south open workstations and west focus rooms. Matching floor finishes, on-model labels and comparison cards identify the sides. Cards average only the selected band’s available facade zones; controlled and baseline values keep their existing meanings.

The floor view includes a toggleable overhead HVAC schematic with separate supply/return ducts, directional arrows, diffusers, return grilles and an air-handling unit above the core. The schematic does not imply measured airflow, room loads or HVAC energy.

Verified 79 frontend tests, TypeScript, lint and a static production build. Browser checks cover all four workspace cards, HVAC visibility, cutaway/top-down views, rotation/zoom, 16 facade zones and the same canvas after lens navigation. Screenshots/logs: `/private/tmp/neuroskin-workspaces-*`; isolated build: `/private/tmp/neuroskin-workspaces-hvac-production-build`.


### Layout correction — different geometry in every band

The interior no longer repeats when switching facade bands. Four furnished groups represent Team office, Learning floor, Collaboration floor and Studio floor; only the selected band is visible. Each side varies its partitions and furniture, including a wide boardroom, training platform, paired round-table huddle rooms, a horseshoe seminar table, angled desk islands, parallel rows, round hubs, staggered studio desks, acoustic pods, a library bench and a curved cafe booth. Cards describe the selected layout and band changes refresh shadows in the same scene.

Validation: all 79 frontend tests, TypeScript, lint and static production build pass. The geometry check rejects identical layouts with different labels and verifies visibility changes. Browser checks cover all four bands and updated descriptions, HVAC visibility, cutaway/top-down, orbit/zoom and persistent canvas. Four top-down comparison screenshots are `/private/tmp/neuroskin-distinct-layouts-band-1.png` through `band-4.png`; build/logs use the `neuroskin-distinct-layouts-` prefix.


### Corrected scope — one complete floor plan per facade side

The user's final clarification supersedes the shared four-sided layout and the band-driven layout variations above. North, East, South and West now open separate, complete floor plans: Team office, Learning centre, Collaboration hub and Studio office. Each has meeting/training rooms, quiet rooms, a cafe/lounge, workstations and its own HVAC distribution. Only the selected plan and its HVAC are visible. The selected side's four facade cells are the only coloured/pickable cells and the only zones in the floor list. Bands choose readings within the selected side without changing its interior. The selector remains usable when readings are unavailable.

Verified all 79 frontend tests, TypeScript, lint and a static production build. Geometry checks prove four distinct full-footprint interiors, one visible plan/HVAC, correct side+band zone IDs, no room telemetry, band persistence and missing-data behaviour. Browser checks exercise all four side plans, their four zones, band changes, HVAC toggles, cutaway/top-down, rotation/zoom and canvas persistence. Existing roof inspection remains available. Screenshots: `/private/tmp/neuroskin-separate-{north,east,south,west}-plan.png` and `/private/tmp/neuroskin-separate-floor-plans.png`. Build/logs: `/private/tmp/neuroskin-separate-plans-*`.


### Confirmed floor groups — selectable vertical stacks

The user confirmed four groups: Floors 1–2, Floors 3–4, Floors 5–6 and Floor 7. Each facade side now has its own vertical stack of four complete furnished floor plans with overhead HVAC. Selecting a level keeps it in colour, greys out the other three and shows its four actual facade zones. Show all levels restores the full stack and all 16 zones for that side. Top down opens the selected level for detail. Interiors, HVAC and vertical spacing remain illustrative.

Verified all 79 frontend tests, TypeScript, lint and a static production build. Geometry checks cover distinct layouts, stack positions, selection materials, grey-level picking, reset and missing readings. Browser checks click all four levels directly on the 3D model and verify their zone details, reset, top-down detail, all four side stacks, HVAC visibility and shared canvas persistence. Screenshots: `/private/tmp/neuroskin-stack-overview.png`, `/private/tmp/neuroskin-stack-selected.png` and `/private/tmp/neuroskin-stack-top-detail.png`. Build/logs: `/private/tmp/neuroskin-stack-*`. Generated build configuration changes were restored.
