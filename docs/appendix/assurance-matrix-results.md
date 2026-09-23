# Sensor assurance fault matrix

Generated 2026-09-17T16:51:58+00:00 at commit `417eadc` (uncommitted changes).

**Synthetic upper bound.** A healthy simulated zone sensor is the geometry model plus 1% noise, so peers agree far more closely than on a real facade. Shadow cases are the only unmodelled legitimate condition. Nothing here is a field result.

Design: date 2026-03-21, west wall, zones W6, W5, W14, W2, perturbation window ticks 78-96 (13:00-16:00), clouds clear, scattered, `fault_correction=monitor`. Severities: dead 1.0, stuck 0.5, drift 0.5, fouled 0.4, shadow_single 0.5, shadow_cluster 0.5.

## Calibration seeds (1, 2, 3)

| Case | Cases | Detected (fault) | Median delay | Max delay | Window verdicts on the perturbed zone(s) |
|---|---:|---:|---:|---:|---|
| dead | 24 | 24 | 2.0 | 2 | fault 387, insufficient 21, suspect 48 |
| stuck | 24 | 24 | 3.0 | 3 | consistent 72, fault 363, insufficient 21 |
| drift | 24 | 20 | 15.0 | 16 | consistent 310, fault 78, insufficient 21, suspect 47 |
| fouled | 24 | 24 | 2.0 | 2 | fault 379, insufficient 21, suspect 56 |
| shadow_single | 24 | 0 | — | — | insufficient 456 |
| shadow_cluster | 24 | 0 | — | — | insufficient 42, legitimate_condition 870 |

Clean runs: 0 fault verdicts in 18,424 assessed zone-ticks (6 runs). Unperturbed zones in perturbed runs: 0 in 433,699. Delays are ticks (10 min) from the window start. A drift ramps from zero and first exceeds the 35% peer-deviation threshold after 13 ticks, so most of its delay is the fault becoming visible.

### Recovery quality (1, 2, 3)

| Fault window | Authority | Case | Cases | Episodes | Isolated | Retained | Rolled back | Escalated | Closed | Unresolved | False interventions | On SAFE ticks | Median delay | Isolated zone-ticks | Admitted error | Sensor error |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 h | auto | clean | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | auto | dead | 24 | 24 | 24 | 0 | 0 | 8 | 16 | 0 | 0 | 0 | 2.0 | 408 | 0.5 | 203.7 |
| 3 h | auto | stuck | 24 | 24 | 20 | 0 | 0 | 0 | 24 | 0 | 0 | 0 | 3.0 | 320 | 0.5 | 36.3 |
| 3 h | auto | drift | 24 | 20 | 0 | 0 | 0 | 0 | 20 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | auto | fouled | 24 | 24 | 0 | 0 | 0 | 0 | 24 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | auto | shadow_single | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | auto | shadow_cluster | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | approved | clean | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | approved | dead | 24 | 24 | 24 | 0 | 0 | 8 | 16 | 0 | 0 | 0 | 2.0 | 408 | 0.5 | 203.7 |
| 3 h | approved | stuck | 24 | 24 | 24 | 0 | 0 | 0 | 24 | 0 | 0 | 0 | 3.0 | 384 | 0.5 | 38.6 |
| 3 h | approved | drift | 24 | 20 | 20 | 0 | 0 | 0 | 20 | 0 | 0 | 0 | 15.0 | 78 | 1.1 | 139.5 |
| 3 h | approved | fouled | 24 | 24 | 24 | 0 | 0 | 18 | 6 | 0 | 0 | 0 | 2.0 | 408 | 0.5 | 81.5 |
| 3 h | approved | shadow_single | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | approved | shadow_cluster | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | — |
| 7 h | auto | dead | 24 | 24 | 24 | 14 | 0 | 9 | 0 | 1 | 0 | 0 | 2.0 | 984 | 0.4 | 174.1 |
| 7 h | auto | stuck | 24 | 24 | 20 | 12 | 0 | 8 | 0 | 4 | 0 | 0 | 3.0 | 800 | 0.5 | 101.6 |
| 7 h | auto | drift | 24 | 12 | 0 | 0 | 0 | 0 | 0 | 12 | 0 | 0 | — | 0 | — | — |
| 7 h | auto | fouled | 24 | 24 | 0 | 0 | 0 | 0 | 0 | 24 | 0 | 0 | — | 0 | — | — |
| 7 h | approved | dead | 24 | 24 | 24 | 14 | 0 | 9 | 0 | 1 | 0 | 0 | 2.0 | 984 | 0.4 | 174.1 |
| 7 h | approved | stuck | 24 | 24 | 24 | 15 | 0 | 9 | 0 | 0 | 0 | 0 | 3.0 | 960 | 0.4 | 97.5 |
| 7 h | approved | drift | 24 | 12 | 12 | 0 | 0 | 0 | 0 | 12 | 0 | 0 | 32.0 | 131 | 0.1 | 12.5 |
| 7 h | approved | fouled | 24 | 24 | 24 | 2 | 0 | 21 | 0 | 1 | 0 | 0 | 2.0 | 984 | 0.4 | 69.6 |

## Evaluation seeds (7, 11, 13)

