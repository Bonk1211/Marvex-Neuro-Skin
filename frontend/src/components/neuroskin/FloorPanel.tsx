'use client'

import type { FacadeOrientation, TickPayload } from '@/lib/types'
import { DaylightReadout, daylightSummary } from './DaylightPanel'
import { FLOOR_PLANS, floorGroupLabel, floorProgram } from './floorWorkspaces'
import { mockOccupancy } from './floorOccupants'

interface FloorPanelProps {
  tick: TickPayload
  floors: number
  focusedBand: number | null
  orientation: FacadeOrientation
  onSideChange: (orientation: FacadeOrientation) => void
  onBandChange: (band: number | null) => void
  selectedZone: string | null
  onSelectZone: (orientation: FacadeOrientation, zone: string) => void
  controlled: boolean
  onEnableDaylight?: () => void
  loading?: boolean
}

export function FloorPanel({
  tick,
  floors,
  focusedBand,
  orientation,
  onSideChange,
  onBandChange,
  selectedZone,
  onSelectZone,
  controlled,
  onEnableDaylight,
  loading = false,
}: FloorPanelProps) {
  const allZones = tick.facade.flatMap((wall) =>
    (wall.zones ?? [])
      .filter((zone) => focusedBand === null || zone.row === focusedBand)
      .map((zone) => ({ orientation: wall.orientation, zone }))
  )
  const zones = allZones.filter((entry) => entry.orientation === orientation)
  const bands = focusedBand === null ? [0, 1, 2, 3] : [focusedBand]
  const crowd = bands.map((row) =>
    mockOccupancy(tick.occupancy, orientation, row)
  )
  const total = crowd.reduce((sum, counts) => sum + counts.total, 0)
  const walking = crowd.reduce((sum, counts) => sum + counts.walking, 0)
  return (
    <section className='console-card' aria-label='Thermal & daylight'>
      <p className='console-card-title'>Individual floor plans</p>
      <p className='mt-2 text-[10px] text-muted-foreground'>
        Choose a side, then click a stacked level to inspect its occupants and
        daylight.
      </p>
      <div
        className='mt-3 grid grid-cols-2 gap-2'
        role='group'
        aria-label='Floor plan side'
      >
        {(Object.keys(FLOOR_PLANS) as FacadeOrientation[]).map((side) => {
          const plan = FLOOR_PLANS[side]
          const readings = allZones
            .filter((entry) => entry.orientation === side)
            .map((entry) => entry.zone)
          const mean = (key: 'incident' | 'transmitted' | 'load_relative') => {
            if (
              !readings.length ||
              readings.some((zone) => !Number.isFinite(zone[key]))
            )
              return null
            return (
              readings.reduce((sum, zone) => sum + zone[key], 0) /
              readings.length
            )
          }
          const irradiance = mean(controlled ? 'transmitted' : 'incident')
          const load = mean('load_relative')
          const people = bands.reduce(
            (sum, row) => sum + mockOccupancy(tick.occupancy, side, row).total,
            0
          )
          const light = daylightSummary(
            readings.flatMap((zone) => zone.conditions?.daylight_probes ?? []),
            controlled ? tick.daylight : null
          )
          return (
            <button
              key={side}
              type='button'
              className='band-button border-t-2 text-left'
              style={{ borderTopColor: plan.color }}
              aria-label={`${side} floor plan`}
              aria-pressed={orientation === side}
              onClick={() => onSideChange(side)}
            >
              <span className='block font-semibold capitalize'>
                {side} floor plan
              </span>
              <span className='block text-[10px]'>
                {focusedBand === null
                  ? '4 grouped levels'
                  : FLOOR_PLANS[floorProgram(side, focusedBand)].name}
              </span>
              <span className='mt-1 block text-[10px] font-semibold text-cyan-800'>
                {people} people · mock
              </span>
              {controlled && tick.daylight && (
                <span className='block text-[10px]'>
                  Et {light.et?.toFixed(0) ?? '—'} · Ev{' '}
                  {light.ev?.toFixed(0) ?? '—'} lux
                </span>
              )}
              <span className='mt-2 block font-mono'>
                {irradiance?.toFixed(0) ?? '—'} W/m²
              </span>
              <span className='block text-[9px]'>
                {controlled ? 'Mean transmitted' : 'Mean before glazing'}
              </span>
              {controlled && (
                <span className='block'>
                  Load index {load?.toFixed(3) ?? '—'}
                </span>
              )}
              <span className='block text-[9px] text-muted-foreground'>
                {readings.length}/{focusedBand === null ? 16 : 4} zones ·{' '}
                {focusedBand === null
                  ? 'all levels'
                  : floorGroupLabel(focusedBand, floors)}
              </span>
            </button>
          )
        })}
      </div>
      <p className='mt-3 text-xs font-semibold capitalize' aria-live='polite'>
        {orientation} floor stack
      </p>
      <p className='mt-1 text-[10px] text-muted-foreground'>
        {focusedBand === null
          ? 'Four stacked groups: floors 1–2, 3–4, 5–6 and 7.'
          : `${floorGroupLabel(focusedBand, floors)} · ${FLOOR_PLANS[floorProgram(orientation, focusedBand)].name}`}
      </p>
      <div
        role='group'
        aria-label='Stacked levels'
        className='mt-3 grid grid-cols-2 gap-1'
      >
        {[0, 1, 2, 3].map((row) => {
          const counts = mockOccupancy(tick.occupancy, orientation, row)
          const light = daylightSummary(
            tick.facade
              .find((wall) => wall.orientation === orientation)
              ?.zones?.filter((zone) => zone.row === row)
              .flatMap((zone) => zone.conditions?.daylight_probes ?? []) ?? [],
            controlled ? tick.daylight : null
          )
          return (
            <button
              className='band-button'
              type='button'
              key={row}
              aria-label={floorGroupLabel(row, floors)}
              aria-pressed={focusedBand === row}
              onClick={() => onBandChange(row)}
            >
              <span className='block font-semibold'>
                {floorGroupLabel(row, floors)}
              </span>
              <span className='mt-1 block text-[10px]'>
                {counts.total} people · mock
              </span>
              {controlled && tick.daylight && (
                <span className='block text-[9px]'>
                  Et {light.et?.toFixed(0) ?? '—'} · Ev{' '}
                  {light.ev?.toFixed(0) ?? '—'} lx
                </span>
              )}
            </button>
          )
        })}
      </div>
      <button
        type='button'
        className='band-button mt-2 w-full'
        aria-pressed={focusedBand === null}
        onClick={() => onBandChange(null)}
      >
        Show all levels
      </button>
      <div
        className='mt-3 rounded-lg border border-cyan-700/20 bg-cyan-50/60 p-3'
        aria-label='Mock occupant detection'
      >
        <p className='text-xs font-semibold'>Occupant detection · mock</p>
        <p className='mt-1 text-sm'>
          <strong>{total}</strong> people · {walking} walking ·{' '}
          {total - walking} seated
        </p>
        <p className='mt-1 text-[10px] text-muted-foreground'>
          {orientation} ·{' '}
          {focusedBand === null
            ? 'all floor groups'
            : floorGroupLabel(focusedBand, floors)}
          . Cyan rings mark scripted people. Counts follow the timeline’s
          simulated occupancy; no camera detection is running.
        </p>
      </div>
      <p className='mt-2 text-[10px] text-muted-foreground'>
        {focusedBand === null
          ? 'All four levels are shown in colour. Select a level for its four facade zones.'
          : `${floorGroupLabel(focusedBand, floors)} is selected; the other levels are greyed out.`}{' '}
        Only {orientation} facade readings are shown. Glare is direct-sun
        screening, not DGP.
      </p>
      <p className='mt-2 text-[9px] text-muted-foreground'>
        Each complete plan is illustrative. Rooms and HVAC have no measured
        layout, airflow or room cooling demand. Light cards show mean Et and
        highest Ev across fixed probes. The coloured edge shows the selected
        side’s facade readings.
      </p>
      {controlled && !tick.daylight && (
        <div className='mt-3 text-xs'>
          <p>Daylight model not loaded for this run.</p>
          {onEnableDaylight && (
            <button
              type='button'
              className='band-button mt-2 w-full'
              disabled={loading}
              onClick={onEnableDaylight}
            >
              {loading
                ? 'Loading daylight predictions…'
                : 'Load Et/Ev predictions'}
            </button>
          )}
          <p className='mt-1 text-[10px] text-muted-foreground'>
            Trained for the Putrajaya facade. Other sites and missing model
            files have no readings.
          </p>
        </div>
      )}
      {controlled &&
        tick.daylight &&
        zones.some(({ zone }) => zone.conditions?.daylight_probes?.length) && (
          <DaylightReadout
            status={tick.daylight}
            probes={zones.flatMap(({ zone }) =>
              (zone.conditions?.daylight_probes ?? []).map((p) => ({
                ...p,
                zone: `${floorGroupLabel(zone.row, floors)} · ${zone.zone}`,
              }))
            )}
          />
        )}
      {!zones.length ? (
        <p className='mt-3 text-xs'>Zone grid unavailable for this side</p>
      ) : (
        <ul className='mt-3 space-y-1' aria-label='Side zones'>
          {zones.map(({ orientation, zone }) => (
            <li key={zone.zone}>
              <button
                type='button'
                aria-pressed={selectedZone === zone.zone}
                className='band-button w-full text-left'
                onClick={() => onSelectZone(orientation, zone.zone)}
              >
                <span className='font-semibold'>
                  {orientation} · {zone.zone}
                </span>
                {controlled ? (
                  <>
                    <span className='block'>
                      Load {zone.load_relative.toFixed(3)} · daylight{' '}
                      {zone.conditions?.daylight_status ?? 'unknown'}
                    </span>
                    <span
                      className={`block ${zone.conditions?.glare_risk ? 'text-amber-700' : ''}`}
                    >
                      {zone.conditions?.glare_risk
                        ? 'Glare risk'
                        : zone.conditions
                          ? 'No glare flag'
                          : 'Glare unknown'}{' '}
                      · {zone.angle.toFixed(1)}° · {zone.mode} ·{' '}
                      {zone.sensor_trusted === undefined
                        ? 'trust unknown'
                        : zone.sensor_trusted
                          ? 'trusted'
                          : 'untrusted'}
                    </span>
                  </>
                ) : (
                  <span className='block'>
                    {zone.incident.toFixed(0)} W/m² before glazing · no external
                    facade
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
