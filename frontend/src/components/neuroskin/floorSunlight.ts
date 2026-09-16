import * as THREE from 'three'
import type { FacadeOrientation, TickPayload, ZoneHeat } from '@/lib/types'

export type FloorLightView = 'sun' | 'et' | 'ev' | 'off'
const azimuths = { north: 0, east: 90, south: 180, west: 270 }
const beamThrough = (zone: ZoneHeat | undefined, controlled: boolean) =>
  zone
    ? Math.max(
        0,
        controlled
          ? zone.transmitted - (zone.diffuse_transmitted ?? zone.transmitted)
          : zone.incident - (zone.diffuse_incident ?? zone.incident)
      )
    : 0

export function floorBeam(
  tick: TickPayload,
  orientation: FacadeOrientation,
  band: number,
  controlled: boolean
) {
  if (
    tick.solar_elevation <= 0 ||
    floorSunDirection(azimuths[orientation], 0).dot(
      floorSunDirection(tick.solar_azimuth, tick.solar_elevation)
    ) <= 0.03
  )
    return 0
  return (
    tick.facade
      .find((wall) => wall.orientation === orientation)
      ?.zones?.filter((zone) => zone.row === band)
      .reduce((sum, zone) => sum + beamThrough(zone, controlled), 0) ?? 0
  )
}

export function floorSunDirection(azimuth: number, elevation: number) {
  const a = THREE.MathUtils.degToRad(azimuth)
  const e = THREE.MathUtils.degToRad(elevation)
  return new THREE.Vector3(
    Math.cos(e) * Math.sin(a),
    Math.sin(e),
    -Math.cos(e) * Math.cos(a)
  )
}

/** Clip a projected window to this illustrative floor, including low sun. */
export function clipToFloor(points: THREE.Vector3[]) {
  for (const axis of ['x', 'z'] as const)
    for (const sign of [-1, 1]) {
      const clipped: THREE.Vector3[] = []
      for (let i = 0; i < points.length; i++) {
        const a = points[i],
          b = points[(i + 1) % points.length]
        const insideA = sign * a[axis] <= 3.1
        const insideB = sign * b[axis] <= 3.1
        if (insideA) clipped.push(a)
        if (insideA !== insideB)
          clipped.push(
            a.clone().lerp(b, (sign * 3.1 - a[axis]) / (b[axis] - a[axis]))
          )
      }
      points = clipped
    }
  return points
}

