import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { TickPayload } from '@/lib/types'
import {
  bakeExposure,
  bakeIrradiance,
  EXPOSURE_RAMP,
  exposureColor,
  facadeOccluders,
  IRRADIANCE_MAX,
  IRRADIANCE_RAMP,
  irradianceColor,
  roofGrid,
  sunSamples,
} from './solarExposure'

/**
 * A flat patch at y = 0 spanning z 1..3, with a 3 x 3 vertex grid. Wide edge
 * first, so its normal points up the way a real roof quadrant's does — the bake
 * skips any sun that is behind the face.
 */
function patch() {
  const mesh = new THREE.Mesh(roofGrid(3, 1, 0, 0, 2))
  mesh.updateMatrixWorld(true)
  return mesh
}

/** A lid hanging over the middle of that patch, so it can cast a shadow. */
function lid() {
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1))
  box.position.set(0, 0.5, 2)
  box.updateMatrixWorld(true)
  return box
}

const overhead = [
  {
    direction: new THREE.Vector3(0, 1, 0),
    direct: 800,
    diffuse: 100,
    hours: 1,
  },
]

const CENTRE = 4 // row 1, column 1 of a 3 x 3 grid
const CORNER = 0

const baseTick: TickPayload = {
  timestamp: '2026-09-01T06:00:00+08:00',
  ghi: 0,
  expected_ghi: 0,
  solar_azimuth: 90,
  solar_elevation: -5,
  measured_irradiance: 0,
  cloud: 0,
  outdoor_temp: 27,
  occupancy: 0,
  wind: 1,
  rain: false,
  load_relative: 0,
  naive_load_relative: 0,
  latent_load: 0,
  lux: 0,
  naive_lux: 0,
  angle_target: 0,
  angle_final: 0,
  naive_angle: 0,
  mode: 'track',
  moved: false,
  sensor_trusted: true,
  reason: '',
  cost_breakdown: { thermal: 0, lux: 0, movement: 0, risk: 0 },
  facade: [],
  roof: [],
}

const roofFace = {
  quadrant: 'south' as const,
  azimuth: 180,
  tilt: 15,
  incident: 700,
  sky_diffuse: 120,
  ground_diffuse: 30,
  sol_air_temp: 45,
}

describe('roofGrid', () => {
  it('subdivides the same trapezoid slopedPanel draws', () => {
    const geometry = roofGrid(2, 1, 0, 1, 1)
    const position = geometry.getAttribute('position')
    expect(position.count).toBe(4)
    expect(geometry.getIndex()!.count).toBe(6)
    // Bottom edge at the wide end, top edge at the narrow one.
    expect(position.getX(0)).toBeCloseTo(-2)
    expect(position.getZ(0)).toBeCloseTo(2)
    expect(position.getX(3)).toBeCloseTo(1)
    expect(position.getY(3)).toBeCloseTo(1)
  })

  it('carries a colour attribute for the bake to write into', () => {
    const geometry = roofGrid(1, 3, 0, 0, 2)
    expect(geometry.getAttribute('color').count).toBe(9)
  })

  it('subdivides one tapered wall bay with inset gaps and outward winding', () => {
    const geometry = roofGrid(3, 6, 0, 3, 2, 1, 3, 0.1)
    const position = geometry.getAttribute('position')
    expect(position.count).toBe(9)
    expect(position.getX(0)).toBeCloseTo(-0.9)
    expect(position.getX(2)).toBeCloseTo(0.9)
    expect(position.getX(6)).toBeCloseTo(-1.9)
    expect(position.getX(8)).toBeCloseTo(1.9)
    expect(position.getY(CENTRE)).toBeCloseTo(1.5)
    expect(position.getZ(CENTRE)).toBeCloseTo(4.5)
    expect(geometry.getAttribute('normal').getZ(CENTRE)).toBeGreaterThan(0)
  })
})

