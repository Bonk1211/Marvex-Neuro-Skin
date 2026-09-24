'use client'

import {
  BrainCircuit,
  CheckCircle2,
  LoaderCircle,
  Play,
  ShieldCheck,
  SunMedium,
  Waves,
  X,
} from 'lucide-react'
import type { ScenarioName, SimulationRunResponse } from '@/lib/types'

export type TierStatus = 'pending' | 'running' | 'done' | 'failed'

export interface TierStep {
  scenario: ScenarioName
  tier: string
  label: string
  /** What the run is doing while it is running. */
  action: string
  /** Why this step exists, in one line. */
  why: string
  icon: React.ElementType
}

/**
 * The three tiers, in the order they have to run: a controller cannot be judged
 * on optimisation before you know whether it believed its own sensor, and it
 * cannot be judged on safety before it has something to hold back.
 */
export const TIER_STEPS: TierStep[] = [
  {
    scenario: 'overview',
    tier: 'Input',
    label: 'Read sensor stream',
    action:
      'Pulling 72 ticks (07:00-19:00) of irradiance, wind, temperature and occupancy.',
    why: 'Every tier below reads the same day, so the three are comparable.',
    icon: Waves,
  },
  {
    scenario: 'lie_detector',
    tier: 'Test 1',
    label: 'Sensor trust',
    action: 'Checking each pyranometer reading against the solar almanac.',
    why: 'A controller that trusts a broken sensor optimises against fiction.',
    icon: SunMedium,
  },
  {
    scenario: 'co_optimization',
    tier: 'Test 2',
    label: 'Co-optimisation',
    action: 'Running the cost optimiser against a naive threshold controller.',
    why: 'Heat, daylight, movement and wind risk are traded in one objective.',
    icon: BrainCircuit,
  },
  {
    scenario: 'budget_failsafe',
    tier: 'Test 3',
    label: 'Budget and fail-safe',
    action: 'Squeezing the movement budget and cutting power mid-afternoon.',
    why: 'Restraint and a safe resting position matter more than a clever angle.',
    icon: ShieldCheck,
  },
]

/** The numbers that make this step's point, pulled from its own run. */
export function tierFindings(
  step: TierStep,
  response: SimulationRunResponse
): string[] {
  const trusted = response.ticks.filter((tick) => tick.sensor_trusted).length
  const share = response.ticks.length
    ? (trusted / response.ticks.length) * 100
    : 0
  const unit = (metric: { unit: string }) =>
    metric.unit.length <= 1 ? '' : ' '
  switch (step.scenario) {
    case 'overview':
      return [
        `${response.ticks.length} ticks from ${response.metadata.location}`,
        `Source: ${response.metadata.environment_source.replace('_', ' ')}, seed ${response.metadata.seed}`,
        `Mean cooling load ${Number(response.summary.mean_relative_load).toFixed(3)}`,
      ]
    case 'lie_detector':
      return [
        `${response.summary.sensor_fault_ticks} readings rejected as impossible`,
        `${share.toFixed(0)}% of the day ran on the trusted sensor`,
        response.annotations[0]?.title ?? 'No almanac disagreement today',
      ]
    case 'co_optimization':
      return response.comparison.length
        ? response.comparison.map(
            (metric) =>
              `${metric.label}: ${metric.ours}${unit(metric)}${metric.unit} vs ${metric.naive}${unit(metric)}${metric.unit} naive`
          )
        : ['No comparison returned for this run']
    case 'budget_failsafe':
      return [
        `${response.summary.movement_count} louvre movements across the day`,
        `${response.summary.safe_mode_ticks} ticks held in SAFE`,
        response.annotations.at(-1)?.title ?? 'No safety event triggered',
      ]
    default:
      return []
  }
}

/**
 * The run list: one row per tier, each showing where the analysis has got to.
 * Finished rows stay clickable, so the dashboard can be pointed back at any
 * tier's result without running it again.
 */
