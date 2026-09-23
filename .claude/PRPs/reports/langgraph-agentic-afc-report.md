# Implementation Report: Local Sensor Assurance and Verified Fault Recovery

Plan: [`plans/completed/langgraph-agentic-afc.plan.md`](../plans/completed/langgraph-agentic-afc.plan.md) (revision 2) · branch `feat/sensor-assurance-recovery` · uncommitted.

## Summary

Built Layer 1 (per-zone sensor assurance) and Layer 3 (deterministic, verified fault recovery) **in simulation**, with no new dependencies and no database. Phase C (rig assurance, persistent ledger, LLM diagnosis) was not started, as planned.

- **Fault injection:** `zone_perturbations` declares windows of `dead`, `stuck`, `drift`, `fouled` or a real `shadow` on any zone. Readings are perturbed after that zone's random draws, so unrelated zones stay byte-identical.
- **Detector:** `backend/app/domain/assurance.py` checks each zone three ways: its reading-to-model ratio against the median of its sunlit wall peers, its lux channel against its own pre-fault ratio, and its flatness against peer flicker. It accepts no fault label.
- **Recovery:** `backend/app/domain/recovery.py` holds pure episode transitions, and `run_scenario` owns in-run episodes. Authority modes are `monitor`, `review` (replayed `approved_episodes`) and `auto` (dead/stuck at score ≥ 0.8).
  - Each correction takes a snapshot, then isolates only the implicated channel using peer-scaled substitutes.
  - Each correction is verified against an uncorrected counterfactual, over informative ticks only.
  - Outcomes are retain, roll back, restore or escalate. Nothing starts or stops on a SAFE tick.
- **Off by default:** `fault_correction="off"` reproduces the legacy response bytes; the hash test is unedited.
- **Evidence:** `scripts/assurance_matrix.py` (`make assurance-matrix`) writes `docs/appendix/assurance-matrix-results.{json,md}` using calibration seeds 1–3 and evaluation seeds 7, 11 and 13.
- **UI:** Brains shows assurance evidence, episode stages at the selected tick, and "Approve and replay". Floor injects a 2 h fault window. The landing page's layer claims are corrected.
- **Docs:** README; software PRD §4.2, §4.3, new §6.8, §8.4 and §14.2; product PRD Layer 3 state; demo-review story, status matrix and gates.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | XL, phased | XL; Phases A and B done, C deferred |
| Confidence | 7/10 (A), 6/10 (B) | A needed one detector redefinition; B needed five design corrections found by exploratory runs |
| Files Changed | ~25 | 34: 25 updated, 7 created, plan archived, report added |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| A1 | Windowed zone perturbations | [done] Complete | |
| A2 | Thresholds + `ZoneAssessment` | [done] Complete | |
| A3 | Pure detector | [done] Complete | Deviated: stuck test redefined (see Deviations) |
| A4 | Observe-only wiring, payload, logging | [done] Complete | |
| A5 | Fault matrix + appendix + Makefile | [done] Complete | Deviated: smoke output goes to the temp dir, not the appendix |
| A6 | Gate A | [done] Evaluated | One criterion missed (drift delay); see Validation |
| B1 | Episode transitions | [done] Complete | Deviated: verdict rules revised (see Deviations) |
| B2 | Controller hook, cost function, in-run loop | [done] Complete | Deviated: channel-level substitute, glare-aware objective, informative ticks |
| B3 | Recovery quality in matrix | [done] Complete | Deviated: added a recovery-only 7 h window after the first full run |
| B4 | Brains / Floor UI | [done] Complete | Also corrected landing-page layer claims |
| B5 | Documentation | [done] Complete | |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | [done] Pass | `ruff check app tests scripts` clean; `tsc --noEmit` clean; `eslint .` clean |
| Unit Tests | [done] Pass | Backend **169** (baseline 123, +46); frontend **100** (baseline 95, +5 new, landing test updated) |
| Build | [done] Pass | `next build` succeeded |
| Integration | [done] Pass | Real uvicorn over HTTP: review → awaiting, approval replay → mitigate/verify, malformed episode id → 422, JSON log carries new counts |
| Browser | [done] Pass | Playwright (scratch install, cached Chromium) against `make`-equivalent dev servers: Floor inject `dead` W6 at 15:00 → Brains fault + awaiting approval → Approve and replay → retained at tick 99 (2.370 vs 6.030). No page errors |
| Determinism / bytes | [done] Pass | Legacy sha256 unchanged in off mode; identical replays with approvals; off/monitor equality after stripping evidence |
| Edge cases | [done] Pass | Invalid windows/kinds/ids/modes → 422; night/thin/dark peers → insufficient; SAFE ticks never transition; override applied after perturbation |

