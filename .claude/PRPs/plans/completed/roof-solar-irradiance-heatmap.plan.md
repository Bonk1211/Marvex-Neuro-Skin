# Plan: Shadow-aware roof solar irradiance heatmap

## Summary
Colour the four roof quadrants of the Diamond model by **cumulative daily solar
exposure (Wh/m²)** instead of a single flat per-quadrant sol-air temperature.
Exposure is baked once per run by sampling a dense grid over each roof face and
raycasting toward the sun at every daylight tick of the run, weighting each hit
by that tick's real plane-of-array direct component. Result is written to a
vertex-colour attribute on a subdivided roof mesh and shown through a
purple → orange ramp, which reproduces the look of the reference solar editors
(hot = high irradiance, cold/purple = shaded).

## User Story
As an engineer inspecting the building, I want to see where on the roof the sun
actually lands over a whole day — including the shadow the crown and skylight
throw — so that I can judge PV placement and roof heat load without reading four
averaged numbers.

## Problem → Solution
Today each roof quadrant is one flat colour from `RoofSegment.sol_air_temp`
(`BuildingHeatmap.tsx:912-919`), so the crown, the deck step and the building's
own mass cast no visible shadow and the roof reads as uniform.
→ A per-vertex daily-exposure bake gives a continuous, shadow-aware gradient
across each quadrant, using data the backend already returns.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A (free-form request)
- **PRD Phase**: N/A
- **Estimated Files**: 4 (2 created, 2 updated)

---

## UX Design

### Before
```
┌────────────────────────────────────────┐
│  Roof: 4 flat trapezoids, one colour   │
│  each, from RoofSegment.sol_air_temp   │
│  Crown + deck cast no shadow           │
│  Legend: "Sol-air surface temperature" │
└────────────────────────────────────────┘
```

### After
```
┌────────────────────────────────────────┐
│  Roof: smooth gradient per quadrant    │
│   ▓▓▓▓ orange = full day of sun        │
│   ▒▒░░ purple = crown / deck shadow    │
│  Toggle in legend:                     │
│   [ Surface temp ] [ Daily sun ]       │
│  Legend swaps ramp + units (kWh/m²·d)  │
│  Facade zones unchanged in both modes  │
└────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Roof colour | Flat, per-tick sol-air temp | Gradient, whole-day exposure (in "Daily sun" mode) | Temp mode stays the default so nothing regresses |
| Legend panel | One ramp, `24°…70°C+` | Two-button toggle; ramp + units follow the mode | Same `stage-panel` markup |
| Scrubbing the timeline | Roof recolours each tick | Roof is static in "Daily sun" mode (it is a daily total) | Legend caption says so, otherwise it reads as a bug |
| Clicking a roof face | Selects `roof:<orientation>` | Unchanged | Picking still uses the quadrant meshes |
| No WebGL | Falls back to `FacadeReadout` table | Unchanged | Bake never runs |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `frontend/src/components/neuroskin/BuildingHeatmap.tsx` | 1-165 | Constants, `slopedPanel`, `sunAt`, ramp conventions — the file being changed |
| P0 | `frontend/src/components/neuroskin/BuildingHeatmap.tsx` | 520-536 | Roof face construction (`roofHalf`, `deckHalf`, `roofFaceGeometry`) |
| P0 | `frontend/src/components/neuroskin/BuildingHeatmap.tsx` | 862-925 | Per-tick repaint effect — where roof colouring happens today |
| P1 | `frontend/src/lib/types.ts` | 40-49, 84-116 | `RoofSegment` and `TickPayload` field names used by the bake |
| P1 | `frontend/src/components/neuroskin/NeuroSkinDashboard.tsx` | 320-330, 544-557 | `sunTrack` memo + the `<BuildingHeatmap>` call site to extend |
| P2 | `frontend/src/components/neuroskin/BuildingHeatmap.zones.test.ts` | all | Exact test style for geometry helpers in this component |
| P2 | `backend/app/domain/facade.py` | 99-131 | Confirms `incident = poa_global`, and that `sky_diffuse`/`ground_diffuse` are components of it |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| `THREE.Raycaster` | three.js docs, r185 | Pure CPU/JS — works in jsdom with no WebGL context, so the bake is unit-testable |
| `BufferGeometry` vertex colours | three.js docs, r185 | Needs a `color` attribute (itemSize 3) **and** `vertexColors: true` on the material; colours are interpolated across the triangle, which is the free smoothing |
| `THREE.PlaneGeometry` segments | three.js docs, r185 | Not used — the roof is a trapezoid, so the grid is built by hand, mirroring `slopedPanel` |
| Colour management | three.js r152+ | `THREE.Color.setRGB`/`copy` values written into a colour attribute are treated as linear-sRGB; use `color.convertSRGBToLinear()` before writing so the baked ramp matches the CSS legend swatch |

```
KEY_INSIGHT: Stacked DirectionalLights do NOT accumulate into correct irradiance.
APPLIES_TO: Why the plan bakes instead of adding N lights.
GOTCHA: each light's shadow map is an independent binary occlusion test applied to
that light's own diffuse term; three.js caps shadow-casting lights by uniform
budget, the sum is a lighting result (already tone-mapped and ambient-washed),
not W/m², and the facade panels deliberately use MeshBasicMaterial so their colour
stays data rather than shading. Bake the number, then map it to colour.
```

```
KEY_INSIGHT: No backend change is needed.
APPLIES_TO: Every task.
GOTCHA: the run already returns, per tick and per quadrant, `incident`,
`sky_diffuse`, `ground_diffuse` (W/m² on the pitched plane) plus
`solar_azimuth`/`solar_elevation`. Direct beam on that plane is
`incident - sky_diffuse - ground_diffuse`, which is exactly the part a shadow
removes. Diffuse stays regardless of the shadow test.
```

---

## Patterns to Mirror

### NAMING_CONVENTION
```ts
// SOURCE: frontend/src/components/neuroskin/BuildingHeatmap.tsx:36-60
// SCREAMING_SNAKE module constants with a comment saying where the number came
// from; camelCase helpers; exported helpers are plain functions, not defaults.
const TEMP_MIN = 24
const TEMP_MAX = 70
const PANEL_ROWS = 4
const halfWidthAt = (y: number, tiltFromVertical: number) =>
  BASE_HALF_WIDTH + y * Math.tan(THREE.MathUtils.degToRad(tiltFromVertical))
