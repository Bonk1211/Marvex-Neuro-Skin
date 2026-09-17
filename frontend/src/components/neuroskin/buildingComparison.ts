import type { FacadeOrientation, TickPayload } from '@/lib/types'

export type BuildingVariant = 'controlled' | 'baseline'

export const BUILDING_VARIANTS = {
  controlled: 'NeuroSkin — Controlled Facade',
  baseline: 'Baseline — No External Facade',
} as const

export function baselineSurfaceTemperature(
  incident: number,
  outdoorTemp: number,
  wind: number
): number {
  return (
    outdoorTemp +
    (0.6 * Math.max(0, incident)) / (5.7 + 3.8 * Math.max(0, wind))
  )
}

/** Pre-glazing model estimates; a wall mean gives each zone equal weight. */
export function surfaceIrradianceComparison(
  tick: TickPayload,
  surface: `wall:${FacadeOrientation}` | `roof:${FacadeOrientation}`,
  zoneId: string | null
): {
  controlled: number
  baseline: number
  label: string
  reduction: number | null
} | null {
  const [kind, orientation] = surface.split(':')
  const name = orientation[0].toUpperCase() + orientation.slice(1)
  let readings: { incident: number; transmitted: number }[]
  let label: string
  if (kind === 'roof') {
    const roof = tick.roof?.find((face) => face.quadrant === orientation)
    if (!roof) return null
    readings = [{ incident: roof.incident, transmitted: roof.incident }]
    label = `${name} roof`
  } else {
    const wall = tick.facade?.find((face) => face.orientation === orientation)
    if (!wall) return null
    if (zoneId !== null) {
      const zone = wall.zones?.find((zone) => zone.zone === zoneId)
      if (!zone) return null
      readings = [zone]
      label = `${name} · ${zone.zone}`
    } else {
      readings = wall.zones?.length ? wall.zones : [wall]
      label = wall.zones?.length
        ? `${name} · mean of ${readings.length} zones`
        : name
    }
  }
  if (
    readings.some(
      ({ incident, transmitted }) =>
        !Number.isFinite(incident) ||
        !Number.isFinite(transmitted) ||
        incident < 0 ||
        transmitted < 0
    )
  )
    return null
  const controlled =
    readings.reduce((sum, reading) => sum + reading.transmitted, 0) /
    readings.length
  const baseline =
    readings.reduce((sum, reading) => sum + reading.incident, 0) /
    readings.length
  return {
    controlled,
    baseline,
    label,
    reduction: baseline > 0 ? ((baseline - controlled) / baseline) * 100 : null,
  }
}
