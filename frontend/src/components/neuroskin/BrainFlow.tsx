'use client'

import { ArrowRight, Eye, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import type { TickPayload, ZoneHeat } from '@/lib/types'
import { daylightSummary } from './DaylightPanel'

const RECOVERY = [
  'Detect',
  'Diagnose',
  'Score evidence',
  'Authorise',
  'Snapshot',
  'Mitigate',
  'Verify',
]

export function BrainFlow({
  tick,
  selectedZone,
  onSelectZone,
}: {
  tick: TickPayload
  selectedZone?: ZoneHeat
  onSelectZone: (id: string | null) => void
}) {
  const zone = selectedZone
  const trusted = zone ? zone.sensor_trusted : tick.sensor_trusted
  const mode = zone?.mode ?? tick.mode
  const target = zone ? zone.angle_target : tick.angle_target
  const final = zone?.angle ?? tick.angle_final
  const primary = tick.facade.find((wall) => wall.primary)
  const scope = zone
    ? `${zone.zone} · local controller`
    : `Primary ${primary?.orientation ?? ''} controller`
  const input = zone?.control_input
  const probes = zone
    ? (zone.conditions?.daylight_probes ?? [])
    : (primary?.zones?.flatMap(
        (entry) => entry.conditions?.daylight_probes ?? []
      ) ?? [])
  const daylight = daylightSummary(probes, tick.daylight)
  const lux = (value: number | null | undefined) =>
    value == null ? '—' : value.toFixed(0)
  return (
    <div className='space-y-4' aria-label='Three-layer brain'>
      <header className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <p className='eyebrow'>One policy · independent local actions</p>
          <h1 className='mt-1 font-display text-2xl font-semibold'>
            Evidence → decision → supervision
          </h1>
        </div>
        <label className='text-xs font-medium'>
          Inspect controller
          <select
            aria-label='Brain controller'
            className='setting-input mt-1 block min-w-48'
            value={zone?.zone ?? ''}
            onChange={(event) => onSelectZone(event.target.value || null)}
          >
            <option value=''>Primary controller</option>
            {tick.facade.map((wall) => (
              <optgroup label={wall.orientation} key={wall.orientation}>
                {wall.zones?.map((entry) => (
                  <option key={entry.zone} value={entry.zone}>
                    {entry.zone} · {entry.angle.toFixed(1)}° · {entry.mode}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </header>
      <p className='text-xs font-medium capitalize'>
        {scope}{' '}
        <span className='ml-2 rounded-full bg-secondary px-2 py-1 text-[10px]'>
          Simulated · selected tick
        </span>
      </p>
      <div
        className='grid gap-3'
        style={{
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
        }}
      >
        <section className='console-card' aria-label='Sensor trust decision'>
          <div className='flex items-center gap-2 text-primary'>
            <ShieldCheck className='h-4 w-4' />
            <h2 className='text-sm font-semibold'>1 · Check inputs</h2>
          </div>
          <p className='mt-3 text-2xl font-semibold'>
            {trusted === undefined
              ? 'Unknown'
              : trusted
                ? 'Accepted'
                : 'Rejected'}
          </p>
          <p className='mt-1 text-xs text-muted-foreground'>
            {zone
              ? 'Local finite/range check'
              : 'Solar/cloud plausibility check'}
          </p>
          <dl className='mt-4 space-y-3 text-xs'>
            <div className='flex justify-between gap-2'>
              <dt>
                Raw{' '}
                {zone?.sensors?.source === 'override'
                  ? 'injected'
                  : 'simulated'}{' '}
                input
              </dt>
              <dd className='font-mono'>
                {lux(
                  zone ? zone.sensors?.irradiance : tick.measured_irradiance
                )}{' '}
                W/m²
              </dd>
            </div>
            <div className='flex justify-between gap-2 border-t pt-3'>
              <dt>{zone ? 'Admitted irradiance' : 'Solar/cloud reference'}</dt>
              <dd className='font-mono'>
                {lux(zone ? input?.irradiance : tick.expected_ghi)} W/m²
              </dd>
            </div>
            {zone && (
              <div className='flex justify-between gap-2'>
                <dt>Open-path lux input</dt>
                <dd className='font-mono'>{lux(input?.open_lux)} lx</dd>
              </div>
            )}
          </dl>
          {input && (
            <p className='mt-3 text-[10px] text-muted-foreground'>
              Irradiance: {input.irradiance_source} · daylight:{' '}
              {input.daylight_source}
            </p>
          )}
          <details className='mt-4 border-t pt-3 text-xs'>
            <summary className='cursor-pointer font-medium'>
              Evidence & limits
            </summary>
            <p className='mt-2 leading-relaxed text-muted-foreground'>
              {zone?.reason ?? tick.reason}
            </p>
            <p className='mt-2 text-muted-foreground'>
              Local range checks can accept an in-range fouled sensor. Full
              local fault diagnosis is planned.
            </p>
            <p className='mt-2 text-muted-foreground'>
              Cloud input:{' '}
              {tick.cloud_source === 'vision'
                ? 'fresh sky-image estimate'
                : 'environment'}{' '}
              · {(tick.cloud * 100).toFixed(0)}% cloud.
            </p>
          </details>
        </section>
        <section className='console-card' aria-label='Prediction and movement'>
          <div className='flex items-center gap-2 text-primary'>
            <SlidersHorizontal className='h-4 w-4' />
            <h2 className='text-sm font-semibold'>2 · Choose an angle</h2>
          </div>
          <div className='mt-3 flex items-end gap-3'>
            <strong className='font-mono text-3xl'>{final.toFixed(1)}°</strong>
            <span className='pb-1 text-xs text-muted-foreground'>
              {mode} · simulated achieved
            </span>
          </div>
          <div
            className='relative mb-5 mt-5 h-2 rounded-full bg-secondary'
            role='img'
            aria-label={`Requested ${target?.toFixed(1) ?? 'unavailable'} degrees, achieved ${final.toFixed(1)} degrees, range 0 to 60`}
          >
            {target !== undefined && (
              <span
                className='bg-sky-600 absolute -top-1 h-4 w-1'
                style={{ left: `${(target / 60) * 100}%` }}
              />
            )}
            <span
              className='absolute -top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white bg-primary shadow'
              style={{ left: `${(final / 60) * 100}%` }}
            />
          </div>
          <p className='text-xs text-muted-foreground'>
            Requested {target?.toFixed(1) ?? '—'}° · mechanical constraints
            apply
          </p>
          <div className='border-sky-700/15 bg-sky-50/60 mt-4 rounded-xl border p-3'>
            <p className='flex items-center gap-2 text-xs font-semibold'>
              <Eye className='h-3.5 w-3.5' />
              Extra Trees daylight{' '}
              <span className='text-sky-800 ml-auto text-[9px] uppercase'>
                Observe only
              </span>
            </p>
            <div className='mt-3 grid grid-cols-2 gap-3 font-mono text-xl'>
              <div>
                {lux(daylight.et)} <span className='text-xs'>lx Et</span>
              </div>
              <div>
                {lux(daylight.ev)} <span className='text-xs'>lx Ev</span>
              </div>
            </div>
            <p className='mt-2 text-[10px] text-muted-foreground'>
              {tick.daylight
                ? tick.daylight.night
                  ? 'Night / low sun · unavailable'
                  : 'Mean work-plane Et · highest seat Ev'
                : 'Enable the daylight model in Floor.'}{' '}
              Predictions do not choose the angle.
            </p>
            {!zone && (
              <p className='mt-2 text-[10px] text-muted-foreground'>
                Across {primary?.orientation} zone probes, each at its own
                achieved angle.
              </p>
            )}
          </div>
          <p className='mt-3 text-xs'>
            Relative load{' '}
            <span className='font-mono'>
              {(zone?.load_relative ?? tick.load_relative).toFixed(3)}
            </span>
          </p>
        </section>
        <section
          className='console-card border-dashed'
          aria-label='Planned fault recovery'
        >
          <div className='flex items-center justify-between gap-2'>
            <h2 className='text-sm font-semibold'>3 · Verify recovery</h2>
            <span className='rounded-full bg-secondary px-2 py-1 text-[9px] font-bold uppercase'>
              Planned
            </span>
          </div>
          <p className='mt-2 text-xs text-muted-foreground'>
            Target workflow · design only
          </p>
          <ol className='mt-4 flex flex-wrap items-center gap-2'>
            {RECOVERY.map((stage, index) => (
              <li className='flex items-center gap-2' key={stage}>
                <span className='rounded-lg border bg-background px-2 py-2 text-[10px]'>
                  {stage}
                </span>
                {index < RECOVERY.length - 1 && (
                  <ArrowRight
                    className='h-3 w-3 text-muted-foreground'
                    aria-hidden
                  />
                )}
              </li>
            ))}
          </ol>
          <div className='mt-3 grid grid-cols-3 gap-1 text-center text-[10px]'>
            {['Retain', 'Roll back', 'Escalate'].map((outcome) => (
              <span key={outcome} className='rounded border border-dashed p-2'>
                {outcome}
              </span>
            ))}
          </div>
          <details className='mt-4 border-t pt-3 text-xs'>
            <summary className='cursor-pointer font-medium'>
              Authority & verification
            </summary>
            <p className='mt-2 leading-relaxed text-muted-foreground'>
              One orchestrator owns zone episodes. A future diagnosis agent
              gathers read-only evidence. Policy authorises changes; snapshots
              enable rollback. Independent verification decides whether to
              retain, roll back or escalate. Safety never waits for the agent.
            </p>
          </details>
        </section>
      </div>
      <div className='flex flex-wrap items-center gap-3 rounded-xl border bg-white/80 px-4 py-3 text-xs'>
        <ShieldCheck className='h-4 w-4 text-primary' />
        <strong>Mechanical safety · implemented</strong>
        <span>
          {mode === 'SAFE' ? 'Safety override active' : 'Normal decision gate'}
        </span>
        <span className='text-muted-foreground'>
          Power · wind · rain · angle and rate limits
        </span>
      </div>
    </div>
  )
}
