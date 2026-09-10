import * as THREE from 'three'
import type { FacadeOrientation, TickPayload } from '@/lib/types'

/**
 * Daily solar exposure on the roof: how many kWh each square metre of each roof
 * quadrant collects over a whole run, with the crown, the deck and the building's
 * own mass casting real shadows.
 *
 * The physics is already done. `backend/app/domain/facade.py` runs a Perez
 * transposition per quadrant, so `RoofSegment.incident` is plane-of-array
 * irradiance for the actual pitch and azimuth — angle of incidence included.
 * All this module decides is whether the beam component reaches a given point,
 * which is a visibility question, so it is a raycast.
 *
 * Nothing here touches WebGL: Raycaster, BufferGeometry and Color are plain
 * maths, so the whole bake runs under jsdom in a unit test.
 */

// Purple to orange, dark to bright: the ramp the solar editors use. Purple is
// "this point spent the day in shadow", orange "full sun". Hue and lightness
// climb together, so it still reads as a magnitude in greyscale.
export const EXPOSURE_RAMP = [
  '#2a0b45',
  '#5b1a6e',
  '#8d2a72',
  '#bf3f61',
  '#e35c3f',
  '#f5842a',
  '#fbb03b',
  '#fee08b',
]

/** Fixed W/m² scale shared by the live mesh and its legend. */
export const IRRADIANCE_MAX = 1000
export const IRRADIANCE_RAMP = [
  '#2546d3',
  '#06c6e6',
  '#47ce75',
  '#f2e641',
  '#fb922e',
  '#df2929',
]

export const irradianceColor = (() => {
  // Three converts CSS colours to its linear working space on construction.
  const stops = IRRADIANCE_RAMP.map((hex) => new THREE.Color(hex))
  const scratch = new THREE.Color()
  return (wm2: number) => {
    const value = Number.isFinite(wm2) ? wm2 : 0
    const position =
      THREE.MathUtils.clamp(value / IRRADIANCE_MAX, 0, 1) * (stops.length - 1)
    const low = Math.floor(position)
    const high = Math.min(stops.length - 1, low + 1)
    return scratch.copy(stops[low]).lerp(stops[high], position - low)
  }
})()

/**
 * Colour for one point's daily exposure, stretched across the run's own spread.
 *
 * The domain is [min, max] of what was actually baked, not [0, max]. Diffuse
 * light reaches even a fully shadowed point, so nothing on the roof is ever
 * near zero — anchoring at zero would squeeze the whole roof into the top third
 * of the ramp and the shadows would barely read. Stretching means the darkest
 * point on the roof is the darkest colour on the ramp. The legend prints both
 * ends, so the scale stays honest.
 */
export const exposureColor = (() => {
  const stops = EXPOSURE_RAMP.map((hex) => new THREE.Color(hex))
  const scratch = new THREE.Color()
  return (kwh: number, min: number, max: number) => {
    const span = max - min
    const t = span > 0 ? THREE.MathUtils.clamp((kwh - min) / span, 0, 1) : 0
    const position = t * (stops.length - 1)
    const low = Math.floor(position)
    const high = Math.min(stops.length - 1, low + 1)
    return scratch.copy(stops[low]).lerp(stops[high], position - low)
  }
})()

/**
 * The same leaning trapezoid `slopedPanel` builds, subdivided into a grid.
 *
 * One vertex per sample point: the bake writes a colour per vertex and the
 * triangles interpolate between them, which is the smoothing for free. Local
 * frame matches `slopedPanel` exactly — x along the face, y up, z outward,
 * half-width lerping from bottom to top — so rotating about y still drops the
 * quadrant on its cardinal.
 */
export function roofGrid(
  halfBottom: number,
  halfTop: number,
  bottomY: number,
  topY: number,
  divisions: number,
  column = 0,
  columns = 1,
  gap = 0
) {
  const steps = Math.max(1, Math.floor(divisions))
  const positions: number[] = []
  for (let row = 0; row <= steps; row += 1) {
    const v = row / steps
    const half = THREE.MathUtils.lerp(halfBottom, halfTop, v)
    const y = THREE.MathUtils.lerp(bottomY, topY, v)
    const left = -half + (column / columns) * 2 * half + gap
    const right = -half + ((column + 1) / columns) * 2 * half - gap
    for (let step = 0; step <= steps; step += 1) {
      positions.push(THREE.MathUtils.lerp(left, right, step / steps), y, half)
    }
  }

  const stride = steps + 1
  const index: number[] = []
  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      const a = row * stride + column
      const b = a + 1
      const c = b + stride
      const d = a + stride
      // Same winding as slopedPanel: counter-clockwise seen from +z, so the
      // normal points out of the roof face.
      index.push(a, b, c, a, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(positions), 3)
  )
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(positions.length), 3)
  )
  return geometry
}

