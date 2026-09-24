'use client'

import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { calibrateCsi, type LiveCsiReading } from '@/lib/api-client'
import { connectionLabel, useHardwareStatus } from './LiveHardwarePanel'
import { LiveCsiRoom } from './LiveCsiRoom'

const STATES: Record<LiveCsiReading['state'], [string, string]> = {
  unavailable: [
    'CSI unavailable',
    'Update the bridge firmware and check its Serial Monitor for CSI errors.',
  ],
  no_signal: [
    'No CSI packets',
    'Check the 2.4 GHz hotspot connection. If the gateway blocks ping, send repeated pings from the laptop to the ESP32.',
  ],
  low_rate: [
    'More packets needed',
    'At least 20 CSI frames/s are needed for this motion check. Check hotspot traffic and signal quality.',
  ],
  servos_moving: [
    'Rig moving',
    'Calibration and motion decisions pause while the bridge commands servo movement. Let the louvres settle.',
  ],
  calibrating: [
    'Calibrating empty room',
    'Keep the phone, board and room still while the baseline is collected.',
  ],
  motion: [
    'Signal motion detected',
    'CSI variation exceeded the calibrated threshold. This indicates a channel change, not a person count.',
  ],
  quiet: [
    'Signal quiet',
    'Variation is below the threshold. A still person may remain undetected.',
  ],
  offline: [
    'ESP32 offline',
    'Waiting for fresh measurements. The recorded graph is paused.',
  ],
}

