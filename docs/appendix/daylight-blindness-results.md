# Daylight glare-blindness experiment

> Modelled, seeded days; uncalibrated illustrative geometry, not measured occupant comfort.

The shipped controller spent **95.04%** of eligible occupied daylight hours with at least one modelled seat above the eye-illuminance cap (1000 lux). It never computed Ev.

| Controller | Any seat Ev > cap (% hours) | Et in band (% seat-hours) | Full-day zone moves | Mean relative load |
|---|---:|---:|---:|---:|
| naive | 94.15 | 20.18 | 1,536 | 0.4994 |
| NeuroSkin (shipped) | 95.04 | 9.23 | 11,686 | 0.5056 |

The oracle shows occupant-plane exceedance the controller did not compute. This does not demonstrate that adding Ev to control would avoid those exposures; that requires a separate controller intervention experiment.

NeuroSkin does not beat naive on the headline any-seat exceedance measure in this sweep.

## Population and denominators

Dates: 2026-01-21, 2026-02-21, 2026-03-20, 2026-03-28, 2026-04-21, 2026-06-21, 2026-07-21, 2026-08-21, 2026-09-15, 2026-09-23, 2026-10-21, 2026-12-21. Seed 42, overview defaults, synthetic scattered skies, Putrajaya, 115° facade tilt. A tick is eligible when occupancy ≥ 0.2 and solar elevation > 8°. Every chair is a fixed probe while eligible; fractional occupancy is not a seat schedule.

Any-seat exceedance is the union across all four orientations × four floor groups at each 10-minute tick, so groups are not counted as independent building hours. Et compliance divides compliant seat-ticks by all eligible seat-ticks using [300, 500] lux, inclusive. Movement counts sum changes of all 64 zone actuators over complete days, including night parking; naive starts at 0°. Relative load averages identical eligible zone-ticks.

naive: 740/786 building ticks; 50.75% of room-hours; 14.72% of seat-hours over cap. Maximum Ev 8,373.5 lux, unclamped.

NeuroSkin (shipped): 747/786 building ticks; 87.95% of room-hours; 38.35% of seat-hours over cap. Maximum Ev 11,568.5 lux, unclamped.

There were 84,402 shipped seat-ticks above the Ev cap while the corresponding zone's existing exterior direct-beam screen reported no risk. Ev is a screening proxy, not a diagnosis of discomfort.

## Method and limits

The real `run_scenario` path executes the shipped zone controller with its existing sensor streams, movement budget and safety rules. Each actual zone angle and the same tick's naive angle are independently re-scored with the oracle. Neither model artifact nor surrogate prediction is used. A probe belongs to the facade column containing its facade-local x coordinate; corner-neighbour sensor coupling does not create a second aperture in the oracle.

The room is a 6.4 × 6.4 × 3.6 m empty box, full-wall transparent aperture, wall/floor/ceiling reflectances 0.5/0.2/0.8. Four passes of diffuse-patch radiosity use 4×4 patches per surface; coarse view factors are normalised to prevent energy creation. Direct beam visibility is traced at each eye. Louvre transmission is the existing spatially averaged optics. Furniture, partitions, a spectral glazing model and measured calibration are absent. This is not a Radiance validation.

[Tabatabaei Manesh et al. (2025)](https://doi.org/10.1016/j.autcon.2025.106474) supplies method precedent, room reflectances and the Ev/Et screening choices. A fixed 110 lm/W efficacy is an assumption informed by [Littlefair (1988)](https://doi.org/10.1177/096032718802000405). Neither paper establishes the outcome of this local experiment.

## Reproduction

`make daylight-ablate` regenerates this report and its JSON numerator/denominator companion. Source SHA-256: `ee7118e08e69a8fa04f378d769f47b9a4da1b0cffd6e7111aaef30796d23f454`. Raw per-room tick scores are saved to `backend/data/daylight/ablation-scores.parquet`. All results are deterministic; execution timing is deliberately excluded from the evidence hash.
