# Maintenance-Cost Model — Audit and Adaptation

Supersedes the maintenance lines in Appendix A of *GYATT — E&M 2026 Proposal*.
Written 2026-09-18 against branch `feat/sensor-assurance-recovery`.

The proposal's maintenance saving is the number that carries its business case:
it is 83% of the claimed RM 120,000/year benefit and it sets the 2.5-year
payback. It is also the least-derived number in the document. This note shows
how it was calculated, what the shipped code now contradicts, what real-world
sources say, and what the claim should be replaced with.

---

## 1. How the proposal calculates it

Chain as written (Section 5.2, Section 6.1, Appendix A):

| Line | Value |
|---|---|
| Reactive kinetic facade, actuator replacement | RM 150,000/yr ("burnout") |
| Neuro-Skin Array, actuator replacement | RM 50,000/yr ("budgeted wear") |
| **Maintenance saving** | **RM 100,000/yr** |
| Stated basis | "3× actuator life (movement budget)" |
| Fleet assumed | ~250 nodes, 15-year horizon |
| Plus energy-related saving | RM 20,000/yr |
| Combined benefit | RM 120,000/yr |
| Intelligence-layer CapEx | RM 300,000 |
| **Payback** | **≈ 2.5 years** |

**The problem is structural, not arithmetic.** RM 150,000 and RM 50,000 are not
two measurements — they are one assumption stated twice, because 150 ÷ 50 *is*
the "3× actuator life" figure. Nothing below that ratio is declared: no actuator
unit cost, no cycles per year, no manufacturer cycle rating, no access or labour
cost, no derivation of the 250-node fleet. A judge cannot reproduce the number
from the appendix, which is what the appendix promises they can do.

---

## 2. What has changed since the proposal was written

| Proposal statement | Code as shipped |
|---|---|
| "~250-node fleet" | 64 zones + 4 wall controllers (`FR-C2`) |
| Movement budget rations mechanical wear | `movement_threshold = 0.0002` (`backend/app/config.py:18`) — effectively disabled |
| "moved less than the naive irradiance-threshold controller" (App. B) | True in degrees, **false in cycles** — see §3 |
| 6% cooling cut → 27,700 kWh → RM 11,100/yr | `docs/neuroskin_software_prd.md:103` forbids exactly this conversion: the relative load index "must never be converted into HVAC kWh, carbon, cost, or payback" |
| "3× actuator life" | No cycle accounting exists in the codebase; nothing measures or enforces a cycle budget |

The third and fourth rows are the serious ones. The proposal's own simulator now
disagrees with its Appendix B sentence, and its Appendix A energy conversion is
prohibited by the software PRD that the same team wrote afterwards.

---

## 3. Measured actuator duty (this is new evidence)

Primary-facade controller, `overview` scenario, 144 ten-minute ticks, committed
moves counted with a 0.1° deadband:

| Controller | Moves/day | Cycles/yr | Travel/day | Mean relative load |
|---|---|---|---|---|
| NeuroSkin (as shipped) | 24 | 8,760 | 112.8° | 0.3974 |
| Naive threshold baseline | 2 | 730 | 120.0° | 0.3942 |

The naive baseline is pure bang-bang: two transitions per day (0°→60° at tick
66, 60°→0° at tick 98). **NeuroSkin performs 12× more actuation cycles than the
baseline it is benchmarked against**, while saving 6% of angular travel.

Wear has two currencies and the proposal conflated them:

- **Cycles** — motor starts, gear-train reversals, brake engagements. This is
  what cycle-life ratings count. NeuroSkin is 12× worse.
- **Angular travel** — sliding and bearing wear. NeuroSkin is 6% better.

Appendix B's "moved less" sentence is only true in the second currency, and the
second currency is not the one that kills actuators.

### Movement-threshold sweep

| `movement_threshold` | Moves/day | Cycles/yr | Travel/day | Mean relative load |
|---|---|---|---|---|
| 0.0002 (shipped) | 24 | 8,760 | 112.8° | 0.3974 |
| 0.002 | 13 | 4,745 | 92.0° | 0.3974 |
| 0.01 | 8 | 2,920 | 50.3° | 0.3973 |
| 0.05 | 6 | 2,190 | 42.5° | 0.3973 |
| ≥0.1 | 0 | 0 | 0.0° | 0.3971 |