describe('bakeExposure', () => {
  it('drops a shadow where an occluder blocks the beam', () => {
    const { exposure, min, max } = bakeExposure(patch(), [lid()], overhead)
    // Shadowed: diffuse only. Lit: beam plus diffuse.
    expect(exposure[CENTRE]).toBeCloseTo(0.1, 5)
    expect(exposure[CORNER]).toBeCloseTo(0.9, 5)
    // The reported range is what the ramp gets stretched across.
    expect(min).toBeCloseTo(0.1, 5)
    expect(max).toBeCloseTo(0.9, 5)
  })

  it('leaves everything lit when nothing occludes it', () => {
    const { exposure, min, max } = bakeExposure(patch(), [], overhead)
    expect(max).toBeCloseTo(0.9, 5)
    expect(min).toBeCloseTo(0.9, 5)
    expect(exposure[CENTRE]).toBeCloseTo(0.9, 5)
  })

  it('returns zero exposure for a run with no daylight', () => {
    const { exposure, min, max } = bakeExposure(patch(), [lid()], [])
    expect(max).toBe(0)
    expect(min).toBe(0)
    expect([...exposure].every((value) => value === 0)).toBe(true)
  })

  it('matches triangle raycasting for a rotated, scaled box with a transformed parent', () => {
    const parent = new THREE.Group()
    parent.position.set(0, 0.75, 2)
    parent.rotation.set(0.2, 0.3, 0.1)
    parent.scale.set(1.3, 0.7, 1.1)
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.15, 0.7),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    )
    box.position.x = 0.12
    box.rotation.set(0.3, -0.2, 0.4)
    box.scale.set(0.8, 1.4, 1.1)
    const triangles: THREE.Mesh = box.clone()
    // Plain BufferGeometry keeps the exact triangles on the fallback path.
    triangles.geometry = new THREE.BufferGeometry().copy(box.geometry)
    parent.add(box, triangles)
    const samples = [
      new THREE.Vector3(0.2, 1, 0),
      new THREE.Vector3(0, 1, 0.3),
      new THREE.Vector3(-0.3, 1, -0.2),
    ].map((direction) => ({
      ...overhead[0],
      direction: direction.normalize(),
      hours: 1 / 3,
    }))
    const surface = new THREE.Mesh(roofGrid(3, 1, 0, 0, 16))
    const actual = bakeExposure(surface, [box], samples)
    const reference = bakeExposure(surface, [triangles], samples)
    expect(actual.exposure).toEqual(reference.exposure)
    expect(actual.min).toBeLessThan(actual.max)
  })

  it('limits scaled box shadows by world distance, not local box distance', () => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    box.scale.set(0.8, 8, 0.8)
    box.position.set(0, 43, 2) // Near face is 39 scene units away.
    expect(bakeExposure(patch(), [box], overhead).exposure[CENTRE]).toBeCloseTo(
      0.1
    )
    box.position.y = 45 // Near face is beyond the 40-unit ray limit.
    expect(bakeExposure(patch(), [box], overhead).exposure[CENTRE]).toBeCloseTo(
      0.9
    )
    box.position.y = -6 // Entirely behind the ray, despite the large scale.
    expect(bakeExposure(patch(), [box], overhead).exposure[CENTRE]).toBeCloseTo(
      0.9
    )
  })

  it('keeps non-box occluders on the geometry raycast path', () => {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6))
    sphere.position.set(0, 0.5, 2)
    const { exposure } = bakeExposure(patch(), [sphere], overhead)
    expect(exposure[CENTRE]).toBeCloseTo(0.1)
    expect(exposure[CORNER]).toBeCloseTo(0.9)
  })
})

