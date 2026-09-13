'use client'

import type { DaylightProbePayload, DaylightStatusPayload } from '@/lib/types'
import evidence from '@/lib/daylight-blindness-results.json'

export function daylightColor(
  probe: DaylightProbePayload,
  status: DaylightStatusPayload
) {
  const value =
    probe.kind === 'seat' ? probe.eye_illuminance : probe.task_illuminance
  if (status.night) return '#a8b0ad'
  if (value == null) return null
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
    (p) => p.kind === 'seat' && p.eye_illuminance != null
  )
  const over = available.filter(
    (p) => p.eye_illuminance! > status.ev_cap_lux
  ).length
  return (
    <div className='mt-3 border-t pt-3' aria-label='Daylight at occupied seats'>
      <p className='console-card-title'>
        Daylight at occupied seats · modelled
      </p>
      <p className='mt-2 text-xs' aria-live='polite'>
        {status.night
          ? 'Night / low sun · seats grey; illuminance unavailable'
          : `${over} of ${available.length} seats over the ${status.ev_cap_lux} lux eye-illuminance cap`}
      </p>
      <p className='mt-1 text-[10px] text-muted-foreground'>
        {status.occupied
          ? 'Occupied tick.'
          : 'Unoccupied tick; fixed probe estimates.'}{' '}
        Seats: green to red at the cap. Desks: blue below, green within, amber
        above {status.et_band_low_lux}–{status.et_band_high_lux} lux.
        Uncalibrated room model; controller decisions do not use these
        estimates.
      </p>
      {!status.night && (
        <details className='mt-2 text-xs'>
          <summary>Seat and desk readings</summary>
          <ul className='mt-2 space-y-1'>
            {probes
              .filter(
                (p) =>
                  (p.kind === 'seat'
                    ? p.eye_illuminance
                    : p.task_illuminance) != null
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
