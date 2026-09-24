import { expect, it } from 'vitest'
import * as THREE from 'three'
import { createFacadeSunlight } from './facadeSunlight'
import { createLouvreAssembly, setLouvreAngle } from './louvreAssembly'

it('traces the moving reflector upward/outward, stops at obstructions, and hides at night', () => {
  const banks = Array.from({ length: 16 }, (_, index) => {
    const bank = createLouvreAssembly({
      bottomY: Math.floor(index / 4) * 0.56,
      topY: (Math.floor(index / 4) + 1) * 0.56,
      halfWidthAt: () => 2,
      column: index % 4,
      columns: 4,
    })
    bank.reflector = true
    setLouvreAngle(bank, 45)
    return bank
  })
  const paths = createFacadeSunlight()
  const sun = new THREE.Vector3(0, 0.5, Math.sqrt(3) / 2)
  paths.update(sun, banks, [])
  const reflected = paths.group.children[1] as THREE.ArrowHelper
  expect(reflected.visible).toBe(true)
  const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(
    reflected.quaternion
  )
  expect(direction.y).toBeCloseTo(Math.sqrt(3) / 2)
  expect(direction.z).toBeCloseTo(0.5)
  expect(
    banks[8].group.getObjectByName('blade-pivot-1')!.rotation.x
  ).toBeCloseTo(Math.PI / 4)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(20, 0.1, 20))
  roof.position.y = 3
  paths.update(sun, banks, [roof])
  expect(reflected.visible).toBe(false)
  expect(paths.group.children[0].visible).toBe(true)
  banks.forEach((bank) => setLouvreAngle(bank, 180))
  expect(banks[8].angle).toBe(180)
  expect(
    banks[8].group.getObjectByName('blade-pivot-1')!.rotation.x
  ).toBeCloseTo(Math.PI)
  paths.update(sun, banks, [])
  expect(reflected.visible).toBe(true)
  direction.set(0, 1, 0).applyQuaternion(reflected.quaternion)
  expect(direction.y).toBeCloseTo(0.5)
  expect(direction.z).toBeCloseTo(-Math.sqrt(3) / 2)
  setLouvreAngle(banks[8], 200)
  expect(banks[8].angle).toBe(180)
  paths.update(new THREE.Vector3(0, -1, 0), banks, [])
  expect(paths.group.children.every((ray) => !ray.visible)).toBe(true)
})