### Gate A (evaluation seeds 7, 11, 13; preregistered criteria)

| Criterion | Result | Met |
|---|---|---|
| Dead and stuck ≥ 95%, median delay ≤ 3 | 24/24, 2; 24/24, 3 | Yes |
| Drift/fouled ≥ 70%, median delay ≤ 6 | Fouled 24/24, 2. Drift 20/24 (83%) but median delay **15** | **No for drift delay**: the 0.5 ramp only exceeds the 35% threshold after 13 ticks; detection follows 2 ticks later. The criterion was mis-specified and was not retuned on evaluation data. |
| Clean false positives ≤ 0.1% | 0 of 18,764 assessed zone-ticks | Yes |
| Cluster shadow as fault ≤ 5% | 0 of 24 | Yes |

### Gate B (evaluation seeds)

| Criterion | Result | Met |
|---|---|---|
| False interventions ≤ 5% | 0 in every case and window | Yes |
| No mitigations on SAFE ticks | 0 | Yes |
| Rollback restores sensor trust next tick | No matrix case produced a rule-5 rollback; restoration after recovery is tested at scenario level, rollback only at unit level | Partial evidence |
| G2 with correction enabled | Identical approval replays; legacy hash unchanged | Yes |
| Independence of non-episode zones | Only the isolated zone differs from the off run | Yes |

Recovery outcomes (auto authority, 7 h window): dead 10/24 retained, 11 escalated, 3 unresolved; stuck 10/24 retained, 6 escalated, 8 unresolved (4 not auto-authorised). With every episode approved, fouled was mostly escalated as unverifiable (20/24), and drift stayed unresolved (15/15). Substitutes averaged 0.5 W/m² from declared truth, against 64–184 W/m² for the readings set aside. In 3 h windows nothing was retained: the fault ended first.

## Files Changed

| File | Action |
|---|---|
| `backend/app/domain/assurance.py` | CREATED (+191) |
| `backend/app/domain/recovery.py` | CREATED (+275) |
| `backend/scripts/assurance_matrix.py` | CREATED (+419) |
| `backend/tests/test_assurance.py` | CREATED (+118) |
| `backend/tests/test_recovery.py` | CREATED (+234) |
| `docs/appendix/assurance-matrix-results.{json,md}` | CREATED (generated) |
| `backend/app/domain/scenarios.py` | UPDATED (+~350) |
| `backend/app/schemas.py`, `types.py`, `config.py`, `controller.py`, `environment.py`, `brain.py`, `main.py`, `logging_config.py` | UPDATED |
| `backend/tests/test_api.py`, `test_logging.py` | UPDATED |
| `frontend/src/lib/types.ts`, `BrainFlow.tsx`, `ZoneSensorPanel.tsx`, `NeuroSkinDashboard.tsx`, `NeuroSkinLanding.tsx` | UPDATED |
| `frontend/.../CostBreakdownPanel.test.tsx`, `ZoneSensorPanel.test.tsx`, `NeuroSkinDashboard.test.tsx`, `NeuroSkinLanding.test.tsx` | UPDATED |
| `Makefile`, `README.md`, `docs/neuroskin_software_prd.md`, `docs/neuroskin_product_prd.md`, `docs/demo-review.md` | UPDATED |
| `.claude/PRPs/plans/langgraph-agentic-afc.plan.md` | MOVED to `completed/` |

## Deviations from Plan