/** Sun paths show direction/occlusion, not a lux field inferred between probes. */
export function createFloorSunlight(
  orientation: FacadeOrientation,
  band: number
) {
  const group = new THREE.Group()
  group.name = 'Illustrative window sunlight'
  const normal = floorSunDirection(azimuths[orientation], 0)
  const tangent = new THREE.Vector3(normal.z, 0, -normal.x)
  const bays = Array.from({ length: 4 }, (_, column) => {
    const finish = new THREE.MeshStandardMaterial({
      color: 0xffc64d,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      roughness: 1,
      side: THREE.DoubleSide,
    })
    const patch = new THREE.Mesh(new THREE.BufferGeometry(), finish)
    patch.receiveShadow = true
    const rays = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xffb526,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      })
    )
    const window = new THREE.LineLoop(new THREE.BufferGeometry(), rays.material)
    const shaft = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xffcf4a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        toneMapped: false,
      })
    )
    const edge = new THREE.LineLoop(new THREE.BufferGeometry(), rays.material)
    group.add(patch, rays, window, shaft, edge)
    return { column, patch, rays, window, shaft, edge }
  })
  group.traverse((object) => {
    object.userData.floorLight = true
  })
  const raycaster = new THREE.Raycaster()
  raycaster.layers.set(1)
  const positions = (
    geometry: THREE.BufferGeometry,
    points: THREE.Vector3[]
  ) => {
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        points.flatMap((point) => point.toArray()),
        3
      )
    )
    geometry.deleteAttribute('normal')
    geometry.computeBoundingSphere()
  }
  return {
    group,
    update(
      tick: TickPayload | undefined,
      controlled: boolean,
      occluders: THREE.Object3D[]
    ) {
      group.visible =
        !!tick &&
        Number.isFinite(tick.solar_azimuth) &&
        Number.isFinite(tick.solar_elevation) &&
        tick.solar_elevation > 0
      if (!tick || !group.visible) return
      const direction = floorSunDirection(
        tick.solar_azimuth,
        tick.solar_elevation
      )
      const originOffset = group.getWorldPosition(new THREE.Vector3())
      const wall = tick.facade.find((wall) => wall.orientation === orientation)
      for (const bay of bays) {
        const zone = wall?.zones?.find(
          (zone) => zone.row === band && zone.column === bay.column
        )
        const beam = beamThrough(zone, controlled)
        const visible =
          Number.isFinite(beam) && beam > 1 && normal.dot(direction) > 0.03
        bay.patch.visible =
          bay.rays.visible =
          bay.window.visible =
          bay.shaft.visible =
          bay.edge.visible =
            visible
        if (!visible) continue
        const strength = Math.min(1, Math.sqrt(beam / 600))
        bay.patch.material.opacity = 0.45 + strength * 0.45
        bay.rays.material.opacity = 0.35 + strength * 0.55
        // ponytail: full-height virtual apertures in the cutaway. Commissioned
        // window geometry is needed before these paths can be a physical study.
        const centre = normal
          .clone()
          .multiplyScalar(3.12)
          .addScaledVector(tangent, -2.4 + bay.column * 1.6)
        const aperture = [
          [-0.7, 0.22],
          [0.7, 0.22],
          [0.7, 1.45],
          [-0.7, 1.45],
        ].map(([x, y]) => centre.clone().addScaledVector(tangent, x).setY(y))
        positions(bay.window.geometry, aperture)
        const floor = clipToFloor(
          aperture.map((point) =>
            point
              .clone()
              .addScaledVector(direction, -(point.y - 0.075) / direction.y)
          )
        )
        const triangles: THREE.Vector3[] = []
        for (let i = 1; i < floor.length - 1; i++)
          triangles.push(floor[0], floor[i], floor[i + 1])
        positions(bay.patch.geometry, triangles)
        bay.patch.geometry.computeVertexNormals()
        positions(bay.edge.geometry, floor)
        const paths: THREE.Vector3[] = []
        for (const offset of [-0.5, 0, 0.5]) {
          const start = centre
            .clone()
            .addScaledVector(tangent, offset)
            .setY(1.25)
          const distance = (start.y - 0.08) / direction.y
          raycaster.set(
            start.clone().add(originOffset).addScaledVector(direction, -0.015),
            direction.clone().negate()
          )
          raycaster.far = distance
          const hit = raycaster.intersectObjects(occluders, false)[0]
          const end = hit
            ? hit.point.clone().sub(originOffset)
            : start.clone().addScaledVector(direction, -distance)
          // Paths stop at furniture or the visible floor boundary.
          let fraction = 1
          for (const axis of ['x', 'z'] as const)
            if (Math.abs(end[axis]) > 3.12)
              fraction = Math.min(
                fraction,
                (Math.sign(end[axis]) * 3.12 - start[axis]) /
                  (end[axis] - start[axis])
              )
          paths.push(start, start.clone().lerp(end, Math.max(0, fraction)))
        }
        positions(bay.rays.geometry, paths)
        // Translucent sheets make the incoming light readable in the cutaway.
        const beams: THREE.Vector3[] = []
        for (let i = 0; i < paths.length; i += 2) {
          const [start, end] = [paths[i], paths[i + 1]]
          const offset = tangent.clone().multiplyScalar(0.15)
          const a = start.clone().sub(offset),
            b = start.clone().add(offset)
          const c = end.clone().add(offset),
            d = end.clone().sub(offset)
          beams.push(a, b, c, a, c, d)
        }
        positions(bay.shaft.geometry, beams)
      }
    },
  }
}
