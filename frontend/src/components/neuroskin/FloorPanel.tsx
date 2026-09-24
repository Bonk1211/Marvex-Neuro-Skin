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
  selectedZone?: string | null
  onSelectZone?: (orientation: FacadeOrientation, zone: string) => void
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
    mockOccupancy(tick.occupancy, orientation, row, !!tick.meeting_demo)
  )
  const total = crowd.reduce((sum, counts) => sum + counts.total, 0)
  const walking = crowd.reduce((sum, counts) => sum + counts.walking, 0)
  return (
    <section className='console-card' aria-label='Thermal & daylight'>
      <p className='console-card-title'>Floor & facade</p>
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
          const people = bands.reduce(
            (sum, row) =>
              sum +
              mockOccupancy(tick.occupancy, side, row, !!tick.meeting_demo)
                .total,
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
              <span className='block font-semibold capitalize'>{side}</span>
              <span className='block text-[10px]'>
                {readings.length}/{focusedBand === null ? 16 : 4} zones ·{' '}
                {people} people · mock
              </span>
              {controlled && tick.daylight && (
                <span className='block text-[10px]'>
                  Et {light.et?.toFixed(0) ?? '—'} · Ev{' '}
                  {light.ev?.toFixed(0) ?? '—'} lux
                </span>
              )}
            </button>
          )
        })}
      </div>
      <p className='mt-3 text-xs font-semibold capitalize' aria-live='polite'>
        {orientation} ·{' '}
        {focusedBand === null
          ? 'all floor groups'
          : floorGroupLabel(focusedBand, floors)}
      </p>
      <p className='mt-1 text-[10px] text-muted-foreground'>
        {focusedBand === null
          ? 'Four illustrative floor groups'
          : FLOOR_PLANS[floorProgram(orientation, focusedBand)].name}
      </p>
      <div
        role='group'
        aria-label='Stacked levels'
        className='mt-3 grid grid-cols-2 gap-1'
      >
        {[0, 1, 2, 3].map((row) => {
          const counts = mockOccupancy(
            tick.occupancy,
            orientation,
            row,
            !!tick.meeting_demo
          )
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
        className='mt-3 rounded-lg border border-cyan-700/20 bg-cyan-50/60 p-2'
        aria-label='Mock occupants'
      >
        <p className='text-[10px] font-semibold'>Scripted occupants · mock</p>
        <p className='mt-1 text-xs'>
          <strong>{total}</strong> people · {walking} walking ·{' '}
          {total - walking} seated
        </p>
      </div>
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
        </div>
      )}
      {controlled && tick.daylight && (
        <DaylightReadout
          demoControl={!!tick.meeting_demo}
          status={tick.daylight}
          probes={zones.flatMap(({ zone }) =>
            (zone.conditions?.daylight_probes ?? []).map((p) => ({
              ...p,
              zone: `${floorGroupLabel(zone.row, floors)} · ${zone.zone}`,
            }))
          )}
        />
      )}
      {!zones.length && (
        <p className='mt-3 text-xs'>Zone grid unavailable for this side</p>
      )}
      <details className='mt-3 border-t pt-2 text-[10px] leading-4 text-muted-foreground'>
        <summary className='cursor-pointer'>Scene & model assumptions</summary>
        <p className='mt-2'>
          Cyan rings mark scripted people.{' '}
          {tick.meeting_demo
            ? 'Six seated people occupy seats 1–4 and 13–14 in this meeting demo.'
            : 'Counts follow shared simulated occupancy; no camera detection is running.'}
        </p>
        <p className='mt-2'>
          Rooms and HVAC are illustrative, with no measured layout, airflow or
          room cooling demand. Floor groups do not provide individual floor
          measurements.
        </p>
        <p className='mt-2'>
          Et is mean work-plane illuminance; Ev is the highest seat estimate.
          Predictions are{' '}
          {tick.meeting_demo
            ? 'used by this scripted demo and remain'
            : 'observe-only and'}{' '}
          uncalibrated. Unsupported sites and missing models have no readings.
          Direct-sun screening is not DGP.
        </p>
      </details>
    </section>
  )
}
