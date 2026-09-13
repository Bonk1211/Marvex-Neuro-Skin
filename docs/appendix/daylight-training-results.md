# Daylight surrogate training results

Modelled oracle labels, not measured occupant comfort. MAE (lux) is the selection criterion. MSE is lux²; R² is dimensionless. Selection uses structural holdout MAE, so it is a validation set; only orientation transfer is untouched by selection.

Shuffled rows share days/zones with fitting. Structural rows have BOTH an unseen day and unseen zone; the two cross-strata are excluded. Five-fold search groups by whole training days. Ev excludes desks, whose eye-plane target is undefined.

| Target / model | MAE shuffled | MAE holdout | MAE transfer | R² shuffled / holdout / transfer | MSE shuffled / holdout / transfer |
|---|---:|---:|---:|---|---|
| EV / extra trees | 18.13 | 106.98 | 141.35 | 0.995 / 0.971 / 0.971 | 8186 / 57069 / 53532 |
| EV / random forest | 25.59 | 187.94 | 172.15 | 0.992 / 0.926 / 0.942 | 14292 / 142802 / 106566 |
| EV / linear | 560.37 | 563.62 | 617.90 | 0.539 / 0.616 / 0.623 | 793593 / 745125 / 699323 |
| ET / extra trees | 28.57 | 105.89 | 94.60 | 0.978 / 0.962 / 0.954 | 43859 / 58401 / 30518 |
| ET / random forest | 33.63 | 121.35 | 103.55 | 0.974 / 0.954 / 0.927 | 51887 / 70883 / 47726 |
| ET / linear | 517.23 | 442.78 | 411.58 | 0.605 / 0.652 / 0.525 | 788939 / 536341 / 311501 |
| ET / incumbent scalar | 1175.49 | 1131.56 | 815.50 | -0.651 / -0.789 / -0.959 | 3296706 / 2758542 / 1285741 |

EV extra trees: structural minus shuffled MAE +88.85 lux.
ET extra trees: structural minus shuffled MAE +77.32 lux.

EV (extra trees): east/north transfer held: MAE 141.35 lux vs holdout 106.98 lux. Predeclared tolerance: 1.5 × holdout + 50 lux. Scope: north, east, south, west.

ET (extra trees): east/north transfer held: MAE 94.60 lux vs holdout 105.89 lux. Predeclared tolerance: 1.5 × holdout + 50 lux. Scope: north, east, south, west.

EV: 55,036 fit / 13,760 shuffled / 6,656 structural / 30,030 transfer; 42,848 cross-stratum rows excluded. Artifact: 191.11 MiB.

ET: 72,363 fit / 18,091 shuffled / 8,320 structural / 39,039 transfer; 55,016 cross-stratum rows excluded. Artifact: 124.56 MiB.

Seed: 42; git: `69d60576906b7fd3d38f85805de25d9451c2eba8`; code SHA-256: `ea43008221479b32b016e8ce0a80a22f5f53b111ca1e248d78f53d4b13113fb5`; dataset SHA-256: `b69fb674df4594977c5e8c9965d8fee2869537203617da32f5511e2df4a8a170`. JSONL records each target/model evaluation.

Features add incident intensity, lateral position, tilt and sky fraction to the plan's list: without these, different physical inputs can produce identical vectors. Every directional feature remains facade-relative. Fixed room/material assumptions constrain model applicability.

Method precedent: [Tabatabaei Manesh et al. (2025)](https://doi.org/10.1016/j.autcon.2025.106474). Independent local data and weights; four-bounce empty box, 4×4 patches per surface, full-wall aperture, uniform louvre-bank transmission, no furniture occlusion or glass spectral calibration. This oracle is not Radiance and does not establish measured glare or comfort.
