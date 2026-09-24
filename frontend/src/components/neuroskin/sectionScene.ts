import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'

import type { SectionPatch, SectionResponse } from '@/lib/api-client'
import type { FacadeOrientation, TickPayload } from '@/lib/types'
import { WALL_ROTATION } from './floorWorkspaces'
import { SKELETON, STANDING_HEIGHT_M, keypointHue, poseFor } from './csiPose'
import type { CsiDetection } from './csiPosture'

/**
 * Geometry for the floor cross-section view.
 *
 * The oracle's frame is x across the facade, y up, z inward from the glazing at
 * z=0 (backend/app/domain/daylight/room.py). This module keeps that frame, so a
 * patch centre can be read straight from the API into a scene position.
 */

export type PatchField = 'radiosity' | 'direct' | 'contribution'

/** Which surface a patch belongs to, from its centre and normal alone. */
export function patchFace(
  patch: SectionPatch,
  room: { width: number; height: number; depth: number }
): 'floor' | 'ceiling' | 'glazing' | 'back' | 'side' {
  const [, ny, nz] = patch.normal
  const [, y, z] = patch.centre
  if (Math.abs(ny) > 0.5) return y < room.height / 2 ? 'floor' : 'ceiling'
  if (Math.abs(nz) > 0.5) return z < room.depth / 2 ? 'glazing' : 'back'
  return 'side'
}

/**
 * The patches lying in a vertical cut at x, i.e. the ones a section drawing may
 * show. Side walls run parallel to the cut and are excluded: drawing them would
 * put the whole room's left wall on top of a 6 cm slice.
 */
export function cutColumn(
  patches: SectionPatch[],
  x: number,
  room: { width: number; height: number; depth: number }
): SectionPatch[] {
  const inCut = patches.filter((p) => patchFace(p, room) !== 'side')
  if (!inCut.length) return []
  // Patch centres sit on a fixed lattice, so "nearest column" is exact, not fuzzy.
  const columns = [...new Set(inCut.map((p) => p.centre[0]))]
  const nearest = columns.reduce((best, c) =>
    Math.abs(c - x) < Math.abs(best - x) ? c : best
  )
  return inCut.filter((p) => p.centre[0] === nearest)
}

export function fieldValue(patch: SectionPatch, field: PatchField): number {
  if (field === 'direct') return patch.direct_lux
  if (field === 'contribution') return patch.contribution_lux
  return patch.radiosity_lux
}

/**
 * The patches worth drawing a bounce ray from: the few that actually carry the
 * occupant's light. Sorted brightest first, and anything contributing nothing is
 * dropped rather than drawn as an invisible line.
 */
export function topContributors(
  patches: SectionPatch[],
  count: number
): SectionPatch[] {
  return patches
    .filter((p) => p.contribution_lux > 0)
    .sort((a, b) => b.contribution_lux - a.contribution_lux)
    .slice(0, Math.max(0, count))
}

/**
 * Where the beam that lands on ``point`` crossed the glazing plane at z=0.
 *
 * ``sun`` follows the oracle's convention: a unit vector pointing TOWARDS the sun,
 * so it runs outward through the glazing (z negative) and upward (y positive). This
 * mirrors _beam_visible in oracle.py, which is what decides whether the patch was
 * lit in the first place. Returns null when the sun cannot reach the glazing plane,
 * or when the back-traced entry misses the aperture.
 */
export function beamEntry(
  sun: [number, number, number] | THREE.Vector3,
  point: THREE.Vector3,
  room: { width: number; height: number }
): THREE.Vector3 | null {
  const direction = Array.isArray(sun) ? new THREE.Vector3(...sun) : sun.clone()
  if (direction.z >= -1e-9) return null
  const travel = -point.z / direction.z
  const entry = point.clone().addScaledVector(direction, travel)
  if (
    entry.x < 0 ||
    entry.x > room.width ||
    entry.y < 0 ||
    entry.y > room.height
  ) {
    return null
  }
  return entry
}

/**
 * Shared ramp for every lux surface in this view. Deep blue is dark, mint is the
 * useful band, amber is over the eye-illuminance cap. The cap anchors the ramp so
 * two zones at different absolute brightness stay comparable.
 */