export function TierRunner({
  statuses,
  results,
  active,
  running,
  onRun,
  onTracking,
  onSelect,
}: {
  statuses: Partial<Record<ScenarioName, TierStatus>>
  results: Partial<Record<ScenarioName, SimulationRunResponse>>
  active: ScenarioName | null
  running: boolean
  onRun: () => void
  onTracking: () => void
  onSelect: (scenario: ScenarioName) => void
}) {
  const done = TIER_STEPS.filter(
    (step) => statuses[step.scenario] === 'done'
  ).length

  return (
    <section className='console-card' aria-label='Scenario comparisons'>
      <div className='flex items-center justify-between gap-2'>
        <p className='console-card-title'>West facade solar tracking</p>
      </div>

      <button
        className='run-button mt-2'
        disabled={running}
        onClick={onTracking}
        type='button'
      >
        {running ? (
          <LoaderCircle className='h-3.5 w-3.5 animate-spin' />
        ) : (
          <Play className='h-3.5 w-3.5' />
        )}
        {running ? 'Running analysis' : 'Run simulation'}
      </button>
      <p className='mt-2 text-[10px] text-muted-foreground'>
        Clear day · healthy sensors · calm wind. Angles gradually follow the
        sun: 0° overhead, 90° at a 45° sun profile, approaching 180° near
        sunset.
      </p>
      <button
        className='rail-action mt-2'
        disabled={running}
        onClick={onRun}
        type='button'
      >
        Run diagnostic tests
      </button>
      <p className='mt-1 text-[9px] text-muted-foreground'>
        {done}/{TIER_STEPS.length} complete
      </p>

      <ol className='mt-2 flex flex-col gap-1'>
        {TIER_STEPS.map((step) => {
          const status = statuses[step.scenario] ?? 'pending'
          const Icon = step.icon
          const result = results[step.scenario]
          return (
            <li key={step.scenario}>
              <button
                aria-current={active === step.scenario ? 'step' : undefined}
                className={
                  active === step.scenario ? 'tier-step-active' : 'tier-step'
                }
                disabled={status !== 'done'}
                onClick={() => onSelect(step.scenario)}
                type='button'
              >
                <span className='tier-step-icon'>
                  {status === 'running' ? (
                    <LoaderCircle className='h-3 w-3 animate-spin' />
                  ) : status === 'done' ? (
                    <CheckCircle2 className='h-3 w-3' />
                  ) : (
                    <Icon className='h-3 w-3' />
                  )}
                </span>
                <span className='min-w-0 text-left'>
                  <span className='block text-[9px] uppercase tracking-wider text-muted-foreground'>
                    {step.tier}
                  </span>
                  <span className='block truncate text-[11px] font-semibold'>
                    {step.label}
                  </span>
                </span>
                <span className='ml-auto text-[9px] text-muted-foreground'>
                  {status === 'running'
                    ? 'running'
                    : status === 'done'
                      ? 'done'
                      : status === 'failed'
                        ? 'failed'
                        : 'waiting'}
                </span>
              </button>

              {/* Every finished tier keeps its findings on the page, so the
                  three read as one analysis rather than three sub-pages. */}
              {status === 'done' && result && (
                <details
                  className='mb-1 ml-7 mt-1 text-[10px]'
                  open={active === step.scenario}
                >
                  <summary className='cursor-pointer text-muted-foreground'>
                    Run findings
                  </summary>
                  <ul className='mt-1 flex flex-col gap-0.5'>
                    {tierFindings(step, result).map((finding) => (
                      <li
                        className='flex gap-1.5 text-[10px] leading-snug text-muted-foreground'
                        key={finding}
                      >
                        <span aria-hidden className='text-primary'>
                          ·
                        </span>
                        <span>{finding}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/**
 * Floating explanation over the 3D model: what this tier is doing while it runs,
 * and what it found once it has.
 */
export function TierCard({
  step,
  status,
  response,
  onDismiss,
}: {
  step: TierStep
  status: TierStatus
  response: SimulationRunResponse | undefined
  onDismiss: () => void
}) {
  const Icon = step.icon
  const findings =
    response && status === 'done' ? tierFindings(step, response) : []

  return (
    <aside
      aria-live='polite'
      aria-label={`${step.tier} explanation`}
      className='tier-card'
    >
      <div className='flex items-start gap-2'>
        <span className='tier-step-icon'>
          {status === 'running' ? (
            <LoaderCircle className='h-3 w-3 animate-spin' />
          ) : (
            <Icon className='h-3 w-3' />
          )}
        </span>
        <div className='min-w-0'>
          <p className='text-[9px] uppercase tracking-wider text-muted-foreground'>
            {step.tier}
          </p>
          <p className='text-[12px] font-semibold leading-tight'>
            {step.label}
          </p>
        </div>
        <button
          aria-label='Dismiss explanation'
          className='ml-auto rounded p-0.5 text-muted-foreground hover:bg-secondary'
          onClick={onDismiss}
          type='button'
        >
          <X className='h-3 w-3' />
        </button>
      </div>

      <p className='mt-1.5 text-[10px] leading-snug text-muted-foreground'>
        {status === 'done' ? step.why : step.action}
      </p>

      {findings.length > 0 && (
        <ul className='mt-1.5 flex flex-col gap-0.5'>
          {findings.map((finding) => (
            <li className='flex gap-1.5 text-[10px] leading-snug' key={finding}>
              <span aria-hidden className='text-primary'>
                ·
              </span>
              <span>{finding}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
