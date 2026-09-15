'use client'

import type { DaylightProbePayload, DaylightStatusPayload } from '@/lib/types'
import evidence from '@/lib/daylight-blindness-results.json'

const validLux = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value >= 0

export function daylightSummary(
  probes: DaylightProbePayload[],
  status?: DaylightStatusPayload | null
) {
  const task =
    status && !status.night
      ? probes.map((p) => p.task_illuminance).filter(validLux)
      : []
  const eye =
    status && !status.night
      ? probes
          .filter((p) => p.kind === 'seat')
          .map((p) => p.eye_illuminance)
          .filter(validLux)
      : []
  return {
    et: task.length
      ? task.reduce((sum, value) => sum + value, 0) / task.length
      : null,
    ev: eye.length ? Math.max(...eye) : null,
  }
}

export function daylightColor(
  probe: DaylightProbePayload,
  status: DaylightStatusPayload
) {
  const value =
    probe.kind === 'seat' ? probe.eye_illuminance : probe.task_illuminance
  if (status.night) return '#a8b0ad'
  if (!validLux(value)) return null
  if (probe.kind === 'desk')
    return value < status.et_band_low_lux
      ? '#6484a0'
      : value > status.et_band_high_lux
        ? '#d69b48'
        : '#43836c'
  // Only the colour saturates; the readout retains the full illuminance.
  return `hsl(${120 * (1 - Math.min(1, value / status.ev_cap_lux))}, 60%, 42%)`
}

export function DaylightReadout({
  probes,
  status,
}: {
  probes: (DaylightProbePayload & { zone?: string })[]
  status: DaylightStatusPayload
}) {
  const available = probes.filter(
    (p) => p.kind === 'seat' && validLux(p.eye_illuminance)
  )
  const over = available.filter(
    (p) => p.eye_illuminance! > status.ev_cap_lux
  ).length
  const summary = daylightSummary(probes, status)
  return (
    <div className='mt-3 border-t pt-3' aria-label='Daylight at occupied seats'>
      <p className='flex items-center justify-between gap-2'>
        <span className='console-card-title'>Daylight prediction</span>
        <span className='rounded-full bg-secondary px-2 py-0.5 text-[9px] font-medium'>
          Observe-only
        </span>
      </p>
      <dl className='mt-3 grid grid-cols-2 gap-2'>
        <div className='rounded-lg border bg-background p-2'>
          <dt className='text-[10px] text-muted-foreground'>
            Et · mean work-plane
          </dt>
          <dd className='mt-1 font-mono text-lg'>
            {summary.et?.toFixed(0) ?? '—'} <span className='text-xs'>lux</span>
          </dd>
        </div>
        <div className='rounded-lg border bg-background p-2'>
          <dt className='text-[10px] text-muted-foreground'>
            Ev · highest at a seat
          </dt>
          <dd className='mt-1 font-mono text-lg'>
            {summary.ev?.toFixed(0) ?? '—'} <span className='text-xs'>lux</span>
          </dd>
        </div>
      </dl>
      <p
        className={`mt-2 text-xs ${!status.night && over ? 'text-amber-800' : 'text-muted-foreground'}`}
        aria-live='polite'
      >
        {status.night
          ? 'Night / low sun · seats grey; illuminance unavailable'
          : !available.length
            ? 'Seat predictions unavailable'
            : `${over} of ${available.length} seats over the ${status.ev_cap_lux} lux eye-illuminance cap`}
      </p>
      <p className='mt-1 text-[10px] text-muted-foreground'>
        {status.occupied
          ? 'Simulated occupied tick'
          : 'Simulated unoccupied tick'}{' '}
        · uncalibrated
      </p>
      <details className='mt-2 text-[10px] leading-4 text-muted-foreground'>
        <summary className='cursor-pointer'>Colour key & model limits</summary>
        <p className='mt-2'>
          Seats: green to red at the cap. Desks: blue below, green within, amber
          above {status.et_band_low_lux}–{status.et_band_high_lux} lux.
        </p>
        <p className='mt-2'>
          Fixed probe predictions from {status.model}; Et is averaged over the
          work-plane probes. Readings stay at the desks and seats as mock people
          move. Controller decisions do not use these estimates.
        </p>
      </details>
      {!status.night && (
        <details className='mt-2 text-xs'>
          <summary className='cursor-pointer'>Seat and desk readings</summary>
          <ul className='mt-2 max-h-48 space-y-1 overflow-auto'>
            {probes
              .filter((p) =>
                validLux(
                  p.kind === 'seat' ? p.eye_illuminance : p.task_illuminance
                )
              )
              .map((p, index) => {
                const value =
                  p.kind === 'seat' ? p.eye_illuminance! : p.task_illuminance!
                return (
                  <li key={index}>
                    <span
                      aria-hidden='true'
                      style={{ color: daylightColor(p, status) ?? undefined }}
                    >
                      ●{' '}
                    </span>
                    {p.zone ? `${p.zone} · ` : ''}
                    {p.kind} {p.index + 1} · {p.kind === 'seat' ? 'Ev' : 'Et'}{' '}
                    {value.toFixed(1)} lux
                    {p.kind === 'seat' && value > status.ev_cap_lux
                      ? ' · over cap'
                      : ''}
                    {p.kind === 'seat' && validLux(p.task_illuminance)
                      ? ` · Et ${p.task_illuminance.toFixed(1)} lux`
                      : ''}
                  </li>
                )
              })}
          </ul>
        </details>
      )}
    </div>
  )
}

export function GlareBlindnessPanel() {
  const ours = evidence.results.find(
    (r) => r.controller === 'NeuroSkin (shipped)'
  )!
  return (
    <section className='console-card' aria-label='Glare blindness'>
      <p className='console-card-title'>Glare blindness · modelled</p>
      <p className='mt-2 text-xs'>
        The shipped controller left at least one seat above the{' '}
        {evidence.ev_cap_lux} lux eye cap during{' '}
        {ours.ev_exceedance_percent.toFixed(2)}% of occupied daylight hours. Its
        decisions never used Ev.
      </p>
      <div className='mt-3 overflow-x-auto'>
        <table className='w-full text-left text-[10px]'>
          <caption className='mb-2 text-left'>
            Oracle experiment · {evidence.days.length} seeded days · seed{' '}
            {evidence.seed}
          </caption>
          <thead>
            <tr>
              <th>Controller</th>
              <th>Any seat over cap</th>
              <th>Et in band</th>
              <th>Moves</th>
              <th>Relative load</th>
            </tr>
          </thead>
          <tbody>
            {evidence.results.map((r) => (
              <tr key={r.controller}>
                <th className='py-2 pr-2 font-normal'>{r.controller}</th>
                <td>{r.ev_exceedance_percent.toFixed(2)}%</td>
                <td>{r.et_in_band_percent.toFixed(2)}%</td>
                <td>{r.movement_count.toLocaleString('en-US')}</td>
                <td>{r.mean_relative_load.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className='mt-2 text-[10px] text-muted-foreground'>
        Fixed offline experiment: all 16 illustrative rooms, {evidence.days[0]}–
        {evidence.days.at(-1)}; independent of the current timeline. Any-seat
        hours count the union at each tick; Et uses seat-hours in{' '}
        {evidence.et_band_low_lux}–{evidence.et_band_high_lux} lux. Moves sum
        all 64 actuators over complete days. NeuroSkin did not beat naive on
        this measure. This is a screening proxy, not measured discomfort or
        proof that different control would prevent it.
      </p>
    </section>
  )
}
