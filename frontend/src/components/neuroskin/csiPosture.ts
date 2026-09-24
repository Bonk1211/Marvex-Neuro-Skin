import type { SectionProbe } from '@/lib/api-client'

/**
 * Scripted WiFi-CSI detections for the section view.
 *
 * NOTHING HERE IS MEASURED. No CSI hardware is wired to this build, so these are
 * deterministic stand-ins shaped like what an ESP32 CSI node would report
 * (hardware/esp32/csi_probe). They exist to show what the control loop would do
 * with a posture channel, and every surface that renders them says SIMULATED.
 *
 * The one thing that is real is the consequence: facingDeg is fed back to the
 * daylight oracle as the occupant's eye normal, and the Ev it returns is solved,
 * not scripted. The sensor is fake; the physics it drives is not.
 */

export type Posture = 'seated' | 'standing' | 'walking'
export type CsiActivity = 'auto' | 'working' | 'window' | 'walking' | 'empty'

export interface CsiDetection {
  probeIndex: number
  zone: string
  posture: Posture
  /** Head yaw in degrees, 0 facing the glazing, matching the oracle's view_rad. */
  facingDeg: number
  /** Detector confidence, 0-1. A CSI node is least sure about a still occupant. */
  confidence: number
  /** Breathing rate, the channel that keeps a motionless person detected. */
  breathingBpm: number | null
}

export interface CsiFrame {
  node: string
  subcarriers: number
  rssiDbm: number
  framesPerSecond: number
  detections: CsiDetection[]
  /** Never remove. Every renderer keys its SIMULATED banner off this. */
  simulated: true
}

/** Deterministic per-seat phase, so a seat's drift is stable across renders. */
const phase = (index: number) => ((index * 2654435761) % 1000) / 1000

/**
 * Occupants turn slowly and unevenly. The period is deliberately long: a head that
 * spun every second would make the Ev trace look like noise rather than a signal.
 */
const facingFor = (index: number, seconds: number) => {
  const drift = Math.sin(seconds * 0.11 + phase(index) * Math.PI * 2)
  const lean = Math.sin(seconds * 0.043 + phase(index) * 7)
  return (((phase(index) * 360 + drift * 55 + lean * 25) % 360) + 360) % 360
}

export function csiFrame(
  probes: SectionProbe[],
  occupancy: number,
  seconds: number
): CsiFrame {
  const seats = probes.filter((p) => p.kind === 'seat')
  const fraction = Number.isFinite(occupancy)
    ? Math.max(0, Math.min(1, occupancy))
    : 0
  const present = Math.round(seats.length * fraction)
  const detections = seats.slice(0, present).map((seat, i) => {
    // A CSI node reads motion, so a walker is the easiest detection and a still
    // reader the hardest. Confidence follows that, not the other way round.
    const walking = present > 2 && i % 7 === 3
    const standing = !walking && i % 5 === 2
    const posture: Posture = walking
      ? 'walking'
      : standing
        ? 'standing'
        : 'seated'
    return {
      probeIndex: seat.index,
      zone: seat.zone,
      posture,
      facingDeg: Math.round(facingFor(seat.index, seconds) * 10) / 10,
      confidence:
        posture === 'walking'
          ? 0.94
          : posture === 'standing'
            ? 0.88
            : 0.72 + phase(seat.index) * 0.14,
      breathingBpm:
        posture === 'seated' ? Math.round(12 + phase(seat.index) * 6) : null,
    }
  })
  return {
    node: 'csi-01',
    // ESP32 HT20 gives 64 subcarriers; 56 carry data. rssi/rate are plausible
    // bench values for a node one room away from its injector.
    subcarriers: 56,
    rssiDbm: -47 - Math.round(3 * Math.sin(seconds * 0.3)),
    framesPerSecond: 98 + Math.round(2 * Math.sin(seconds * 0.7)),
    detections,
    simulated: true,
  }
}

/**
 * The detection the section view decomposes: whoever the CSI node is most sure about.
 * ``zone`` scopes it to one bay, so the section follows the zone selected elsewhere in
 * the dashboard; a zone with nobody in it falls back to the whole floor.
 */
export function primaryDetection(
  frame: CsiFrame,
  zone?: string | null
): CsiDetection | null {
  const scoped = zone ? frame.detections.filter((d) => d.zone === zone) : []
  const pool = scoped.length ? scoped : frame.detections
  if (!pool.length) return null
  return pool.reduce((best, d) => (d.confidence > best.confidence ? d : best))
}

/** Postures in the order the panel shows them: the ones Ev depends on come first. */
export const POSTURES: Posture[] = ['seated', 'standing', 'walking']

export interface PostureGroup {
  posture: Posture
  detections: CsiDetection[]
  /** Mean detector confidence, 0 for an empty group. A still occupant reads worst. */
  meanConfidence: number
}

/**
 * Split a frame by posture, always returning all three groups so the panel keeps a
 * stable set of cards instead of reflowing as people stand up and sit down.
 */
export function groupByPosture(frame: CsiFrame): PostureGroup[] {
  return POSTURES.map((posture) => {
    const detections = frame.detections.filter((d) => d.posture === posture)
    return {
      posture,
      detections,
      meanConfidence: detections.length
        ? detections.reduce((sum, d) => sum + d.confidence, 0) /
          detections.length
        : 0,
    }
  })
}

/** A visible control proposal, separate from the backend's applied controller. */
export function csiFacadePreview({
  angle,
  ev,
  et,
  cap,
  etLow = 300,
  etHigh = 500,
  posture,
  safe,
}: {
  angle: number
  ev: number
  et: number
  cap: number
  etLow?: number
  etHigh?: number
  posture: Posture | null
  safe: boolean
}) {
  const current = Math.max(0, Math.min(60, angle))
  const valid =
    [angle, ev, et, cap, etLow, etHigh].every(Number.isFinite) &&
    ev >= 0 &&
    et >= 0 &&
    cap > 0 &&
    etHigh > etLow
  if (!valid) return null
  // ponytail: linear transmission is an illustrative policy preview; replace with
  // angle-conditioned oracle solves before using these targets for actuation.
  const transmission = (target: number) =>
    (1 - target / 75) / (1 - current / 75)
  const cost = (target: number) => {
    const ratio = transmission(target)
    const task = et * ratio
    return (
      Math.max(0, (ev * ratio) / cap - 1) * 5 +
      Math.max(0, (etLow - task) / etLow) * 3 +
      Math.max(0, (task - etHigh) / etHigh) * 2 +
      ratio * 0.15 +
      (Math.abs(target - current) / 60) * 0.02
    )
  }
  let target = current
  if (!safe && posture !== 'walking') {
    if (!posture) target = 60
    else
      for (let candidate = 0; candidate <= 60; candidate += 3) {
        if (cost(candidate) < cost(target)) target = candidate
      }
  }
  const ratio = transmission(target)
  const reason = safe
    ? 'Safety hold takes priority.'
    : !posture
      ? 'No occupant detected. Prioritise solar shading.'
      : posture === 'walking'
        ? 'Passing movement. Hold position to avoid unnecessary cycling.'
        : ev > cap
          ? 'Eye light is high. Add shading while preserving desk light.'
          : et < etLow
            ? 'Desk light is low. Admit daylight before adding electric light.'
            : et > etHigh
              ? 'More light than needed. Reduce solar gain and keep useful daylight.'
              : 'Keep useful desk light with the least solar exposure.'
  return {
    angle: target,
    ev: ev * ratio,
    et: et * ratio,
    solarChange: (1 - ratio) * 100,
    reason,
  }
}