export function LiveCsiPanel() {
  const [status, setStatus] = useHardwareStatus(500)
  const [history, setHistory] = useState<LiveCsiReading[]>([])
  const [calibrating, setCalibrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const csi = status?.online ? status.csi : null
  const [label, explanation] = !status
    ? [
        'Backend unreachable',
        'Start the local backend and connect the ESP32 bridge.',
      ]
    : !status.online
      ? [
          connectionLabel(status),
          'Waiting for the bridge. Graphs only advance when real CSI measurements arrive.',
        ]
      : !csi
        ? [
            'CSI firmware needed',
            'Flash the updated neuroskin_bridge sketch to enable CSI on the same ESP32.',
          ]
        : STATES[csi.state]

  useEffect(() => {
    if (!csi) return
    setHistory((previous) => {
      const last = previous.at(-1)
      if (last?.sample_id === csi.sample_id) return previous
      const reset =
        last &&
        (csi.uptime_ms < last.uptime_ms ||
          csi.calibration_windows < last.calibration_windows)
      const recent = reset
        ? []
        : previous.filter((sample) => sample.sample_id >= csi.sample_id - 60)
      return [...recent.slice(-119), csi]
    })
  }, [csi])

  const recalibrate = async () => {
    setCalibrating(true)
    setError(null)
    try {
      setStatus(await calibrateCsi())
      setHistory([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Calibration failed.')
    } finally {
      setCalibrating(false)
    }
  }

  // Explicit gaps prevent a reconnect from drawing a continuous invented trace.
  const trace = history.flatMap((sample, index) => {
    const previous = history[index - 1]
    const point = { time: sample.sample_id, sigma: sample.sigma }
    return previous && sample.sample_id - previous.sample_id > 2
      ? [{ time: previous.sample_id + 0.5, sigma: null }, point]
      : [point]
  })
  const latest = history.at(-1)?.sample_id ?? 0
  const spectrum =
    csi?.amplitudes.map((amplitude, bin) => ({ bin, amplitude })) ?? []
  const live = !!csi?.frames && csi.enabled

  return (
    <section
      aria-label='Live CSI proof of concept'
      className='absolute inset-x-0 bottom-0 top-24 overflow-y-auto bg-[#edf5f1] px-5 pb-8 pt-3'
    >
      <div className='mx-auto max-w-5xl space-y-4'>
        <header className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <p className='eyebrow'>One ESP32 · measured Wi-Fi channel</p>
            <h2 className='mt-1 font-display text-2xl font-semibold'>
              Live CSI room
            </h2>
            <p className='mt-2 max-w-xl text-xs leading-5 text-muted-foreground'>
              Move near the phone-to-ESP32 link and watch the room respond to
              measured signal changes. CSI updates every 500 ms alongside the
              lux sensors and louvres.
            </p>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-[10px] font-bold tracking-wide ${live ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-white text-slate-600'}`}
          >
            {live ? 'LIVE MEASUREMENTS' : 'WAITING FOR DATA'}
          </span>
        </header>

        <LiveCsiRoom reading={csi} />

        <div className='console-card'>
          <p
            role='status'
            className={`text-lg font-semibold ${csi?.state === 'motion' ? 'text-amber-700' : 'text-primary'}`}
          >
            {label}
          </p>
          <p className='mt-1 text-xs leading-5 text-muted-foreground'>
            {explanation}
          </p>
          {csi && csi.calibration_windows < csi.calibration_required && (
            <div className='mt-3'>
              <label className='text-xs' htmlFor='csi-calibration'>
                Empty-room baseline · {csi.calibration_windows}/
                {csi.calibration_required} windows
              </label>
              <progress
                id='csi-calibration'
                className='mt-1 block h-2 w-full accent-emerald-700'
                value={csi.calibration_windows}
                max={csi.calibration_required}
              />
            </div>
          )}
          <div className='mt-3 flex flex-wrap items-center justify-between gap-3'>
            <span className='font-mono text-xs'>
              Variation σ: {csi?.sigma?.toFixed(2) ?? '—'} · Threshold:{' '}
              {csi?.threshold?.toFixed(2) ?? '—'}
            </span>
            <button
              type='button'
              className='run-button-light disabled:opacity-50'
              disabled={!csi?.enabled || calibrating}
              onClick={() => void recalibrate()}
            >
              {calibrating ? 'Resetting baseline…' : 'Recalibrate empty room'}
            </button>
          </div>
          {error && (
            <p role='alert' className='mt-2 text-xs text-rose-700'>
              {error}
            </p>
          )}
        </div>

        <dl className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
          {[
            ['CSI frames/s', csi?.frames_per_second.toFixed(1) ?? '—'],
            ['RSSI', csi?.rssi != null ? `${csi.rssi} dBm` : '—'],
            ['Wi-Fi channel', csi ? String(csi.channel) : '—'],
            ['Captured bins', live ? String(spectrum.length) : '—'],
          ].map(([name, value]) => (
            <div key={name} className='console-card'>
              <dt className='text-[10px] text-muted-foreground'>{name}</dt>
              <dd className='mt-1 font-mono text-xl font-semibold'>{value}</dd>
            </div>
          ))}
        </dl>

        <div className='console-card'>
          <h3 className='text-sm font-semibold'>
            Signal variation · last 60 seconds
          </h3>
          <p className='mt-1 text-[11px] text-muted-foreground'>
            Measured window standard deviation (relative units). Dashed line:
            current motion threshold.
          </p>
          <div
            className='mt-3 h-56'
            role='img'
            aria-label={`CSI variation over time. ${live ? 'Receiving measured data.' : 'Waiting for fresh data; any history is paused.'}`}
          >
            {trace.length < 2 ? (
              <div className='grid h-full place-items-center rounded-lg border border-dashed text-center text-xs text-muted-foreground'>
                Waiting for measured CSI samples…
              </div>
            ) : (
              <ResponsiveContainer width='100%' height='100%'>
                <LineChart
                  data={trace}
                  margin={{ top: 12, right: 20, bottom: 4, left: -16 }}
                >
                  <CartesianGrid strokeDasharray='3 3' vertical={false} />
                  <XAxis
                    dataKey='time'
                    type='number'
                    domain={[latest - 60, latest]}
                    tickFormatter={(value: number) =>
                      `${Math.round(value - latest)}s`
                    }
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis domain={[0, 'auto']} tick={{ fontSize: 10 }} />
                  <Tooltip
                    labelFormatter={(value) =>
                      `${Math.round(Number(value) - latest)}s`
                    }
                  />
                  {csi?.threshold != null && (
                    <ReferenceLine
                      y={csi.threshold}
                      stroke='#b7791f'
                      strokeDasharray='5 4'
                      ifOverflow='extendDomain'
                    />
                  )}
                  <Line
                    type='linear'
                    dataKey='sigma'
                    name='Variation σ'
                    stroke='#087f9c'
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className='console-card'>
          <h3 className='text-sm font-semibold'>
            Latest packet · CSI amplitude
          </h3>
          <p className='mt-1 text-[11px] text-muted-foreground'>
            Received CSI bins, using |I| + |Q| as relative amplitude. No
            synthetic waveform.
          </p>
          <div
            className='mt-3 h-40'
            role='img'
            aria-label={`Latest measured CSI amplitude across ${spectrum.length} bins`}
          >
            {!spectrum.length ? (
              <div className='grid h-full place-items-center rounded-lg border border-dashed text-xs text-muted-foreground'>
                No current CSI packet
              </div>
            ) : (
              <ResponsiveContainer width='100%' height='100%'>
                <LineChart
                  data={spectrum}
                  margin={{ top: 8, right: 20, bottom: 4, left: -16 }}
                >
                  <CartesianGrid strokeDasharray='3 3' vertical={false} />
                  <XAxis dataKey='bin' tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 'auto']} tick={{ fontSize: 10 }} />
                  <Tooltip labelFormatter={(value) => `CSI bin ${value}`} />
                  <Line
                    type='linear'
                    dataKey='amplitude'
                    stroke='#1b5740'
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <p className='text-xs leading-5 text-muted-foreground'>
          To demonstrate: let the rig settle, recalibrate an empty room, then
          walk through the link and stop. Fans, moving louvres and a moving
          phone can also change CSI. This is a signal-motion experiment; the
          skeletons and room positions in CSI X-ray are simulated.
        </p>
      </div>
    </section>
  )
}