```

### GEOMETRY_BUILDER
```ts
// SOURCE: frontend/src/components/neuroskin/BuildingHeatmap.tsx:85-118
export function slopedPanel(
  halfBottom: number, halfTop: number, bottomY: number, topY: number,
  column = 0, columns = 1
) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...]), 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  return geometry
}
```

### COLOUR_RAMP
```ts
// SOURCE: frontend/src/components/neuroskin/BuildingHeatmap.tsx:166-180
const rampColor = (() => {
  const stops = HEAT_RAMP.map((hex) => new THREE.Color(hex))
  const scratch = new THREE.Color()
  return (temperature: number) => {
    const t = THREE.MathUtils.clamp((temperature - TEMP_MIN) / (TEMP_MAX - TEMP_MIN), 0, 1)
    const position = t * (stops.length - 1)
    const low = Math.floor(position)
    const high = Math.min(stops.length - 1, low + 1)
    return scratch.copy(stops[low]).lerp(stops[high], position - low)
  }
})()
```

### SUN_VECTOR
```ts
// SOURCE: frontend/src/components/neuroskin/BuildingHeatmap.tsx:150-164
const SUN_RADIUS = 11
function sunAt(azimuth: number, elevation: number) {
  const a = THREE.MathUtils.degToRad(azimuth)
  const e = THREE.MathUtils.degToRad(elevation)
  return new THREE.Vector3(
    SUN_RADIUS * Math.cos(e) * Math.sin(a),
    SUN_RADIUS * Math.sin(e),
    -SUN_RADIUS * Math.cos(e) * Math.cos(a)
  )
}
```

### PICKING_METADATA
```ts
// SOURCE: frontend/src/components/neuroskin/BuildingHeatmap.tsx:530-535
face.rotation.y = WALLS[orientation]
face.userData.surface = `roof:${orientation}` satisfies SurfaceId
scene.add(face)
roofFaces.set(orientation, face)
```

### DISPOSE_ON_TEARDOWN
```ts
// SOURCE: frontend/src/components/neuroskin/BuildingHeatmap.tsx:808-826
// Geometries that never enter the scene graph are collected in an array and
// disposed by hand; everything in the scene is disposed by scene.traverse.
frames.forEach((geometry) => geometry.dispose())
scene.traverse((object) => { object.geometry?.dispose?.(); /* materials too */ })
```

### TEST_STRUCTURE
```ts
// SOURCE: frontend/src/components/neuroskin/BuildingHeatmap.zones.test.ts:1-27
import { describe, expect, it } from 'vitest'
import { slopedPanel } from './BuildingHeatmap'