On this reference day the relative load is flat to four decimal places across a
4× cycle reduction — and a fully frozen louvre scores 0.3971, marginally *better*
than moving 24 times. The Diamond Building's 25° passive tilt is doing the work,
exactly as Appendix B admits. This is a strong result for the movement budget and
a weak one for movement itself; both should be reported.

> Caveat: this measures the primary-facade controller on one scenario and one
> seed. Fleet-wide and multi-seed cycle counts are not yet instrumented. The
> daylight-band metric is not reproduced here — the reference-day lux never
> exceeds 203 lx, so the 300–700 lx band is unreachable and the Appendix B
> compliance figures come from a different metric path in the notebook.

---

## 4. Real-world anchors

### Actuator reliability

- **Al Bahr Towers, Abu Dhabi** — 1,049 mashrabiya devices per tower, ~1.5 t
  each. Stated service life **15 years for actuators**, 20 years for the PTFE
  fabric. Prototype qualification: **30,000 cycles** in 65 °C / 100% RH chambers
  against sand, dust and salt air. Critically, the linear actuators **operate
  once per day** on a pre-programmed sequence, with a 15-minute sensor update
  only for wind/overcast overrides.
- **Damper and life-safety actuator sector** — minimum **20,000-cycle**
  qualification test is the industry standard.
- **EN 14201** is the governing test standard: *Blinds and shutters — Resistance
  to repeated operations (mechanical endurance)*. Referenced by EN 13561 for
  external blinds. Any cycle claim should be specified against it.
- **Motorised blinds, field life** — commonly quoted at **5–10 years**.
- **The ESP32 rig's SG90 servos** are hobby-grade plastic-gear units
  (50k–100k cycles unloaded, far less under load) with no position feedback.
  They are a demonstration substrate, not evidence about building actuators, and
  must not be cited as such.

**The decisive comparison:** Al Bahr — the largest kinetic facade ever built —
runs its actuators at **365 cycles/year** and still only claims a 15-year life.
NeuroSkin as shipped runs at **8,760 cycles/year**, roughly **24× Al Bahr's
duty**. At that rate a 30,000-cycle-qualified actuator reaches its tested limit
in **3.4 years**. Sustaining a 15-year life at 8,760 cycles/yr would require a
**131,400-cycle** rating, which no shading actuator is publicly qualified to.

### Maintenance-cost verification

No public source gives RM or £/m²/yr specifically for automated facade shading.
What exists:

- **BSRIA O&M benchmarking** — £23.17/m² GIA for *total* building maintenance,
  all types. Not shading-specific; useful only as an order-of-magnitude ceiling.
- **CIBSE Guide M10 *Costs* (2023)** and **BCIS Life Cycle Evaluator** hold the
  component-level life and cost data. Both are paywalled and neither has been
  consulted — this is the single highest-value purchase for defending the claim.
- A frequently-cited figure of €180–420/m² kinetic premium with 8–19 year payback
  and "3× maintenance touchpoints" circulates online, but the source is a vendor
  content page with no methodology. **Do not cite it.** It is listed here only so
  nobody re-finds it and mistakes it for evidence.

### Pilot building performance

- **New York Times HQ (LBNL, monitored)** — the best-documented real pilot of
  automated shading plus dimming. **38% lighting energy saving vs code, 4.1-year
  simple payback**; the 401 m² pre-construction mockup measured 20–23% and 52–59%
  savings by zone depth. 78% occupant satisfaction. This is the defensible
  comparator, and note that its savings are **lighting**, not cooling.
- **Al Bahr Towers** — the widely repeated "20% building / 50% office energy
  saving" is a **design projection, not a measurement**. The facility management
  company *refused to release any energy or comfort data*. Only 12 months of
  monitoring was done, in 2015, on a building opened in 2012. Commissioning was
  completed by the facade subcontractor **two years after the building was
  occupied**. Of 22 surveyed staff, **60% were uncomfortable with daylighting,
  principally because the automation gives them no manual override** — a direct
  warning for any fully-autonomous facade brain.
- **Performance gap literature** — across 62 buildings, measured vs predicted
  energy deviates by **+34% with a 55% standard deviation**, driven by
  specification uncertainty, occupant behaviour and poor operational practice.
  Any single-figure saving claim should carry this band.

---

## 5. Adapted calculation

Replace the asserted ratio with a cycle budget, because cycles are the unit the
hardware is actually rated in and the only one the simulator can measure.

```
replacements/yr   = fleet_size × (cycles_per_yr ÷ rated_cycles)
maintenance RM/yr = replacements/yr × all_in_replacement_cost
```