export function luxColor(lux: number, cap: number): THREE.Color {
  const t = Math.max(0, Math.min(1, lux / Math.max(cap, 1)))
  if (t >= 1) return new THREE.Color('#d69b48')
  // 210deg (blue) down to 95deg (mint-green) as the surface brightens.
  return new THREE.Color().setHSL((210 - 115 * t) / 360, 0.55, 0.28 + 0.34 * t)
}

/** A patch quad, oriented by its normal and sized from its area. */
export function patchMesh(
  patch: SectionPatch,
  field: PatchField,
  cap: number,
  opacity = 0.9
): THREE.Mesh {
  const side = Math.sqrt(patch.area)
  const geometry = new THREE.PlaneGeometry(side, side)
  const material = new THREE.MeshBasicMaterial({
    color: luxColor(fieldValue(patch, field), cap),
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...patch.centre)
  mesh.lookAt(mesh.position.clone().add(new THREE.Vector3(...patch.normal)))
  return mesh
}

/** Room edges, so the box reads as a room rather than a cloud of quads. */
export function roomFrame(room: {
  width: number
  height: number
  depth: number
}): THREE.LineSegments {
  const box = new THREE.BoxGeometry(room.width, room.height, room.depth)
  const edges = new THREE.EdgesGeometry(box)
  edges.translate(room.width / 2, room.height / 2, room.depth / 2)
  return new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({
      color: '#5d6b66',
      transparent: true,
      opacity: 0.55,
    })
  )
}

/**
 * One line per contributing patch, from the patch to the eye. Opacity carries the
 * share so the drawing says which bounce matters, not merely that bounces exist.
 */
export function bounceRays(
  patches: SectionPatch[],
  eye: THREE.Vector3,
  cap: number
): THREE.Group {
  const group = new THREE.Group()
  const brightest = patches[0]?.contribution_lux ?? 0
  for (const patch of patches) {
    const share = brightest > 0 ? patch.contribution_lux / brightest : 0
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...patch.centre),
      eye.clone(),
    ])
    group.add(
      new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: luxColor(patch.contribution_lux, cap / 8),
          transparent: true,
          opacity: 0.18 + 0.62 * share,
        })
      )
    )
  }
  return group
}

/** The occupant's eye point, in the oracle frame. */
export function eyePoint(probe: {
  x: number
  z: number
  height_m: number
}): THREE.Vector3 {
  return new THREE.Vector3(probe.x, probe.height_m, probe.z)
}

/**
 * The cone an eye-plane measurement actually integrates over. Ev is a cosine-
 * weighted hemisphere, not a camera frustum, so this is an honest 180-degree fan
 * rather than a narrow view cone.
 */
export function viewFan(
  eye: THREE.Vector3,
  viewDeg: number,
  length = 2.2
): THREE.Line {
  const view = (viewDeg * Math.PI) / 180
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= 12; i++) {
    const angle = view - Math.PI / 2 + (Math.PI * i) / 12
    points.push(eye.clone())
    points.push(
      eye
        .clone()
        .add(
          new THREE.Vector3(
            Math.sin(angle) * length,
            0,
            -Math.cos(angle) * length
          )
        )
    )
  }
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: '#8fd4bb',
      transparent: true,
      opacity: 0.35,
    })
  )
}

/** Peak, trough and swing of the head-yaw sweep: the panel's headline numbers. */
export function yawExtremes(sweep: SectionResponse['yaw_sweep']) {
  if (!sweep.length) return null
  const best = sweep.reduce((a, b) => (b.eye_lux > a.eye_lux ? b : a))
  const worst = sweep.reduce((a, b) => (b.eye_lux < a.eye_lux ? b : a))
  return {
    best,
    worst,
    ratio: worst.eye_lux > 0 ? best.eye_lux / worst.eye_lux : Infinity,
  }
}

/** Thickness of a section bar, in metres. Purely a drawing width. */
export const SECTION_BAR_M = 0.14