describe('facade zones', () => {
  it('tiles the wall across four columns, left to right, without overlap', () => {
    const edges = [0, 1, 2, 3].map((column) => bottomEdge(column, 4))
    expect(edges[0][0]).toBeCloseTo(-2, 1)
  })
})
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `frontend/src/components/neuroskin/solarExposure.ts` | CREATE | Pure bake: grid geometry, raycast accumulation, exposure ramp. No React, no WebGL, so it is testable |
| `frontend/src/components/neuroskin/solarExposure.test.ts` | CREATE | Vitest cover for the bake — a box occluder must produce a shadow |
| `frontend/src/components/neuroskin/BuildingHeatmap.tsx` | UPDATE | Subdivided roof geometry + vertex colours, bake effect, legend toggle |
| `frontend/src/components/neuroskin/NeuroSkinDashboard.tsx` | UPDATE | Pass the run's whole tick series to the heatmap |

## NOT Building

- No lightmap UV unwrap, no render-to-texture bake, no custom `ShaderMaterial`.
  Vertex colours on a subdivided mesh interpolate for free.
- No new npm dependency (`three@0.185` and `@types/three` are already installed).
- No backend endpoint, schema or `pvlib` change.
- No Web Worker / OffscreenCanvas. The bake is ~60k raycasts and runs once per
  run; if it ever measures over 150 ms, chunk it then.
- No exposure gradient on the **facade** zones. The facade already carries
  per-zone louvre-aware readings from the backend; overwriting them with a bake
  would be a downgrade.
- No imported neighbouring-building geometry. Occluders are the meshes already in
  the scene (crown, deck, core, podium, walls).
- No per-tick animated shadow on the roof. Daily total only.

---

## Step-by-Step Tasks

### Task 1: Exposure ramp + module constants
- **ACTION**: Create `frontend/src/components/neuroskin/solarExposure.ts`.
- **IMPLEMENT**:
  ```ts
  import * as THREE from 'three'

  // Purple to orange, dark to bright: the ramp the solar editors use. Purple
  // means "this texel spent the day in shadow", orange "full sun". Single
  // sweep through hue and lightness together, so it still reads as a magnitude
  // in greyscale.
  export const EXPOSURE_RAMP = [
    '#2a0b45', '#5b1a6e', '#8d2a72', '#bf3f61',
    '#e35c3f', '#f5842a', '#fbb03b', '#fee08b',
  ]
  ```
  Then `exposureColor(kwh, max)` built exactly like `rampColor`
  (IIFE closing over parsed stops + one scratch `THREE.Color`), normalising
  `t = clamp(kwh / max, 0, 1)` — the domain is per-run, because a January run and
  a June run have different ceilings and a fixed domain would flatten one of them.
- **MIRROR**: `COLOUR_RAMP`, `NAMING_CONVENTION`.
- **IMPORTS**: `import * as THREE from 'three'`.
- **GOTCHA**: return the shared scratch colour (do not allocate per call) — this
  is called once per vertex, ~4k times per bake.
- **VALIDATE**: `exposureColor(0, 5)` is near-black-purple, `exposureColor(5, 5)`
  is the last stop, `exposureColor(9, 5)` clamps to the last stop.

### Task 2: Subdivided roof quadrant geometry
- **ACTION**: In `solarExposure.ts`, export `roofGrid(halfBottom, halfTop, bottomY, topY, divisions)`.
- **IMPLEMENT**: Build a `(divisions+1)²` vertex grid over the same trapezoid
  `slopedPanel` produces, in the same local frame (x along the wall, y up,
  z outward, half-width lerping from `halfBottom` at `bottomY` to `halfTop` at
  `topY`):
  ```ts
  for (let row = 0; row <= divisions; row += 1) {
    const v = row / divisions
    const half = THREE.MathUtils.lerp(halfBottom, halfTop, v)
    const y = THREE.MathUtils.lerp(bottomY, topY, v)
    for (let column = 0; column <= divisions; column += 1) {
      const u = column / divisions
      positions.push(-half + u * 2 * half, y, half)
    }
  }
  ```
  Two triangles per cell into `setIndex`, then `computeVertexNormals()`, then
  seed a `color` attribute of the right length (`new THREE.BufferAttribute(new Float32Array(count * 3), 3)`).