describe('bakeIrradiance', () => {
  const reading = { incident: 900, sky_diffuse: 80, ground_diffuse: 20 }

  it('maps sun and geometry shadows in W/m², retaining diffuse light', () => {
    const values = bakeIrradiance(
      patch(),
      [lid()],
      reading,
      new THREE.Vector3(0, 11, 0)
    )
    expect(values[CENTRE]).toBeCloseTo(100)
    expect(values[CORNER]).toBeCloseTo(900)
  })

  it('does not apply a second incidence-angle cosine to the backend reading', () => {
    const values = bakeIrradiance(
      patch(),
      [],
      reading,
      new THREE.Vector3(0, 1, 1)
    )
    expect(values[CENTRE]).toBeCloseTo(900)
  })

  it('changes diffuse fill without changing the raw beam or applying incidence twice', () => {
    const values = bakeIrradiance(
      patch(),
      [lid()],
      reading,
      new THREE.Vector3(0, 1, 0.2),
      40
    )
    expect(values[CENTRE]).toBeCloseTo(40)
    expect(values[CORNER]).toBeCloseTo(840)
  })

  it('removes hidden facade proxies but retains passive shadows and the same roof exposure', () => {
    const adaptive = lid()
    const hiddenAssembly = new THREE.Group()
    hiddenAssembly.visible = false
    adaptive.visible = false
    hiddenAssembly.add(adaptive)
    const passive = lid()
    passive.position.set(-3, 0.5, 3)
    const banks = [{ occluders: [adaptive] }]
    const controlled = facadeOccluders([passive], banks, true)
    const baseline = facadeOccluders([passive], banks, false)
    const direction = new THREE.Vector3(0, 1, 0)
    const before = bakeIrradiance(patch(), controlled, reading, direction)
    const after = bakeIrradiance(patch(), baseline, reading, direction)
    expect(before[CENTRE]).toBeCloseTo(100)
    expect(after[CENTRE]).toBeCloseTo(900)
    expect(after[CORNER]).toBeCloseTo(before[CORNER])
    expect(after[CORNER]).toBeCloseTo(100)
    after.forEach((value, index) =>
      expect(value).toBeGreaterThanOrEqual(before[index])
    )
    const roof = patch()
    roof.position.y = 1 // Adaptive hardware stays entirely below the roof.
    expect(bakeExposure(roof, controlled, overhead).exposure).toEqual(
      bakeExposure(roof, baseline, overhead).exposure
    )
  })

  it('leaves a rear-facing wall diffuse-only and makes night entirely zero', () => {
    const wall = new THREE.Mesh(roofGrid(2, 2, 0, 3, 2))
    const values = bakeIrradiance(
      wall,
      [],
      reading,
      new THREE.Vector3(0, 1, -1)
    )
    expect(values[CENTRE]).toBeCloseTo(100)
    for (const direction of [
      new THREE.Vector3(0, -1, 1),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(NaN, 1, 0),
    ]) {
      expect([...bakeIrradiance(wall, [], reading, direction)]).toEqual(
        Array(9).fill(0)
      )
    }
  })

  it('sanitizes invalid readings and never exceeds the plane-of-array total', () => {
    for (const invalid of [
      { incident: NaN, sky_diffuse: 80, ground_diffuse: 20 },
      { incident: -100, sky_diffuse: 80, ground_diffuse: 20 },
    ]) {
      expect(
        bakeIrradiance(patch(), [], invalid, new THREE.Vector3(0, 1, 0))[CENTRE]
      ).toBe(0)
    }
    expect(
      bakeIrradiance(
        patch(),
        [],
        { incident: 90, sky_diffuse: 120, ground_diffuse: Infinity },
        new THREE.Vector3(0, 1, 0)
      )[CENTRE]
    ).toBeCloseTo(90)
  })
})

describe('irradianceColor', () => {
  it('maps fixed W/m² levels to the legend colours in linear working space', () => {
    IRRADIANCE_RAMP.forEach((hex, index) => {
      const color = irradianceColor(
        (index / (IRRADIANCE_RAMP.length - 1)) * IRRADIANCE_MAX
      )
      expect(color.getHexString()).toBe(hex.slice(1))
      expect(color.r).toBeCloseTo(new THREE.Color(hex).r, 7)
      expect(color.g).toBeCloseTo(new THREE.Color(hex).g, 7)
      expect(color.b).toBeCloseTo(new THREE.Color(hex).b, 7)
    })
    const midpoint = new THREE.Color(IRRADIANCE_RAMP[0]).lerp(
      new THREE.Color(IRRADIANCE_RAMP[1]),
      0.5
    )
    expect(irradianceColor(100).equals(midpoint)).toBe(true)
  })

  it('clamps values beyond the fixed scale and handles invalid input', () => {
    const first = IRRADIANCE_RAMP[0].slice(1)
    const last = IRRADIANCE_RAMP[IRRADIANCE_RAMP.length - 1].slice(1)
    expect(irradianceColor(-10).getHexString()).toBe(first)
    expect(irradianceColor(NaN).getHexString()).toBe(first)
    expect(irradianceColor(1400).getHexString()).toBe(last)
  })
})

