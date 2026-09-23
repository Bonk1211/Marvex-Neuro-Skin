'use client'

import type { FacadeHeat, PerturbationKind } from '@/lib/types'
import type { BuildingVariant } from './buildingComparison'

const PERTURBATIONS: [PerturbationKind, string][] = [
  ['dead', 'Dead irradiance sensor'],
  ['stuck', 'Stuck sensor pair'],
  ['drift', 'Drifting irradiance sensor'],
  ['fouled', 'Fouled irradiance sensor'],
  ['shadow', 'Real local shadow'],
]

interface ZoneSensorPanelProps {
  wall: FacadeHeat
  selectedZone: string | null
  onSelectZone: (id: string) => void
  onOverride: (
    zoneId: string,
    reading: { irradiance: number; illuminance: number }
  ) => void
  onClearOverride: (zoneId: string) => void
  overriddenZoneIds: string[]
  onPerturb?: (zoneId: string, kind: PerturbationKind) => void
  onClearPerturbation?: (zoneId: string) => void
  perturbedZoneIds?: string[]
  loading: boolean
  buildingVariant?: BuildingVariant
}

export function ZoneSensorPanel({
  wall,
  selectedZone,
  onSelectZone,
  onOverride,
  onClearOverride,
  overriddenZoneIds,
  onPerturb,
  onClearPerturbation,
  perturbedZoneIds = [],
  loading,
  buildingVariant = 'controlled',
}: ZoneSensorPanelProps) {
  const uncontrolled = buildingVariant !== 'controlled'
  const zones = [...(wall.zones ?? [])].sort(
    (left, right) => right.row - left.row || left.column - right.column
  )
  const selected = zones.find((zone) => zone.zone === selectedZone)
  const sensors = selected?.sensors
  const conditions = selected?.conditions
  const input = selected?.control_input
  const sensorSource =
    sensors?.source === 'override'
      ? 'injected'
      : sensors
        ? 'simulated'
        : 'unknown'

  return (
    <section
      className='console-card'
      aria-label={`${wall.orientation} ${uncontrolled ? 'surface zones' : 'zone sensors'}`}
    >
      <h3 className='console-card-title flex justify-between gap-2'>
        <span className='capitalize'>
          {wall.orientation} · {uncontrolled ? 'surface zones' : 'zone sensors'}
        </span>
        <span className='font-mono'>{zones.length} simulated zones</span>
      </h3>
      <div
        role='group'
        aria-label={`${wall.orientation} 4 by 4 ${uncontrolled ? 'surface' : 'sensor'} matrix`}
        className='mt-2 grid grid-cols-4 gap-1'
      >
        {zones.map((zone) => (
          <button
            key={zone.zone}
            type='button'
            aria-label={
              uncontrolled
                ? `Zone ${zone.zone}, ${zone.incident.toFixed(0)} watts per square metre`
                : `Zone ${zone.zone}, ${zone.angle.toFixed(1)} degrees${zone.sensors ? `, ${zone.sensors.irradiance.toFixed(0)} watts per square metre` : ''}`
            }
            aria-pressed={zone.zone === selectedZone}
            onClick={() => onSelectZone(zone.zone)}
            className={`min-w-0 rounded border px-1 py-1.5 text-left font-mono text-[10px] ${zone.zone === selectedZone ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary/60'}`}
          >
            <span className='flex flex-wrap justify-between gap-x-1 font-semibold'>
              <span>{zone.zone}</span>
              {!uncontrolled && <span>{zone.angle.toFixed(1)}°</span>}
            </span>
            <span className='mt-0.5 block truncate text-[9px] text-muted-foreground'>
              {uncontrolled
                ? `${zone.incident.toFixed(0)} W/m²`
                : zone.sensors
                  ? `${zone.sensors.irradiance.toFixed(0)} W/m²`
                  : 'No sensor'}
            </span>
          </button>
        ))}
      </div>

      {!selected ? (
        <p className='mt-2 text-[10px] text-muted-foreground'>
          {uncontrolled
            ? 'Select a zone to inspect its surface irradiance.'
            : 'Select a zone to inspect its sensors and actuator.'}
        </p>
      ) : uncontrolled ? (
        <div className='mt-3 border-t border-border/60 pt-2'>
          <p className='text-[11px] font-semibold'>
            {selected.zone} · surface zone
          </p>
          <dl className='mt-2 space-y-1 text-[10px]'>
            <div className='flex flex-wrap justify-between gap-x-2'>
              <dt>Surface irradiance</dt>
              <dd className='font-mono'>{selected.incident.toFixed(1)} W/m²</dd>
            </div>
            <div className='flex flex-wrap justify-between gap-x-2'>
              <dt>Unshaded by roof</dt>
              <dd className='font-mono'>
                {(selected.sunlit_fraction * 100).toFixed(0)}%
              </dd>
            </div>
          </dl>
          <p className='mt-2 text-[10px] leading-4 text-muted-foreground'>
            No external louvres, actuators or mechatronic controller. Surface
            irradiance only.
          </p>
        </div>
      ) : (
        <div
          className='mt-3 border-t border-border/60 pt-2'
          aria-label='Selected zone inspection'
        >
          <p className='flex flex-wrap items-center justify-between gap-1 text-[11px] font-semibold'>
            <span>{selected.zone} · simulated actuator</span>
            <span className='font-mono text-[9px]'>{selected.mode}</span>
          </p>
          <dl className='mt-2 grid grid-cols-2 gap-2'>
            <div className='rounded-lg bg-secondary/60 p-2'>
              <dt className='text-[10px] text-muted-foreground'>
                Requested angle
              </dt>
              <dd className='font-mono text-lg'>
                {selected.angle_target?.toFixed(1) ?? '—'}°
              </dd>
            </div>
            <div className='rounded-lg bg-primary/5 p-2'>
              <dt className='text-[10px] text-muted-foreground'>
                Simulated achieved
              </dt>
              <dd className='font-mono text-lg'>
                {selected.angle.toFixed(1)}°
              </dd>
            </div>
          </dl>
          <p className='mt-1 text-[10px] text-muted-foreground'>
            Local input:{' '}
            <strong
              className={
                selected.sensor_trusted === false ? 'text-amber-800' : ''
              }
            >
              {selected.sensor_trusted === undefined
                ? 'unknown'
                : selected.sensor_trusted
                  ? 'accepted'
                  : 'rejected'}
            </strong>{' '}
            · finite/range checks only
          </p>
          <dl
            className='mt-3 space-y-1.5 text-[10px]'
            aria-label='Control evidence'
          >
            <div className='flex flex-wrap justify-between gap-x-2'>
              <dt>Raw irradiance · {sensorSource}</dt>
              <dd className='font-mono'>
                {sensors?.irradiance.toFixed(1) ?? '—'} W/m²
              </dd>
            </div>
            <div className='flex flex-wrap justify-between gap-x-2'>
              <dt>Raw illuminance · {sensorSource}</dt>
              <dd className='font-mono'>
                {sensors?.illuminance.toFixed(1) ?? '—'} lx
              </dd>
            </div>
            <div className='flex flex-wrap justify-between gap-x-2 border-t border-border/60 pt-1.5'>
              <dt>Admitted irradiance</dt>
              <dd className='text-right font-mono'>
                {input?.irradiance.toFixed(1) ?? '—'} W/m²
                {input && (
                  <span className='block text-[9px] text-muted-foreground'>
                    {input.irradiance_source === 'model'
                      ? 'model'
                      : `${sensorSource} sensor`}
                  </span>
                )}
              </dd>
            </div>
            <div className='flex flex-wrap justify-between gap-x-2'>
              <dt>Open-path lux input</dt>
              <dd className='text-right font-mono'>
                {input?.open_lux.toFixed(1) ?? '—'} lx
                {input && (
                  <span className='block text-[9px] text-muted-foreground'>
                    {input.daylight_source === 'model'
                      ? 'model'
                      : `${sensorSource} sensor`}
                  </span>
                )}
              </dd>
            </div>
          </dl>
          {!input && (
            <p className='mt-1 text-[9px] text-muted-foreground'>
              Effective control input unavailable in this run.
            </p>
          )}
          <details className='mt-3 text-[10px] leading-4'>
            <summary className='cursor-pointer font-medium'>
              Why this action?
            </summary>
            <p className='mt-2 text-muted-foreground'>
              {selected.reason || 'Decision reason unavailable.'}
            </p>
            <p className='mt-2 text-muted-foreground'>
              Local range checks can accept an in-range fouled sensor. A passed
              check does not establish fault-free sensing.
            </p>
            {sensors && (
              <p className='mt-2 break-words font-mono text-muted-foreground'>
                {sensors.sensor_id}
              </p>
            )}
          </details>
          {conditions && (
            <details className='mt-2 text-[10px]'>
              <summary className='cursor-pointer font-medium'>
                Simulated daylight & heat
              </summary>
              <dl className='mt-2 space-y-1'>
                <div className='flex flex-wrap justify-between gap-x-2'>
                  <dt>Indoor daylight</dt>
                  <dd className='font-mono'>
                    {selected.lux.toFixed(1)} lx · {conditions.daylight_status}
                  </dd>
                </div>
                <div className='flex flex-wrap justify-between gap-x-2'>
                  <dt>Through louvers</dt>
                  <dd className='font-mono'>
                    {conditions.transmitted.toFixed(1)} W/m²
                  </dd>
                </div>
                <div className='flex flex-wrap justify-between gap-x-2'>
                  <dt>Estimated solar heat gain</dt>
                  <dd className='font-mono'>
                    {conditions.solar_heat_gain.toFixed(1)} W/m² glazing
                  </dd>
                </div>
                <div className='flex flex-wrap justify-between gap-x-2'>
                  <dt>Direct-sun exposure</dt>
                  <dd className='font-mono'>
                    {conditions.direct_sun.toFixed(1)} W/m²
                  </dd>
                </div>
                <div className='flex flex-wrap justify-between gap-x-2'>
                  <dt>Direct-sun screening</dt>
                  <dd
                    className={
                      conditions.glare_risk
                        ? 'font-semibold text-amber-700'
                        : 'text-primary'
                    }
                  >
                    {conditions.glare_risk ? 'Above limit' : 'Within limit'}
                  </dd>
                </div>
              </dl>
              <p className='mt-1.5 text-[9px] leading-4 text-muted-foreground'>
                Useful daylight: 300–700 lx · screening limit{' '}
                {conditions.glare_limit_w_m2.toFixed(1)} W/m² · SHGC{' '}
                {conditions.glazing_shgc.toFixed(2)}. Calibration assumptions;
                DGP needs a separate luminance assessment.
              </p>
            </details>
          )}
          {sensors ? (
            <details className='mt-3 rounded-lg border border-border p-2'>
              <summary className='cursor-pointer text-[10px] font-semibold'>
                Inject sensor reading
                {overriddenZoneIds.includes(selected.zone) && (
                  <span className='text-amber-800'> · override active</span>
                )}
              </summary>
              <form
                key={`${selected.zone}:${sensors.source}`}
                className='mt-2'
                onSubmit={(event) => {
                  event.preventDefault()
                  if (loading || !event.currentTarget.reportValidity()) return
                  const values = new FormData(event.currentTarget)
                  onOverride(selected.zone, {
                    irradiance: Number(values.get('irradiance')),
                    illuminance: Number(values.get('illuminance')),
                  })
                }}
              >
                <fieldset disabled={loading} className='space-y-2'>
                  <div className='grid grid-cols-2 gap-2'>
                    <label className='min-w-0 text-[10px]'>
                      Sensor irradiance
                      <span className='ml-1 text-muted-foreground'>W/m²</span>
                      <input
                        aria-label='Sensor irradiance'
                        name='irradiance'
                        type='number'
                        required
                        min={0}
                        max={1600}
                        step='any'
                        defaultValue={sensors.irradiance}
                        className='setting-input mt-1 w-full'
                      />
                    </label>
                    <label className='min-w-0 text-[10px]'>
                      Sensor illuminance
                      <span className='ml-1 text-muted-foreground'>lx</span>
                      <input
                        aria-label='Sensor illuminance'
                        name='illuminance'
                        type='number'
                        required
                        min={0}
                        max={10000}
                        step='any'
                        defaultValue={sensors.illuminance}
                        className='setting-input mt-1 w-full'
                      />
                    </label>
                  </div>
                  <button
                    type='submit'
                    className='run-button-light w-full text-[10px]'
                  >
                    Apply only this sensor
                  </button>
                  {overriddenZoneIds.includes(selected.zone) && (
                    <button
                      type='button'
                      onClick={() => onClearOverride(selected.zone)}
                      className='w-full rounded border border-border px-2 py-1 text-[10px] hover:bg-secondary/60'
                    >
                      Clear override
                    </button>
                  )}
                </fieldset>
              </form>
              <p className='mt-1.5 text-[9px] text-muted-foreground'>
                Inject into {selected.zone} at the selected time. Other zones
                retain their own readings.
              </p>
            </details>
          ) : (
            <p className='mt-2 text-[10px] text-muted-foreground'>
              Sensor readings unavailable at this tick.
            </p>
          )}
          {sensors && onPerturb && (
            <details className='mt-2 rounded-lg border border-border p-2'>
              <summary className='cursor-pointer text-[10px] font-semibold'>
                Inject fault window
                {perturbedZoneIds.includes(selected.zone) && (
                  <span className='text-amber-800'> · fault active</span>
                )}
              </summary>
              <form
                className='mt-2'
                onSubmit={(event) => {
                  event.preventDefault()
                  if (loading) return
                  const kind = new FormData(event.currentTarget).get('kind')
                  onPerturb(selected.zone, kind as PerturbationKind)
                }}
              >
                <fieldset disabled={loading} className='space-y-2'>
                  <label className='block text-[10px]'>
                    Fault window
                    <select
                      aria-label='Fault window'
                      name='kind'
                      defaultValue='dead'
                      className='setting-input mt-1 w-full'
                    >
                      {PERTURBATIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type='submit'
                    className='run-button-light w-full text-[10px]'
                  >
                    Inject 2 h from this time
                  </button>
                  {perturbedZoneIds.includes(selected.zone) &&
                    onClearPerturbation && (
                      <button
                        type='button'
                        onClick={() => onClearPerturbation(selected.zone)}
                        className='w-full rounded border border-border px-2 py-1 text-[10px] hover:bg-secondary/60'
                      >
                        Clear fault window
                      </button>
                    )}
                </fieldset>
              </form>
              <p className='mt-1.5 text-[9px] text-muted-foreground'>
                Declared synthetic test input for {selected.zone}. Faults
                corrupt its reading; shadow is a real drop the geometry model
                cannot see. Local sensor checks run on the replay.
              </p>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
