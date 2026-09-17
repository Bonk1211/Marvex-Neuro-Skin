'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  getHardwareStatus,
  setHardwareControl,
  type HardwarePanelId,
  type HardwareStatus,
} from '@/lib/api-client'
import type { TickPayload } from '@/lib/types'

// Physical 2×2 seen from outside: BH1/BH2 top row, BH3/BH4 bottom row.
export const PANELS: HardwarePanelId[] = ['bh1', 'bh2', 'bh3', 'bh4']

/** The twin's angle for every zone the rig mirrors, or null if any is missing. */
export function twinAngles(
  tick: TickPayload | null,
  zones: string[]
): Record<string, number> | null {
  const angles = new Map(
    (tick?.facade ?? [])
      .flatMap((wall) => wall.zones ?? [])
      .map((zone) => [zone.zone, zone.angle])
  )
  if (!zones.length || zones.some((zone) => !angles.has(zone))) return null
  return Object.fromEntries(
    zones.map((zone) => [zone, angles.get(zone) as number])
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
  onError: (message: string | null) => void
) {
  return request
    .then((status) => {
      onStatus(asStatus(status))
      onError(null)
    })
    .catch((caught: unknown) =>
      onError(
        caught instanceof Error ? caught.message : 'Hardware request failed.'
      )
    )
}

export function connectionLabel(status: HardwareStatus | null) {
  if (!status) return 'backend unreachable'
  if (status.online) return `online · ${status.last_seen_s}s`
  return status.last_seen_s === null
    ? 'waiting for ESP32'
    : `offline · ${status.last_seen_s}s ago`
}

/** Polls live hardware status once a second, with FeedsPanel's abort/timeout loop. */
export function useHardwareStatus() {
  const [status, setStatus] = useState<HardwareStatus | null>(null)

  useEffect(() => {
    let controller: AbortController | null = null
    const refresh = async () => {
      controller?.abort()
      const pending = new AbortController()
      controller = pending
      const timeout = setTimeout(() => pending.abort(), 900)
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
    const timer = setInterval(() => void refresh(), 1000)
    return () => {
      controller?.abort()
      clearInterval(timer)
    }
  }, [])

  return [status, setStatus] as const
}

export function LiveHardwarePanel({ tick }: { tick: TickPayload | null }) {
  const [status, setStatus] = useHardwareStatus()
  const [error, setError] = useState<string | null>(null)

  const zones = status ? PANELS.map((panel) => status.panels[panel].zone) : []
  const mirror = twinAngles(tick, zones)
  const mirrorKey = mirror ? JSON.stringify(mirror) : null
  const mode = status?.mode

  // The backend reverts to auto 30 s after the last push; refresh well inside that.
  useEffect(() => {
    if (mode !== 'twin' || !mirrorKey) return
    const angles = JSON.parse(mirrorKey) as Record<string, number>
    const push = () =>
      void settle(
        setHardwareControl({ mode: 'twin', angles }),
        setStatus,
        setError
      )
    push()
    const timer = setInterval(push, 5000)
    return () => clearInterval(timer)
  }, [mode, mirrorKey, setStatus])

  const toggle = (active: boolean) =>
    `rounded border px-2 py-1 text-[10px] font-semibold disabled:opacity-50 ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary/60'}`

  return (
    <section className='console-card' aria-label='Live hardware'>
      <h3 className='console-card-title flex justify-between gap-2'>
        <span>Live hardware · ESP32</span>
        <span
          className={status?.online ? 'text-emerald-700' : 'text-amber-700'}
        >
          {connectionLabel(status)}
        </span>
      </h3>
      <div
        role='group'
        aria-label='Servo control source'
        className='mt-2 flex gap-1'
      >
        <button
          type='button'
          aria-pressed={mode === 'auto'}
          disabled={!status}
          className={toggle(mode === 'auto')}
          onClick={() =>
            void settle(
              setHardwareControl({ mode: 'auto' }),
              setStatus,
              setError
            )
          }
        >
          Auto (lux)
        </button>
        <button
          type='button'
          aria-pressed={mode === 'twin'}
          disabled={!status || !mirror}
          title={
            mirror
              ? undefined
              : 'Run a controlled simulation: the twin has no angles for the mapped zones.'
          }
          className={toggle(mode === 'twin')}
          onClick={() =>
            mirror &&
            void settle(
              setHardwareControl({ mode: 'twin', angles: mirror }),
              setStatus,
              setError
            )
          }
        >
          Mirror twin
        </button>
      </div>
      <div
        role='group'
        aria-label='Physical 2 by 2 rig'
        className='mt-2 grid grid-cols-2 gap-1'
      >
        {PANELS.map((panel) => {
          const state = status?.panels[panel]
          return (
            <div
              key={panel}
              title={state?.reason}
              className='min-w-0 rounded border border-border px-1 py-1.5 font-mono text-[10px]'
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
              <span className='mt-0.5 block truncate text-[9px] text-muted-foreground'>
                {state?.mode === 'fault'
                  ? 'sensor fault'
                  : state?.lux != null
                    ? `${state.lux.toFixed(0)} lux`
                    : 'no reading'}
                {state?.target_angle != null
                  ? ` · target ${state.target_angle.toFixed(1)}°`
                  : ''}
              </span>
            </div>
          )
        })}
      </div>
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
