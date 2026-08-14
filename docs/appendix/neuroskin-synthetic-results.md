# Appendix A — NeuroSkin Synthetic Simulation Results

> **Data status:** Fully synthetic, deterministic simulation output generated on 14 August 2026. Cooling load is a relative index, not measured HVAC energy or kWh.

## Technical summary

The current simulator supports three bounded conclusions:

- In the seed-42 upright west-façade counterfactual, NeuroSkin maintained **70.8% daylight compliance** versus **12.5%** for the naive controller and used **1 movement** versus **2**. Its mean relative cooling-load index was higher at **0.507 versus 0.469** because the naive strategy over-shaded.
- In the targeted east-facing upright fault test, NeuroSkin rejected all **10 injected dead-sensor ticks**. At 11:30, it selected **55°** while the naive controller opened to **0°**.
- During the power-loss test, the controller produced **4 SAFE ticks** and selected the required **60° fail-shaded position**.

These results demonstrate decision logic only. They do not establish measured building performance, energy savings, carbon savings, or financial payback.

## A.1 Reference scenario results

The four reference scenarios use the same seed-42 synthetic scattered-cloud day, west façade, 25° outward tilt, occupancy scale, wind override, and controller weights.

| Scenario | NeuroSkin daylight (%) | Naive daylight (%) | NeuroSkin load | Naive load | NeuroSkin moves | Naive moves | Rejected ticks | SAFE ticks |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Overview | 100.0 | 16.7 | 0.550 | 0.456 | 0 | 2 | 0 | 0 |
| Sensor Trust | 100.0 | 51.9 | 0.544 | 0.489 | 0 | 6 | 10 | 0 |
| Optimisation | 100.0 | 16.7 | 0.550 | 0.456 | 0 | 2 | 0 | 0 |
| Safety | 46.7 | 16.7 | 0.460 | 0.456 | 1 | 2 | 0 | 4 |

NeuroSkin generally preserved more useful daylight and moved less than the naive irradiance-threshold controller. The naive strategy sometimes achieved a lower relative load by closing more aggressively. This is a comfort–load trade-off; the results do not show one controller winning every metric simultaneously.

## A.2 Upright-façade co-optimisation result

The upright west-façade counterfactual represents a conventional vertical façade where adaptive control has more work to do.

| Metric | NeuroSkin | Naive baseline | Preferred direction |
|---|---:|---:|---|
| Daylight compliance | 70.8% | 12.5% | Higher |
| Mean relative cooling-load index | 0.507 | 0.469 | Lower |
| Full-day movement count | 1 | 2 | Lower |

Daylight compliance is the percentage of eligible occupied ticks within the **300–700 lux** band. The naive controller's lower load is associated with substantially lower daylight compliance.

## A.3 Ten-seed sensitivity check

Ten deterministic synthetic skies were tested on the upright west façade. NeuroSkin matched or exceeded naive daylight compliance in **10 of 10 seeds** and strictly exceeded it in **7 of 10**. NeuroSkin movements were never higher. Its relative load was higher in nine seeds and equal in one; the largest NeuroSkin-to-naive load ratio was **1.128**.

| Seed | NeuroSkin daylight (%) | Naive daylight (%) | NeuroSkin load | Naive load | Load ratio | NeuroSkin moves | Naive moves |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 94.7 | 57.9 | 0.573 | 0.522 | 1.098 | 0 | 4 |
| 1 | 100.0 | 55.2 | 0.557 | 0.506 | 1.101 | 0 | 4 |
| 2 | 46.7 | 46.7 | 0.565 | 0.552 | 1.024 | 0 | 2 |
| 3 | 57.7 | 15.4 | 0.505 | 0.468 | 1.079 | 1 | 2 |
| 4 | 100.0 | 40.0 | 0.549 | 0.524 | 1.048 | 0 | 2 |
| 5 | 100.0 | 78.1 | 0.564 | 0.540 | 1.044 | 0 | 2 |
| 6 | 100.0 | 61.1 | 0.557 | 0.494 | 1.128 | 0 | 2 |
| 7 | 100.0 | 66.7 | 0.555 | 0.537 | 1.034 | 0 | 2 |
| 8 | 100.0 | 100.0 | 0.550 | 0.550 | 1.000 | 0 | 0 |
| 9 | 68.8 | 68.8 | 0.574 | 0.570 | 1.007 | 0 | 2 |

Absolute daylight compliance ranged from 46.7% to 100%, confirming that the generated cloud realization materially affects the result. These ten seeds are a bounded sensitivity check, not a statistical confidence interval.

## A.4 Sensor-trust event evidence

The default west-facing Diamond façade detects the injected fault but remains open because its passive geometry already keeps the optimum at 0° at that time. The following targeted test therefore uses an **east-facing upright façade** to expose the control consequence.

| Time (MYT) | Event | Measured (W/m²) | Expected (W/m²) | Trust decision | NeuroSkin angle | Naive angle | NeuroSkin lux | Naive lux | NeuroSkin load | Naive load |
|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 11:30 | Injected dead pyranometer | 0.0 | 816.12 | Rejected | 55° | 0° | 325.9 | 824.4 | 0.4509 | 0.7707 |
| 15:00 | Genuine heavy cloud | 8.0 | 281.63 | Trusted | 55° | 0° | 20.0 | 20.0 | 0.3778 | 0.5131 |