1. **Stuck detection.**
   - *What:* the test compares the zone's flatness with its peers' reading-to-reading flicker (sum > 3 W/m², own range < 0.05 W/m²), not with a 20 W/m² change in the peer median.
   - *Why:* on calibration seeds a flat afternoon sky left stuck sensors undetected for 13 ticks.
2. **Calibrated substitute.**
   - *What:* isolation replaces only the implicated channel with peer-scaled inputs; a stuck pair also replaces lux using the zone's pre-fault ratio. The plan had a bare model fallback for the whole pair.
   - *Why:* whole-pair isolation discarded a healthy lux channel, and the uncalibrated model disagreed with the verification reference, so correct isolations "lost".
3. **Glare-aware verification.**
   - *What:* a branch whose direct sun breaches the screen at the reference pays 1.0.
   - *Why:* the optimiser enforces the glare screen as a bound outside its cost. Without the penalty, a dead sensor that opened the louvres into the sun scored better.
4. **Informative ticks only.**
   - *What:* verification counts sunlit, non-SAFE ticks where the branches differ by more than 0.5°.
   - *Why:* identical decisions carry no evidence, and counting them rolled back correct isolations under diffuse light.
5. **Verdict rules.**
   - *What:* rule 1 now restores (`closed`) instead of rolling back; rollback means only "did not help". The episode limit and unverifiable limit count evidence ticks, not elapsed time.
   - *Why:* a recovered sensor was being marked as a repeat offender, and dark evenings escalated episodes with no evidence.
6. **Public cost function name.**
   - *What:* the public cost function is named `angle_cost_breakdown`, not `cost_breakdown`.
   - *Why:* to avoid confusion with the existing `cost_breakdown` fields.
7. **SAFE ticks in verification.**
   - *What:* SAFE ticks are excluded from verification rather than forcing a rollback.
   - *Why:* the plan itself flagged rev 1's rule as wrong; implemented as revised.
8. **Recovery-only 7 h window.**
   - *What:* added to the matrix after the first full run.
   - *Why:* that run showed no 3 h fault outlived verification. No threshold changed, and the addition is disclosed in the appendix and PRD.
9. **Landing page.**
   - *What:* the landing page's layer claims were updated, which the plan did not list.
   - *Why:* it still said Layer 3 "PLANNED" and Layer 1 "range checks only".

## Issues Encountered

- A GateGuard hook blocked each first edit per file until facts were restated; the blocked edits were retried. One blocked draft contained a broken JSX ternary that was never applied.
- Two full matrix runs were discarded because code changed afterwards (rule-1 semantics, then evidence-based limits). The recorded appendix is from the final code.
- Frontend test output includes pre-existing WebGL/canvas/chart-size warnings from jsdom; no new failures.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `backend/tests/test_assurance.py` | 10 | Injection kinds, adjacency, cloud vs shadow vs fault, ambiguity, persistence, stuck flicker, thin/night/dark evidence, peer exclusion, no-label signature |
| `backend/tests/test_recovery.py` | 28 | Authority table, SAFE guards, stable ids, repeat-offender escalation, closure, verdict precedence, evidence-counted limits, informative ticks, no-label signatures, auto retention with zone independence, SAFE-owned facade, approval replay idempotency, restoration, shared shadow |
| `backend/tests/test_api.py` | +7 | Fault-window independence, monitor-only evidence, detection timing, request validation |
| `backend/tests/test_logging.py` | +1 (+2 asserts) | Correction counts reach JSON logs |
| `CostBreakdownPanel.test.tsx` | +3 | Assurance evidence, approval affordance vs tick/SAFE, outcomes lit by tick, design-only fallback |
| `ZoneSensorPanel.test.tsx` | +1 | Fault-window injection/clear, hidden in baseline |
| `NeuroSkinDashboard.test.tsx` | +1 | Brains deep link runs review, approval replay body, Floor fault-window body |

## Next Steps

- [ ] Review: `/code-review`, especially the `scenarios.py` zone loop, which grew significantly
- [ ] Decide whether the dashboard should expose `auto` mode (the UI currently uses `review` only)
- [ ] Phase C plan: rig lux-only assurance, Supabase episode ledger, read-only diagnosis agent
- [ ] Commit and PR via `/prp-commit` and `/prp-pr`
