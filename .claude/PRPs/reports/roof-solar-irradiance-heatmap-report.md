# Implementation Report: Shadow-aware roof solar irradiance heatmap

## Summary
The four roof quadrants can now be coloured by cumulative daily solar exposure
(kWh/m²·day) instead of a single flat per-quadrant sol-air temperature. Each
quadrant is drawn as a 33 × 33 vertex grid; a CPU raycast bake decides, per
vertex and per daylight tick of the run, whether the beam component reaches it,
weighting hits by that tick's real plane-of-array irradiance from the backend.
Results are written to a vertex-colour attribute through a purple → orange ramp.
A legend toggle switches between "Surface temp" (unchanged default) and
"Daily sun".

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Confidence | 8/10 | Held — one design deviation, no rework |
| Files Changed | 4 (2 new, 2 updated) | 4 (2 new, 2 updated) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Exposure ramp + constants | Complete | `EXPOSURE_RAMP`, `exposureColor` |
| 2 | Subdivided roof geometry | Complete | `roofGrid`, seeds its own `color` attribute |
| 3 | The bake | Complete | `bakeExposure` |
| 4 | Run → sun samples | Complete | `sunSamples`, median tick spacing |
| 5 | Wire roof meshes into scene | Complete | Deviated — see below |
| 6 | Bake effect + mode toggle | Complete | |
| 7 | Tests | Complete | 11 tests |
| 8 | Dashboard passes ticks | Complete | |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `npx tsc --noEmit` clean; `npm run lint` clean; prettier applied |
| Unit Tests | Pass | 33/33 across 6 files, 11 of them new |
| Build | Pass | `npm run build` — `/dashboard` 164 kB, 381 kB first load |
| Integration | Partial | `make dev` restarted; `/dashboard` 200, backend `/docs` 200. The visual check (shadow actually visible) needs a human at the browser |
| Edge Cases | Pass | Empty samples, night-only run, missing quadrant, zero peak, no-`ticks` prop all covered by tests or by explicit guards |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `frontend/src/components/neuroskin/solarExposure.ts` | CREATED | +215 |
| `frontend/src/components/neuroskin/solarExposure.test.ts` | CREATED | +175 |
| `frontend/src/components/neuroskin/BuildingHeatmap.tsx` | UPDATED | +165 / −14 |
| `frontend/src/components/neuroskin/NeuroSkinDashboard.tsx` | UPDATED | +1 |

## Deviations from Plan

**Occluders are low-poly proxies, not the drawn meshes.**
*What:* the plan's occluder list was "core, podium, deck, crown, facade panels",
and implied the roof quadrants could shade one another using their drawn meshes.
Instead the bake casts rays at four flat two-triangle stand-ins of the quadrants
(built from the `slopedPanel` geometry the outline already needs), plus core,
podium, deck and crown. The proxies never join the scene graph.
*Why:* a quadrant's drawn mesh is 2,048 triangles. Using three of them as
occluders would have meant roughly 350 M triangle tests per bake — seconds, not
milliseconds. The flat proxy is geometrically the same surface at the resolution
a shadow edge needs. Total occluder budget is now about 30 triangles.

**Facade panels dropped as occluders.**
*What:* the plan listed them; they are not in the list.
*Why:* the roof slab oversails the walls and the walls lean outward beneath it,
so a facade panel can never shade the roof. 128 triangles of raycast for a
shadow that cannot exist.

## Issues Encountered

- Started on `main` with a dirty tree (an unrelated `docs/neuroskin_software_prd.md`
  edit and an untracked `.claude/`). Rather than stash or commit someone else's
  work, the branch was created with those changes carried across untouched. They
  are still uncommitted and still unrelated.
- `npm run build` and `next dev` contend for `.next`, so the frontend dev server
  was stopped for the build and `make dev` restarted afterwards. Both ports are
  back up.
- The existing `NeuroSkinDashboard.test.tsx` prints a jsdom
  `HTMLCanvasElement.prototype.getContext` error. Pre-existing — the component
  catches it and falls back to the readings table. Not introduced here.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `frontend/src/components/neuroskin/solarExposure.test.ts` | 11 | Grid parity with `slopedPanel`, colour attribute presence, shadow vs lit vertex, empty-sample run, ramp clamping, zero-peak divide guard, daylight filtering, lossless beam/diffuse split, missing quadrant |

## Known Simplifications

- Diffuse irradiance is added unshaded (no sky-view factor). Marked with a
  `ponytail:` comment in `solarExposure.ts` naming the upgrade path.
- The exposure domain is per-run, normalised to the run's own peak, so two runs
  are not directly comparable by colour. The legend prints the ceiling.
- No LUT texture, no shader, no UV unwrap, no worker, no new dependency, no
  backend change.

## Next Steps
- [ ] Human visual check: run a simulation, toggle "Daily sun", confirm the
      crown and deck throw a readable shadow across the quadrant away from the sun
- [ ] Measure the bake in devtools; if it exceeds ~150 ms, drop `ROOF_DIVISIONS`
      to 24 or chunk it
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