At 11:30, the near-zero sensor reading contradicted the solar almanac under a clear synthetic sky. NeuroSkin rejected the sensor and retained shading, while the naive controller opened. At 15:00, heavy cloud explained the low reading, so the sensor value was accepted.

## A.5 Safety and movement-budget event evidence

| Time (MYT) | Event | Mode | Target angle | Final angle | Measured irradiance (W/m²) | Relative load | Result |
|---|---|---|---:|---:|---:|---:|---|
| 14:00 | Power loss | SAFE | 60° | 60° | 721.02 | 0.3939 | Optimiser bypassed; fail shaded |
| 15:00 | Marginal movement | HOLD | 40° | 60° | 682.98 | 0.3887 | Movement declined below threshold |

The power-loss rule bypassed normal optimisation for four ten-minute ticks. After power returned, the optimiser requested 40°, but the predicted benefit did not clear the movement threshold, so the controller held 60°.

## A.6 Façade geometry counterfactual

| Geometry | pvlib tilt | NeuroSkin daylight (%) | NeuroSkin load | NeuroSkin moves | Naive daylight (%) | Naive load | Naive moves |
|---|---:|---:|---:|---:|---:|---:|---:|
| Diamond as built: 25° outward | 115° | 100.0 | 0.550 | 0 | 16.7 | 0.456 | 2 |
| Upright counterfactual | 90° | 70.8 | 0.507 | 1 | 12.5 | 0.469 | 2 |

The Diamond Building's passive geometry reduced the need for adaptive movement and maintained daylight in the reference day. The upright counterfactual produced a lower relative load through additional active shading. The table should therefore be interpreted as an interaction between passive geometry and active control, not as a simple efficiency ranking.

## A.7 Scope and metric definitions

| Item | Definition |
|---|---|
| Simulation period | 21 March 2026, 00:00–23:50 MYT |
| Resolution | 144 ticks at ten-minute intervals |
| Environment | Seeded synthetic scattered-cloud day |
| Location | ST Diamond Building, Putrajaya |
| Daylight compliance | Percentage of occupied ticks within 300–700 lux where the controlled wall receives at least 200 W/m² incident irradiance |
| Mean relative load | Arithmetic mean of the physics-inspired cooling-load index across occupied ticks |
| Movement count | Number of full-day final-angle changes |
| Sensor-fault ticks | Ticks where `sensor_trusted` is false |
| SAFE ticks | Ticks where controller mode is `SAFE` |

The relative load includes a latent component that façade shading cannot eliminate. It must not be converted into HVAC energy or presented as kWh.

## A.8 Simulation configuration

| Parameter | Reference value | Targeted variation |
|---|---|---|
| Environment | Synthetic, scattered cloud | Unchanged |
| Date and timezone | 21 March 2026, Asia/Kuala_Lumpur | Unchanged |
| Location | ST Diamond Building, Putrajaya | Unchanged |
| Seed | 42 | Seeds 0–9 for sensitivity check |
| Controlled façade | West | East for sensor-fault consequence |
| Façade geometry | 115° pvlib tilt | 90° upright counterfactual |
| Occupancy | 1.0× | Unchanged |
| Wind | 3 m/s override | Unchanged |
| Controller weights | Thermal 0.45; daylight 0.35; movement 0.15; risk 0.05 | Unchanged |
| Candidate angles | 0°–60° in 5° increments | Unchanged |

## A.9 Methodology and reproducibility

Each result was generated by passing an explicit `SimulationRunRequest` into `run_scenario`. Solar position and plane-of-array irradiance were calculated for the selected site and façade geometry. NeuroSkin and the naive baseline received the same environmental realization within each run.

The simulation is deterministic: repeating an identical request produces identical output. Seed 42 is the documented reference, while seeds 0–9 provide the bounded sensitivity check.

Supporting sources:

- [Simulation engine](../../backend/app/domain/scenarios.py)
- [Request and response definitions](../../backend/app/schemas.py)
- [Appendix audit dataset](./neuroskin-synthetic-results.sql)

## A.10 Limitations and robustness boundaries

- All environmental, occupancy, indoor, and sensor channels in this appendix are synthetic.
- The ten-seed check is not a statistical confidence interval or field-validation sample.
- Cooling load is a relative model output; no HVAC kWh, energy saving, carbon saving, or payback is inferred.
- The 3D building massing is representative rather than based on measured construction drawings.
- The sensor-fault test changes orientation and geometry to expose the controller consequence; it must not be described as the default west-façade result.
- Safety behaviour is a software-state proof. Actuator timing, failure mechanics, sensor calibration, and communication latency remain untested.

## A.11 Recommended validation steps

1. Replay the request matrix using measured irradiance and indoor-lux data from a physical test bay.
2. Calibrate the relative load model against a validated building-energy model before making any energy claim.
3. Repeat the sensor-fault and fail-safe cases on the selected physical façade orientation.
4. Define acceptance thresholds for daylight, load trade-off, movements, and fault-detection latency before hardware integration.

## A.12 Further questions

- Should the preliminary claim focus on retrofit value for upright façades, with the Diamond Building treated as the passive-design control case?
- Which physical façade and occupancy schedule will be used for the first validation pilot?
- What measured HVAC or surface-temperature signal will anchor the relative load index?
