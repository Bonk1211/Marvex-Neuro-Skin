import type { FacadeOrientation } from '@/lib/types'

/** Each facade owns a stack of four illustrative floor groups. */
export const FLOOR_PLANS: Record<
  FacadeOrientation,
  { name: string; description: string; color: string; floor: number }
> = {
  north: {
    name: 'Team office',
    description: 'Boardroom, huddle room, quiet offices, desk islands & café',
    color: '#526f91',
    floor: 0x809fbb,
  },
  east: {
    name: 'Learning centre',
    description: 'Training hall, library, shared desks & coffee counter',
    color: '#9b6945',
    floor: 0xd2a77f,
  },
  south: {
    name: 'Collaboration hub',
    description:
      'Huddle rooms, round worktables, private office & curved lounge',
    color: '#597953',
    floor: 0x8daa83,
  },
  west: {
    name: 'Studio office',
    description: 'Seminar room, individual studios, acoustic booths & lounge',
    color: '#81648f',
    floor: 0xb29bbf,
  },
}

export function floorGroupLabel(band: number, floors: number) {
  const first = Math.min(floors, band * Math.ceil(floors / 4) + 1)
  const last = Math.min(floors, (band + 1) * Math.ceil(floors / 4))
  return first === last ? `Floor ${first}` : `Floors ${first}–${last}`
}

export function floorProgram(side: FacadeOrientation, band: number) {
  const sides = Object.keys(FLOOR_PLANS) as FacadeOrientation[]
  return sides[(sides.indexOf(side) + band) % sides.length]
}
