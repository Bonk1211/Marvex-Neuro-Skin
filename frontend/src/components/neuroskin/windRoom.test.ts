import { describe, expect, it } from 'vitest'
import type { FacadeHeat, TickPayload } from '@/lib/types'
import { cardinal, wallLoads, windRoster, windTicket } from './windRoom'

const AZIMUTH: Record<string, number> = {
  north: 0,
  east: 90,
  south: 180,
  west: 270,
}

/** One wall's 4 x 4 zone grid, ids the way the backend numbers them: W1..W16. */
function wall(orientation: string, angle = 45): FacadeHeat {
  const zones = Array.from({ length: 16 }, (_, index) => ({
    row: Math.floor(index / 4),
    column: index % 4,
    zone: `${orientation[0].toUpperCase()}${index + 1}`,
    angle,
  }))
  return {
    orientation,
    azimuth: AZIMUTH[orientation],
    zones,
  } as unknown as FacadeHeat
}

function tick(wind: number, windDirection: number): TickPayload {
  return {
    timestamp: '2026-03-21T13:40:00+08:00',
    mode: wind >= 15 ? 'SAFE' : 'NORMAL',
    wind,
    wind_direction: windDirection,
    facade: ['north', 'east', 'south', 'west'].map((side) => wall(side)),
  } as unknown as TickPayload
}

const ROOM = { floors: 7, criticalWind: 15 }

describe('windRoom', () => {
  it('seats the four bays a west-north-west gust loads hardest', () => {
    const roster = windRoster(tick(18, 292), ROOM)

    // The upwind corner of the west wall: top two rows, north-end columns.
    expect(roster.map((seat) => seat.zone)).toEqual(['W13', 'W14', 'W9', 'W10'])
    expect(roster[0].incidence).toBe(22)
    expect(cardinal(292)).toBe('WNW')
    // Worst load first, and the top row stands in faster wind than the one below.
    expect(roster.map((seat) => seat.pressure)).toEqual(
      [...roster.map((seat) => seat.pressure)].sort((a, b) => b - a)
    )
    expect(roster[0].height).toBeGreaterThan(roster[3].height)
    expect(roster[0].speed).toBeGreaterThan(18)
  })

  it('retreats each bay by its own load and leaves the sheltered walls alone', () => {
    const roster = windRoster(tick(12, 292), ROOM)
    const [worst] = roster
    const lightest = roster[roster.length - 1]

    // Every seat gives up shading angle, the most loaded one the most of it.
    expect(worst.hold).toBeLessThan(lightest.hold)
    expect(worst.proposed).toBeLessThan(lightest.proposed)
    expect(lightest.proposed).toBeLessThan(lightest.angle)
    // Past the pressure a head-on gust at the safety limit puts on a panel,
    // the proposal is flat: nothing left to give.
    expect(windRoster(tick(18, 292), ROOM)[0].hold).toBe(0)

    // The east wall is in the lee: suction, no seat in the room.
    const east = wallLoads(wall('east'), {
      bearing: 292,
      wind: 18,
      floors: 7,
      criticalWind: 15,
    })
    expect(east.every((load) => load.pressure < 0)).toBe(true)
    expect(roster.every((seat) => seat.orientation === 'west')).toBe(true)
  })

  it('raises one emergency ticket per tick, forecast first and then measured', () => {
    const calm = tick(3, 292)
    const forecast = windTicket(calm, [], {
      wind: 18,
      bearing: 292,
      criticalWind: 15,
    })

    // Named after the site clock, so the same tick always raises the same id.
    expect(forecast.id).toBe('INC-20260321-1340-W')
    expect(forecast.severity).toBe('P1')
    expect(forecast.status).toBe('Raised · waiting for a channel')
    expect(forecast.summary).toContain('Forecast gust 18 m/s from 292° WNW')

    const gust = tick(18, 292)
    const live = windTicket(gust, windRoster(gust, ROOM), {
      wind: 18,
      bearing: 292,
      criticalWind: 15,
    })
    expect(live.status).toContain('Mitigating')
    expect(live.summary).toContain('worst W13')
  })

  it('holds no meeting while the wind is light', () => {
    expect(windRoster(tick(3, 292), ROOM)).toEqual([])
  })

  it('follows the wind round the building', () => {
    const roster = windRoster(tick(18, 68), ROOM)

    // The same gust from the east-north-east: the east wall takes it, and its
    // upwind corner is the north end, so the far columns seat instead.
    expect(roster.map((seat) => seat.zone)).toEqual([
      'E16',
      'E15',
      'E12',
      'E11',
    ])
  })
})
