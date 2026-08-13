'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  Layers3,
  Leaf,
  LoaderCircle,
  ShieldCheck,
  SunMedium,
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
    label: 'Sensor Trust',
    shortLabel: 'Trust',
    icon: SunMedium,
  },
  {
    value: 'co_optimization',
    label: 'Optimisation',
    shortLabel: 'Optimise',
    icon: BrainCircuit,
  },
  {
    value: 'budget_failsafe',
    label: 'Safety',
    shortLabel: 'Safety',
    icon: ShieldCheck,
  },
]

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
  const requestController = useRef<AbortController | null>(null)

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
        <div
          className='flex flex-row gap-1 xl:mt-4 xl:flex-col'
          data-tour='scenario-tabs'
        >
          {tabs.map((tab) => {
            const Icon = tab.icon
            const active = request.scenario === tab.value
            return (
              <button
                key={tab.value}
                aria-label={tab.label}
                aria-current={active ? 'page' : undefined}
                title={tab.label}
                className={
                  active ? 'console-nav-button-active' : 'console-nav-button'
                }
                onClick={() => switchTab(tab.value)}
                type='button'
              >
                <Icon className='h-4 w-4' />
              </button>
            )
          })}
        </div>
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
              {tabs.find((tab) => tab.value === request.scenario)?.label}
            </h1>
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

            <SimulationCharts
              scenario={request.scenario}
              ticks={data.ticks}
              annotations={data.annotations}
            />
          </>
        )}
      </aside>

      <section className='console-stage' aria-label='Building model'>
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
            />

            <div className='stage-toolbar' data-tour='timeline-inspector'>
              <div className='flex flex-wrap items-center gap-2'>
                <p className='font-mono text-sm font-semibold'>
                  {timeLabel(selectedTick.timestamp, zone)}
                </p>
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
