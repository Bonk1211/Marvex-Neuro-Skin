# Known limitations

Hand-written 2026-09-23 at commit `98f65a9` (uncommitted changes). Unlike the rest of this
appendix, no script generates this file.

**Read this before the result files.** NeuroSkin is a simulation proof. Every figure in this
appendix is a model output, not a measurement. This page states, in one place, what each
part of the system actually establishes and what would be needed to establish more. Nothing
here is a defect report: these are the boundaries the design was built inside. Where a
boundary is narrower than the surrounding prose implies, that is said plainly.

---

## 1. What is real and what is synthetic

| Layer | Status |
|---|---|
| Irradiance (GHI/DNI/DHI), temperature, cloud, wind, precipitation | Real, when `environment_source=open_meteo`: hourly Open-Meteo data for the site, interpolated to 10-minute ticks |
| Sky condition and temperature range | Real, when `environment_source=met_anchored`: MET Malaysia daily forecast, period-level only |
| Everything at 10-minute resolution under either source | Synthetic, seeded |
| Occupancy | Synthetic |
| Indoor illuminance, indoor temperature, indoor RH | Synthetic |
| Every sensor fault and every zone perturbation | Synthetic, declared by the caller |
| Facade geometry, louvre optics, cooling load | Modelled |

The API reports this per run in `metadata.data_notice`. The default
`environment_source=synthetic` makes the whole day synthetic.

**The ESP32 rig does not validate the simulation.** `hardware/esp32/neuroskin_bridge`
proves the actuation path end to end: four BH1750 sensors post real lux to the backend, the
backend returns angles, and PCA9685 servos apply them. It does not measure a facade, a room
or a cooling load, and no figure in this appendix comes from it.
`hardware/esp32/csi_probe` is earlier still: it establishes that CSI frames arrive and that
a moving person changes amplitude variance. There is no zone mapping and no backend POST.

## 2. Tier 1's almanac cross-check is circular in simulation

`expected_irradiance` in `backend/app/domain/validation.py` computes
`clear_sky_ghi x (1 - 0.72 x cloud)`. `generate_day` in
`backend/app/domain/environment.py:127` generates GHI from the identical expression. In a
synthetic run, the lie-detector is therefore comparing the generator against itself. It
demonstrates that the logic runs and that the resulting explanation is legible. It does not
demonstrate detection, and no detection rate should be quoted from it.

The `lie_detector` scenario compounds this: it sets cloud to 0.05 and zeroes the sensor in
the same tick, so the contradiction is constructed rather than discovered.

**The structurally sound check is the per-zone one.** `backend/app/domain/assurance.py`
normalises each zone's reading against the median of its 15 peers on the same wall. That
verdict is a ratio between sensors and never consults the generator, so it survives the
transfer to a physical facade that the Tier 1 check does not. Its measured behaviour is in
`assurance-matrix-results.md`. Judge the sensor-trust claim on that file, not on Tier 1.

**What would settle it:** a pyranometer and a clear-sky model that were not used to
synthesise the reading — that is, a field deployment.

## 3. A single vision estimate can overturn the trust verdict

When a vision observation is supplied, `run_tick` replaces `env.cloud` with the camera's
cloud fraction *before* `validate` runs. Because the almanac check only calls a near-zero
reading suspicious under a clear sky (`low_cloud_threshold = 0.35`), a cloud estimate above
that threshold reclassifies a dead pyranometer as genuine cloud-gating.

Measured on the `lie_detector` scenario, tick 30 (12:00), where the pyranometer is dead by
construction:

| Vision cloud | Verdict | Reason shown to the operator |
|---:|---|---|
| 0.05 | not trusted | "Almanac predicts strong sun while the sensor reads near zero under a clear sky" |
| 0.34 | not trusted | as above |
| 0.40 | **trusted** | "Low irradiance agrees with heavy cloud despite the sun being above the horizon" |
| 0.80 | **trusted** | as above |

At 0.40 and above the fault is missed and the interface states a confident, incorrect
explanation. One camera frame of an overcast sky is sufficient. The cloud estimate itself is
a whole-frame segmentation area, not a sky-ROI measurement, and is flagged as a demo proxy
in `backend/app/vision.py`.

Separately, `run_scenario` discards any observation whose `captured_at` is not within the
last 60 seconds. A replayed or saved frame is ignored silently; only the wording of
`metadata.data_notice` changes.

**What would settle it:** require the almanac contradiction to hold under both the modelled
and observed cloud values before trust is granted, and degrade to an explicit
"unverifiable" state when the two sources disagree, rather than to "trusted".

## 4. Two daylight scales, not yet reconciled

The control loop converts plane-of-array irradiance to work-plane lux with
`WALL_LUX_PER_IRRADIANCE = 1.7` (`backend/app/domain/controller.py:29`), a single constant
covering glazing, room geometry and transfer to the work plane. The learned occupant-plane
model instead applies a luminous efficacy of 110 lm/W, from Littlefair (1988),
doi:10.1177/096032718802000405.

