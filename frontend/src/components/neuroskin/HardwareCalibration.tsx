'use client'

import Link from 'next/link'
import { ArrowLeft, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  saveHardwareCalibration,
  setHardwareControl,
  type HardwarePanelId,
  type ServoCalibration,
} from '@/lib/api-client'
import {
  PANELS,
  connectionLabel,
  settle,
  useHardwareStatus,
} from './LiveHardwarePanel'

// Louvre 0° is perpendicular to the facade (the start position), 90° parallel, 180° perpendicular flipped.
const HOLD_ANGLES = [0, 45, 90, 135, 180]
const NUDGES = [-10, -1, 1, 10]
const ENDPOINTS: Array<[keyof ServoCalibration, string]> = [
  ['servo_at_0', 'Servo at louvre 0° (perpendicular)'],
  ['servo_at_180', 'Servo at louvre 180° (perpendicular, flipped)'],
]
const START = Object.fromEntries(PANELS.map((panel) => [panel, 0])) as Record<
  HardwarePanelId,
  number
>

export function HardwareCalibration() {
  const [status, setStatus] = useHardwareStatus()
  const [error, setError] = useState<string | null>(null)
  const calibrating = status?.mode === 'calibrate'
  const heldKey = calibrating
    ? JSON.stringify({ ...START, ...status.held })
    : null

  // Holds expire 30 s after the last push (like twin mirroring), so keep them alive.
  useEffect(() => {
    if (!heldKey) return
    const angles = JSON.parse(heldKey) as Record<HardwarePanelId, number>
    const timer = setInterval(
      () =>
        void settle(
          setHardwareControl({ mode: 'calibrate', angles, refresh_only: true }),
          setStatus,
          setError
        ),
      5000
    )
    return () => clearInterval(timer)
  }, [heldKey, setStatus])

  const control = (mode: 'auto' | 'calibrate', angles = START) =>
    void settle(
      setHardwareControl(mode === 'auto' ? { mode } : { mode, angles }),
      setStatus,
      setError
    )

  const hold = (panel: HardwarePanelId, angle: number) =>
    control('calibrate', { ...START, ...status?.held, [panel]: angle })

  // ponytail: each change builds on the last status; a poll landing mid-save can
  // drop one nudge, which is visible on the rig and simply repeated.
  const saveCalibration = (
    panel: HardwarePanelId,
    change: (current: ServoCalibration) => ServoCalibration
  ) => {
    if (!status?.calibration) return
    const panels = {
      ...status.calibration,
      [panel]: change(status.calibration[panel]),
    }
    void settle(saveHardwareCalibration(panels), setStatus, setError)
  }

  return (
    <main className='min-h-screen bg-secondary/40 px-4 py-6 sm:px-8'>
      <div className='mx-auto max-w-5xl'>
        <header className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <p className='eyebrow flex items-center gap-1.5'>
              <Wrench className='h-3 w-3' /> Hardware
            </p>
            <h1 className='mt-1 font-display text-2xl font-semibold tracking-tight'>
              Actuator calibration
            </h1>
            <p className='mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground'>
              Hold each louvre at a known angle, then nudge its servo until the
              physical louvre matches. Every change is saved on the backend and
              reaches the ESP32 within one tick.
            </p>
          </div>
          <Link className='landing-nav-cta' href='/dashboard'>
            <ArrowLeft className='h-3.5 w-3.5' /> Back to twin
          </Link>
        </header>

        <section
          aria-label='Calibration session'
          className='surface-card mt-5 flex flex-wrap items-center justify-between gap-3 p-4'
        >
          <p className='text-xs'>
            ESP32{' '}
            <span
              className={
                status?.online
                  ? 'font-semibold text-emerald-700'
                  : 'font-semibold text-amber-700'
              }
            >
              {connectionLabel(status)}
            </span>
            {status && (
              <>
                {' · mode '}
                <span className='font-semibold'>{status.mode}</span>
              </>
            )}
          </p>
          {calibrating ? (
            <button
              type='button'
              className='rounded-xl border border-border bg-white px-4 py-2 text-xs font-semibold hover:bg-secondary'
              onClick={() => control('auto')}
            >
              Finish · return to auto
            </button>
          ) : (
            <button
              type='button'
              disabled={!status}
              className='rounded-xl bg-forest px-4 py-2 text-xs font-semibold text-white hover:bg-forest/90 disabled:opacity-50'
              onClick={() => control('calibrate')}
            >
              Start calibration
            </button>
          )}
        </section>

        {error && (
          <p
            role='alert'
            className='mt-3 rounded-xl bg-rose-50 px-4 py-2 text-xs text-rose-700'
          >
            {error}
          </p>
        )}

        <div className='mt-4 grid gap-4 md:grid-cols-2'>
          {PANELS.map((panel) => {
            const live = status?.panels[panel]
            const calibration = status?.calibration?.[panel]
            const held = calibrating ? (status.held[panel] ?? 0) : null
            const label = panel.toUpperCase()
            return (
              <section
                key={panel}
                aria-label={`${label} calibration`}
                className='surface-card p-4'
              >
                <h2 className='flex flex-wrap justify-between gap-2 text-sm font-semibold'>
                  <span>
                    {label} → {live?.zone ?? '—'}
                  </span>
                  <span className='font-mono text-xs font-normal text-muted-foreground'>
                    {live?.commanded_angle != null
                      ? `${live.commanded_angle.toFixed(1)}° commanded`
                      : 'no reading'}
                    {live?.lux != null ? ` · ${live.lux.toFixed(0)} lux` : ''}
                  </span>
                </h2>

                <p className='field-label mt-3'>Hold louvre at</p>
                <div
                  role='group'
                  aria-label={`${label} hold angle`}
                  className='setting-segments mt-1 grid-cols-5'
                >
                  {HOLD_ANGLES.map((angle) => (
                    <button
                      key={angle}
                      type='button'
                      disabled={!calibrating}
                      aria-pressed={held === angle}
                      className={
                        held === angle
                          ? 'setting-segment-active'
                          : 'setting-segment disabled:opacity-50'
                      }
                      onClick={() => hold(panel, angle)}
                    >
                      {angle}°
                    </button>
                  ))}
                </div>

                {ENDPOINTS.map(([key, endpoint]) => (
                  <div key={key} className='mt-3'>
                    <p className='field-label'>{endpoint}</p>
                    <div
                      role='group'
                      aria-label={`${label} ${endpoint}`}
                      className='mt-1 flex items-center gap-1'
                    >
                      {NUDGES.map((delta, index) => (
                        <span key={delta} className='contents'>
                          {index === NUDGES.length / 2 && (
                            <output className='w-14 text-center font-mono text-sm font-semibold'>
                              {calibration
                                ? `${calibration[key].toFixed(0)}°`
                                : '—'}
                            </output>
                          )}
                          <button
                            type='button'
                            disabled={!calibrating || !calibration}
                            aria-label={`${label} ${endpoint} ${delta > 0 ? 'plus' : 'minus'} ${Math.abs(delta)}`}
                            className='min-w-10 rounded-lg border border-border bg-white px-2 py-1.5 font-mono text-[11px] font-semibold hover:bg-secondary disabled:opacity-50'
                            onClick={() =>
                              saveCalibration(panel, (current) => ({
                                ...current,
                                [key]: Math.min(
                                  180,
                                  Math.max(0, current[key] + delta)
                                ),
                              }))
                            }
                          >
                            {delta > 0 ? `+${delta}` : delta}
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}

                <button
                  type='button'
                  disabled={!calibrating || !calibration}
                  className='mt-3 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50'
                  onClick={() =>
                    saveCalibration(panel, (current) => ({
                      servo_at_0: current.servo_at_180,
                      servo_at_180: current.servo_at_0,
                    }))
                  }
                >
                  Swap direction
                </button>
              </section>
            )
          })}
        </div>

        <section className='surface-card mt-4 p-4 text-xs leading-relaxed text-muted-foreground'>
          <h2 className='text-sm font-semibold text-foreground'>Procedure</h2>
          <ol className='mt-2 list-decimal space-y-1 pl-4'>
            <li>
              Start calibration: every louvre holds its start position (0°) and
              auto lux control pauses.
            </li>
            <li>
              For each panel, nudge <em>Servo at louvre 0°</em> until the louvre
              is perpendicular to the building.
            </li>
            <li>
              Hold 180° and nudge <em>Servo at louvre 180°</em> until the louvre
              is perpendicular again with the blade flipped. Hold 90° to check
              it lies parallel to the building.
            </li>
            <li>
              If the louvre turns the wrong way from 0° toward 90°, press{' '}
              <em>Swap direction</em>.
            </li>
            <li>
              Finish to return to auto. Closing this page also returns to auto
              after 30 s.
            </li>
          </ol>
          <p className='mt-2'>
            Calibration is stored in{' '}
            <code>backend/data/hardware_calibration.json</code> and survives
            restarts. The ESP32 uses its compiled defaults (servo 0°/180°, the
            SG90&apos;s full travel) until its first backend reply after boot.
            Auto lux control shades within 0–90°. The pulse range and PCA9685
            oscillator stay firmware constants.
          </p>
        </section>
      </div>
    </main>
  )
}