| Case | Cases | Detected (fault) | Median delay | Max delay | Window verdicts on the perturbed zone(s) |
|---|---:|---:|---:|---:|---|
| dead | 24 | 24 | 2.0 | 2 | fault 387, insufficient 21, suspect 48 |
| stuck | 24 | 24 | 3.0 | 3 | consistent 77, fault 358, insufficient 21 |
| drift | 24 | 20 | 15.0 | 15 | consistent 307, fault 80, insufficient 21, suspect 48 |
| fouled | 24 | 24 | 2.0 | 2 | fault 378, insufficient 21, suspect 57 |
| shadow_single | 24 | 0 | — | — | insufficient 456 |
| shadow_cluster | 24 | 0 | — | — | insufficient 42, legitimate_condition 870 |

Clean runs: 0 fault verdicts in 18,764 assessed zone-ticks (6 runs). Unperturbed zones in perturbed runs: 0 in 441,628. Delays are ticks (10 min) from the window start. A drift ramps from zero and first exceeds the 35% peer-deviation threshold after 13 ticks, so most of its delay is the fault becoming visible.

### Recovery quality (7, 11, 13)

| Fault window | Authority | Case | Cases | Episodes | Isolated | Retained | Rolled back | Escalated | Closed | Unresolved | False interventions | On SAFE ticks | Median delay | Isolated zone-ticks | Admitted error | Sensor error |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 h | auto | clean | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | auto | dead | 24 | 24 | 24 | 0 | 0 | 10 | 14 | 0 | 0 | 0 | 2.0 | 408 | 0.6 | 184.6 |
| 3 h | auto | stuck | 24 | 24 | 20 | 0 | 0 | 0 | 24 | 0 | 0 | 0 | 3.0 | 320 | 0.6 | 35.1 |
| 3 h | auto | drift | 24 | 20 | 0 | 0 | 0 | 0 | 20 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | auto | fouled | 24 | 24 | 0 | 0 | 0 | 0 | 24 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | auto | shadow_single | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | auto | shadow_cluster | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | approved | clean | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | approved | dead | 24 | 24 | 24 | 0 | 0 | 10 | 14 | 0 | 0 | 0 | 2.0 | 408 | 0.6 | 184.6 |
| 3 h | approved | stuck | 24 | 24 | 24 | 0 | 0 | 0 | 24 | 0 | 0 | 0 | 3.0 | 384 | 0.6 | 33.5 |
| 3 h | approved | drift | 24 | 20 | 20 | 0 | 0 | 0 | 20 | 0 | 0 | 0 | 15.0 | 80 | 0.7 | 116.6 |
| 3 h | approved | fouled | 24 | 24 | 24 | 0 | 0 | 19 | 5 | 0 | 0 | 0 | 2.0 | 408 | 0.6 | 73.9 |
| 3 h | approved | shadow_single | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | — |
| 3 h | approved | shadow_cluster | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | — |
| 7 h | auto | dead | 24 | 24 | 24 | 10 | 0 | 11 | 0 | 3 | 0 | 0 | 2.0 | 984 | 0.5 | 160.3 |
| 7 h | auto | stuck | 24 | 24 | 20 | 10 | 0 | 6 | 0 | 8 | 0 | 0 | 3.0 | 800 | 0.5 | 97.6 |
| 7 h | auto | drift | 24 | 15 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | — | 0 | — | — |
| 7 h | auto | fouled | 24 | 24 | 0 | 0 | 0 | 0 | 0 | 24 | 0 | 0 | — | 0 | — | — |
| 7 h | approved | dead | 24 | 24 | 24 | 10 | 0 | 11 | 0 | 3 | 0 | 0 | 2.0 | 984 | 0.5 | 160.3 |
| 7 h | approved | stuck | 24 | 24 | 24 | 10 | 0 | 10 | 0 | 4 | 0 | 0 | 3.0 | 960 | 0.5 | 89.7 |
| 7 h | approved | drift | 24 | 15 | 15 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 32 | 163 | 0.1 | 10.9 |
| 7 h | approved | fouled | 24 | 24 | 24 | 1 | 0 | 20 | 0 | 3 | 0 | 0 | 2.0 | 984 | 0.5 | 64.2 |

For shadow cases a `fault` verdict is a false alarm; `legitimate_condition` and `insufficient` are acceptable.

**Recovery columns.** `auto` isolates only dead/stuck hypotheses at score ≥ 0.8; `approved` replays the run with every episode the monitor opened approved by an operator. Retained counts episodes ever retained, including those later restored or escalated at the episode limit. Closed episodes ended because the sensor agreed with its peers again (restored); rolled back means verification found the correction did not help. The 7 h window (ticks 78-120) is recovery-only and was added after the first full run showed no 3 h fault outlived verification; no threshold changed with it. A false intervention is an isolation applied while no declared fault was active on that zone. Admitted and sensor error are mean |irradiance − truth| (W/m²) over the window's isolated zone-ticks, for the substitute the controller used and for the reading it set aside. Truth is the simulation's declared incident, which the controller never sees; its own verification compares branches on peer evidence, so the two measures are reported separately and never merged.

Reproduce: `make assurance-matrix` (add `ARGS=--split calibration` to tune).
