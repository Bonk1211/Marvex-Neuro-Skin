'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ProvenanceStrip } from './ProvenanceStrip'
import { CostBreakdownPanel } from './CostBreakdownPanel'
import { ModelLimitsPanel } from './ModelLimitsPanel'
import { FeedsPanel } from './FeedsPanel'
import { LiveHardwarePanel } from './LiveHardwarePanel'
import { LiveCsiPanel } from './LiveCsiPanel'
import { GlareBlindnessPanel } from './DaylightPanel'
import { FloorPanel } from './FloorPanel'
import { FloorSectionPanel } from './FloorSectionPanel'
import type { CsiActivity } from './csiPosture'
import type { OrbitAngles } from './sectionScene'
import { BrainFlow } from './BrainFlow'
import { DEFAULT_BEARING } from './windRoom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Building2,
  Layers,
  BrainCircuit,
  Radio,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Leaf,
  Pause,
  Play,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import {
  GaugeCard,
  BuildingOverview,
  ImpactStrip,
  StatusBadge,
  LoadingState,
  ErrorState,
  timeLabel,
} from './DashboardCards'
import {
  runSimulation,
  type BuildingProfile,
  type HardwareStatus,
} from '@/lib/api-client'
import type {
  FacadeOrientation,
  PerturbationKind,
  ScenarioName,
  SimulationRunRequest,
  SimulationRunResponse,
} from '@/lib/types'
import { BuildingHeatmap } from './BuildingHeatmap'
import type { SurfaceId } from './BuildingHeatmap'
import {
  baselineSurfaceTemperature,
  surfaceIrradianceComparison,
  type BuildingVariant,
} from './buildingComparison'
import { DEFAULT_WEIGHTS } from './ControllerPanel'
import { CloudVisionPanel, type SkyObservation } from './CloudVisionPanel'
import { SimulationCharts } from './SimulationCharts'
import { ZoneSensorPanel } from './ZoneSensorPanel'
import { TIER_STEPS, TierCard, TierRunner } from './TierAnalysis'
import type { TierStatus } from './TierAnalysis'

const LENSES = [
  ['building', 'Building', Building2],
  ['floor', 'Floor', Layers],
  ['brains', 'Brains', BrainCircuit],
  ['feeds', 'Feeds', Radio],
] as const
type Lens = (typeof LENSES)[number][0]

const DEFAULT_REQUEST: SimulationRunRequest = {
  scenario: 'overview',
  date: '2026-03-21',
  seed: 42,
  environment_source: 'synthetic',
  cloud_profile: 'scattered',
  occupancy_scale: 1,
  wind_override: 3,
  wind_direction: DEFAULT_BEARING,
  power_ok: true,
  weights: DEFAULT_WEIGHTS,
  latitude: 2.922,
  longitude: 101.6885,
  timezone: 'Asia/Kuala_Lumpur',
  location_name: 'ST Diamond Building, Putrajaya',
  facade_orientation: 'west',
  facade_tilt: 115,
  roof_pitch: 10,
  glare_limit_w_m2: 25,
  glazing_shgc: 0.4,
  actuator_speed_deg_per_min: 6,
}

/**
 * Overlay whatever the building manager filed on /onboarding. A deployment nobody
 * has onboarded yet has no profile, and the shipped defaults stand unchanged.
 */
function withBuildingProfile(
  request: SimulationRunRequest,
  profile?: BuildingProfile
): SimulationRunRequest {
  if (!profile?.location || !profile.structure) return request
  return {
    ...request,
    latitude: profile.location.latitude,
    longitude: profile.location.longitude,
    timezone: profile.location.timezone,
    location_name: profile.location.name,
    facade_orientation: profile.structure.facade_orientation,
    facade_tilt: profile.structure.facade_tilt,
    roof_pitch: profile.structure.roof_pitch,
  }
}

/** How long a finished tier stays on screen before the next one starts. */
const STEP_PAUSE_MS = 700

// Leave time to see the actuator response; the 07:00-19:00 day takes about 22 seconds.
const PLAY_INTERVAL_MS = 300

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