/**
 * One patch drawn as it reads in a section: floor and ceiling as horizontal bars,
 * glazing and back wall as vertical strips, all lying in the cut plane and facing
 * the orthographic camera. Side-wall patches have no section presence and return
 * null rather than a zero-area mesh.
 */
export function sectionBar(
  patch: SectionPatch,
  room: { width: number; height: number; depth: number },
  field: PatchField,
  cap: number,
  cutX: number
): THREE.Mesh | null {
  const face = patchFace(patch, room)
  if (face === 'side') return null
  const side = Math.sqrt(patch.area)
  const horizontal = face === 'floor' || face === 'ceiling'
  const geometry = new THREE.PlaneGeometry(
    horizontal ? side : SECTION_BAR_M,
    horizontal ? SECTION_BAR_M : side
  )
  geometry.rotateY(Math.PI / 2)
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: luxColor(fieldValue(patch, field), cap),
      side: THREE.DoubleSide,
    })
  )
  const half = SECTION_BAR_M / 2
  const y =
    face === 'floor'
      ? half
      : face === 'ceiling'
        ? room.height - half
        : patch.centre[1]
  const z =
    face === 'glazing'
      ? half
      : face === 'back'
        ? room.depth - half
        : patch.centre[2]
  mesh.position.set(cutX, y, z)
  return mesh
}

/**
 * Mean beam/diffuse flux reaching one band's room, in W/m² at the glazing plane.
 *
 * The oracle models one room behind a whole band, so the band's zones are averaged
 * rather than picked from. ``controlled`` selects the post-louvre channel, matching
 * beamThrough in floorSunlight.ts; uncontrolled falls back to raw incident so the
 * section can show what the louvres are actually preventing.
 */
export function bandFlux(
  tick: TickPayload,
  orientation: FacadeOrientation,
  band: number,
  controlled: boolean
): { beam: number; diffuse: number } {
  const zones =
    tick.facade
      .find((wall) => wall.orientation === orientation)
      ?.zones?.filter((zone) => zone.row === band) ?? []
  if (!zones.length) return { beam: 0, diffuse: 0 }
  const totals = zones.reduce(
    (acc, zone) => {
      const total = controlled ? zone.transmitted : zone.incident
      const diffuse = controlled
        ? (zone.diffuse_transmitted ?? total)
        : (zone.diffuse_incident ?? total)
      return {
        beam: acc.beam + Math.max(0, total - diffuse),
        diffuse: acc.diffuse + Math.max(0, diffuse),
      }
    },
    { beam: 0, diffuse: 0 }
  )
  // The endpoint bounds flux at 1500 W/m²; clamp here so a spiked feed is a dull
  // picture rather than a 422.
  return {
    beam: Math.min(1500, totals.beam / zones.length),
    diffuse: Math.min(1500, totals.diffuse / zones.length),
  }
}

/** A shared orbit pose. Angles, not positions: the two scenes are at different scales. */
export interface OrbitAngles {
  azimuth: number
  polar: number
}

/** Fold any angle into (-pi, pi], so a sync never accumulates turns. */
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

/**
 * Convert the building scene's orbit azimuth into this room's.
 *
 * A wall reads head-on in the building when the azimuth equals its WALL_ROTATION
 * (BuildingHeatmap frames a wall from `(0.7, 0.45, 3.5)` turned by that angle). The
 * section room reads head-on through its glazing at azimuth pi, because the glazing
 * sits at z=0 with the room at z>0. The offset between those two is all the sync is.
 */
export function toSectionAzimuth(
  buildingAzimuth: number,
  orientation: FacadeOrientation
): number {
  return wrap(Math.PI + buildingAzimuth - WALL_ROTATION[orientation])
}

export function toBuildingAzimuth(
  sectionAzimuth: number,
  orientation: FacadeOrientation
): number {
  return wrap(sectionAzimuth - Math.PI + WALL_ROTATION[orientation])
}

/** Whether two poses differ enough to be worth pushing across. Damping jitters. */
export function orbitChanged(
  a: OrbitAngles | null,
  b: OrbitAngles,
  epsilon = 0.004
) {
  if (!a) return true
  return (
    Math.abs(wrap(a.azimuth - b.azimuth)) > epsilon ||
    Math.abs(a.polar - b.polar) > epsilon
  )
}