describe('exposureColor', () => {
  const first = new THREE.Color(EXPOSURE_RAMP[0]).getHex()
  const last = new THREE.Color(EXPOSURE_RAMP[EXPOSURE_RAMP.length - 1]).getHex()

  it('stretches the ramp across the range that was actually baked', () => {
    // Nothing on a roof reaches zero — diffuse lands everywhere — so the floor
    // of the range has to be the darkest colour or the shadows barely read.
    expect(exposureColor(3, 3, 5).getHex()).toBe(first)
    expect(exposureColor(5, 3, 5).getHex()).toBe(last)
  })

  it('clamps outside the range', () => {
    expect(exposureColor(50, 3, 5).getHex()).toBe(last)
    expect(exposureColor(-1, 3, 5).getHex()).toBe(first)
  })

  it('does not divide by an empty range', () => {
    expect(exposureColor(4, 4, 4).getHex()).toBe(first)
  })
})

describe('sunSamples', () => {
  const sunAt = (azimuth: number, elevation: number) =>
    new THREE.Vector3(
      Math.cos(THREE.MathUtils.degToRad(elevation)) *
        Math.sin(THREE.MathUtils.degToRad(azimuth)),
      Math.sin(THREE.MathUtils.degToRad(elevation)),
      -Math.cos(THREE.MathUtils.degToRad(elevation)) *
        Math.cos(THREE.MathUtils.degToRad(azimuth))
    ).multiplyScalar(11)

  const ticks: TickPayload[] = [
    { ...baseTick, roof: [roofFace] },
    {
      ...baseTick,
      timestamp: '2026-09-01T07:00:00+08:00',
      solar_elevation: 30,
      roof: [roofFace],
    },
  ]

  it('keeps only the daylight ticks', () => {
    const samples = sunSamples(ticks, 'south', sunAt)
    expect(samples).toHaveLength(1)
    expect(samples[0].hours).toBeCloseTo(1)
    expect(samples[0].direction.length()).toBeCloseTo(1)
  })

  it('splits plane-of-array irradiance into beam and diffuse without loss', () => {
    const [sample] = sunSamples(ticks, 'south', sunAt)
    expect(sample.direct + sample.diffuse).toBeCloseTo(roofFace.incident)
  })

  it('skips a tick with no reading for that quadrant', () => {
    expect(sunSamples(ticks, 'north', sunAt)).toHaveLength(0)
  })

  it('walks the sun between ticks without inventing energy', () => {
    const varyingTicks = [300, 900, 500].map((incident, index) => ({
      ...baseTick,
      timestamp: `2026-09-01T0${7 + index}:00:00+08:00`,
      solar_elevation: 30,
      solar_azimuth: 90 + index * 30,
      roof: [{ ...roofFace, incident, sky_diffuse: incident / 10 }],
    }))
    const coarse = sunSamples(varyingTicks, 'south', sunAt)
    const fine = sunSamples(varyingTicks, 'south', sunAt, 3)
    expect(fine).toHaveLength(coarse.length * 3)
    const total = (samples: typeof fine) =>
      samples.reduce(
        (sum, sample) => sum + (sample.direct + sample.diffuse) * sample.hours,
        0
      )
    expect(total(fine)).toBeCloseTo(total(coarse), 6)
    coarse.forEach((sample, index) => {
      expect(total(fine.slice(index * 3, index * 3 + 3))).toBeCloseTo(
        (sample.direct + sample.diffuse) * sample.hours,
        6
      )
    })
    expect(fine[1].direction.equals(fine[0].direction)).toBe(false)
  })

  it('holds sun position across missing readings and missing timestamps', () => {
    const daylight = [7, 8, 9, 10, 11].map((hour, index) => ({
      ...baseTick,
      timestamp: `2026-09-01T${String(hour).padStart(2, '0')}:00:00+08:00`,
      solar_elevation: 30,
      solar_azimuth: 90 + index * 30,
      roof: index === 1 ? [] : [roofFace],
    }))
    const missingReading = sunSamples(daylight, 'south', sunAt, 3)
    expect(
      missingReading[0].direction.equals(missingReading[2].direction)
    ).toBe(true)
    const missingTimestamp = sunSamples(
      [daylight[0], daylight[2], daylight[3], daylight[4]],
      'south',
      sunAt,
      3
    )
    expect(
      missingTimestamp[0].direction.equals(missingTimestamp[2].direction)
    ).toBe(true)
  })
})