export function NeuroSkinDashboard({ profile }: { profile?: BuildingProfile }) {
  const view = useSearchParams().get('view')
  const lens: Lens = LENSES.find(([id]) => id === view)?.[0] ?? 'building'
  // Read on the server from /onboarding; absent on a deployment nobody has onboarded.
  const onboarded = withBuildingProfile(DEFAULT_REQUEST, profile)
  const [band, setBand] = useState(0)
  const [floorFocused, setFloorFocused] = useState(false)
  const [floorView, setFloorView] = useState<'normal' | 'xray' | 'live'>(
    'normal'
  )
  const csiView = floorView === 'xray'
  const liveCsi = lens === 'floor' && floorView === 'live'
  const [csiActivity, setCsiActivity] = useState<CsiActivity>('auto')
  const [visionAgeSeconds, setVisionAgeSeconds] = useState<number | null>(null)
  const [request, setRequest] = useState<SimulationRunRequest>(() => ({
    ...onboarded,
    daylight_model_enabled: lens === 'floor',
    // Opening Brains directly runs local sensor checks; approvals stay manual.
    fault_correction: lens === 'brains' ? 'review' : 'off',
  }))
  const initialRequest = useRef(request)
  const [data, setData] = useState<SimulationRunResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timelineIndex, setTimelineIndex] = useState(36)
  const [selectedWall, setSelectedWall] = useState<SurfaceId>(
    `wall:${onboarded.facade_orientation}`
  )
  const [selectedZone, setSelectedZone] = useState<string | null>(null)
  // One orbit pose shared by the building scene and the floor section, in the
  // building's frame. Either view may set it; the section converts it through its
  // wall's rotation so both show the same facade from the same side.
  const [orbit, setOrbit] = useState<OrbitAngles | null>(null)
  const focusFloor = useCallback((next: number | null) => {
    setFloorFocused(next !== null)
    if (next !== null) setBand(next)
    setSelectedZone(null)
  }, [])
  const [buildingVariant, setBuildingVariant] =
    useState<BuildingVariant>('controlled')
  const isControlled = buildingVariant === 'controlled'
  const selectSurface = useCallback((surface: SurfaceId) => {
    setSelectedWall(surface)
    setSelectedZone(null)
  }, [])
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
  // The 3D view portals its scene controls into the right rail.
  const [sceneControls, setSceneControls] = useState<HTMLElement | null>(null)
  // Clock playback: walks the timeline so the sun crosses the sky on the real
  // solar positions the run returned.
  const [playing, setPlaying] = useState(false)
  const [hardwareMode, setHardwareMode] = useState<
    HardwareStatus['mode'] | null
  >(null)
  const requestController = useRef<AbortController | null>(null)
  const appliedRequest = useRef<SimulationRunRequest>(initialRequest.current)
  const tierRequests = useRef<
    Partial<Record<ScenarioName, SimulationRunRequest>>
  >({})
  const [visionSky, setVisionSky] = useState<SkyObservation | null>(null)

  const tickCount = data?.ticks.length ?? 0
  // The clock walks to the end of the day and stops there rather than wrapping
  // back to 07:00, so a finished run leaves the facade at its last state.
  useEffect(() => {
    if (!playing || tickCount < 2) return
    const timer = setInterval(
      () => setTimelineIndex((index) => Math.min(index + 1, tickCount - 1)),
      hardwareMode === 'twin' ? 1000 : PLAY_INTERVAL_MS
    )
    return () => clearInterval(timer)
  }, [playing, tickCount, hardwareMode])

  useEffect(() => {
    if (playing && tickCount > 0 && timelineIndex >= tickCount - 1)
      setPlaying(false)
  }, [playing, timelineIndex, tickCount])

  /** Point the stage, timeline and charts at one run's result. */
  const focusOn = useCallback((response: SimulationRunResponse) => {
    setData(response)
    // Land on the end of the simulated day. This used to jump to the scenario's
    // headline annotation, which parked the clock mid-afternoon on every run.
    setTimelineIndex(Math.max(0, response.ticks.length - 1))
  }, [])

  const execute = useCallback(
    async (
      nextRequest: SimulationRunRequest,
      preserveTick?: number,
      keepClock = false
    ) => {
      requestController.current?.abort()
      const controller = new AbortController()
      requestController.current = controller
      setLoading(true)
      setError(null)
      try {
        const response = await runSimulation(nextRequest, controller.signal)
        if (controller.signal.aborted) return
        if (
          JSON.stringify({ ...nextRequest, scenario: null }) !==
          JSON.stringify({ ...appliedRequest.current, scenario: null })
        ) {
          setTierResults({})
          setTierStatus({})
          setActiveTier(null)
          tierRequests.current = {}
        }
        appliedRequest.current = nextRequest
        if (preserveTick === undefined) focusOn(response)
        else {
          setData(response)
          if (!keepClock)
            setTimelineIndex(
              Math.max(0, Math.min(preserveTick, response.ticks.length - 1))
            )
        }
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
    // Start in the occupied afternoon so light, people and shading are visible.
    void execute(initialRequest.current, 48).then((response) => {
      if (!response) return
      tierRequests.current.overview = initialRequest.current
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
    tierRequests.current = {}
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
        const stepRequest = { ...request, scenario: step.scenario }
        const response = await runSimulation(stepRequest, controller.signal)
        if (controller.signal.aborted) return
        last = response
        tierRequests.current[step.scenario] = stepRequest
        setTierResults((prev) => ({ ...prev, [step.scenario]: response }))
        setTierStatus((prev) => ({ ...prev, [step.scenario]: 'done' }))
        setRequest((prev) => ({ ...prev, scenario: step.scenario }))
        // Swap the data under the running clock rather than jumping the time.
        appliedRequest.current = stepRequest
        setData(response)
        setLoading(false)
        // Let the step land on screen before the next one starts.
        await pause(STEP_PAUSE_MS, controller.signal)
      }
      // Let the clock finish the day on the last tier's data; it stops itself at
      // the final tick instead of snapping back to that tier's headline event.
      if (last) setData(last)
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
      // A failed analysis has nothing left to animate.
      setPlaying(false)
    } finally {
      if (!controller.signal.aborted) {
        setTierRunning(false)
        // The clock is NOT stopped here: the three runs finish in a few seconds,
        // long before the day does, and killing playback here parked it at
        // whatever tick the last fetch happened to land on (late morning).
        setLoading(false)
      }
    }
  }, [request])

  const focusTier = useCallback(
    (scenario: ScenarioName) => {
      setActiveTier(
        TIER_STEPS.some((step) => step.scenario === scenario) ? scenario : null
      )
      setCardDismissed(false)
      // A tier already run is shown from its stored result, not fetched again.
      const stored = tierResults[scenario]
      if (stored) {
        appliedRequest.current = tierRequests.current[scenario] ?? {
          ...appliedRequest.current,
          scenario,
        }
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
        if (response) {
          tierRequests.current[scenario] = next
          setTierResults((prev) => ({ ...prev, [scenario]: response }))
        }
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
  const primaryOrientation = selectedTick?.facade.find(
    (wall) => wall.primary
  )?.orientation
  useEffect(() => {
    if (lens === 'brains' && !selectedZone && primaryOrientation)
      setSelectedWall(`wall:${primaryOrientation}`)
  }, [lens, selectedZone, primaryOrientation])
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
  const selectedZoneState = selectedWallState?.zones?.find(
    (zone) => zone.zone === selectedZone
  )
  const selectZone = (id: string | null) => {
    setSelectedZone(id)
    if (!id) {
      const primary = selectedTick?.facade.find((wall) => wall.primary)
      if (primary) setSelectedWall(`wall:${primary.orientation}`)
      return
    }
    const wall = selectedTick?.facade.find((wall) =>
      wall.zones?.some((zone) => zone.zone === id)
    )
    const zone = wall?.zones?.find((zone) => zone.zone === id)
    if (wall && zone) {
      setSelectedWall(`wall:${wall.orientation}`)
      setBand(zone.row)
      setFloorFocused(true)
    }
  }
  const selectedController = selectedZoneState ?? selectedWallState
  const irradianceComparison = selectedTick
    ? surfaceIrradianceComparison(selectedTick, selectedWall, selectedZone)
    : null
  const sensorTrusted =
    selectedZoneState?.sensor_trusted ?? selectedTick?.sensor_trusted
  const updateZoneSensor = async (
    zoneId: string,
    reading: { irradiance: number; illuminance: number } | null
  ) => {
    const sensorTick = Math.min(timelineIndex, Math.max(0, tickCount - 1))
    const overrides = { ...appliedRequest.current.zone_sensor_overrides }
    if (reading) overrides[zoneId] = { ...reading, tick_index: sensorTick }
    else delete overrides[zoneId]
    const nextRequest = {
      ...appliedRequest.current,
      zone_sensor_overrides: overrides,
    }
    setPlaying(false)
    // Testing one sensor must not also apply unrelated, unsaved global settings.
    setRequest((draft) => ({ ...draft, zone_sensor_overrides: overrides }))
    // Cached tier results describe the old sensor inputs.
    setTierResults({})
    setTierStatus({})
    setActiveTier(null)
    await execute(nextRequest, sensorTick)
  }

  /** Replay the applied run with a fault-correction change, keeping the clock. */
  const replayFaultCorrection = async (
    changes: Partial<
      Pick<
        SimulationRunRequest,
        'zone_perturbations' | 'fault_correction' | 'approved_episodes'
      >
    >
  ) => {
    const sensorTick = Math.min(timelineIndex, Math.max(0, tickCount - 1))
    setPlaying(false)
    // Like a sensor override, this must not apply unrelated unsaved settings.
    setRequest((draft) => ({ ...draft, ...changes }))
    setTierResults({})
    setTierStatus({})
    setActiveTier(null)
    await execute({ ...appliedRequest.current, ...changes }, sensorTick)
  }
  /** The wind-response demo: raise the gust on the squall bearing and re-run. */
  const applyWind = async (wind: number) => {
    const sensorTick = Math.min(timelineIndex, Math.max(0, tickCount - 1))
    setPlaying(false)
    const changes = { wind_override: wind, wind_direction: DEFAULT_BEARING }
    setRequest((draft) => ({ ...draft, ...changes }))
    await execute({ ...appliedRequest.current, ...changes }, sensorTick)
  }

  const updateZonePerturbation = (
    zoneId: string,
    kind: PerturbationKind | null
  ) => {
    const sensorTick = Math.min(timelineIndex, Math.max(0, tickCount - 1))
    const perturbations = { ...appliedRequest.current.zone_perturbations }
    if (kind)
      perturbations[zoneId] = {
        kind,
        start_tick: sensorTick,
        end_tick: Math.min(tickCount - 1, sensorTick + 12),
      }
    else delete perturbations[zoneId]
    const mode = appliedRequest.current.fault_correction ?? 'off'
    void replayFaultCorrection({
      zone_perturbations: perturbations,
      // An injected fault is only worth watching with local checks running.
      fault_correction: kind && mode === 'off' ? 'review' : mode,
      // Earlier approvals named episodes of a different fault.
      approved_episodes: [],
    })
  }

  const updateSkyObservation = async (observation: SkyObservation | null) => {
    if (loading || tierRunning || !tickCount) return null
    const sensorTick = Math.min(timelineIndex, tickCount - 1)
    const vision_observation = observation
      ? {
          captured_at: observation.captured_at,
          cloud_cover: observation.cloud_cover,
          tick_index: sensorTick,
        }
      : null
    const nextRequest = { ...appliedRequest.current, vision_observation }
    const response = await execute(nextRequest, sensorTick, true)
    if (!response) return null
    setRequest((draft) => ({ ...draft, vision_observation }))
    setTierResults({})
    setTierStatus({})
    setActiveTier(null)
    const tick = response.ticks[sensorTick]
    return `Brain updated · ${timeLabel(tick.timestamp, response.metadata.timezone)} · ${tick.mode} → ${tick.angle_final.toFixed(1)}° · ${tick.cloud_source === 'vision' ? 'vision + light sensors + weather' : 'weather fallback'}`
  }

  return (
    <div className='console-shell' data-lens={lens}>
      <nav className='console-nav' aria-label='Console'>
        <Link
          href='/onboarding'
          aria-label='Building onboarding'
          title='Building onboarding'
          className='brand-mark h-10 w-10 shrink-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'
        >
          <Leaf className='h-4 w-4' />
        </Link>
        {LENSES.map(([id, label, Icon]) => (
          <Link
            key={id}
            href={`/dashboard?view=${id}`}
            scroll={false}
            aria-label={label}
            aria-current={lens === id ? 'page' : undefined}
            className={`lens-nav-button ${lens === id ? 'console-nav-button-active' : 'console-nav-button'}`}
            title={label}
          >
            <Icon className='h-4 w-4' />
            <span>{label}</span>
          </Link>
        ))}
        <Link
          aria-label='Actuator calibration'
          className='console-nav-button'
          href='/hardware'
          title='Hardware · actuator calibration'
        >
          <Wrench className='h-4 w-4' />
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

      <div className='console-workspace'>
        {data && !error && (
          <ProvenanceStrip
            metadata={data.metadata}
            visionAgeSeconds={visionAgeSeconds}
          />
        )}
        <div className='console-rails'>
          <aside
            className='console-rail console-rail-left'
            aria-label='Simulation results'
            aria-live='polite'
          >
            {lens === 'building' && (
              <>
                <header className='flex items-start justify-between gap-3 px-1'>
                  <div>
                    <p className='eyebrow'>Engineering console</p>
                    <h1 className='mt-0.5 font-display text-lg font-semibold tracking-tight'>
                      {isControlled
                        ? 'Building overview'
                        : 'No external facade'}
                    </h1>
                    {isControlled && activeStep && (
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
                  </div>
                </header>

                {selectedTick && <BuildingOverview tick={selectedTick} />}

                {isControlled && (
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
                )}
              </>
            )}

            {data && (
              <>
                {lens === 'building' && (
                  <details className='space-y-3'>
                    <summary className='cursor-pointer px-1 py-1 text-xs font-semibold text-muted-foreground'>
                      Performance & comparison · 07:00–19:00
                    </summary>
                    {irradianceComparison && (
                      <section
                        className='console-card'
                        aria-label='Building irradiance comparison'
                      >
                        <p className='console-card-title'>Facade comparison</p>
                        <p className='mt-1 text-xs font-semibold'>
                          {irradianceComparison.label}
                        </p>
                        <dl className='mt-3 grid grid-cols-2 gap-3'>
                          <div>
                            <dt className='text-[10px] text-muted-foreground'>
                              Controlled
                            </dt>
                            <dd className='font-mono text-base font-semibold'>
                              {irradianceComparison.controlled.toFixed(0)}{' '}
                              <span className='text-[10px]'>W/m²</span>
                            </dd>
                          </div>
                          <div>
                            <dt className='text-[10px] text-muted-foreground'>
                              No external facade
                            </dt>
                            <dd className='font-mono text-base font-semibold'>
                              {irradianceComparison.baseline.toFixed(0)}{' '}
                              <span className='text-[10px]'>W/m²</span>
                            </dd>
                          </div>
                        </dl>
                        <p className='mt-2 text-xs font-semibold text-primary'>
                          {selectedKind === 'roof'
                            ? 'Same roof · unchanged exposure'
                            : irradianceComparison.reduction === null
                              ? 'No solar exposure at this tick'
                              : `${irradianceComparison.reduction.toFixed(1)}% less irradiance with louvres`}
                        </p>
                        <p className='mt-2 text-[10px] leading-4 text-muted-foreground'>
                          Same sun, weather and colour scale.{' '}
                          {selectedKind === 'roof'
                            ? 'Modelled roof irradiance.'
                            : 'Modelled zone irradiance before glazing; wall means weight zones equally.'}{' '}
                          The heatmap shows local mesh shadows.
                        </p>
                      </section>
                    )}
                    {isControlled && (
                      <div
                        className='grid grid-cols-3 gap-2'
                        data-tour='kpi-grid'
                      >
                        <GaugeCard
                          icon={Activity}
                          label='Mean load'
                          display={Number(
                            data.summary.mean_relative_load
                          ).toFixed(3)}
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
                          fraction={
                            Number(data.summary.movement_count) /
                            Math.max(1, tickCount)
                          }
                          detail={`${data.summary.safe_mode_ticks} SAFE`}
                        />
                      </div>
                    )}

                    {isControlled && data.comparison.length > 0 && (
                      <ImpactStrip metrics={data.comparison} />
                    )}

                    <p className='px-1 text-[10px] text-muted-foreground'>
                      Building-wide simulated occupancy:{' '}
                      {((selectedTick?.occupancy ?? 0) * 100).toFixed(0)}%
                    </p>
                  </details>
                )}

                {lens === 'feeds' && (
                  <>
                    <FeedsPanel visionAgeSeconds={visionAgeSeconds} />
                    <ModelLimitsPanel metadata={data.metadata} />
                  </>
                )}

                {lens === 'floor' && (
                  <>
                    {selectedTick && (
                      <FloorPanel
                        orientation={selectedOrientation}
                        onSideChange={(orientation) =>
                          selectSurface(`wall:${orientation}`)
                        }
                        tick={selectedTick}
                        floors={data.metadata.floors}
                        focusedBand={floorFocused ? band : null}
                        onBandChange={focusFloor}
                        controlled={isControlled}
                        loading={loading || tierRunning}
                        onEnableDaylight={() => {
                          setRequest((current) => ({
                            ...current,
                            daylight_model_enabled: true,
                          }))
                          void execute(
                            {
                              ...appliedRequest.current,
                              daylight_model_enabled: true,
                            },
                            timelineIndex
                          )
                        }}
                      />
                    )}
                    {selectedWallState &&
                      (selectedWallState.zones?.length ?? 0) > 0 && (
                        <ZoneSensorPanel
                          buildingVariant={buildingVariant}
                          wall={selectedWallState}
                          selectedZone={selectedZone}
                          onSelectZone={selectZone}
                          onOverride={(zoneId, reading) =>
                            void updateZoneSensor(zoneId, reading)
                          }
                          onClearOverride={(zoneId) =>
                            void updateZoneSensor(zoneId, null)
                          }
                          overriddenZoneIds={Object.keys(
                            request.zone_sensor_overrides ?? {}
                          )}
                          onPerturb={updateZonePerturbation}
                          onClearPerturbation={(zoneId) =>
                            updateZonePerturbation(zoneId, null)
                          }
                          perturbedZoneIds={Object.keys(
                            request.zone_perturbations ?? {}
                          )}
                          loading={loading || tierRunning}
                        />
                      )}
                  </>
                )}

                {lens === 'brains' && isControlled && (
                  <>
                    {selectedTick && (
                      <>
                        <CostBreakdownPanel
                          tick={selectedTick}
                          weights={appliedRequest.current.weights}
                          zone={selectedZoneState}
                        />
                      </>
                    )}
                    <details className='console-card'>
                      <summary className='cursor-pointer text-xs font-semibold'>
                        Offline daylight benchmark
                      </summary>
                      <div className='mt-3'>
                        <GlareBlindnessPanel />
                      </div>
                    </details>
                    {isControlled && data.annotations.length > 0 && (
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
                                  (tick) =>
                                    tick.timestamp === annotation.timestamp
                                )
                                if (index >= 0) setTimelineIndex(index)
                              }}
                            >
                              <AlertTriangle className='h-3.5 w-3.5 shrink-0' />
                              <span className='truncate'>
                                {annotation.title}
                              </span>
                              <span className='ml-auto font-mono text-[9px] opacity-60'>
                                {timeLabel(annotation.timestamp, zone)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </section>
                    )}

                    <p className='px-1 text-[10px] text-muted-foreground'>
                      Scenario charts · primary reporting controller ·
                      07:00-19:00
                    </p>
                    {/* Each tier keeps its own charts on the page. One clock drives all
                of them, so the three read side by side instead of one chart
                area swapping its contents as the analysis moves on. */}
                    {isControlled &&
                      (tierCharts.length > 0 ? (
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
                              cursor={Math.min(
                                timelineIndex,
                                response.ticks.length - 1
                              )}
                              revealing={playing}
                            />
                          </section>
                        ))
                      ) : (
                        <SimulationCharts
                          scenario={request.scenario}
                          ticks={data.ticks}
                          annotations={data.annotations}
                          cursor={Math.min(
                            timelineIndex,
                            data.ticks.length - 1
                          )}
                          revealing={playing}
                        />
                      ))}
                  </>
                )}
              </>
            )}
          </aside>

          <RailHandle side='left' label='Resize results panel' />

          <section
            className='console-stage'
            aria-label='Building model'
            data-csi={lens === 'floor' && csiView}
          >
            {lens === 'building' &&
              isControlled &&
              activeStep &&
              !cardDismissed && (
                <TierCard
                  step={activeStep}
                  status={tierStatus[activeStep.scenario] ?? 'pending'}
                  response={tierResults[activeStep.scenario]}
                  onDismiss={() => setCardDismissed(true)}
                />
              )}

            {lens === 'floor' && (
              <>
                <div
                  className='floor-view-switch'
                  role='group'
                  aria-label='Floor view'
                >
                  <button
                    type='button'
                    aria-pressed={floorView === 'normal'}
                    onClick={() => setFloorView('normal')}
                  >
                    Normal view
                  </button>
                  <button
                    type='button'
                    aria-pressed={csiView}
                    onClick={() => setFloorView('xray')}
                  >
                    CSI X-ray
                  </button>
                  <button
                    type='button'
                    aria-pressed={liveCsi}
                    onClick={() => setFloorView('live')}
                  >
                    Live CSI
                  </button>
                </div>
                <p className='floor-view-caption'>
                  {liveCsi
                    ? 'ESP32 bridge · live CSI room · illustrative layout'
                    : csiView
                      ? 'WiFi CSI · simulated signal waves + poses · transparent structure'
                      : 'Furnished floor · drag to orbit · scroll to zoom'}
                </p>
              </>
            )}

            {liveCsi ? (
              <LiveCsiPanel />
            ) : error ? (
              <ErrorState
                message={error}
                onRetry={() => void execute(request)}
              />
            ) : loading && !data ? (
              <LoadingState />
            ) : data && selectedTick ? (
              <>
                <div className='csi-scene-wash' aria-hidden='true' />
                <div
                  className={`absolute inset-0 ${lens === 'brains' ? 'hidden' : ''}`}
                >
                  <BuildingHeatmap
                    orbit={orbit}
                    onOrbitChange={setOrbit}
                    active={lens !== 'brains'}
                    cameraMode={lens === 'floor' ? 'plan' : 'orbit'}
                    csiView={lens === 'floor' && csiView}
                    csiActivity={csiActivity}
                    band={band}
                    focusedBand={floorFocused ? band : null}
                    onSelectBand={focusFloor}
                    visionSky={visionSky}
                    buildingVariant={buildingVariant}
                    onBuildingVariantChange={setBuildingVariant}
                    controlsSlot={lens === 'brains' ? null : sceneControls}
                    tick={selectedTick}
                    floors={data.metadata.floors}
                    facadeTilt={data.metadata.facade_tilt}
                    roofPitch={data.metadata.roof_pitch}
                    locationName={data.metadata.location}
                    timeLabel={timeLabel(selectedTick.timestamp, zone)}
                    selected={selectedWall}
                    onSelect={selectSurface}
                    selectedZone={selectedZone}
                    onSelectZone={selectZone}
                    sunTrack={sunTrack}
                    ticks={data.ticks}
                    onSelectTick={(index) => {
                      setPlaying(false)
                      setTimelineIndex(index)
                    }}
                  />
                </div>
                {lens === 'brains' && isControlled && (
                  <div className='absolute inset-0 flex flex-col overflow-hidden p-4 pb-44 sm:p-5 sm:pb-44'>
                    <BrainFlow
                      tick={selectedTick}
                      floors={data.metadata.floors}
                      selectedZone={selectedZoneState}
                      onSelectZone={selectZone}
                      onSimulateWind={(wind) => void applyWind(wind)}
                      site={{
                        latitude: data.metadata.latitude,
                        longitude: data.metadata.longitude,
                        name: data.metadata.location,
                      }}
                    />
                  </div>
                )}
                {lens === 'brains' && !isControlled && (
                  <div className='absolute inset-0 flex items-center justify-center p-6 pb-44'>
                    <section className='console-card max-w-sm text-center'>
                      <h1 className='font-display text-xl font-semibold'>
                        No facade controller
                      </h1>
                      <p className='mt-2 text-sm text-muted-foreground'>
                        This comparison building has no external louvres or
                        actuators.
                      </p>
                      <Link
                        className='run-button-light mt-4'
                        href='/dashboard?view=building'
                      >
                        Choose a controlled building
                      </Link>
                    </section>
                  </div>
                )}
                <div className='stage-toolbar' data-tour='timeline-inspector'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <button
                      aria-label={
                        playing ? 'Pause sun movement' : 'Play sun movement'
                      }
                      aria-pressed={playing}
                      className='play-button'
                      onClick={() => {
                        // Replay from 07:00 when the clock is parked at the end.
                        if (!playing && timelineIndex >= tickCount - 1)
                          setTimelineIndex(0)
                        setPlaying((value) => !value)
                      }}
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
                        : `${selectedOrientation} facade${selectedZoneState ? ` · ${selectedZoneState.zone}` : ''}`}
                    </span>
                    {isControlled && selectedKind === 'wall' && (
                      <StatusBadge
                        mode={selectedController?.mode ?? selectedTick.mode}
                      />
                    )}
                    {isControlled ? (
                      <span
                        className={
                          sensorTrusted ? 'trust-badge' : 'fault-badge'
                        }
                      >
                        {sensorTrusted ? 'Trusted' : 'Rejected'}
                      </span>
                    ) : (
                      <span className='stage-chip'>No controller</span>
                    )}
                    <span className='ml-auto text-[10px] uppercase tracking-wider text-muted-foreground'>
                      {`Day ${timeLabel(data.ticks[0].timestamp, zone)}-${timeLabel(
                        data.ticks[data.ticks.length - 1].timestamp,
                        zone
                      )} · ${data.ticks.length} ticks`}
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
                    ) : !isControlled ? (
                      <>
                        <span className='stage-chip'>
                          {(
                            irradianceComparison?.baseline ??
                            selectedWallState?.incident ??
                            0
                          ).toFixed(0)}{' '}
                          W/m² before glazing
                        </span>
                        <span className='stage-chip'>
                          {baselineSurfaceTemperature(
                            irradianceComparison?.baseline ??
                              selectedWallState?.incident ??
                              0,
                            selectedTick.outdoor_temp,
                            selectedTick.wind
                          ).toFixed(1)}{' '}
                          °C surface estimate
                        </span>
                      </>
                    ) : (
                      <>
                        <span className='stage-chip'>
                          {(
                            selectedController?.angle ??
                            selectedTick.angle_final
                          ).toFixed(1)}
                          ° angle
                        </span>
                        <span className='stage-chip'>
                          {(
                            selectedController?.lux ?? selectedTick.lux
                          ).toFixed(0)}{' '}
                          lux
                        </span>
                        <span className='stage-chip'>
                          {(
                            selectedZoneState?.sensors?.irradiance ??
                            selectedController?.incident ??
                            selectedTick.measured_irradiance
                          ).toFixed(0)}{' '}
                          W/m² {selectedZoneState ? 'zone sensor' : 'on wall'}
                        </span>
                        <span className='stage-chip'>
                          {(
                            selectedController?.load_relative ??
                            selectedTick.load_relative
                          ).toFixed(3)}{' '}
                          load
                        </span>
                        {selectedController && (
                          <span className='stage-chip'>
                            {selectedController.sol_air_temp.toFixed(1)} °C
                            surface
                          </span>
                        )}
                      </>
                    )}
                    <span className='stage-chip'>
                      {selectedTick.wind.toFixed(1)} m/s
                    </span>
                    <span className='stage-chip'>
                      {selectedTick.outdoor_temp.toFixed(1)} °C
                    </span>
                  </div>
                  {selectedWallState && lens === 'building' && (
                    <details className='text-[10px] leading-4 text-muted-foreground'>
                      <summary className='cursor-pointer'>
                        Selected action details
                      </summary>
                      <p className='mt-1'>
                        {isControlled
                          ? (selectedZoneState?.reason ??
                            selectedWallState.reason)
                          : 'Same structure, glazing and roof; external louvres, actuators and mechatronic controller removed.'}
                      </p>
                    </details>
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

          <RailHandle side='right' label='Resize scene controls' />

          <aside
            className='console-rail console-rail-right'
            aria-label='Scene controls and sky monitoring'
          >
            <LiveHardwarePanel
              tick={isControlled ? (selectedTick ?? null) : null}
              onModeChange={setHardwareMode}
            />
            {lens === 'floor' &&
              csiView &&
              selectedTick &&
              (floorFocused ? (
                <FloorSectionPanel
                  key={`${selectedOrientation}-${band}-${selectedZone ?? 'all'}`}
                  tick={selectedTick}
                  orientation={selectedOrientation}
                  band={band}
                  controlled={isControlled}
                  zone={selectedZone}
                  compact
                  activity={csiActivity}
                  onActivityChange={setCsiActivity}
                />
              ) : (
                <section className='console-card'>
                  <p className='console-card-title'>CSI X-ray · simulated</p>
                  <p className='mt-2 text-xs'>
                    Select a floor in the model or the floor list to inspect its
                    Ev / Et comfort response.
                  </p>
                </section>
              ))}
            {/* Portal target for the 3D view's scene controls. Kept childless
                so React and the portal never fight over the same node. */}
            <div ref={setSceneControls} />
            <CloudVisionPanel
              onObservation={updateSkyObservation}
              onSkyChange={setVisionSky}
              onAgeChange={setVisionAgeSeconds}
            />
          </aside>
        </div>
      </div>
    </div>
  )
}