/** One position of the sun, and what it delivers to one quadrant's plane. */
export interface SunSample {
  /** Scene-space direction from the surface toward the sun, normalised. */
  direction: THREE.Vector3
  /** Beam irradiance on this quadrant's plane, W/m². Removed by a shadow. */
  direct: number
  /** Sky plus ground diffuse on this quadrant's plane, W/m². */
  diffuse: number
  /** Hours this sample stands for. */
  hours: number
}

// Far enough to clear the scene (the sun marker sits at radius 11), short
// enough that rays are not chasing geometry that does not exist.
const RAY_FAR = 40
// Lift the ray origin off the surface, or every point shadows itself on the
// triangle it sits in. Scene units are metres / 10, so this is 2 cm.
const SURFACE_EPSILON = 0.002

/** Invisible blade proxies still raycast: removal must change this list too. */
export function facadeOccluders(
  passive: THREE.Object3D[],
  banks: { occluders: THREE.Object3D[] }[],
  controlled: boolean
): THREE.Object3D[] {
  return controlled
    ? [...passive, ...banks.flatMap((bank) => bank.occluders)]
    : passive
}

/**
 * Accumulate daily exposure per vertex of one roof quadrant.
 *
 * ponytail: diffuse is added unshaded. A real sky-view factor would need a
 * hemisphere of extra rays per vertex for a second-order effect; if the deck
 * ever needs to darken the quadrant it faces, that is the upgrade.
 */
export function bakeExposure(
  mesh: THREE.Mesh,
  occluders: THREE.Object3D[],
  samples: SunSample[]
): { exposure: Float32Array; min: number; max: number } {
  // The quadrants are rotated into place, so a stale matrix bakes the shadow
  // onto the wrong side of the building.
  mesh.updateWorldMatrix(true, false, true)
  // Flattened once, not per ray: intersectObjects walks the groups every call,
  // and an occluder may arrive as a group rather than a bare mesh.
  const targets: THREE.Object3D[] = []
  const boxes: {
    bounds: THREE.Box3
    inverse: THREE.Matrix4
    world: THREE.Matrix4
    directions: THREE.Vector3[]
  }[] = []
  for (const occluder of occluders) {
    occluder.updateWorldMatrix(true, true, true)
    occluder.traverse((object) => {
      const blocker = object as THREE.Mesh
      if (!blocker.isMesh) return
      if (
        blocker.geometry.type === 'BoxGeometry' &&
        !(blocker as THREE.InstancedMesh).isInstancedMesh
      ) {
        if (!blocker.geometry.boundingBox) blocker.geometry.computeBoundingBox()
        const inverse = new THREE.Matrix4().copy(blocker.matrixWorld).invert()
        boxes.push({
          bounds: blocker.geometry.boundingBox!,
          inverse,
          world: blocker.matrixWorld,
          directions: samples.map((sample) =>
            sample.direction.clone().transformDirection(inverse)
          ),
        })
      } else {
        targets.push(blocker)
      }
    })
  }

  const position = mesh.geometry.getAttribute('position')
  const normal = mesh.geometry.getAttribute('normal')
  const count = position.count
  const exposure = new Float32Array(count)

  const raycaster = new THREE.Raycaster()
  raycaster.far = RAY_FAR
  const origin = new THREE.Vector3()
  const surfaceNormal = new THREE.Vector3()
  const localRay = new THREE.Ray()
  const boxHit = new THREE.Vector3()
  // Reused, so a bake does not allocate a result array per ray.
  const hits: THREE.Intersection[] = []
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)

  let max = 0
  let min = Infinity
  for (let vertex = 0; vertex < count; vertex += 1) {
    origin.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld)
    surfaceNormal
      .fromBufferAttribute(normal, vertex)
      .applyMatrix3(normalMatrix)
      .normalize()
    origin.addScaledVector(surfaceNormal, SURFACE_EPSILON)

    let wh = 0
    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      const sample = samples[sampleIndex]
      wh += sample.diffuse * sample.hours
      // No beam to lose: either the sun is below this face's own horizon, or
      // pvlib already clipped the plane-of-array beam to nothing. Either way
      // the ray would only confirm a zero.
      if (sample.direct <= 0) continue
      if (surfaceNormal.dot(sample.direction) <= 0) continue

      // Blades and slabs are opaque boxes: a native box intersection replaces
      // twelve triangle tests and hit sorting, stopping at the first shadow.
      let shadowed = false
      for (const box of boxes) {
        localRay.origin.copy(origin).applyMatrix4(box.inverse)
        localRay.direction.copy(box.directions[sampleIndex])
        if (
          localRay.intersectBox(box.bounds, boxHit) &&
          boxHit.applyMatrix4(box.world).distanceToSquared(origin) <=
            RAY_FAR ** 2
        ) {
          shadowed = true
          break
        }
      }
      if (shadowed) continue

      raycaster.set(origin, sample.direction)
      hits.length = 0
      // One call, not one per occluder: three sorts the result array every time
      // it is called, and 30-odd sorts a ray costs more than an early exit saves.
      if (targets.length) raycaster.intersectObjects(targets, false, hits)
      if (!hits.length) wh += sample.direct * sample.hours
    }
    const kwh = wh / 1000
    exposure[vertex] = kwh
    if (kwh > max) max = kwh
    if (kwh < min) min = kwh
  }

  return { exposure, min: Number.isFinite(min) ? min : 0, max }
}

