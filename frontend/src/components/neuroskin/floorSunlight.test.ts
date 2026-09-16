import { expect, it } from 'vitest'
import * as THREE from 'three'
import type { TickPayload } from '@/lib/types'
import { createFloorSunlight, floorSunDirection } from './floorSunlight'

it('projects only sun-facing, transmitting bays; clips low sun and ends paths at furniture on the right floor', () => {
  const tick = {
    solar_azimuth: 270,
    solar_elevation: 35,
    facade: [
      {
        orientation: 'west',
        zones: Array.from({ length: 4 }, (_, column) => ({
          row: 2,
          column,
          incident: 600,
          diffuse_incident: 100,
          transmitted: column ? 300 : 100,
          diffuse_transmitted: 100,
        })),
      },
    ],
  } as TickPayload
  const light = createFloorSunlight('west', 2)
  const level = new THREE.Group()
  level.position.y = 8.8
  level.add(light.group)
  level.updateMatrixWorld(true)
  light.update(tick, true, [])
  const patches = light.group.children.filter(
    (mesh) => mesh instanceof THREE.Mesh && mesh.receiveShadow
  ) as THREE.Mesh[]
  expect(patches.map((patch) => patch.visible)).toEqual([
    false,
    true,
    true,
    true,
  ])
  const rays = light.group.children.filter(
    (mesh) => mesh instanceof THREE.LineSegments
  ) as THREE.LineSegments[]
  const points = rays[1].geometry.getAttribute('position')
  const start = new THREE.Vector3().fromBufferAttribute(points, 0)
  const end = new THREE.Vector3().fromBufferAttribute(points, 1)
  expect(end.x).toBeGreaterThan(start.x)
  expect(end.y).toBeCloseTo(0.08)
  const blocker = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.25, 0.25),
    new THREE.MeshBasicMaterial()
  )
  blocker.position
    .copy(start)
    .lerp(end, 0.5)
    .add(new THREE.Vector3(0, 8.8, 0))
  blocker.layers.set(1)
  blocker.updateMatrixWorld(true)
  light.update(tick, true, [blocker])
  expect(rays[1].geometry.getAttribute('position').getY(1)).toBeGreaterThan(0.5)
  light.update({ ...tick, solar_elevation: 2 }, false, [])
  expect(patches.every((patch) => patch.visible)).toBe(true)
  for (const patch of patches) {
    const positions = patch.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      expect(Math.abs(positions.getX(i))).toBeLessThanOrEqual(3.10001)
      expect(Math.abs(positions.getZ(i))).toBeLessThanOrEqual(3.10001)
    }
  }
  light.update({ ...tick, solar_azimuth: 90 }, true, [])
  expect(patches.every((patch) => !patch.visible)).toBe(true)
  light.update({ ...tick, solar_elevation: -5 }, true, [])
  expect(light.group.visible).toBe(false)
  light.update(undefined, true, [])
  expect(light.group.visible).toBe(false)
  expect(floorSunDirection(90, 30).x).toBeGreaterThan(0)
  expect(floorSunDirection(270, 30).x).toBeLessThan(0)
})
