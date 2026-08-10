'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  CloudSun,
  Gauge,
  HelpCircle,
  Layers3,
  Leaf,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  SunMedium,
} from 'lucide-react'
import { runSimulation } from '@/lib/api-client'
import type {
  ScenarioName,
  SimulationRunRequest,
  SimulationRunResponse,
} from '@/lib/types'
import { SimulationCharts } from './SimulationCharts'
import { SimulationControls } from './SimulationControls'
import { GuidedTour } from './GuidedTour'

const DEFAULT_REQUEST: SimulationRunRequest = {
  scenario: 'overview',
  date: '2026-03-21',
  seed: 42,
  cloud_profile: 'scattered',
  occupancy_scale: 1,
  wind_override: 3,
  power_ok: true,
  weights: { thermal: 0.45, lux: 0.35, movement: 0.15, risk: 0.05 },
}

const tabs: Array<{
  value: ScenarioName
  label: string
  shortLabel: string
  icon: React.ElementType
}> = [
  {
    value: 'overview',
    label: 'Overview',
    shortLabel: 'Overview',
    icon: Layers3,
  },
  {
    value: 'lie_detector',
    label: 'Lie Detector',
    shortLabel: 'Tier 1',
    icon: SunMedium,
  },
  {
    value: 'co_optimization',
    label: 'Co-optimisation',
    shortLabel: 'Tier 2',
    icon: BrainCircuit,
  },
  {
    value: 'budget_failsafe',
    label: 'Safety & Movement',
    shortLabel: 'Tier 3',
    icon: ShieldCheck,
  },
]

