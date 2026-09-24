import type { FacadeHeat, TickPayload, ZoneHeat } from '@/lib/types'

/**
 * Which facade zones a strong wind puts under load, and how far each one would
 * retreat. The zone agents use this to decide whether to join the room: a bay
 * only speaks when the wind is actually pressing on its own panel.
 *
 * Quasi-steady wind pressure, the screening form used for cladding loads:
 *
 *   v(z) = v10 (z / 10)^0.16      open-terrain power law
 *   q(z) = 0.613 v(z)^2 Cp        Pa, with 0.613 = air density / 2
 *
 * Cp is the windward 0.8 scaled by how square the wall stands to the wind and
 * by where the bay sits along it. Oblique wind piles pressure on the upwind
 * corner and sheds it along the face, which is why one end of a wall retreats
 * while the other keeps its daylight angle. Not a design wind load: no gust
 * factor, no terrain category, no shielding from what stands next door.
 */

const AIR = 0.613
const SHEAR = 0.16
const REF_HEIGHT = 10
const WINDWARD_CP = 0.8
/** Along the wall, from the upwind corner to the separated downwind one. */
const LEAD_CP = 1.2
const TRAIL_CP = 0.3
const FLOOR_HEIGHT = 3.6
/** Mirrors the backend DEFAULTS.angle_max: fully shaded is 60 degrees of blade. */
const ANGLE_MAX = 60
/** WNW: the bearing a Klang Valley squall line arrives on, across the west facade. */
export const DEFAULT_BEARING = 292
/** The wind the backend safety rule retracts the facade flat at. */
export const CRITICAL_WIND = 15
/** The gust the ticket asks the simulation for: past the safety limit. */
export const DEMO_WIND = 18
/** Where the wind slider sits on an ordinary day. */
export const CALM_WIND = 3
/** Seats in the room. A meeting of sixteen bays is a graph again, not a meeting. */
export const SEATS = 4

export interface ZoneLoad {
  zone: string
  orientation: string
  row: number
  column: number
  /** Metres above ground, at the middle of the zone. */
  height: number
  /** Wind speed at that height, m/s. */
  speed: number
  /** Degrees between the wind and this wall's outward normal. 0 is head-on. */
  incidence: number
  /** Pressure on this bay's panel, Pa. Negative is suction on a leeward wall. */
  pressure: number
  /** Louvre angle now. */
  angle: number
  /** Most blade this bay judges it can carry under its own pressure. */
  hold: number
  /** Where it wants to be: its own angle, capped by what it can hold. */
  proposed: number
}

const rad = (degrees: number) => (degrees * Math.PI) / 180
/** Smallest angle between two bearings, 0-180 degrees. */
export const bearingGap = (a: number, b: number) =>
  Math.abs(((((a - b) % 360) + 540) % 360) - 180)

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'] // prettier-ignore
export const cardinal = (bearing: number) =>
  CARDINALS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16]

/** Pressure a head-on gust at the safety limit puts on a panel, Pa. */
export const criticalPressure = (criticalWind: number) =>
  AIR * criticalWind ** 2 * WINDWARD_CP

/**
 * The load on every zone of one wall. `wall.azimuth` is the outward normal and
 * `bearing` is where the wind blows from, both degrees clockwise from north.
 */
