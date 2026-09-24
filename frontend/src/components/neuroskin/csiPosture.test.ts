import { expect, it } from 'vitest'
import type { SectionProbe } from '@/lib/api-client'
import {
  csiFacadePreview,
  csiFrame,
  groupByPosture,
  primaryDetection,
} from './csiPosture'

const probes: SectionProbe[] = Array.from({ length: 10 }, (_, i) => ({
  index: i,
  kind: i % 4 === 3 ? 'desk' : 'seat',
  x: 1 + i * 0.4,
  z: 2,
  height_m: 1.2,
  view_deg: 0,
  zone: `W${i}`,
  task_lux: 300,
  eye_lux: 400,
}))

it('previews comfort and vacancy responses while holding for movement and safety', () => {
  const input = {
    angle: 30,
    ev: 1500,
    et: 700,
    cap: 1000,
    posture: 'seated' as const,
    safe: false,
  }
  const shaded = csiFacadePreview(input)!
  expect(shaded.angle).toBeGreaterThan(input.angle)
  expect(shaded.ev).toBeLessThanOrEqual(input.cap)
  expect(shaded.et).toBeGreaterThanOrEqual(300)
  expect(shaded.et).toBeLessThanOrEqual(500)
  expect(csiFacadePreview({ ...input, ev: 100, et: 150 })!.angle).toBeLessThan(
    input.angle
  )
  expect(csiFacadePreview({ ...input, posture: null })!.angle).toBe(60)
  expect(csiFacadePreview({ ...input, posture: 'walking' })!.angle).toBe(30)
  expect(csiFacadePreview({ ...input, safe: true, posture: null })!.angle).toBe(
    30
  )
  expect(csiFacadePreview({ ...input, ev: NaN })).toBeNull()
})

it('detects seats only, scaled by occupancy, and never a desk', () => {
  const seats = probes.filter((p) => p.kind === 'seat').length
  expect(csiFrame(probes, 1, 0).detections).toHaveLength(seats)
  expect(csiFrame(probes, 0, 0).detections).toHaveLength(0)
  expect(csiFrame(probes, 0.5, 0).detections.length).toBe(
    Math.round(seats * 0.5)
  )
  const deskIndexes = probes
    .filter((p) => p.kind === 'desk')
    .map((p) => p.index)
  for (const d of csiFrame(probes, 1, 0).detections) {
    expect(deskIndexes).not.toContain(d.probeIndex)
  }
})

it('is deterministic for the same clock and drifts for a later one', () => {
  expect(csiFrame(probes, 1, 12)).toEqual(csiFrame(probes, 1, 12))
  const now = csiFrame(probes, 1, 12).detections[0].facingDeg
  const later = csiFrame(probes, 1, 40).detections[0].facingDeg
  expect(later).not.toBe(now)
})

it('keeps every facing a usable bearing and stays flagged as simulated', () => {
  const frame = csiFrame(probes, 1, 31)
  expect(frame.simulated).toBe(true)
  for (const d of frame.detections) {
    expect(d.facingDeg).toBeGreaterThanOrEqual(0)
    expect(d.facingDeg).toBeLessThan(360)
    expect(d.confidence).toBeGreaterThan(0)
    expect(d.confidence).toBeLessThanOrEqual(1)
    // Breathing is the channel that holds a still occupant; movers do not need it.
    expect(d.breathingBpm === null).toBe(d.posture !== 'seated')
  }
})

it('picks the most confident detection, and nothing from an empty floor', () => {
  const frame = csiFrame(probes, 1, 5)
  const best = primaryDetection(frame)!
  expect(best.confidence).toBe(
    Math.max(...frame.detections.map((d) => d.confidence))
  )
  expect(primaryDetection(csiFrame(probes, 0, 5))).toBeNull()
})

it('always returns all three posture groups, partitioned and averaged', () => {
  const frame = csiFrame(probes, 1, 9)
  const groups = groupByPosture(frame)
  expect(groups.map((g) => g.posture)).toEqual([
    'seated',
    'standing',
    'walking',
  ])
  // A partition: every detection lands in exactly one group, none invented.
  expect(groups.reduce((n, g) => n + g.detections.length, 0)).toBe(
    frame.detections.length
  )
  for (const group of groups) {
    for (const d of group.detections) expect(d.posture).toBe(group.posture)
    if (group.detections.length) {
      const mean =
        group.detections.reduce((sum, d) => sum + d.confidence, 0) /
        group.detections.length
      expect(group.meanConfidence).toBeCloseTo(mean, 9)
    } else {
      expect(group.meanConfidence).toBe(0)
    }
  }
})

it('keeps three cards on an empty floor rather than collapsing them', () => {
  const groups = groupByPosture(csiFrame(probes, 0, 9))
  expect(groups).toHaveLength(3)
  expect(
    groups.every((g) => g.detections.length === 0 && g.meanConfidence === 0)
  ).toBe(true)
})

it('rates a still occupant as the hardest detection', () => {
  const groups = groupByPosture(csiFrame(probes, 1, 9))
  const seated = groups.find((g) => g.posture === 'seated')!
  const walking = groups.find((g) => g.posture === 'walking')!
  expect(seated.detections.length).toBeGreaterThan(0)
  expect(walking.detections.length).toBeGreaterThan(0)
  expect(seated.meanConfidence).toBeLessThan(walking.meanConfidence)
})