/** Instantaneous plane-of-array irradiance with the same geometry shadows. */
export function bakeIrradiance(
  mesh: THREE.Mesh,
  occluders: THREE.Object3D[],
  reading: { incident: number; sky_diffuse: number; ground_diffuse: number },
  direction: THREE.Vector3,
  diffuseOverride?: number
): Float32Array {
  if (direction.y <= 0 || !Number.isFinite(direction.lengthSq())) {
    return new Float32Array(mesh.geometry.getAttribute('position').count)
  }
  const positive = (value: number) =>
    Number.isFinite(value) ? Math.max(0, value) : 0
  const incident = positive(reading.incident)
  const diffuse = Math.min(
    incident,
    positive(reading.sky_diffuse) + positive(reading.ground_diffuse)
  )
  // A one-hour bake gives kWh/m²; multiplying by 1000 recovers W/m². The
  // backend already includes incidence angle, so only beam visibility changes.
  const { exposure } = bakeExposure(mesh, occluders, [
    {
      direction: direction.clone().normalize(),
      direct: incident - diffuse,
      // Keep the raw plane beam unchanged: a local optical diffuse estimate
      // must not reintroduce beam already intercepted by roof or blade geometry.
      diffuse:
        diffuseOverride === undefined ? diffuse : positive(diffuseOverride),
      hours: 1,
    },
  ])
  for (let vertex = 0; vertex < exposure.length; vertex += 1) {
    exposure[vertex] *= 1000
  }
  return exposure
}

/** Median tick spacing in hours. The run's step is not guaranteed hourly. */
function tickHours(ticks: TickPayload[]) {
  if (ticks.length < 2) return 1
  const gaps: number[] = []
  for (let index = 1; index < ticks.length; index += 1) {
    const gap =
      Date.parse(ticks[index].timestamp) -
      Date.parse(ticks[index - 1].timestamp)
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap / 3_600_000)
  }
  if (!gaps.length) return 1
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

/** Shortest way round the compass, so a lerp never runs the long way. */
function lerpAzimuth(from: number, to: number, t: number) {
  let delta = ((to - from + 540) % 360) - 180
  if (delta === -180) delta = 180
  return from + delta * t
}

/**
 * The run's daylight ticks as sun samples for one roof quadrant.
 *
 * `substeps` splits each tick into that many sun positions, interpolated toward
 * the next tick. An hourly run is only 13 positions across a day, and 13
 * discrete shadows stack into visible bands rather than a shadow edge; walking
 * the sun between them smooths the edge without asking the backend for a finer
 * run. Energy is conserved — each substep carries its share of the tick's hours.
 *
 * `sunAt` is passed in rather than imported so this module never points back at
 * the component that draws it.
 */
export function sunSamples(
  ticks: TickPayload[],
  quadrant: FacadeOrientation,
  sunAt: (azimuth: number, elevation: number) => THREE.Vector3,
  substeps = 1
): SunSample[] {
  const hours = tickHours(ticks)
  const steps = Math.max(1, Math.floor(substeps))

  // Daylight ticks that actually carry a reading for this quadrant, paired with
  // the split of their plane-of-array total into beam and diffuse.
  const daylight = ticks.flatMap((tick, index) => {
    if (tick.solar_elevation <= 0) return []
    const segment = tick.roof?.find((face) => face.quadrant === quadrant)
    if (!segment) return []
    const diffuse = segment.sky_diffuse + segment.ground_diffuse
    return [
      {
        index,
        timestamp: Date.parse(tick.timestamp),
        azimuth: tick.solar_azimuth,
        elevation: tick.solar_elevation,
        // What a shadow takes away is the beam, and the beam is whatever the
        // plane-of-array total has left once the two diffuse parts come out.
        direct: Math.max(0, segment.incident - diffuse),
        diffuse,
      },
    ]
  })

  const samples: SunSample[] = []
  for (let index = 0; index < daylight.length; index += 1) {
    const from = daylight[index]
    const next = daylight[index + 1]
    // Hold across night, missing readings, missing timestamps and the last
    // tick; there is no continuous sun path to infer across those gaps.
    const to =
      next &&
      next.index === from.index + 1 &&
      Math.abs(next.timestamp - from.timestamp - hours * 3_600_000) < 1
        ? next
        : from
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps
      samples.push({
        direction: sunAt(
          lerpAzimuth(from.azimuth, to.azimuth, t),
          THREE.MathUtils.lerp(from.elevation, to.elevation, t)
        ).normalize(),
        direct: from.direct,
        diffuse: from.diffuse,
        hours: hours / steps,
      })
    }
  }
  return samples
}
