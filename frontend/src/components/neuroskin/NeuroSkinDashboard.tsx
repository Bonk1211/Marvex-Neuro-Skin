'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BatteryCharging,
  CheckCircle2,
  Leaf,
  LoaderCircle,
  Pause,
  Play,
  ShieldCheck,
} from 'lucide-react'
import { runSimulation } from '@/lib/api-client'
import type {
  ComparisonMetric,
  FacadeOrientation,
  ScenarioName,
  SimulationRunRequest,
  SimulationRunResponse,
} from '@/lib/types'
import { BuildingHeatmap, FacadeReadout } from './BuildingHeatmap'
import type { SurfaceId } from './BuildingHeatmap'
import { ControllerPanel } from './ControllerPanel'
import { SimulationCharts } from './SimulationCharts'
import { SimulationControls } from './SimulationControls'
import { TIER_STEPS, TierCard, TierRunner } from './TierAnalysis'
import type { TierStatus } from './TierAnalysis'

const DEFAULT_REQUEST: SimulationRunRequest = {
  scenario: 'overview',
  date: '2026-03-21',
  seed: 42,
  environment_source: 'synthetic',
  cloud_profile: 'scattered',
  occupancy_scale: 1,
  wind_override: 3,
  power_ok: true,
  weights: { thermal: 0.45, lux: 0.35, movement: 0.15, risk: 0.05 },
  latitude: 2.922,
  longitude: 101.6885,
  timezone: 'Asia/Kuala_Lumpur',
  location_name: 'ST Diamond Building, Putrajaya',
  facade_orientation: 'west',
  facade_tilt: 115,
  roof_pitch: 10,
}

const sourceLabels: Record<SimulationRunRequest['environment_source'], string> =
  {
    synthetic: 'Synthetic',
    met_anchored: 'MET anchored',
    open_meteo: 'Open-Meteo',
  }

/** How long a finished tier stays on screen before the next one starts. */
const STEP_PAUSE_MS = 700

// One tick every 45 ms walks the 144-tick day in about 6.5 seconds, which is
// slow enough to read the sun across the sky and fast enough to sit through.
const PLAY_INTERVAL_MS = 45

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })

/** Drag bar between a rail and the stage. Writes the width straight to CSS. */
function RailHandle({
  side,
  label,
}: {
  side: 'left' | 'right'
  label: string
}) {
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget
    const rail =
      side === 'left'
        ? handle.previousElementSibling
        : handle.nextElementSibling
    const shell = handle.closest('.console-shell')
    if (!(rail instanceof HTMLElement) || !(shell instanceof HTMLElement))
      return
    const edge = rail.getBoundingClientRect()
    handle.setPointerCapture(event.pointerId)

    const move = (pointer: PointerEvent) => {
      const width =
        side === 'left'
          ? pointer.clientX - edge.left
          : edge.right - pointer.clientX
      const clamped = Math.min(Math.max(width, 240), window.innerWidth * 0.45)
      shell.style.setProperty(`--rail-${side}`, `${Math.round(clamped)}px`)
    }
    const stop = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
  }

  return (
    <div
      aria-label={label}
      aria-orientation='vertical'
      className='rail-handle'
      onPointerDown={onPointerDown}
      role='separator'
    />
  )
}

