'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  getHardwareStatus,
  setHardwareControl,
  type HardwareControl,
  type HardwarePanelId,
  type HardwareStatus,
} from '@/lib/api-client'
import type { TickPayload } from '@/lib/types'

// Physical 2×2 seen from outside: BH1/BH2 top row, BH3/BH4 bottom row.
export const PANELS: HardwarePanelId[] = ['bh1', 'bh2', 'bh3', 'bh4']

/** Hardware targets for the mapped zones, or null if any twin angle is missing. */
export function twinAngles(
  tick: TickPayload | null,
  zones: string[],
  meetingDemo = false
): Record<string, number> | null {
  const angles = new Map(
    (tick?.facade ?? [])
      .flatMap((wall) => wall.zones ?? [])
      .map((zone) => [zone.zone, zone.angle])
  )
  if (
    !zones.length ||
    zones.some((zone) => {
      const angle = angles.get(zone)
      return (
        angle == null || !Number.isFinite(angle) || angle < 0 || angle > 180
      )
    })
  )
    return null
  return Object.fromEntries(
    zones.map((zone) => [
      zone,
      // Explicit prototype travel demo; optical predictions keep their solved angle.
      meetingDemo && tick?.meeting_demo && zone === 'W13'
        ? tick.meeting_demo === 'ready'
          ? 0
          : 180
        : (angles.get(zone) as number),
    ])
  )
}

// A body without panels (older backend, proxy page) must not crash the dashboard.
function asStatus(body: HardwareStatus | null | undefined) {
  return body?.panels ? body : null
}

/** Applies a hardware response to page state, or reports why it failed. */
export function settle(
  request: Promise<HardwareStatus>,
  onStatus: (status: HardwareStatus | null) => void,
  onError: (message: string | null) => void,
  signal?: AbortSignal
) {
  return request
    .then((status) => {
      if (signal?.aborted) return
      onStatus(asStatus(status))
      onError(null)
    })
    .catch((caught: unknown) => {
      if (!signal?.aborted)
        onError(
          caught instanceof Error ? caught.message : 'Hardware request failed.'
        )
    })
}

export function connectionLabel(status: HardwareStatus | null) {
  if (!status) return 'backend unreachable'
  if (status.online) return `online · ${status.last_seen_s}s`
  return status.last_seen_s === null
    ? 'waiting for ESP32'
    : `offline · ${status.last_seen_s}s ago`
}

/** Polls hardware status (1 s default, 500 ms for CSI) with an abort/timeout loop. */
export function useHardwareStatus(intervalMs = 1000) {
  const [status, setStatus] = useState<HardwareStatus | null>(null)

  useEffect(() => {
    let controller: AbortController | null = null
    const refresh = async () => {
      controller?.abort()
      const pending = new AbortController()
      controller = pending
      const timeout = setTimeout(
        () => pending.abort(),
        Math.min(900, intervalMs)
      )
      try {
        const result = await getHardwareStatus(pending.signal)
        if (!pending.signal.aborted) setStatus(asStatus(result))
      } catch {
        setStatus(null)
      } finally {
        clearTimeout(timeout)
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), intervalMs)
    return () => {
      controller?.abort()
      clearInterval(timer)
    }
  }, [intervalMs])

  return [status, setStatus] as const
}

