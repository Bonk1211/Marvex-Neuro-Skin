import { expect, it } from 'vitest'
import * as THREE from 'three'
import type { SectionPatch } from '@/lib/api-client'
import type { TickPayload } from '@/lib/types'
import { WALL_ROTATION } from './bandPlan'
import {
  SECTION_BAR_M,
  bandFlux,
  beamEntry,
  cutColumn,
  luxColor,
  patchFace,
  sectionBar,
  acrossAxis,
  applyOrbit,
  orbitChanged,
  poseSkeleton,
  toBuildingAzimuth,
  toSectionAzimuth,
  topContributors,
  yawExtremes,
} from './sectionScene'

const ROOM = { width: 6.4, height: 3.6, depth: 6.4 }

const patch = (
  centre: [number, number, number],
  normal: [number, number, number],
  contribution = 0
): SectionPatch => ({
  centre,
  normal,
  area: 2.56,
  reflectance: 0.6,
  direct_lux: 0,
  radiosity_lux: 100,
  contribution_lux: contribution,
})

it('names each surface from its centre and normal, and keeps side walls out of a cut', () => {
  const floor = patch([0.8, 0, 1.6], [0, 1, 0])
  const ceiling = patch([0.8, 3.6, 1.6], [0, -1, 0])
  const glazing = patch([0.8, 1.8, 0], [0, 0, 1])
  const back = patch([0.8, 1.8, 6.4], [0, 0, -1])
  const side = patch([0, 1.8, 1.6], [1, 0, 0])
  expect(floor).toSatisfy(() => patchFace(floor, ROOM) === 'floor')
  expect(patchFace(ceiling, ROOM)).toBe('ceiling')
  expect(patchFace(glazing, ROOM)).toBe('glazing')
  expect(patchFace(back, ROOM)).toBe('back')
  expect(patchFace(side, ROOM)).toBe('side')

  const cut = cutColumn([floor, ceiling, glazing, back, side], 0.9, ROOM)
  expect(cut).toHaveLength(4)
  expect(cut).not.toContain(side)
})

it('snaps a cut to the nearest patch column rather than returning a mixed slice', () => {
  const near = patch([0.8, 0, 1.6], [0, 1, 0])
  const far = patch([4.0, 0, 1.6], [0, 1, 0])
  expect(cutColumn([near, far], 3.6, ROOM)).toEqual([far])
  expect(cutColumn([near, far], 2.3, ROOM)).toEqual([near])
})

it('ranks bounce sources by contribution and drops the ones carrying no light', () => {
  const dark = patch([0.8, 0, 1.6], [0, 1, 0], 0)
  const dim = patch([2.4, 0, 1.6], [0, 1, 0], 4)
  const bright = patch([4.0, 0, 1.6], [0, 1, 0], 90)
  expect(topContributors([dark, dim, bright], 5)).toEqual([bright, dim])
  expect(topContributors([dark, dim, bright], 1)).toEqual([bright])
  expect(topContributors([dark], 3)).toEqual([])
})

it('back-traces a beam to the glazing, and refuses a sun that cannot enter', () => {
  // oracle.py convention: sun points TOWARDS the sun, outward (-z) and up (+y).
  const low = new THREE.Vector3(0, Math.sin(0.61), -Math.cos(0.61))
  const entry = beamEntry([low.x, low.y, low.z], new THREE.Vector3(3.2, 0, 2), ROOM)
  expect(entry).not.toBeNull()
  expect(entry!.z).toBeCloseTo(0, 6)
  // 2 m deep under a 35-degree sun enters 1.4 m up the glazing.
  expect(entry!.y).toBeCloseTo(2 * Math.tan(0.61), 5)

  // Sun on the far side of the back wall never crosses the aperture.
  expect(beamEntry([0, 0.5, 0.866], new THREE.Vector3(3.2, 0, 2), ROOM)).toBeNull()
  // A steep sun back-traces to a point above the head of the glazing.
  const high = new THREE.Vector3(0, Math.sin(1.31), -Math.cos(1.31))
  expect(beamEntry([high.x, high.y, high.z], new THREE.Vector3(3.2, 0, 6), ROOM)).toBeNull()
})

