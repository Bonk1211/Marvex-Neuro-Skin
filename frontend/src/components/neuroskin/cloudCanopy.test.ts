import * as THREE from 'three'
import { expect, it } from 'vitest'
import { createCloudCanopy } from './cloudCanopy'

it('projects the same camera mask toward the sun and restores light when disabled', () => {
  const canopy = createCloudCanopy(5)
  const overhead = new THREE.Vector3(0, 1, 0)
  canopy.update(0.5, [
    [1, 0],
    [1, 0],
  ])
  const clouds = canopy.mesh.getObjectByName(
    'Cloud volume'
  ) as THREE.InstancedMesh
  expect(clouds.count).toBeGreaterThan(0)
  const partlyCloudy = clouds.count
  expect(canopy.transmission(-2, 0, 0, overhead)).toBe(0)
  expect(canopy.transmission(2, 0, 0, overhead)).toBe(1)
  // Sun toward the east displaces the cloud shadow to the west.
  const east = new THREE.Vector3(1, 1, 0).normalize()
  expect(canopy.transmission(-2, 0, 0, east)).toBe(1)
  expect(canopy.transmission(-7, 0, 0, east)).toBe(0)
  expect(canopy.transmission(-2, 0, 0, new THREE.Vector3(0, -1, 0))).toBe(1)
  canopy.mesh.position.x = 4
  expect(canopy.transmission(2, 0, 0, overhead)).toBe(0)
  canopy.update(0)
  expect(clouds.count).toBe(0)
  expect(canopy.mesh.visible).toBe(false)
  expect(canopy.transmission(2, 0, 0, overhead)).toBe(1)
  canopy.update(1)
  expect(clouds.count).toBeGreaterThan(partlyCloudy)
  expect(canopy.transmission(2, 0, 0, overhead)).toBe(0)
  canopy.update(Number.NaN)
  expect(canopy.mesh.visible).toBe(false)
  canopy.dispose()
  canopy.mesh.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose()
      if (!Array.isArray(object.material)) object.material.dispose()
    }
    if (object instanceof THREE.InstancedMesh) object.dispose()
  })
})
