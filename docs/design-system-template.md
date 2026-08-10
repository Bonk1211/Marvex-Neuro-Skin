# NeuroSkin Frontend Design System

## Product intent

The interface is a judge-facing simulation proof, not an operations console.
The visual hierarchy should always make this sequence obvious:

1. State the claim.
2. Show the synthetic evidence.
3. Compare NeuroSkin with the naive baseline.
4. Explain the selected tick and its safety or cost rationale.

## Visual language

- `font-display` — headings and primary metric values.
- `font-sans` — body copy and controls.
- `font-mono` — timestamps and compact numeric telemetry.
- `forest` (`#092b24`) — control surfaces and the decision-brain identity.
- `mint` (`#5ee0b5`) — NeuroSkin actions, trust, and primary highlights.
- `sky` (`#65b9e8`) — almanac/reference data.
- Amber — warnings, naive comparison data, and annotated events.
- Rose — rejected readings and the unshadeable latent-load floor.

Use semantic Tailwind tokens (`background`, `foreground`, `card`, `border`,
`primary`, `muted`) for ordinary UI. Direct chart colors live together in
`SimulationCharts.tsx` because Recharts requires color strings.

## Evidence integrity

- Every chart carries a visible **Synthetic** badge and synthetic caption.
- Cooling load is always named a **relative cooling-load index** or proxy.
- Never display or infer HVAC kWh savings.
- Lux compliance is scoped to occupied ticks with at least 200 W/m² available
  daylight; load covers all occupied ticks; movements cover the full day.
- Event cards must jump the timeline inspector to the supporting tick.
- The explainability panel must show trust, mode, angle, reason, and normalized
  cost contributions. Safety overrides explain when the cost function was
  bypassed.

## Reusable patterns

- `surface-card` — white evidence or inspector surface.
- `metric-card` — headline KPI with a compact icon and definition.
- `control-panel` — dark input surface with explicit Run/Reset actions.
- `judge-brief` and `proof-flow` — claim and evidence sequence for each tier.
- `synthetic-badge` — mandatory provenance signal for visualized data.
- `event-card` — clickable fault/safety annotation.
- `tour-panel` and `tour-focus` — guided judge walkthrough.

The generic primitives under `frontend/src/components/ui` remain available for
future interface work, but the NeuroSkin dashboard components live under
`frontend/src/components/neuroskin`.

## Accessibility and responsive behavior

- All icon-only or abbreviated controls need an explicit accessible name.
- Keyboard focus must remain visible; the guided tour supports arrow keys and
  Escape.
- Scenario tabs scroll horizontally on small screens.
- The controls stack above evidence on small screens and become sticky on large
  screens.
- Loading, empty/error, and retry states should remain readable without charts.
