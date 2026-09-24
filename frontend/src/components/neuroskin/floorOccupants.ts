import type { FacadeOrientation } from '@/lib/types'

const SIDES: FacadeOrientation[] = ['north', 'east', 'south', 'west']

export const MEETING_SEATS = [0, 1, 2, 3, 12, 13]

/** Scripted demo counts, shared by the scene and inspector; no camera inference. */
export function mockOccupancy(
  occupancy: number,
  side: FacadeOrientation,
  band: number,
  meetingDemo = false
) {
  if (meetingDemo && side === 'west' && band === 3)
    return {
      total: MEETING_SEATS.length,
      walking: 0,
      seated: MEETING_SEATS.length,
    }
  const capacity = 8 + ((SIDES.indexOf(side) * 3 + band * 2) % 5)
  const fraction = Number.isFinite(occupancy)
    ? Math.max(0, Math.min(1, occupancy))
    : 0
  const total = Math.round(capacity * fraction)
  const walking = total > 1 ? Math.max(1, Math.floor(total / 3)) : 0
  return { total, walking, seated: total - walking }
}

export const occupantId = (
  side: FacadeOrientation,
  band: number,
  index: number
) => `${side[0].toUpperCase()}${band + 1}-${String(index + 1).padStart(2, '0')}`

// ponytail: a shared clear aisle is scripted for the four illustrative layouts;
// use a navigation mesh if furnishings or walkable rooms become editable.
const AISLE = [
  [-1.03, -0.55],
  [-1.03, 1.22],
  [0.75, 1.22],
  [0.96, 0.76],
  [0.96, -0.9],
]
const ROUTE = [...AISLE, ...AISLE.slice(1, -1).reverse(), AISLE[0]]
const LENGTHS = ROUTE.slice(1).map(([x, z], i) =>
  Math.hypot(x - ROUTE[i][0], z - ROUTE[i][1])
)
const DISTANCE = LENGTHS.reduce((sum, length) => sum + length, 0)

export function walkingPosition(
  seconds: number,
  index: number,
  side: FacadeOrientation,
  band: number
) {
  let distance =
    (((seconds * 0.22 + index * 2.3 + band * 0.8 + SIDES.indexOf(side)) %
      DISTANCE) +
      DISTANCE) %
    DISTANCE
  for (let i = 0; i < LENGTHS.length; i++) {
    if (distance <= LENGTHS[i] || i === LENGTHS.length - 1) {
      const [x, z] = ROUTE[i]
      const dx = ROUTE[i + 1][0] - x
      const dz = ROUTE[i + 1][1] - z
      return {
        x: x + (dx * distance) / LENGTHS[i],
        z: z + (dz * distance) / LENGTHS[i],
        rotation: Math.atan2(-dx, -dz),
      }
    }
    distance -= LENGTHS[i]
  }
  return { x: AISLE[0][0], z: AISLE[0][1], rotation: 0 }
}