it('saturates the lux ramp at the cap so two zones stay comparable', () => {
  const dark = luxColor(0, 1000)
  const mid = luxColor(500, 1000)
  const over = luxColor(4000, 1000)
  expect(dark.getHexString()).not.toBe(mid.getHexString())
  expect(over.getHexString()).toBe(luxColor(1000, 1000).getHexString())
  expect(mid.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(
    dark.getHSL({ h: 0, s: 0, l: 0 }).l
  )
})

it('reports the head-yaw swing an occupant can cause without the room changing', () => {
  const sweep = [
    { view_deg: 0, eye_lux: 2400 },
    { view_deg: 90, eye_lux: 600 },
    { view_deg: 180, eye_lux: 200 },
  ]
  const extremes = yawExtremes(sweep)!
  expect(extremes.best.view_deg).toBe(0)
  expect(extremes.worst.view_deg).toBe(180)
  expect(extremes.ratio).toBeCloseTo(12, 6)
  expect(yawExtremes([])).toBeNull()
})

it('lays section bars on the surface they belong to, and skips side walls', () => {
  const cap = 1000
  const floor = patch([0.8, 0, 1.6], [0, 1, 0])
  const ceiling = patch([0.8, 3.6, 1.6], [0, -1, 0])
  const glazing = patch([0.8, 1.8, 0], [0, 0, 1])
  const back = patch([0.8, 1.8, 6.4], [0, 0, -1])
  const side = patch([0, 1.8, 1.6], [1, 0, 0])

  const bars = [floor, ceiling, glazing, back].map(
    (p) => sectionBar(p, ROOM, 'radiosity', cap, 3.2)!
  )
  expect(bars.every((b) => b.position.x === 3.2)).toBe(true)
  expect(bars[0].position.y).toBeCloseTo(SECTION_BAR_M / 2, 6)
  expect(bars[1].position.y).toBeCloseTo(ROOM.height - SECTION_BAR_M / 2, 6)
  expect(bars[2].position.z).toBeCloseTo(SECTION_BAR_M / 2, 6)
  expect(bars[3].position.z).toBeCloseTo(ROOM.depth - SECTION_BAR_M / 2, 6)
  // Floor and ceiling keep the patch's own z; walls keep its y.
  expect(bars[0].position.z).toBeCloseTo(1.6, 6)
  expect(bars[2].position.y).toBeCloseTo(1.8, 6)

  expect(sectionBar(side, ROOM, 'radiosity', cap, 3.2)).toBeNull()
})

it('averages a band to oracle flux, splits beam from diffuse, and clamps a spike', () => {
  const tick = {
    facade: [
      {
        orientation: 'west',
        zones: [
          { row: 1, transmitted: 300, diffuse_transmitted: 100, incident: 900, diffuse_incident: 200 },
          { row: 1, transmitted: 500, diffuse_transmitted: 100, incident: 900, diffuse_incident: 200 },
          { row: 2, transmitted: 999, diffuse_transmitted: 999, incident: 999, diffuse_incident: 999 },
        ],
      },
    ],
  } as unknown as TickPayload

  // Band 1: beam (200 + 400)/2 = 300, diffuse (100 + 100)/2 = 100.
  expect(bandFlux(tick, 'west', 1, true)).toEqual({ beam: 300, diffuse: 100 })
  // Uncontrolled reads the raw incident channel instead.
  expect(bandFlux(tick, 'west', 1, false)).toEqual({ beam: 700, diffuse: 200 })
  // A band with no zones is dark, not NaN.
  expect(bandFlux(tick, 'west', 3, true)).toEqual({ beam: 0, diffuse: 0 })

  const spike = {
    facade: [
      { orientation: 'west', zones: [{ row: 0, transmitted: 9000, diffuse_transmitted: 4000, incident: 0, diffuse_incident: 0 }] },
    ],
  } as unknown as TickPayload
  expect(bandFlux(spike, 'west', 0, true)).toEqual({ beam: 1500, diffuse: 1500 })
})

it('lines the section up with whichever wall the building is showing, both ways', () => {
  // Head-on in the building means head-on through the glazing in the section.
  for (const [orientation, rotation] of Object.entries(WALL_ROTATION)) {
    const side = orientation as keyof typeof WALL_ROTATION
    expect(Math.abs(toSectionAzimuth(rotation, side))).toBeCloseTo(Math.PI, 6)
    expect(toBuildingAzimuth(Math.PI, side)).toBeCloseTo(rotation, 6)
  }

  // Turning the building turns the room the same way, by the same amount.
  const before = toSectionAzimuth(WALL_ROTATION.west, 'west')
  const after = toSectionAzimuth(WALL_ROTATION.west + 0.4, 'west')
  expect(Math.atan2(Math.sin(after - before), Math.cos(after - before))).toBeCloseTo(0.4, 6)

  // Round trip is lossless and always lands inside (-pi, pi].
  for (const azimuth of [-3.1, -1, 0, 0.7, 2.9]) {
    const round = toBuildingAzimuth(toSectionAzimuth(azimuth, 'east'), 'east')
    expect(Math.sin(round)).toBeCloseTo(Math.sin(azimuth), 6)
    expect(Math.cos(round)).toBeCloseTo(Math.cos(azimuth), 6)
    expect(round).toBeGreaterThan(-Math.PI - 1e-9)
    expect(round).toBeLessThanOrEqual(Math.PI + 1e-9)
  }
})

it('ignores damping jitter but forwards a real turn', () => {
  const pose = { azimuth: 1, polar: 0.8 }
  expect(orbitChanged(null, pose)).toBe(true)
  expect(orbitChanged(pose, { azimuth: 1.001, polar: 0.801 })).toBe(false)
  expect(orbitChanged(pose, { azimuth: 1.2, polar: 0.8 })).toBe(true)
  expect(orbitChanged(pose, { azimuth: 1, polar: 0.9 })).toBe(true)
  // Crossing the pi seam is a small move, not a full turn.
  expect(orbitChanged({ azimuth: Math.PI - 0.001, polar: 0.8 }, { azimuth: -Math.PI + 0.001, polar: 0.8 })).toBe(false)
})

it('applies an orbit pose without moving the camera closer, and respects the clamp', () => {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(11, 7, 13)
  const controls = {
    target: new THREE.Vector3(3.2, 1.4, 3.2),
    minPolarAngle: 0,
    maxPolarAngle: Math.PI / 2 - 0.05,
    update: () => {},
  }
  const radius = camera.position.distanceTo(controls.target)

  applyOrbit(camera, controls, { azimuth: -1.2, polar: 1.1 })
  const offset = camera.position.clone().sub(controls.target)
  expect(offset.length()).toBeCloseTo(radius, 6)
  // Read back the way OrbitControls would.
  expect(Math.atan2(offset.x, offset.z)).toBeCloseTo(-1.2, 6)
  expect(Math.acos(offset.y / offset.length())).toBeCloseTo(1.1, 6)

  // A pose below the floor is clamped, not obeyed.
  applyOrbit(camera, controls, { azimuth: 0, polar: 3 })
  const low = camera.position.clone().sub(controls.target)
  expect(Math.acos(low.y / low.length())).toBeCloseTo(controls.maxPolarAngle, 6)
})

it('points the shoulders across whichever way the occupant faces', () => {
  for (const deg of [0, 37, 90, 180, 274]) {
    const view = (deg * Math.PI) / 180
    const facing = new THREE.Vector3(Math.sin(view), 0, -Math.cos(view))
    const across = acrossAxis(deg)
    expect(across.length()).toBeCloseTo(1, 6)
    expect(across.dot(facing)).toBeCloseTo(0, 6)
    expect(across.y).toBe(0)
  }
})

it('stands a skeleton on the floor at human scale, spanning the across axis', () => {
  const detection = {
    probeIndex: 2,
    zone: 'W6',
    posture: 'standing' as const,
    facingDeg: 0,
    confidence: 0.9,
    breathingBpm: null,
  }
  const origin = new THREE.Vector3(2, 0, 3)
  const { positions } = poseSkeleton(detection, origin, new THREE.Vector3(1, 0, 0), 1)
  let minY = Infinity
  let maxY = -Infinity
  let minX = Infinity
  let maxX = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i])
    maxX = Math.max(maxX, positions[i])
    minY = Math.min(minY, positions[i + 1])
    maxY = Math.max(maxY, positions[i + 1])
    // The across axis is x only, so the figure stays in its own depth plane.
    expect(positions[i + 2]).toBeCloseTo(3, 6)
  }
  expect(minY).toBeGreaterThan(0) // feet on the floor, nothing below it
  expect(minY).toBeLessThan(0.1)
  expect(maxY).toBeGreaterThan(1.55) // crown of a standing adult
  expect(maxY).toBeLessThan(1.75)
  // Shoulders and arms span a bit over a third of a metre either side of centre.
  expect(maxX - minX).toBeGreaterThan(0.5)
  expect(maxX - minX).toBeLessThan(0.9)
  expect((minX + maxX) / 2).toBeCloseTo(2, 1)
})

it('seats a skeleton at the eye height the daylight probes use', () => {
  const seated = poseSkeleton(
    {
      probeIndex: 2,
      zone: 'W6',
      posture: 'seated',
      facingDeg: 0,
      confidence: 0.8,
      breathingBpm: 14,
    },
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    1
  )
  let maxY = -Infinity
  for (let i = 1; i < seated.positions.length; i += 3) maxY = Math.max(maxY, seated.positions[i])
  // Seat eye plane is 1.2 m in room.py; the crown sits just above it.
  expect(maxY).toBeGreaterThan(1.15)
  expect(maxY).toBeLessThan(1.45)
})