export function LiveHardwarePanel({
  tick,
  sensorOnly = false,
  meetingDemo = false,
  onModeChange,
  onMeetingAngleChange,
}: {
  tick: TickPayload | null
  sensorOnly?: boolean
  meetingDemo?: boolean
  onModeChange?: (mode: HardwareStatus['mode'] | null) => void
  onMeetingAngleChange?: (angle: number | null) => void
}) {
  const [status, setStatus] = useHardwareStatus(meetingDemo ? 500 : 1000)
  const [error, setError] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  // Only the page where Follow simulation was selected may stream its timeline.
  const [following, setFollowing] = useState(false)
  const [meetingHolds, setMeetingHolds] = useState<Record<
    string,
    number
  > | null>(null)
  const pendingControl = useRef<AbortController | null>(null)

  const zones = status ? PANELS.map((panel) => status.panels[panel].zone) : []
  const twin = twinAngles(tick, zones, meetingDemo)
  const mirror =
    meetingDemo && meetingHolds && twin
      ? { ...meetingHolds, W13: twin.W13 }
      : twin
  const mirrorKey = mirror ? JSON.stringify(mirror) : null
  const mode = status?.mode
  const meetingAngle = status?.panels.bh1.commanded_angle
  useEffect(() => {
    onMeetingAngleChange?.(
      meetingDemo &&
        following &&
        status?.online &&
        mode === 'twin' &&
        meetingAngle != null &&
        Number.isFinite(meetingAngle) &&
        meetingAngle >= 0 &&
        meetingAngle <= 180
        ? meetingAngle
        : null
    )
  }, [
    meetingDemo,
    following,
    status?.online,
    mode,
    meetingAngle,
    onMeetingAngleChange,
  ])

  useEffect(() => {
    onModeChange?.(mode ?? null)
    if (mode !== 'twin') setFollowing(false)
  }, [mode, onModeChange])

  useEffect(() => {
    if (meetingDemo && !meetingHolds) setFollowing(false)
    if (meetingDemo || !meetingHolds) return
    setFollowing(false)
    setMeetingHolds(null)
    if (following && mode === 'twin')
      void settle(setHardwareControl({ mode: 'auto' }), setStatus, setError)
  }, [meetingDemo, meetingHolds, setStatus, following, mode])

  // Opening the dedicated demo disconnects any running twin immediately.
  useEffect(() => {
    if (!sensorOnly) return
    const controller = new AbortController()
    void settle(
      setHardwareControl({ mode: 'auto' }, controller.signal),
      setStatus,
      setError,
      controller.signal
    )
    return () => controller.abort()
  }, [sensorOnly, setStatus])

  // The backend reverts to auto 30 s after the last push; refresh well inside that.
  useEffect(() => {
    if (
      sensorOnly ||
      switching ||
      !following ||
      mode !== 'twin' ||
      !mirrorKey ||
      !!meetingHolds !== meetingDemo
    )
      return
    const controller = new AbortController()
    const angles = JSON.parse(mirrorKey) as Record<string, number>
    const push = () =>
      void settle(
        setHardwareControl(
          { mode: 'twin', angles, refresh_only: true },
          controller.signal
        ),
        setStatus,
        setError,
        controller.signal
      )
    push()
    const timer = setInterval(push, 5000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [
    mode,
    mirrorKey,
    following,
    switching,
    sensorOnly,
    setStatus,
    meetingHolds,
    meetingDemo,
  ])

  const selectMode = async (
    control: HardwareControl,
    holds: Record<string, number> | null = null,
    controller = new AbortController()
  ) => {
    if (pendingControl.current !== controller) pendingControl.current?.abort()
    pendingControl.current = controller
    setSwitching(true)
    setFollowing(false)
    await settle(
      setHardwareControl(control, controller.signal),
      (next) => {
        setStatus(next)
        setMeetingHolds(
          control.mode === 'twin' && next?.mode === 'twin' ? holds : null
        )
        setFollowing(control.mode === 'twin' && next?.mode === 'twin')
      },
      setError,
      controller.signal
    )
    if (pendingControl.current === controller) setSwitching(false)
  }

  const followSimulation = async (controller = new AbortController()) => {
    pendingControl.current?.abort()
    pendingControl.current = controller
    setSwitching(true)
    setFollowing(false)
    try {
      // Read the rig at the click, so a stale poll cannot freeze the wrong poses.
      const current = meetingDemo
        ? asStatus(await getHardwareStatus(controller.signal))
        : status
      if (controller.signal.aborted) return
      const angles = twinAngles(
        tick,
        current ? PANELS.map((panel) => current.panels[panel].zone) : [],
        meetingDemo
      )
      if (
        !current ||
        !angles ||
        (meetingDemo &&
          (!current.online ||
            !('W13' in angles) ||
            PANELS.some(
              (panel) => !Number.isFinite(current.panels[panel].commanded_angle)
            )))
      )
        throw new Error(
          'Hardware did not connect. Check ESP32 power and Wi-Fi, then reset and retry Simulate glare.'
        )
      const held = meetingDemo
        ? (meetingHolds ??
          Object.fromEntries(
            PANELS.map((panel) => [
              current.panels[panel].zone,
              current.panels[panel].commanded_angle!,
            ])
          ))
        : null
      await selectMode(
        { mode: 'twin', angles: held ? { ...held, W13: angles.W13 } : angles },
        held,
        controller
      )
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : 'Hardware connection failed.'
        )
    } finally {
      if (pendingControl.current === controller) setSwitching(false)
    }
  }
  const followAction = useRef(followSimulation)
  followAction.current = followSimulation
  const meetingStage = meetingDemo ? tick?.meeting_demo : null
  useEffect(() => {
    if (meetingStage !== 'glare') return
    const controller = new AbortController()
    void followAction.current(controller)
    return () => controller.abort()
  }, [meetingStage])
  useEffect(() => () => pendingControl.current?.abort(), [])

  const toggle = (active: boolean) =>
    `rounded border px-2 py-1 text-[10px] font-semibold disabled:opacity-50 ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary/60'}`

  return (
    <section className='console-card' aria-label='Live hardware'>
      <h3 className='console-card-title flex justify-between gap-2'>
        <span>Hardware demo · ESP32</span>
        <span
          className={status?.online ? 'text-emerald-700' : 'text-amber-700'}
        >
          {connectionLabel(status)}
        </span>
      </h3>
      <div
        role='group'
        aria-label='Demo mode'
        className='mt-2 flex flex-wrap gap-1'
      >
        {!sensorOnly && (
          <button
            type='button'
            aria-pressed={mode === 'twin' && following}
            disabled={
              !status ||
              !mirror ||
              switching ||
              (meetingDemo &&
                (!status.online ||
                  !zones.includes('W13') ||
                  PANELS.some(
                    (panel) => status.panels[panel].commanded_angle == null
                  )))
            }
            title={
              mirror
                ? undefined
                : 'Run a controlled simulation: the twin has no angles for the mapped zones.'
            }
            className={toggle(mode === 'twin' && following)}
            onClick={() => void followSimulation()}
          >
            {meetingDemo ? '1 · Follow meeting demo' : '1 · Follow simulation'}
          </button>
        )}
        <button
          type='button'
          aria-pressed={mode === 'auto'}
          disabled={!status || switching}
          className={toggle(mode === 'auto')}
          onClick={() => void selectMode({ mode: 'auto' })}
        >
          2 · Sensor only
        </button>
      </div>
      <p className='mt-2 text-xs leading-relaxed text-muted-foreground'>
        {meetingDemo
          ? 'Simulate glare drives BH1 through the 0°–180° prototype sweep. The other three panels hold. Ev/Et and sunlight use the modelled W13 shading angle; the prototype demonstrates full travel.'
          : mode === 'twin'
            ? following
              ? 'Play or run the simulation: these four panels follow their mapped zones. Playback uses 1 second per tick.'
              : 'Simulation control is active in another view. Select a demo here to take control.'
            : mode === 'auto'
              ? `Each BH1750 controls only its own actuator: above ${status?.lux_band[1]} lux shades, below ${status?.lux_band[0]} lux opens; inside the band holds. Simulation angles are disconnected.`
              : 'Select the control source for the physical 2×2 prototype.'}
      </p>
      <div
        role='group'
        aria-label='Physical 2 by 2 rig'
        className={`mt-2 grid grid-cols-2 ${sensorOnly ? 'gap-3' : 'gap-1'}`}
      >
        {PANELS.map((panel) => {
          const state = status?.panels[panel]
          return (
            <div
              key={panel}
              title={state?.reason}
              aria-label={`${panel.toUpperCase()} panel`}
              className={`min-w-0 rounded border font-mono ${sensorOnly ? 'p-4 text-sm' : 'px-1 py-1.5 text-[10px]'} ${status?.online && state?.lux != null && state.lux > status.lux_band[1] ? 'border-amber-400 bg-amber-50' : 'border-border'}`}
            >
              <span className='flex justify-between gap-1 font-semibold'>
                <span>
                  {panel.toUpperCase()} → {state?.zone ?? '—'}
                </span>
                <span>
                  {state?.commanded_angle != null
                    ? `${state.commanded_angle.toFixed(1)}°`
                    : '—'}
                </span>
              </span>
              <span className='mt-1 block text-muted-foreground'>
                {state?.mode === 'fault' ||
                (state?.lux === null && state.commanded_angle !== null)
                  ? 'sensor fault'
                  : state?.lux != null
                    ? `${state.lux.toFixed(0)} lux`
                    : 'no reading'}
                {state?.target_angle != null
                  ? ` · target ${state.target_angle.toFixed(1)}°`
                  : ''}
              </span>
              {meetingDemo && following && (
                <p className='mt-1 font-semibold'>
                  {state?.zone === 'W13'
                    ? 'Meeting room · follows glare response'
                    : 'Unchanged · holding captured angle'}
                </p>
              )}
              <p className='mt-1 text-[10px] leading-relaxed text-muted-foreground'>
                {state?.reason ?? 'Waiting for a sensor reading.'}
              </p>
            </div>
          )
        })}
      </div>
      {!sensorOnly && (
        <Link
          className='mt-2 block text-xs font-semibold text-primary hover:underline'
          href='/demo'
        >
          Open sensor-only demo →
        </Link>
      )}
      {mode === 'calibrate' && (
        <p className='mt-2 text-[10px] font-semibold text-amber-700'>
          Calibration in progress: louvres hold the angles set on the
          calibration page.
        </p>
      )}
      {error && (
        <p role='alert' className='mt-2 text-[10px] text-rose-700'>
          {error}
        </p>
      )}
      <p className='mt-2 flex justify-between gap-2 text-[10px] text-muted-foreground'>
        <span>Measured lux; angles are commanded, not measured.</span>
        <Link
          className='shrink-0 font-semibold text-primary hover:underline'
          href='/hardware'
        >
          Calibrate →
        </Link>
      </p>
    </section>
  )
}