/** The slice of OrbitControls an orbit pose needs. Structural, so tests need no WebGL. */
export interface OrbitTarget {
  target: THREE.Vector3
  minPolarAngle: number
  maxPolarAngle: number
  update: () => void
}

/**
 * Point a camera at a shared orbit pose, keeping its own distance.
 *
 * This three build's OrbitControls exposes getAzimuthalAngle/getPolarAngle but no
 * setters, so the pose is applied through the spherical coordinates those getters
 * read: Spherical.theta is the azimuth and .phi the polar angle, exactly.
 */
export function applyOrbit(
  camera: THREE.Camera,
  controls: OrbitTarget,
  pose: OrbitAngles
): void {
  const offset = camera.position.clone().sub(controls.target)
  const spherical = new THREE.Spherical().setFromVector3(offset)
  spherical.theta = pose.azimuth
  spherical.phi = Math.min(
    controls.maxPolarAngle,
    Math.max(controls.minPolarAngle, pose.polar)
  )
  spherical.makeSafe()
  camera.position.copy(controls.target).add(offset.setFromSpherical(spherical))
  camera.lookAt(controls.target)
  controls.update()
}

/**
 * One occupant drawn as a posed skeleton inside the room, coloured by the same ramp
 * as the CSI pose view so the figure standing in the section and the blob in the
 * confidence field are legibly the same person.
 *
 * ``across`` is the body's left-to-right axis in world space; the pose's own x runs
 * along it. The figure stands on ``origin`` and is scaled so a standing occupant's eye
 * lands near 1.6 m and a seated one near 1.2 m, which is where the daylight probes sit.
 */
export interface PosedSkeleton {
  object: LineSegments2
  /** Raw bone endpoints, xyz per vertex. Exposed so placement is testable without a GPU. */
  positions: Float32Array
  update: (seconds: number) => void
  /** LineMaterial sizes its width in pixels, so it needs the viewport it draws into. */
  setResolution: (width: number, height: number) => void
}

export function poseSkeleton(
  detection: CsiDetection,
  origin: THREE.Vector3,
  across: THREE.Vector3,
  opacity: number
): PosedSkeleton {
  const count = SKELETON.length * 2
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const geometry = new LineSegmentsGeometry()
  // Fat lines, not LineBasicMaterial: WebGL ignores its linewidth, so a skeleton drawn
  // that way is a 1px hairline at any room distance.
  const material = new LineMaterial({
    linewidth: 2.4,
    vertexColors: true,
    transparent: true,
    opacity,
    dashed: false,
  })
  const object = new LineSegments2(geometry, material)
  const side = across.clone().normalize()
  const colour = new THREE.Color()

  const update = (seconds: number) => {
    const pose = poseFor(detection, seconds)
    let i = 0
    for (const [a, b] of SKELETON) {
      for (const index of [a, b]) {
        const joint = pose[index]
        positions[i * 3] = origin.x + side.x * joint.x * STANDING_HEIGHT_M
        positions[i * 3 + 1] = origin.y + joint.y * STANDING_HEIGHT_M
        positions[i * 3 + 2] = origin.z + side.z * joint.x * STANDING_HEIGHT_M
        colour.setHSL(
          keypointHue(joint.name) / 360,
          0.85,
          0.35 + joint.confidence * 0.3
        )
        colors[i * 3] = colour.r
        colors[i * 3 + 1] = colour.g
        colors[i * 3 + 2] = colour.b
        i++
      }
    }
    geometry.setPositions(positions)
    geometry.setColors(colors)
    object.computeLineDistances()
  }
  update(0)
  return {
    object,
    positions,
    update,
    setResolution: (width, height) => material.resolution.set(width, height),
  }
}

/** The body's left-to-right axis for an occupant facing ``viewDeg`` from the glazing. */
export function acrossAxis(viewDeg: number): THREE.Vector3 {
  const view = (viewDeg * Math.PI) / 180
  // Facing is (sin v, 0, -cos v); turning it a quarter turn about y gives the shoulders.
  return new THREE.Vector3(Math.cos(view), 0, Math.sin(view))
}