const timeLabel = (timestamp: string, timeZone = 'Asia/Kuala_Lumpur') =>
  new Intl.DateTimeFormat('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(timestamp))

export function NeuroSkinDashboard() {
  const [request, setRequest] = useState(DEFAULT_REQUEST)
  const [data, setData] = useState<SimulationRunResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timelineIndex, setTimelineIndex] = useState(72)
  const [selectedWall, setSelectedWall] = useState<SurfaceId>(
    `wall:${DEFAULT_REQUEST.facade_orientation}`
  )
  // The three-tier run: one stored result per tier, so a finished tier can be
  // revisited without paying for it again.
  const [tierStatus, setTierStatus] = useState<
    Partial<Record<ScenarioName, TierStatus>>
  >({})
  const [tierResults, setTierResults] = useState<
    Partial<Record<ScenarioName, SimulationRunResponse>>
  >({})
  const [activeTier, setActiveTier] = useState<ScenarioName | null>(null)
  const [tierRunning, setTierRunning] = useState(false)
  const [cardDismissed, setCardDismissed] = useState(false)
  // Clock playback: walks the timeline so the sun crosses the sky on the real
  // solar positions the run returned.
  const [playing, setPlaying] = useState(false)
  const requestController = useRef<AbortController | null>(null)

  const tickCount = data?.ticks.length ?? 0
  useEffect(() => {
    if (!playing || tickCount < 2) return
    const timer = setInterval(
      () => setTimelineIndex((index) => (index + 1) % tickCount),
      PLAY_INTERVAL_MS
    )
    return () => clearInterval(timer)
  }, [playing, tickCount])

  /** Point the stage, timeline and charts at one run's result. */
  const focusOn = useCallback((response: SimulationRunResponse) => {
    setData(response)
    const focusTime = response.annotations[0]?.timestamp
    const focusIndex = focusTime
      ? response.ticks.findIndex((tick) => tick.timestamp === focusTime)
      : Math.floor(response.ticks.length / 2)
    setTimelineIndex(Math.max(0, focusIndex))
  }, [])

  const execute = useCallback(
    async (nextRequest: SimulationRunRequest) => {
      requestController.current?.abort()
      const controller = new AbortController()
      requestController.current = controller
      setLoading(true)
      setError(null)
      try {
        const response = await runSimulation(nextRequest, controller.signal)
        focusOn(response)
        return response
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
    },
    [focusOn]
  )

  useEffect(() => {
    // The first load is the sensor read, so the analysis opens with that step
    // already banked and the three tiers waiting on the run button.
    void execute(DEFAULT_REQUEST).then((response) => {
      if (!response) return
      setTierResults((prev) => ({ ...prev, overview: response }))
      setTierStatus((prev) => ({ ...prev, overview: 'done' }))
    })
    return () => requestController.current?.abort()
  }, [execute])

  /**
   * The three-tier analysis: one run per tier, in order, with the dashboard
   * following each result as it lands. Sequential on purpose — the point is to
   * watch the tiers happen, and they read the same day so a reader can compare.
   */
  const runTiers = useCallback(async () => {
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    setTierRunning(true)
    setCardDismissed(false)
    setError(null)
    setTierResults({})
    setTierStatus({})
    // Run the clock for the whole analysis: the sun keeps crossing the sky on
    // each tier's own solar data while the next tier is still being computed.
    setTimelineIndex(0)
    setPlaying(true)

    try {
      let last: SimulationRunResponse | null = null
      for (const step of TIER_STEPS) {
        setActiveTier(step.scenario)
        setTierStatus((prev) => ({ ...prev, [step.scenario]: 'running' }))
        setLoading(true)
        const response = await runSimulation(
          { ...request, scenario: step.scenario },
          controller.signal
        )
        if (controller.signal.aborted) return
        last = response
        setTierResults((prev) => ({ ...prev, [step.scenario]: response }))
        setTierStatus((prev) => ({ ...prev, [step.scenario]: 'done' }))
        setRequest((prev) => ({ ...prev, scenario: step.scenario }))
        // Swap the data under the running clock rather than jumping the time.
        setData(response)
        setLoading(false)
        // Let the step land on screen before the next one starts.
        await pause(STEP_PAUSE_MS, controller.signal)
      }
      // Settle on the last tier's own event once the day has been walked.
      setPlaying(false)
      if (last) focusOn(last)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setTierStatus((prev) => {
        const failed = TIER_STEPS.find(
          (step) => prev[step.scenario] === 'running'
        )
        return failed ? { ...prev, [failed.scenario]: 'failed' } : prev
      })
      setError(
        cause instanceof Error
          ? cause.message
          : 'The simulation could not be loaded.'
      )
    } finally {
      if (!controller.signal.aborted) {
        setTierRunning(false)
        setPlaying(false)
        setLoading(false)
      }
    }
  }, [focusOn, request])

  const focusTier = useCallback(
    (scenario: ScenarioName) => {
      setActiveTier(
        TIER_STEPS.some((step) => step.scenario === scenario) ? scenario : null
      )
      setCardDismissed(false)
      // A tier already run is shown from its stored result, not fetched again.
      const stored = tierResults[scenario]
      if (stored) {
        setRequest((prev) => ({ ...prev, scenario }))
        focusOn(stored)
        return
      }
      if (request.scenario === scenario) return
      // A tier opened before the full analysis has run banks its result too, so
      // the run list always reflects everything that has actually been computed.
      const next = { ...request, scenario }
      setRequest(next)
      setTierStatus((prev) => ({ ...prev, [scenario]: 'running' }))
      void execute(next).then((response) => {
        setTierStatus((prev) => ({
          ...prev,
          [scenario]: response ? 'done' : 'failed',
        }))
        if (response)
          setTierResults((prev) => ({ ...prev, [scenario]: response }))
      })
    },
    [execute, focusOn, request, tierResults]
  )

  const activeStep = TIER_STEPS.find((step) => step.scenario === activeTier)
  // Every tier that has run, with its own charts. The sensor read is left out:
  // its chart set is the same load-and-position pair the tiers already carry.
  const tierCharts = TIER_STEPS.filter(
    (step) => step.scenario !== 'overview'
  ).flatMap((step) => {
    const response = tierResults[step.scenario]
    return response ? [{ step, response }] : []
  })

  // The sun's real path for this run, drawn as an arc the marker rides along.
  const sunTrack = useMemo(
    () =>
      data?.ticks.map(
        (tick) => [tick.solar_azimuth, tick.solar_elevation] as [number, number]
      ),
    [data]
  )
  const selectedTick =
    data?.ticks[Math.min(timelineIndex, Math.max(0, data.ticks.length - 1))]
  const trustedPercent = data?.ticks.length
    ? (data.ticks.filter((tick) => tick.sensor_trusted).length /
        data.ticks.length) *
      100
    : 0
  const zone = data?.metadata.timezone
  const [selectedKind, selectedOrientation] = selectedWall.split(':') as [
    'wall' | 'roof',
    FacadeOrientation,
  ]
  const selectedWallState =
    selectedKind === 'wall'
      ? selectedTick?.facade?.find(
          (wall) => wall.orientation === selectedOrientation
        )
      : undefined
  const selectedRoofState =
    selectedKind === 'roof'
      ? selectedTick?.roof?.find(
          (segment) => segment.quadrant === selectedOrientation
        )
      : undefined

  return (
    <div className='console-shell'>
      <nav className='console-nav' aria-label='Console'>
        <div className='brand-mark h-10 w-10 shrink-0 rounded-xl'>
          <Leaf className='h-4 w-4' />
        </div>
        <Link
          aria-label='Predictive slab charging'
          className='console-nav-button'
          href='/slab'
          title='7.1 Predictive radiant-slab charging'
        >
          <BatteryCharging className='h-4 w-4' />
        </Link>
        <div className='ml-auto xl:ml-0 xl:mt-auto'>
          <Link
            aria-label='Project overview'
            className='console-nav-button'
            href='/'
            title='Project overview'
          >
            <ArrowLeft className='h-4 w-4' />
          </Link>
        </div>
      </nav>

      <aside
        className='console-rail console-rail-left'
        aria-label='Simulation results'
        aria-live='polite'
      >
        <header className='flex items-start justify-between gap-3 px-1'>
          <div>
            <p className='eyebrow'>24-hour result</p>
            <h1 className='mt-0.5 font-display text-lg font-semibold tracking-tight'>
              Three-tier analysis
            </h1>
            {activeStep && (
              <p className='text-[10px] text-muted-foreground'>
                Stage showing {activeStep.tier} · {activeStep.label}
              </p>
            )}
          </div>
          <div className='flex flex-col items-end gap-1 text-[9px] text-muted-foreground'>
            <span className='flex items-center gap-1.5'>
              <span
                className={
                  loading
                    ? 'status-pulse'
                    : 'h-2 w-2 rounded-full bg-emerald-500'
                }
              />
              {loading ? 'Running' : 'Ready'}
            </span>
            {data && (
              <span className='flex items-center gap-1'>
                <span>{sourceLabels[data.metadata.environment_source]}</span>
                <span>· seed {data.metadata.seed}</span>
              </span>
            )}
          </div>
        </header>

        <div data-tour='scenario-tabs'>
          <TierRunner
            statuses={tierStatus}
            results={tierResults}
            active={activeTier}
            running={tierRunning}
            onRun={() => void runTiers()}
            onSelect={focusTier}
          />
        </div>

        {data && (
          <>
            <div className='grid grid-cols-3 gap-2' data-tour='kpi-grid'>
              <GaugeCard
                icon={Activity}
                label='Mean load'
                display={Number(data.summary.mean_relative_load).toFixed(3)}
                fraction={Number(data.summary.mean_relative_load)}
                detail='Lower better'
              />
              <GaugeCard
                icon={CheckCircle2}
                label='Sensor trust'
                display={`${trustedPercent.toFixed(0)}%`}
                fraction={trustedPercent / 100}
                detail={`${data.summary.sensor_fault_ticks} rejected`}
              />
              <GaugeCard
                icon={ShieldCheck}
                label='Movements'
                display={String(data.summary.movement_count)}
                fraction={Number(data.summary.movement_count) / 144}
                detail={`${data.summary.safe_mode_ticks} SAFE`}
              />
            </div>

            {data.comparison.length > 0 && (
              <ImpactStrip metrics={data.comparison} />
            )}

            {selectedTick && (
              <FacadeReadout
                tick={selectedTick}
                selected={selectedWall}
                onSelect={setSelectedWall}
              />
            )}

            {data.annotations.length > 0 && (
              <section className='console-card' data-tour='events'>
                <p className='console-card-title'>Events</p>
                <div className='mt-2 flex flex-col gap-1.5'>
                  {data.annotations.map((annotation) => (
                    <button
                      key={`${annotation.kind}-${annotation.timestamp}`}
                      className='event-marker justify-start'
                      type='button'
                      onClick={() => {
                        const index = data.ticks.findIndex(
                          (tick) => tick.timestamp === annotation.timestamp
                        )
                        if (index >= 0) setTimelineIndex(index)
                      }}
                    >
                      <AlertTriangle className='h-3.5 w-3.5 shrink-0' />
                      <span className='truncate'>{annotation.title}</span>
                      <span className='ml-auto font-mono text-[9px] opacity-60'>
                        {timeLabel(annotation.timestamp, zone)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Each tier keeps its own charts on the page. One clock drives all
                of them, so the three read side by side instead of one chart
                area swapping its contents as the analysis moves on. */}
            {tierCharts.length > 0 ? (
              tierCharts.map(({ step, response }) => (
                <section
                  aria-label={`${step.tier} charts`}
                  className='grid gap-2'
                  key={step.scenario}
                >
                  <p className='console-card-title'>
                    {step.tier} · {step.label}
                  </p>
                  <SimulationCharts
                    scenario={step.scenario}
                    ticks={response.ticks}
                    annotations={response.annotations}
                    cursor={Math.min(timelineIndex, response.ticks.length - 1)}
                    revealing={playing}
                  />
                </section>
              ))
            ) : (
              <SimulationCharts
                scenario={request.scenario}
                ticks={data.ticks}
                annotations={data.annotations}
                cursor={Math.min(timelineIndex, data.ticks.length - 1)}
                revealing={playing}
              />
            )}
          </>
        )}
      </aside>

      <RailHandle side='left' label='Resize results panel' />

      <section className='console-stage' aria-label='Building model'>
        {activeStep && !cardDismissed && (
          <TierCard
            step={activeStep}
            status={tierStatus[activeStep.scenario] ?? 'pending'}
            response={tierResults[activeStep.scenario]}
            onDismiss={() => setCardDismissed(true)}
          />
        )}

        {error ? (
          <ErrorState message={error} onRetry={() => void execute(request)} />
        ) : loading && !data ? (
          <LoadingState />
        ) : data && selectedTick ? (
          <>
            <BuildingHeatmap
              tick={selectedTick}
              floors={data.metadata.floors}
              facadeTilt={data.metadata.facade_tilt}
              roofPitch={data.metadata.roof_pitch}
              locationName={data.metadata.location}
              timeLabel={timeLabel(selectedTick.timestamp, zone)}
              selected={selectedWall}
              onSelect={setSelectedWall}
              sunTrack={sunTrack}
            />

            <div className='stage-toolbar' data-tour='timeline-inspector'>
              <div className='flex flex-wrap items-center gap-2'>
                <button
                  aria-label={
                    playing ? 'Pause sun movement' : 'Play sun movement'
                  }
                  aria-pressed={playing}
                  className='play-button'
                  onClick={() => setPlaying((value) => !value)}
                  type='button'
                >
                  {playing ? (
                    <Pause className='h-3 w-3 fill-current' />
                  ) : (
                    <Play className='h-3 w-3 fill-current' />
                  )}
                </button>
                <p className='font-mono text-sm font-semibold'>
                  {timeLabel(selectedTick.timestamp, zone)}
                </p>
                <span className='text-[10px] text-muted-foreground'>
                  {`sun ${selectedTick.solar_elevation.toFixed(0)}° elev · ${selectedTick.solar_azimuth.toFixed(0)}° az`}
                </span>
                <span className='text-[11px] font-semibold capitalize'>
                  {selectedKind === 'roof'
                    ? `${selectedOrientation} roof face`
                    : `${selectedOrientation} facade`}
                </span>
                {selectedKind === 'wall' && (
                  <StatusBadge
                    mode={selectedWallState?.mode ?? selectedTick.mode}
                  />
                )}
                <span
                  className={
                    selectedTick.sensor_trusted ? 'trust-badge' : 'fault-badge'
                  }
                >
                  {selectedTick.sensor_trusted ? 'Trusted' : 'Rejected'}
                </span>
                <span className='ml-auto text-[10px] uppercase tracking-wider text-muted-foreground'>
                  Selected tick
                </span>
              </div>

              <input
                aria-label='Simulation timeline'
                className='timeline-range'
                type='range'
                min={0}
                max={Math.max(0, data.ticks.length - 1)}
                value={timelineIndex}
                onChange={(event) =>
                  setTimelineIndex(Number(event.target.value))
                }
              />

              <div className='flex flex-wrap items-center gap-1.5'>
                {selectedRoofState ? (
                  <>
                    <span className='stage-chip'>
                      {selectedRoofState.tilt.toFixed(0)}° pitch
                    </span>
                    <span className='stage-chip'>
                      {selectedRoofState.incident.toFixed(0)} W/m² on roof
                    </span>
                    <span className='stage-chip'>
                      {selectedRoofState.sky_diffuse.toFixed(0)} W/m² sky
                    </span>
                    <span className='stage-chip'>
                      {selectedRoofState.sol_air_temp.toFixed(1)} °C surface
                    </span>
                  </>
                ) : (
                  <>
                    <span className='stage-chip'>
                      {(
                        selectedWallState?.angle ?? selectedTick.angle_final
                      ).toFixed(0)}
                      ° angle
                    </span>
                    <span className='stage-chip'>
                      {(selectedWallState?.lux ?? selectedTick.lux).toFixed(0)}{' '}
                      lux
                    </span>
                    <span className='stage-chip'>
                      {(
                        selectedWallState?.incident ??
                        selectedTick.measured_irradiance
                      ).toFixed(0)}{' '}
                      W/m² on wall
                    </span>
                    <span className='stage-chip'>
                      {(
                        selectedWallState?.load_relative ??
                        selectedTick.load_relative
                      ).toFixed(3)}{' '}
                      load
                    </span>
                  </>
                )}
                <span className='stage-chip'>
                  {selectedTick.wind.toFixed(1)} m/s
                </span>
                <span className='stage-chip'>
                  {selectedTick.outdoor_temp.toFixed(1)} °C
                </span>
              </div>
              {selectedWallState && (
                <p className='text-[10px] leading-4 text-muted-foreground'>
                  {selectedWallState.reason}
                </p>
              )}
              {selectedRoofState && (
                <p className='text-[10px] leading-4 text-muted-foreground'>
                  Roof faces carry no louvres, so this is raw plane-of-array
                  gain. A flat roof reads the same on every quadrant.
                </p>
              )}
            </div>
          </>
        ) : null}
      </section>

      <RailHandle side='right' label='Resize settings panel' />

      <aside className='console-rail console-rail-right'>
        <SimulationControls
          value={request}
          onChange={setRequest}
          onReset={() => {
            const reset = { ...DEFAULT_REQUEST, scenario: request.scenario }
            setRequest(reset)
            void execute(reset)
          }}
        />
        <ControllerPanel
          value={request}
          loading={loading}
          onChange={setRequest}
          onRun={() => void execute(request)}
        />
      </aside>
    </div>
  )
}

/** Bounded value as a 270-degree arc. Unbounded counts pass a rough fraction. */
function GaugeCard({
  icon: Icon,
  label,
  display,
  detail,
  fraction,
}: {
  icon: React.ElementType
  label: string
  display: string
  detail: string
  fraction: number
}) {
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const sweep = 0.75
  const filled = Math.min(1, Math.max(0, fraction)) * sweep

  return (
    <article className='gauge-card'>
      <div className='relative'>
        <svg viewBox='0 0 64 64' className='h-16 w-16 -rotate-[135deg]'>
          <circle
            cx='32'
            cy='32'
            r={radius}
            fill='none'
            strokeWidth='6'
            strokeLinecap='round'
            className='stroke-secondary'
            strokeDasharray={`${circumference * sweep} ${circumference}`}
          />
          <circle
            cx='32'
            cy='32'
            r={radius}
            fill='none'
            strokeWidth='6'
            strokeLinecap='round'
            className='stroke-primary'
            strokeDasharray={`${circumference * filled} ${circumference}`}
          />
        </svg>
        <span className='absolute inset-0 grid place-items-center'>
          <Icon className='h-4 w-4 text-primary' />
        </span>
      </div>
      <p className='mt-1 font-display text-base font-semibold tracking-tight'>
        {display}
      </p>
      <p className='text-[9px] font-semibold uppercase tracking-wider text-muted-foreground'>
        {label}
      </p>
      <p className='mt-0.5 text-[9px] text-muted-foreground'>{detail}</p>
    </article>
  )
}

/** "70%" but "1 moves" — only a bare symbol sits tight against its number. */
const formatMetric = (value: number, unit: string) =>
  unit.length <= 1 ? `${value}${unit}` : `${value} ${unit}`

function ImpactStrip({ metrics }: { metrics: ComparisonMetric[] }) {
  return (
    <section
      className='console-card'
      aria-label='Impact versus baseline'
      data-tour='comparison'
    >
      <div className='flex items-center justify-between'>
        <p className='console-card-title'>Impact</p>
        <p className='text-[9px] text-muted-foreground'>vs baseline</p>
      </div>
      <div className='mt-2 grid gap-1.5'>
        {metrics.map((metric) => {
          const improved = metric.higher_is_better
            ? metric.ours > metric.naive
            : metric.ours < metric.naive
          return (
            <div
              className='border-t border-border/50 pt-1.5 first:border-0 first:pt-0'
              key={metric.metric}
            >
              <div className='flex items-center justify-between gap-2'>
                <p className='truncate text-[10px] font-semibold text-muted-foreground'>
                  {metric.label}
                </p>
                {improved && <span className='winner-badge'>Better</span>}
              </div>
              <div className='mt-0.5 flex flex-wrap items-baseline gap-x-2'>
                <span className='font-mono text-sm font-semibold'>
                  {formatMetric(metric.ours, metric.unit)}
                </span>
                <span className='text-[9px] text-muted-foreground'>
                  base {formatMetric(metric.naive, metric.unit)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
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

function LoadingState() {
  return (
    <div className='absolute inset-0 flex flex-col items-center justify-center text-center'>
      <LoaderCircle className='h-7 w-7 animate-spin text-primary' />
      <h2 className='mt-3 font-display text-lg font-semibold'>
        Running simulation
      </h2>
      <p className='mt-1 text-xs text-muted-foreground'>144 decision ticks</p>
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
    <div className='absolute inset-0 flex flex-col items-center justify-center p-10 text-center'>
      <div className='rounded-full bg-red-50 p-3 text-red-600'>
        <AlertTriangle className='h-6 w-6' />
      </div>
      <h2 className='mt-4 font-display text-xl font-semibold'>
        Simulation unavailable
      </h2>
      <p className='mt-2 max-w-lg text-sm text-muted-foreground'>{message}</p>
      <button className='retry-button mt-5' onClick={onRetry} type='button'>
        Try again
      </button>
    </div>
  )
}