These are not the same scale and have not been reconciled against each other. The
consequence is that the daylight figure the controller optimises and the daylight figure the
occupant-plane view displays are produced by different assumptions. Both are labelled in the
code; neither is calibrated.

The 300-700 lux band used for the compliance metric is the incumbent comparison band
recorded in `docs/neuroskin_software_prd.md`. This repository does not cite it to a lighting
standard. The occupant-plane thresholds are separate and do carry a citation: Manesh et al.
(2025), doi:10.1016/j.autcon.2025.106474.

**What would settle it:** a lux meter behind the real facade at a known louvre angle and a
known incident irradiance. One afternoon of readings fixes the constant and tells you
whether the two scales can be merged.

## 5. Recovery verification is a consistency check, not an independent one

`backend/app/domain/recovery.py` is documented as "Verified fault recovery". The
verification compares a corrected branch against a counterfactual that runs the same tick
without isolation, and only ticks where the two branches chose materially different angles
are counted.

The limitation is in the reference. Both branches are scored by the `objective` closure in
`backend/app/domain/scenarios.py:711`, which uses `incident_ref` and `open_lux_ref` — the
corrected branch's own peer-scaled substitute inputs. The corrected branch is therefore
graded against the estimate it was itself controlling on, while the uncorrected branch is
graded against an estimate it never saw. The comparison is structurally favourable to the
correction.

This was a deliberate choice: the alternative is to score against the simulator's ground
truth, which no deployed controller could access, and which would make the result
unreproducible on hardware. The honest reading of the retained/rolled-back outcomes in
`assurance-matrix-results.md` is therefore "the correction improves the objective under the
controller's best available estimate", not "the correction was verified".

## 6. The stuck-sensor threshold is calibrated to a synthetic fault

`assurance_stuck_change = 0.05` W/m² (`backend/app/config.py:109`). The preregistered value
was 20 W/m²; it was reduced during calibration because at 20 the detector waited 13 ticks
for the sky to move. The injected `stuck` perturbation copies the previous reading exactly,
so the observed span across the detection window is precisely zero.

A physical BH1750 or pyranometer will not hold still to 0.05 W/m². ADC quantisation and
thermal noise alone exceed it. The stuck detector as configured is expected to fail on the
rig, and the retune direction — down, toward the synthetic fault — is the direction that
overfits.

**What would settle it:** the measured noise floor of a healthy sensor on the rig over one
day, with the threshold set above it. If that floor is too high to separate stuck from
live, the detector should move from absolute span to a variance-ratio test against peers.

## 7. The glare screen is not a glare index

`glare_limit_w_m2 = 25.0` screens direct solar flux at the aperture. It is not Daylight
Glare Probability, not Daylight Glare Index, and carries no field of view, no luminance and
no occupant orientation. `backend/app/config.py` labels it "Direct solar exposure screen,
not an occupant-view glare index (DGP)". Interface copy that says "glare" means this screen.

The optimiser treats the screen as a hard bound rather than a cost term: it solves the
crossings where direct flux equals the limit and optimises only inside the clear intervals,
and will not slew from one clear interval through a breaching gap to another. Where no clear
pose exists it minimises exposure and reports the residual rather than claiming the limit
was met.

## 8. Commissioning assumptions

None of the following are measured properties of the ST Diamond Building or of any
installed hardware. They are plausible values chosen to make the model run, and each is
marked as such in `backend/app/config.py`.

| Value | Setting | Note |
|---|---|---|
| Facade tilt | 115 deg | 25 deg outward lean, as published; the resulting normal sits 25 deg below horizontal |
| Roof pitch | 10 deg | No source publishes the roof geometry or the 71.4 kWp array tilt |
| Roof overhang | 1.6 m | Sets which facade rows shade first |
| Glazing SHGC | 0.4 | Not a specification for the installed glazing |
| Actuator speed | 6 deg/min | Rate limit, not a measured servo characteristic. Was 1.2; that lagged the sun by up to ~45 degrees |
| Rain response | retract flat | Conservative policy; rain does not itself threaten the blades |
| Cooling load | relative index | `metadata.load_unit` says so. It is not kW, not kWh, and no energy saving should be derived from it |

The louvre optics model is a periodic-bank raycast with an 8x16 isotropic sky and ground
quadrature interpolated per degree. It omits finite blade ends and side gaps, and is
commented to that effect in `backend/app/domain/optics.py`.

---

## How to read the rest of this appendix

- `assurance-matrix-results.md` — the strongest evidence here. Peer-based sensor assurance
  across six fault types and multiple seeds, with false-intervention counts on clean runs.
  Its own caveat paragraph states the synthetic upper bound: a healthy simulated sensor is
  the geometry model plus 1% noise, so peers agree more closely than they would on a real
  facade.
- `daylight-training-results.md`, `daylight-blindness-results.md`,
  `daylight-inference-results.md` — the learned occupant-plane model, its holdout and
  transfer error, its ablations and its serving cost. This model is read-only and never
  enters the control loop.
- `solar-gain-shave-by-angle.csv` — what the louvres buy over a fixed facade, by angle.
- `maintenance-cost-model.md` — cost assumptions, separate from the physics.