export function wallLoads(
  wall: FacadeHeat,
  {
    bearing,
    wind,
    floors,
    criticalWind,
  }: { bearing: number; wind: number; floors: number; criticalWind: number }
): ZoneLoad[] {
  const zones = wall.zones ?? []
  if (!zones.length) return []
  const rows = Math.max(...zones.map((zone) => zone.row)) + 1
  const columns = Math.max(...zones.map((zone) => zone.column)) + 1
  const incidence = bearingGap(bearing, wall.azimuth)
  const windwardness = Math.cos(rad(incidence))
  // Standing outside looking at the wall, column 0 is on the left, which is the
  // azimuth+90 end. The wind reaches that end first when it comes from that side.
  const leadsAtZero = bearingGap(bearing, wall.azimuth + 90) < 90
  const critical = criticalPressure(criticalWind)
  return zones.map((zone: ZoneHeat) => {
    const height = ((zone.row + 0.5) / rows) * floors * FLOOR_HEIGHT
    const speed = wind * (Math.max(height, 2) / REF_HEIGHT) ** SHEAR
    const along =
      columns > 1
        ? (leadsAtZero ? zone.column : columns - 1 - zone.column) /
          (columns - 1)
        : 0
    // Flat over the upwind part of the face, then falling away as the flow
    // separates off the downwind corner, rather than a straight ramp.
    const lateral = LEAD_CP - (LEAD_CP - TRAIL_CP) * along ** 2
    // A leeward wall sees roughly even suction; only the windward face has an
    // upwind corner to pile pressure on.
    const cp =
      windwardness > 0
        ? WINDWARD_CP * windwardness * lateral
        : 0.3 * windwardness
    const pressure = AIR * speed ** 2 * cp
    const angle = zone.angle
    // Full blade at no load, flat once the pressure reaches what a head-on gust
    // at the safety limit puts on the panel.
    const hold = Math.max(0, ANGLE_MAX * (1 - Math.max(0, pressure) / critical))
    const proposed = Math.min(angle, hold)
    return {
      zone: zone.zone,
      orientation: wall.orientation,
      row: zone.row,
      column: zone.column,
      height: Number(height.toFixed(1)),
      speed: Number(speed.toFixed(1)),
      incidence: Number(incidence.toFixed(0)),
      pressure: Number(pressure.toFixed(0)),
      angle,
      hold: Number(hold.toFixed(1)),
      proposed: Number(proposed.toFixed(1)),
    }
  })
}

/**
 * The bays that join the room, worst load first. Empty while the wind is too
 * light to press on anything: no load, no meeting.
 */
export function windRoster(
  tick: TickPayload,
  {
    floors,
    criticalWind,
    seats = SEATS,
  }: { floors: number; criticalWind: number; seats?: number }
): ZoneLoad[] {
  const bearing = tick.wind_direction ?? 0
  const join = 0.35 * criticalPressure(criticalWind)
  return tick.facade
    .flatMap((wall) =>
      wallLoads(wall, { bearing, wind: tick.wind, floors, criticalWind })
    )
    .filter((load) => load.pressure >= join)
    .sort((a, b) => b.pressure - a.pressure)
    .slice(0, seats)
}

export interface WindTicket {
  /** INC-<date>-<time>-<wall>, so the same tick always raises the same ticket. */
  id: string
  severity: 'P1' | 'P2'
  title: string
  raisedBy: string
  status: string
  summary: string
}

/**
 * The emergency ticket the safety monitor raises for a gust. Before the run it
 * describes the forecast the demo is asking for; once the wind is on the wall it
 * describes what the bays are actually carrying.
 */
export function windTicket(
  tick: TickPayload,
  roster: ZoneLoad[],
  {
    wind,
    bearing,
    criticalWind,
  }: { wind: number; bearing: number; criticalWind: number }
): WindTicket {
  const live = roster.length > 0
  const gust = live ? tick.wind : wind
  const from = live ? (tick.wind_direction ?? bearing) : bearing
  const wall = live
    ? roster[0].orientation
    : (tick.facade.find((entry) => entry.primary)?.orientation ?? 'west')
  // Slice the local timestamp rather than parsing it: the ticket is named after
  // the site's clock, not the browser's.
  const stamp = `${tick.timestamp.slice(0, 10).replace(/-/g, '')}-${tick.timestamp.slice(11, 16).replace(':', '')}`
  return {
    id: `INC-${stamp}-${wall[0].toUpperCase()}`,
    severity: gust >= criticalWind ? 'P1' : 'P2',
    title: `Strong wind on the ${wall} facade`,
    raisedBy: 'Facade safety monitor',
    status: live
      ? tick.mode === 'SAFE'
        ? 'Mitigating · safety rule holding the facade flat'
        : 'Open · bays deciding their own retreat'
      : 'Raised · waiting for a channel',
    summary: live
      ? `${gust.toFixed(1)} m/s from ${from.toFixed(0)}° ${cardinal(from)}. ` +
        `${roster.length} bays over the review pressure, worst ${roster[0].zone} at ${roster[0].pressure} Pa.`
      : `Forecast gust ${gust.toFixed(0)} m/s from ${from.toFixed(0)}° ${cardinal(from)} across the ${wall} facade, ` +
        `past the ${criticalWind} m/s safety limit. Needs the loaded bays on a channel to agree a retreat.`,
  }
}
