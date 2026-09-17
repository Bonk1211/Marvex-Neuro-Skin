# Daylight serving verification

Default overview, seed 42; 144 ticks, all 64 zones and 16 illustrative floor plans. Timing includes HTTP validation/serialization via TestClient, excludes network transit. The same process loads the real artifacts once; each grid starts without a matching curve cache.

Model load: 3.033 s.

| Mode | Seconds | Response bytes |
|---|---:|---:|
| off | 1.934 | 6,973,222 |
| 1 degree | 17.648 | 11,899,498 |
| 5 degree | 7.227 | 11,899,571 |
| 5 degree cached | 2.297 | 11,899,571 |

Five-degree overhead: 5.293 s. The one-degree grid exceeded the ~1 s budget, so serving uses the training grid's five-degree spacing, interpolated to whole degrees and then to the achieved angle. The remaining uncached overhead is reported rather than hidden; the feature defaults off.

Compared 18,200 daylight seat-ticks with the one-degree reference. Added Et/Ev MAE: [1.914, 0.824] lux; maximum: [523.092, 252.398] lux. Ev-cap classifications changed for 6 seat-ticks. This is interpolation sensitivity, separate from the oracle holdout error.

Assertions passed: all legacy response fields unchanged with observations enabled; identical predictions on repeat; missing artifacts reproduce the off response; saved pre-change baseline agrees when present. Night estimates remain null.

Reproduce: `cd backend && uv run python -m scripts.benchmark_daylight`. Requires the locally trained, gitignored artifacts.