const timeLabel = (timestamp: string) =>
  new Intl.DateTimeFormat('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(timestamp))

export function NeuroSkinDashboard() {
  const [request, setRequest] = useState(DEFAULT_REQUEST)
  const [data, setData] = useState<SimulationRunResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timelineIndex, setTimelineIndex] = useState(72)
  const [tourOpen, setTourOpen] = useState(false)
  const requestController = useRef<AbortController | null>(null)
  const tourPrompted = useRef(false)

  const execute = useCallback(async (nextRequest: SimulationRunRequest) => {
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    setLoading(true)
    setError(null)
    try {
      const response = await runSimulation(nextRequest, controller.signal)
      setData(response)
      const focusTime = response.annotations[0]?.timestamp
      const focusIndex = focusTime
        ? response.ticks.findIndex((tick) => tick.timestamp === focusTime)
        : Math.floor(response.ticks.length / 2)
      setTimelineIndex(Math.max(0, focusIndex))
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(
        cause instanceof Error
          ? cause.message
          : 'The simulation could not be loaded.'
      )
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void execute(DEFAULT_REQUEST)
    return () => requestController.current?.abort()
  }, [execute])

  const switchTab = useCallback(
    (scenario: ScenarioName) => {
      if (request.scenario === scenario) return
      const next = { ...request, scenario }
      setRequest(next)
      void execute(next)
    },
    [execute, request]
  )

  useEffect(() => {
    if (tourPrompted.current || loading || !data || error) return
    tourPrompted.current = true
    if (window.localStorage.getItem('neuroskin-tour-v1') === 'complete') return
    const timer = window.setTimeout(() => setTourOpen(true), 900)
    return () => window.clearTimeout(timer)
  }, [data, error, loading])

  const selectedTick =
    data?.ticks[Math.min(timelineIndex, Math.max(0, data.ticks.length - 1))]
  const costTotal = selectedTick
    ? Object.values(selectedTick.cost_breakdown).reduce(
        (sum, value) => sum + value,
        0
      )
    : 0
  const daytimeTicks = useMemo(
    () => data?.ticks.filter((tick) => tick.ghi > 20) ?? [],
    [data]
  )
  const trustedPercent = data?.ticks.length
    ? (data.ticks.filter((tick) => tick.sensor_trusted).length /
        data.ticks.length) *
      100
    : 0

  return (
    <main className='min-h-screen'>
      <header className='hero-shell' data-tour='hero'>
        <nav className='mx-auto flex max-w-[1600px] items-center justify-between px-5 py-5 lg:px-8'>
          <div className='flex items-center gap-3'>
            <div className='brand-mark'>
              <Leaf className='h-5 w-5' />
            </div>
            <div>
              <p className='font-display text-lg font-semibold tracking-tight text-white'>
                NeuroSkin
              </p>
              <p className='text-[10px] font-medium uppercase tracking-[0.22em] text-white/45'>
                Climate decision brain
              </p>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <div className='hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/65 md:flex'>
              <span className='status-pulse' />
              Deterministic engine · no ML
            </div>
            <button
              aria-label='Guided tour'
              className='tour-launch-button'
              type='button'
              onClick={() => setTourOpen(true)}
            >
              <HelpCircle className='h-4 w-4' />
              <span className='hidden sm:inline'>Guided tour</span>
              <span className='sm:hidden'>Tour</span>
            </button>
          </div>
        </nav>

        <div className='mx-auto grid max-w-[1600px] gap-8 px-5 pb-10 pt-6 lg:grid-cols-[1fr_auto] lg:px-8 lg:pb-14 lg:pt-10'>
          <div className='max-w-4xl'>
            <div className='mb-5 flex flex-wrap gap-2'>
              <span className='hero-pill'>
                <Sparkles className='h-3.5 w-3.5' /> Simulation proof
              </span>
              <span className='hero-pill'>
                <CloudSun className='h-3.5 w-3.5' /> Kuala Lumpur
              </span>
            </div>
            <h1 className='font-display text-4xl font-semibold leading-[1.04] tracking-[-0.04em] text-white sm:text-5xl lg:text-7xl'>
              A facade that can tell when the{' '}
              <span className='text-mint'>sensor is lying.</span>
            </h1>
            <p className='mt-5 max-w-2xl text-sm leading-7 text-white/60 sm:text-base'>
              Explore a modelled tropical day and inspect every angle
              decision—from solar cross-checks to co-optimisation and
              fail-shaded safety.
            </p>
          </div>
          <div className='hero-orbit' aria-hidden='true'>
            <div className='orbit-core'>
              <BrainCircuit className='h-10 w-10' />
            </div>
            <span className='orbit-dot orbit-dot-one' />
            <span className='orbit-dot orbit-dot-two' />
          </div>
        </div>
      </header>

      <div className='sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur-xl'>
        <div className='mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-5 py-3 lg:px-8'>
          {tabs.map((tab) => {
            const Icon = tab.icon
            const active = request.scenario === tab.value
            return (
              <button
                key={tab.value}
                aria-label={tab.label}
                className={active ? 'scenario-tab-active' : 'scenario-tab'}
                onClick={() => switchTab(tab.value)}
                type='button'
              >
                <Icon className='h-4 w-4' />
                <span className='hidden sm:inline'>{tab.label}</span>
                <span className='sm:hidden'>{tab.shortLabel}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className='mx-auto grid max-w-[1600px] gap-6 px-5 py-7 lg:grid-cols-[300px_minmax(0,1fr)] lg:px-8 lg:py-10'>
        <aside>
          <div className='lg:sticky lg:top-24' data-tour='controls'>
            <SimulationControls
              value={request}
              loading={loading}
              onChange={setRequest}
              onRun={() => void execute(request)}
              onReset={() => {
                const reset = { ...DEFAULT_REQUEST, scenario: request.scenario }
                setRequest(reset)
                void execute(reset)
              }}
            />
          </div>
        </aside>

        <section className='min-w-0 space-y-5' aria-live='polite'>
          {error ? (
            <ErrorState message={error} onRetry={() => void execute(request)} />
          ) : loading && !data ? (
            <LoadingState />
          ) : data ? (
            <>
              <div className='flex flex-col justify-between gap-4 md:flex-row md:items-end'>
                <div>
                  <p className='eyebrow'>Live model output</p>
                  <h2 className='mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl'>
                    {data.title}
                  </h2>
                  <p className='mt-2 max-w-3xl text-sm text-muted-foreground'>
                    {data.metadata.data_notice}
                  </p>
                </div>
                <div className='flex shrink-0 items-center gap-2 text-xs text-muted-foreground'>
                  {loading && (
                    <LoaderCircle className='h-4 w-4 animate-spin text-primary' />
                  )}
                  Seed {data.metadata.seed} · {data.metadata.tick_minutes}
                  -minute ticks
                </div>
              </div>

              <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                <MetricCard
                  icon={Gauge}
                  label='Mean relative load'
                  value={Number(data.summary.mean_relative_load).toFixed(3)}
                  detail='Proxy quantity'
                />
                <MetricCard
                  icon={Activity}
                  label='Facade movements'
                  value={String(data.summary.movement_count)}
                  detail={`Across ${data.summary.ticks} ticks`}
                />
                <MetricCard
                  icon={CheckCircle2}
                  label='Sensor trust'
                  value={`${trustedPercent.toFixed(1)}%`}
                  detail={`${data.summary.sensor_fault_ticks} fault ticks`}
                />
                <MetricCard
                  icon={CloudSun}
                  label='Daylight window'
                  value={`${daytimeTicks.length}`}
                  detail='Synthetic sunlit ticks'
                />
              </div>

              <JudgeBrief scenario={request.scenario} data={data} />

              {request.scenario === 'co_optimization' && (
                <ComparisonStrip data={data} />
              )}

              {data.annotations.length > 0 && (
                <div className='grid gap-3 md:grid-cols-2' data-tour='events'>
                  {data.annotations.map((annotation) => (
                    <button
                      key={`${annotation.kind}-${annotation.timestamp}`}
                      className='event-card text-left'
                      type='button'
                      onClick={() => {
                        const index = data.ticks.findIndex(
                          (tick) => tick.timestamp === annotation.timestamp
                        )
                        if (index >= 0) setTimelineIndex(index)
                      }}
                    >
                      <div className='event-icon'>
                        <AlertTriangle className='h-4 w-4' />
                      </div>
                      <div>
                        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                          <h3 className='text-sm font-semibold'>
                            {annotation.title}
                          </h3>
                          <span className='font-mono text-[11px] text-muted-foreground'>
                            {timeLabel(annotation.timestamp)}
                          </span>
                        </div>
                        <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
                          {annotation.detail}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div data-tour='evidence'>
                <SimulationCharts
                  scenario={request.scenario}
                  ticks={data.ticks}
                  annotations={data.annotations}
                />
              </div>

              {selectedTick && (
                <div
                  className='grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.7fr)]'
                  data-tour='explainability'
                >
                  <section className='surface-card p-5 sm:p-6'>
                    <div className='flex flex-col justify-between gap-4 sm:flex-row sm:items-center'>
                      <div>
                        <p className='eyebrow'>Timeline inspector</p>
                        <h3 className='mt-1 font-display text-xl font-semibold'>
                          {timeLabel(selectedTick.timestamp)} MYT
                        </h3>
                      </div>
                      <div className='flex items-center gap-2'>
                        <StatusBadge mode={selectedTick.mode} />
                        <span
                          className={
                            selectedTick.sensor_trusted
                              ? 'trust-badge'
                              : 'fault-badge'
                          }
                        >
                          {selectedTick.sensor_trusted
                            ? 'Sensor trusted'
                            : 'Sensor rejected'}
                        </span>
                      </div>
                    </div>
                    <input
                      aria-label='Simulation timeline'
                      className='timeline-range mt-7'
                      type='range'
                      min={0}
                      max={Math.max(0, data.ticks.length - 1)}
                      value={timelineIndex}
                      onChange={(event) =>
                        setTimelineIndex(Number(event.target.value))
                      }
                    />
                    <div className='mt-2 flex justify-between font-mono text-[10px] text-muted-foreground'>
                      <span>00:00</span>
                      <span>06:00</span>
                      <span>12:00</span>
                      <span>18:00</span>
                      <span>23:50</span>
                    </div>
                    <div className='mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4'>
                      <TickStat
                        label='Final angle'
                        value={`${selectedTick.angle_final.toFixed(0)}°`}
                      />
                      <TickStat
                        label='Target angle'
                        value={`${selectedTick.angle_target.toFixed(0)}°`}
                      />
                      <TickStat
                        label='Indoor light'
                        value={`${selectedTick.lux.toFixed(0)} lux`}
                      />
                      <TickStat
                        label='Relative load'
                        value={selectedTick.load_relative.toFixed(3)}
                      />
                    </div>
                  </section>

                  <section className='explain-card'>
                    <div className='flex items-center gap-3'>
                      <div className='explain-icon'>
                        <BrainCircuit className='h-5 w-5' />
                      </div>
                      <div>
                        <p className='text-[10px] font-semibold uppercase tracking-[0.18em] text-mint'>
                          Why this angle?
                        </p>
                        <h3 className='text-sm font-semibold text-white'>
                          Decision explanation
                        </h3>
                      </div>
                    </div>
                    <p className='mt-5 text-sm leading-6 text-white/70'>
                      {selectedTick.reason}
                    </p>
                    {costTotal > 0 ? (
                      <div className='mt-5 space-y-3'>
                        <p className='text-[10px] font-semibold uppercase tracking-wider text-white/35'>
                          Normalized cost contribution
                        </p>
                        {Object.entries(selectedTick.cost_breakdown).map(
                          ([key, value]) => (
                            <CostBar
                              key={key}
                              label={key}
                              value={value}
                              total={costTotal}
                            />
                          )
                        )}
                      </div>
                    ) : (
                      <div className='mt-5 rounded-xl border border-mint/15 bg-mint/5 p-3 text-xs leading-5 text-white/55'>
                        The cost function was bypassed. A safety rule directly
                        selected this angle.
                      </div>
                    )}
                  </section>
                </div>
              )}

              <ScenarioPager scenario={request.scenario} onChange={switchTab} />
            </>
          ) : null}
        </section>
      </div>

      <footer className='border-t border-border/70 px-5 py-6 text-center text-xs text-muted-foreground'>
        Modelled Kuala Lumpur day · synthetic environmental data · cooling load
        shown only as a relative proxy
      </footer>
      <GuidedTour
        open={tourOpen}
        loading={loading}
        scenario={request.scenario}
        onOpenChange={setTourOpen}
        onScenarioChange={switchTab}
      />
    </main>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ElementType
  label: string
  value: string
  detail: string
}) {
  return (
    <article className='metric-card'>
      <div className='metric-icon'>
        <Icon className='h-4 w-4' />
      </div>
      <p className='mt-5 text-xs font-medium text-muted-foreground'>{label}</p>
      <p className='mt-1 font-display text-2xl font-semibold tracking-tight'>
        {value}
      </p>
      <p className='mt-1 text-[11px] text-muted-foreground'>{detail}</p>
    </article>
  )
}

function ComparisonStrip({ data }: { data: SimulationRunResponse }) {
  return (
    <section className='surface-card p-5' data-tour='comparison'>
      <div className='mb-4 flex items-center justify-between gap-3'>
        <div>
          <p className='eyebrow'>Same day, two strategies</p>
          <h3 className='mt-1 font-display text-lg font-semibold'>
            Outcome comparison
          </h3>
        </div>
        <span className='synthetic-badge'>Synthetic benchmark</span>
      </div>
      <p className='mb-4 text-xs leading-5 text-muted-foreground'>
        Lux compliance uses occupied ticks with at least 200 W/m² available
        daylight. Relative load uses every occupied tick; movement uses the full
        day.
      </p>
      <div className='grid gap-3 md:grid-cols-3'>
        {data.comparison.map((metric) => {
          const oursBetter = metric.higher_is_better
            ? metric.ours > metric.naive
            : metric.ours < metric.naive
          return (
            <div
              key={metric.metric}
              className={
                oursBetter
                  ? 'comparison-cell comparison-win'
                  : 'comparison-cell'
              }
            >
              <div className='flex items-center justify-between gap-2'>
                <p className='text-xs font-medium text-muted-foreground'>
                  {metric.label}
                </p>
                {oursBetter && <span className='winner-badge'>Better</span>}
              </div>
              <div className='mt-3 flex items-end justify-between gap-3'>
                <div>
                  <p className='text-[10px] uppercase tracking-wider text-primary'>
                    NeuroSkin
                  </p>
                  <p className='font-display text-xl font-semibold'>
                    {metric.ours}{' '}
                    <span className='text-xs font-normal text-muted-foreground'>
                      {metric.unit}
                    </span>
                  </p>
                </div>
                <div className='text-right'>
                  <p className='text-[10px] uppercase tracking-wider text-muted-foreground'>
                    Naive
                  </p>
                  <p className='font-display text-lg text-muted-foreground'>
                    {metric.naive}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

const scenarioBriefs: Record<
  ScenarioName,
  { kicker: string; title: string; body: string; proof: string[] }
> = {
  overview: {
    kicker: 'How to judge the proof',
    title: 'Three demonstrations, one decision loop',
    body: 'Start with sensor truth, compare the multi-objective outcome, then verify that safety and actuator life outrank optimisation.',
    proof: [
      'Truth before action',
      'One shared objective',
      'Safety before optimisation',
    ],
  },
  lie_detector: {
    kicker: 'USP · Fault-aware sensing',
    title: 'A low reading is not automatically darkness',
    body: 'NeuroSkin checks the irradiance sensor against sun position and cloud state. Clear-sky contradiction means fault; heavy cloud means genuine gating.',
    proof: [
      'Sensor-only naive baseline',
      'Solar almanac cross-check',
      'Cloud-aware disambiguation',
    ],
  },
  co_optimization: {
    kicker: 'USP · One decision objective',
    title: 'Comfort, load, movement, and risk are solved together',
    body: 'Both strategies see the same seeded tropical day. NeuroSkin searches allowable angles and exposes every normalized cost term.',
    proof: [
      'Same synthetic day',
      'Four normalized costs',
      'Three outcome measures',
    ],
  },
  budget_failsafe: {
    kicker: 'USP · Operational maturity',
    title: 'The brain never outranks safety',
    body: 'Marginal gains do not spend actuator life. Power loss moves to the passive shaded geometry; powered wind or rain protection retracts flat.',
    proof: ['Marginal move → HOLD', 'Power loss → 60°', 'Wind or rain → 0°'],
  },
}

function JudgeBrief({
  scenario,
  data,
}: {
  scenario: ScenarioName
  data: SimulationRunResponse
}) {
  const brief = scenarioBriefs[scenario]
  const faultTick = data.ticks.find((tick) => !tick.sensor_trusted)
  const proof =
    scenario === 'lie_detector' && faultTick
      ? [
          `Sensor ${faultTick.measured_irradiance.toFixed(0)} W/m²`,
          `Expected ${faultTick.expected_ghi.toFixed(0)} W/m²`,
          'Sensor rejected',
        ]
      : brief.proof

  return (
    <section className='judge-brief' data-tour='scenario-story'>
      <div>
        <p className='eyebrow'>{brief.kicker}</p>
        <h3 className='mt-1 font-display text-xl font-semibold tracking-tight'>
          {brief.title}
        </h3>
        <p className='mt-2 max-w-3xl text-sm leading-6 text-muted-foreground'>
          {brief.body}
        </p>
      </div>
      <div className='proof-flow' aria-label='Proof sequence'>
        {proof.map((item, index) => (
          <div key={item} className='contents'>
            <span className='proof-chip'>{item}</span>
            {index < proof.length - 1 && (
              <span className='proof-arrow' aria-hidden='true'>
                →
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function ScenarioPager({
  scenario,
  onChange,
}: {
  scenario: ScenarioName
  onChange: (scenario: ScenarioName) => void
}) {
  const currentIndex = tabs.findIndex((tab) => tab.value === scenario)
  const previous = tabs[currentIndex - 1]
  const next = tabs[currentIndex + 1]
  return (
    <nav className='scenario-pager' aria-label='Demo navigation'>
      <button
        type='button'
        disabled={!previous}
        onClick={() => previous && onChange(previous.value)}
      >
        <span className='text-[10px] uppercase tracking-wider text-muted-foreground'>
          Previous
        </span>
        <span>{previous?.label ?? 'Start'}</span>
      </button>
      <span className='font-mono text-[11px] text-muted-foreground'>
        {currentIndex + 1} / {tabs.length}
      </span>
      <button
        className='text-right'
        type='button'
        disabled={!next}
        onClick={() => next && onChange(next.value)}
      >
        <span className='text-[10px] uppercase tracking-wider text-muted-foreground'>
          Next proof
        </span>
        <span>{next?.label ?? 'Complete'}</span>
      </button>
    </nav>
  )
}

function TickStat({ label, value }: { label: string; value: string }) {
  return (
    <div className='tick-stat'>
      <p className='text-[10px] uppercase tracking-wider text-muted-foreground'>
        {label}
      </p>
      <p className='mt-1 font-mono text-sm font-semibold'>{value}</p>
    </div>
  )
}

function StatusBadge({ mode }: { mode: string }) {
  return (
    <span
      className={
        mode === 'SAFE'
          ? 'safe-badge'
          : mode === 'HOLD'
            ? 'hold-badge'
            : 'normal-badge'
      }
    >
      {mode}
    </span>
  )
}

function CostBar({
  label,
  value,
  total,
}: {
  label: string
  value: number
  total: number
}) {
  const percent = total > 0 ? (value / total) * 100 : 0
  return (
    <div>
      <div className='mb-1.5 flex items-center justify-between text-[11px] capitalize text-white/55'>
        <span>{label}</span>
        <span className='font-mono'>{value.toFixed(3)}</span>
      </div>
      <div className='h-1.5 overflow-hidden rounded-full bg-white/10'>
        <div
          className='h-full rounded-full bg-mint transition-all'
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className='surface-card flex min-h-[520px] flex-col items-center justify-center p-10 text-center'>
      <LoaderCircle className='h-8 w-8 animate-spin text-primary' />
      <h2 className='mt-4 font-display text-xl font-semibold'>
        Modelling the tropical day
      </h2>
      <p className='mt-2 text-sm text-muted-foreground'>
        Resolving solar position, cloud events, safety gates, and controller
        costs.
      </p>
    </div>
  )
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className='surface-card flex min-h-[420px] flex-col items-center justify-center p-10 text-center'>
      <div className='rounded-full bg-red-50 p-3 text-red-600'>
        <AlertTriangle className='h-6 w-6' />
      </div>
      <h2 className='mt-4 font-display text-xl font-semibold'>
        Simulation API unavailable
      </h2>
      <p className='mt-2 max-w-lg text-sm text-muted-foreground'>
        {message} Confirm the FastAPI service is running on port 8000.
      </p>
      <button className='retry-button mt-5' onClick={onRetry} type='button'>
        Try again
      </button>
    </div>
  )
}