Fleet 64 zones; actuator rated 30,000 cycles (the Al Bahr qualification figure);
all-in replacement cost **RM 3,500** per unit including rope-access labour —
**this is the one undeclared input and it needs a supplier quote.**

| | Cycles/yr | Equivalent replacements/yr | Maintenance RM/yr |
|---|---|---|---|
| NeuroSkin, movement budget off (as shipped) | 8,760 | 18.7 | ≈ RM 65,000 |
| NeuroSkin, budget tuned to 6 moves/day | 2,190 | 4.7 | ≈ RM 16,000 |
| **Saving attributable to the movement budget** | | **14.0** | **≈ RM 49,000/yr** |

Payback on RM 300,000 of intelligence-layer CapEx, maintenance alone:
**≈ 6 years**, not 2.5. The energy line cannot legitimately be added back until
the relative load index is replaced by a metered or calibrated kWh figure, which
`docs/neuroskin_software_prd.md:103` currently forbids.

### What to claim instead

1. **Claim the mechanism, not a competitor's failure.** "A movement budget tuned
   to 6 actuations/day/zone cuts actuator cycles 4×, from 8,760 to 2,190 per
   year, while relative load changes by less than 0.0001 on the reference day."
   Every number there is measured and reproducible from the repo.
2. **State the duty target against a rating.** "Sized so a 30,000-cycle-qualified
   actuator meets a 15-year design life" — that is 2,000 cycles/yr, which the
   0.05 threshold already achieves.
3. **Drop "3× actuator life" and the RM 150,000 reactive baseline.** No reactive
   hunting controller is implemented, so there is no measurement behind either.
   The baseline that *is* implemented moves 2×/day and beats us on cycles.
4. **Report cooling as load shaved, never as RM.** Keep the honesty the software
   PRD already commits to; the maintenance case does not need the energy line.
5. **Add a manual-override commitment.** Al Bahr's 60% daylight dissatisfaction
   came from automation without override. This is cheap to promise and it is the
   clearest lesson available from the only comparable building in operation.

### Open items before this is quotable

- [ ] Supplier quote for actuator unit + access labour (the RM 3,500 placeholder)
- [ ] CIBSE Guide M10 / BCIS component life data for shading drives
- [ ] Cycle rating from the actually-specified actuator, tested per EN 14201
- [ ] Fleet-wide, multi-seed cycle instrumentation in the simulator
- [ ] Whether 6 moves/day/zone survives cloudier seeds than the reference day

---

## Sources

- [Evaluation of adaptive facades: Al Bahr Towers, UAE](https://www.glassonweb.com/article/evaluation-adaptive-facades-case-study-al-bahr-towers-uae)
- [Al Bahar Towers — Arup / FIDIC project summary](https://fidic.org/sites/default/files/5pages_Al%20Bahar%20Towers_Arup.pdf)
- [LBNL: Big Energy Savings in The New York Times Building](https://windows.lbl.gov/news/article/30598/big-energy-savings-in-the-new-york-times-building-confirmed-by-berkeley-lab-study)
- [LBNL: Post-Occupancy Monitored Evaluation, NYT Building](https://windows.lbl.gov/publications/post-occupancy-monitored-evaluation)
- [EN 14201 — Blinds and shutters: resistance to repeated operations](https://standards.iteh.ai/catalog/standards/cen/c0f9fff7-6f9c-49e8-9922-0e28c5e54832/en-14201-2004)
- [EN 13561 — External blinds: performance requirements including safety](https://standards.iteh.ai/catalog/standards/cen/68acf0fe-dae5-4d19-ac8c-c555c9f4e690/en-13561-2015)
- [United Enertech — motorized damper/actuator cycle testing](https://unitedenertech.com/news/todays-motorized-life-safety-damper-reliability)
- [LINAK — solar shading / louvre actuators](https://www.linak-us.com/business-areas/solar-shading/louvres/)
- [BSRIA — operation and maintenance benchmarking](https://www.bsria.com/uk/news/article/operation-and-maintenance-benchmarking-outputs-for-the-year/)
- [CIBSE Guide M10 Costs (2023)](https://www.cibse.org/knowledge-research/knowledge-portal/guide-m10-costs-2023/)
- [Predicted vs. actual energy performance of non-domestic buildings](https://www.sciencedirect.com/science/article/abs/pii/S0306261911007811)
- [Dynamic facades for sustainable buildings: a review](https://www.sciencedirect.com/science/article/pii/S2352484724003238)