- **MIRROR**: `GEOMETRY_BUILDER`.
- **IMPORTS**: same file's `THREE`.
- **GOTCHA**: the existing flat face uses `side: THREE.DoubleSide`; keep that on
  the new material or the quadrant facing away disappears. Winding must match
  `slopedPanel`'s `[0,1,2, 0,2,3]` (counter-clockwise seen from +z) so the normal
  points outward and picking still hits.
- **VALIDATE**: `roofGrid(2, 1, 0, 1, 1)` has 4 vertices, 6 indices, and the same
  corner positions as `slopedPanel(2, 1, 0, 1)`.

### Task 3: The bake
- **ACTION**: In `solarExposure.ts`, export `bakeExposure(options)`.
- **IMPLEMENT**:
  ```ts
  export interface SunSample {
    /** Scene-space direction from the surface toward the sun, normalised. */
    direction: THREE.Vector3
    /** Beam irradiance on this quadrant's plane, W/m². */
    direct: number
    /** Sky + ground diffuse on this quadrant's plane, W/m². */
    diffuse: number
    /** Hours this sample stands for. */
    hours: number
  }

  export function bakeExposure(
    mesh: THREE.Mesh,
    occluders: THREE.Object3D[],
    samples: SunSample[]
  ): { exposure: Float32Array; max: number }
  ```
  For each vertex: take the local position, `mesh.localToWorld` it, push it
  `0.002` along the vertex normal (world space) to escape self-hits, then for
  each sample fire `raycaster.set(origin, sample.direction)` and test
  `raycaster.intersectObjects(occluders, true).length === 0`. Accumulate
  `(lit ? direct : 0) + diffuse` times `hours`, divide by 1000 for kWh/m².
  Return the array and its max.
- **MIRROR**: `SUN_VECTOR` for how the caller builds `direction`.
- **IMPORTS**: `THREE` only.
- **GOTCHA (four of them)**:
  1. `mesh.updateMatrixWorld(true)` before `localToWorld`, and call
     `updateMatrixWorld` on the occluders too — the roof quadrants are rotated by
     `rotation.y`, and a stale matrix bakes the shadow onto the wrong quadrant.
  2. Set `raycaster.far` to a little over `SUN_RADIUS` (say 40) so rays do not
     scan the whole scene, and leave `firstHitOnly` alone — any hit is enough.
  3. The mesh being baked must **not** be in `occluders`, or the epsilon offset
     becomes the only thing preventing a total black-out.
  4. Diffuse is added unshaded on purpose. A proper sky-view factor would need a
     hemisphere of extra rays for a second-order effect; note the simplification
     in a `ponytail:` comment naming that as the upgrade path.
- **VALIDATE**: covered by Task 7.

### Task 4: Turn a run into sun samples
- **ACTION**: In `solarExposure.ts`, export
  `sunSamples(ticks, quadrant, sunAt)`.
- **IMPLEMENT**: Filter to `tick.solar_elevation > 0`; for each, find
  `tick.roof.find((segment) => segment.quadrant === quadrant)`; compute
  `direct = Math.max(0, segment.incident - segment.sky_diffuse - segment.ground_diffuse)`,
  `diffuse = segment.sky_diffuse + segment.ground_diffuse`,
  `direction = sunAt(tick.solar_azimuth, tick.solar_elevation).normalize()`, and
  `hours` = the median gap between consecutive tick timestamps in hours
  (do **not** hardcode 1.0 — the run's step is not guaranteed hourly).
- **MIRROR**: the `Map`-by-orientation pattern at `BuildingHeatmap.tsx:355-361`.
- **IMPORTS**: `import type { FacadeOrientation, TickPayload } from '@/lib/types'`.
- **GOTCHA**: `sunAt` is passed in rather than imported, to keep this module free
  of a circular import back into `BuildingHeatmap.tsx`. Type it as
  `(azimuth: number, elevation: number) => THREE.Vector3`.
- **VALIDATE**: a two-tick fixture yields one sample when only one tick is above
  the horizon, and `direct + diffuse === incident` for that sample.

### Task 5: Wire the roof meshes into the scene
- **ACTION**: In `BuildingHeatmap.tsx`, replace the flat roof faces
  (lines 520-536) with subdivided ones.
- **IMPLEMENT**:
  ```ts
  const ROOF_DIVISIONS = 32 // 33x33 vertices per quadrant; ~4.4k rays per sun step
  // ...
  const face = new THREE.Mesh(
    roofGrid(roofHalf, deckHalf, height, deckHeight, ROOF_DIVISIONS),
    new THREE.MeshBasicMaterial({ color: 0xfde3d5, side: THREE.DoubleSide })
  )
  ```
  Each quadrant now needs **its own** geometry instance (the four cannot share
  one, because each bakes different colours). Keep
  `face.rotation.y = WALLS[orientation]` and `face.userData.surface`. Add the
  four faces to `roofFaces` as before, and keep a `roofOccluders` array on the
  scene ref holding `[core, podium, deck, crown, ...facade panels]`.
- **MIRROR**: `PICKING_METADATA`, `GEOMETRY_BUILDER`.
- **IMPORTS**: `import { bakeExposure, exposureColor, roofGrid, sunSamples } from './solarExposure'`.
- **GOTCHA**: `roofOutline` currently borrows `roofFaceGeometry`
  (`BuildingHeatmap.tsx:614-620`). Keep building that flat quad separately for
  the outline — a `LineLoop` over the grid geometry would draw a zigzag through
  every interior vertex. Push it onto the `frames` array so it is still disposed.
- **VALIDATE**: `npm run dev`, orbit the model — the roof looks unchanged and
  clicking a quadrant still selects `roof:<orientation>`.

### Task 6: Bake effect + mode toggle
- **ACTION**: Add a `roofMode` state and a bake effect to `BuildingHeatmap.tsx`;
  add a `ticks?: TickPayload[]` prop.
- **IMPLEMENT**:
  - `const [roofMode, setRoofMode] = useState<'temp' | 'exposure'>('temp')`.
  - New `useEffect` keyed on `[ticks, roofMode, floors, overhang, roofPitch]`:
    when `roofMode === 'exposure'` and `ticks?.length`, for each quadrant call
    `sunSamples` → `bakeExposure`, keep the four results, take the max across all
    four (one shared domain, or the quadrants are not comparable), write
    `exposureColor(value, max).convertSRGBToLinear()` into each geometry's
    `color` attribute, set `attribute.needsUpdate = true` and flip the material to
    `vertexColors: true`. Store `max` in state for the legend.
  - When `roofMode === 'temp'`, set `vertexColors = false`,
    `material.needsUpdate = true`, and let the existing per-tick effect
    (lines 912-919) keep painting `material.color`. Guard that block with
    `if (roofMode === 'temp')` so it does not fight the bake.
  - Legend: inside the existing `stage-panel`, two `<button type='button'>` with
    `aria-pressed`, swapping the gradient swatch between `HEAT_RAMP` and
    `EXPOSURE_RAMP` and the end labels between `24°/70°C+` and
    `0 / {max.toFixed(1)} kWh/m²·day`. Caption in exposure mode: "Daily solar
    exposure on the roof — a whole-day total, so it does not change as you scrub."
- **MIRROR**: the legend markup at `BuildingHeatmap.tsx:975-996`; the
  ref-held-scene / effect-repaint split used throughout the file.
- **IMPORTS**: as Task 5, plus `EXPOSURE_RAMP`.
- **GOTCHA**: the bake must run **after** the scene-building effect has populated
  `sceneRef.current`; return early if it is null, and list every scene-rebuild
  dependency (`floors`, `overhang`, `roofPitch`) so a geometry rebuild re-bakes.
  Also update the `aria-label` on the mount div for exposure mode — the current
  one only describes surface temperature.
- **VALIDATE**: toggle to "Daily sun" — the crown and deck throw a visible purple
  wedge across the quadrant opposite the afternoon sun; toggle back and the
  per-tick temperature colouring returns.

### Task 7: Tests
- **ACTION**: Create `frontend/src/components/neuroskin/solarExposure.test.ts`.
- **IMPLEMENT**: three `it` blocks —
  1. *shadow*: a `roofGrid` plane at y=0 with one small `BoxGeometry` mesh
     hovering above its centre, one sun sample straight overhead
     (`direction = (0, 1, 0)`, `direct: 800`, `diffuse: 100`, `hours: 1`).
     Expect the centre vertex's exposure ≈ `0.1` kWh and a corner vertex ≈ `0.9`.
  2. *ramp*: `exposureColor(0, 5)` differs from `exposureColor(5, 5)`, and
     `exposureColor(50, 5)` equals `exposureColor(5, 5)` (clamps).
  3. *samples*: `sunSamples` drops below-horizon ticks and splits
     `incident` into `direct + diffuse` losslessly.
- **MIRROR**: `TEST_STRUCTURE`.
- **IMPORTS**: `import { describe, expect, it } from 'vitest'`, `* as THREE from 'three'`,
  and the module under test.
- **GOTCHA**: no `render()` and no WebGL here — `Raycaster`, `BufferGeometry` and
  `Color` are pure JS and run fine under jsdom. Call `mesh.updateMatrixWorld(true)`
  in the fixture, exactly as the production path does.
- **VALIDATE**: `cd frontend && npx vitest run src/components/neuroskin/solarExposure.test.ts`.

### Task 8: Pass the run's ticks from the dashboard
- **ACTION**: Update `NeuroSkinDashboard.tsx:546-556`.
- **IMPLEMENT**: add `ticks={data.ticks}` to the `<BuildingHeatmap>` call.
- **MIRROR**: the adjacent `sunTrack={sunTrack}` prop.
- **IMPORTS**: none.
- **GOTCHA**: `data.ticks` is already a stable reference per run, so no `useMemo`
  is needed — but the bake effect keys on it, so do not wrap it in an inline
  `.map()` at the call site or it re-bakes every render.
- **VALIDATE**: `cd frontend && npx tsc --noEmit`.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Occluded vertex | Box above grid centre, sun overhead, direct 800 / diffuse 100 / 1 h | Centre ≈ 0.1 kWh/m² | No |
| Lit vertex | Same bake, corner vertex | ≈ 0.9 kWh/m² | No |
| No samples | `samples: []` | All zero, `max` 0 | Yes |
| Night-only run | Every tick `solar_elevation <= 0` | `sunSamples` returns `[]` | Yes |
| Missing quadrant | `tick.roof` empty | `sunSamples` skips the tick, no throw | Yes |
| Ramp clamp | `exposureColor(50, 5)` | Equals top stop | Yes |
| Grid parity | `roofGrid(2, 1, 0, 1, 1)` vs `slopedPanel(2, 1, 0, 1)` | Same 4 corner positions | No |
| Zero max | `exposureColor(0, 0)` | No `NaN` — guard the divide | Yes |

### Edge Cases Checklist
- [ ] `ticks` prop absent (component used without a run) — bake skipped, temp mode only
- [ ] All-night run — `max` is 0, legend shows `0 kWh`, roof all-purple, no `NaN`
- [ ] `roofPitch === 0` — quadrants are coplanar; the bake still runs, shadows still land
- [ ] No WebGL — scene ref is null, bake effect returns early, table fallback shows
- [ ] Rapid run changes — a new `ticks` array re-bakes; verify no stale colours
- [ ] Geometry rebuild (`floors` / `facadeTilt` / `roofPitch` change) re-bakes
- [ ] Component unmount mid-bake — the bake is synchronous, so nothing to cancel; just confirm the new geometries are disposed by the existing `scene.traverse` teardown

---

## Validation Commands

### Static Analysis
```bash
cd frontend && npx tsc --noEmit
```
EXPECT: Zero type errors

### Lint / Format
```bash
cd frontend && npm run lint && npx prettier --check "src/components/neuroskin/*.{ts,tsx}"
```
EXPECT: Clean

### Unit Tests
```bash
cd frontend && npx vitest run src/components/neuroskin/
```
EXPECT: All pass, including the existing `BuildingHeatmap.zones.test.ts`

### Full Test Suite
```bash
make test
```
EXPECT: No regressions (frontend vitest + backend pytest)

### Browser Validation
```bash
make dev   # backend :8000, frontend :3000
```
EXPECT: `http://localhost:3000/dashboard` — run a simulation, toggle "Daily sun",
see a shadow-shaped purple region on the roof

### Manual Validation
- [ ] Toggle "Daily sun": roof gradient appears, facade zones unchanged
- [ ] Crown and deck cast a visible purple shadow on at least one quadrant
- [ ] Scrub the timeline in exposure mode: roof stays put, facade still animates
- [ ] Toggle back to "Surface temp": per-tick roof colouring returns exactly as before
- [ ] Click a roof quadrant in both modes: still selects `roof:<orientation>`
- [ ] Change roof pitch, rerun: the bake re-runs and the pattern changes
- [ ] Legend swatch matches the colours on the mesh (sRGB conversion is right)
- [ ] Devtools Performance: bake under ~150 ms

---

## Acceptance Criteria
- [ ] Roof quadrants show a continuous, shadow-aware exposure gradient in "Daily sun" mode
- [ ] Shadows come from real scene occluders (crown, deck, core, podium, facade), not from a fake mask
- [ ] Exposure is weighted by the run's own per-tick plane-of-array irradiance, in kWh/m²·day
- [ ] "Surface temp" mode is byte-for-byte the old behaviour and remains the default
- [ ] Legend states the mode, the ramp and the units
- [ ] No new dependency, no backend change
- [ ] All validation commands pass

## Completion Checklist
- [ ] Code follows discovered patterns (ramp IIFE, geometry builder, dispose-on-teardown)
- [ ] `ponytail:` comment on the unshaded-diffuse simplification, naming sky-view factor as the upgrade
- [ ] Comments explain *why* (the file's house style), not *what*
- [ ] Tests follow `BuildingHeatmap.zones.test.ts` style
- [ ] No hardcoded tick interval, no hardcoded exposure ceiling
- [ ] New geometries and materials disposed on unmount
- [ ] No scope additions beyond the roof

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bake blocks the main thread | Medium | Medium | 32 divisions ≈ 4.4k rays/sun-step; measure, and drop to 24 or chunk with `requestIdleCallback` only if it exceeds 150 ms |
| Self-intersection blackens the roof | Medium | High | Offset origins along the vertex normal; keep the baked mesh out of `occluders`; the shadow unit test catches a regression |
| Colour space mismatch (legend vs mesh) | Medium | Low | `convertSRGBToLinear()` on colours written to the attribute; visual check against the CSS swatch |
| Rotated quadrants bake the wrong shadow | Medium | High | `updateMatrixWorld(true)` before `localToWorld`; manual check that the shadow follows the sun's side |
| Users read the static roof as a frozen render | Medium | Low | Legend caption says it is a whole-day total |
| `roofOutline` zigzags over grid vertices | Low | Low | Keep the flat quad geometry purely for the outline |

## Notes

**Answering the original design questions.**

*"Multiple directional lights, one per hour — would they add up correctly?"* No.
Each `DirectionalLight` shadow map is a binary occlusion test applied to that
light's diffuse term; the sum is a shaded render, not irradiance, and three.js
runs out of shadow-map uniforms well before a full day of sun steps. It also
fights the deliberate choice in this file to draw heat surfaces with
`MeshBasicMaterial` so colour means data, not lighting.

*"Compute solar exposure per vertex and display it like that example"* — that is
what this plan does, and it is the cheapest thing that works: `THREE.Raycaster`
is already in the bundle, vertex colours interpolate across triangles for free
(no smoothing pass, no blur), and the whole bake is a pure function, so it is
unit-testable without a WebGL context.

*"Orange-purple gradient as a filter over a white-black gradient"* — skipped. A
LUT texture plus a shader pass is a second mechanism for something a lookup in
`exposureColor` does in eight lines. Reach for the texture path only if you later
need a resolution the vertex grid cannot carry (fine shadows from small rooftop
units, say) — at that point bake into a UV-unwrapped `WebGLRenderTarget` and
sample the LUT in a `ShaderMaterial`, and everything in `solarExposure.ts` except
`roofGrid` still applies.

**Where the physics comes from.** `backend/app/domain/facade.py:99-131` runs
`poa_series` (Perez) per quadrant, so `incident`, `sky_diffuse` and
`ground_diffuse` on `RoofSegment` are already the plane-of-array numbers for the
actual roof pitch and azimuth. The bake only decides, per point, whether the beam
component reaches it. The angle-of-incidence weighting is therefore already baked
into `incident` by pvlib — do **not** apply a second `cos(AOI)` factor.
