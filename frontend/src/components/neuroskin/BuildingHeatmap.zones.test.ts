import { describe, expect, it } from 'vitest'
import { slopedPanel } from './BuildingHeatmap'
import * as THREE from 'three'
import { createBandPlan, FLOOR_STACK_GAP } from './bandPlan'
import { roofGrid } from './solarExposure'

/** x of the bottom-left and bottom-right corner of one zone. */
function bottomEdge(column: number, columns: number) {
  const position = slopedPanel(2, 3, 0, 1, column, columns).getAttribute(
    'position'
  )
  return [position.getX(0), position.getX(1)]
}

describe('facade zones', () => {
  it('stacks four floor groups per side, focuses one, and restores every material', () => {
    const rotations = {
      north: Math.PI,
      east: Math.PI / 2,
      south: 0,
      west: -Math.PI / 2,
    }
    const panels = new Map<keyof typeof rotations, THREE.Mesh[]>(
      (Object.keys(rotations) as (keyof typeof rotations)[]).map(
        (orientation) => [
          orientation,
          Array.from({ length: 16 }, (_, index) => {
            const mesh = new THREE.Mesh(
              roofGrid(2, 3, 0, 1, 2, index % 4, 4),
              new THREE.MeshBasicMaterial()
            )
            mesh.rotation.y = rotations[orientation]
            mesh.userData = {
              index,
              zone: `${orientation[0].toUpperCase()}${index + 1}`,
              surface: `wall:${orientation}`,
            }
            return mesh
          }),
        ]
      )
    )
    const plan = createBandPlan(panels, 2)
    const available = new Set(
      [...panels.values()].flat().map((mesh) => mesh.userData.zone)
    )
    expect(plan.levels).toHaveLength(16)
    expect(plan.levels.every((level) => !level.wifi.visible)).toBe(true)
    for (const orientation of Object.keys(
      rotations
    ) as (keyof typeof rotations)[]) {
      plan.update(null, orientation, available)
      const visible = plan.levels.filter((level) => level.group.visible)
      expect(visible.map((level) => level.orientation)).toEqual(
        Array(4).fill(orientation)
      )
      expect(visible.map((level) => level.group.position.y)).toEqual(
        [0, 1, 2, 3].map((band) => band * FLOOR_STACK_GAP)
      )
      expect(plan.cells.filter((cell) => cell.visible)).toHaveLength(16)
      expect(
        visible.every(
          (level) => level.slab.material === level.materials.get(level.slab)
        )
      ).toBe(true)
      const shapes = visible.map((level) => {
        const interior = level.group.children[1]
        const meshes: number[][] = []
        interior.traverse((object) => {
          expect(object.userData.zone).toBeUndefined()
          if (object instanceof THREE.Mesh)
            meshes.push([
              ...object.position.toArray(),
              ...object.scale.toArray(),
            ])
        })
        return JSON.stringify(meshes)
      })
      expect(new Set(shapes).size).toBe(4)
    }
    plan.update(1, 'west', available)
    const west = plan.levels.filter((level) => level.orientation === 'west')
    expect(west.every((level) => level.group.visible)).toBe(true)
    for (const level of west) {
      expect(level.slab.material === level.materials.get(level.slab)).toBe(
        level.band === 1
      )
      expect(level.slab.visible).toBe(true)
    }
    expect(
      plan.cells
        .filter(
          (cell) =>
            cell.visible && cell.material === cell.userData.source.material
        )
        .map((cell) => cell.userData.zone)
    ).toEqual(['W5', 'W6', 'W7', 'W8'])
    // X-ray changes only rendering: occupied positions and every original material survive.
    plan.updatePeople(12, 0.8, true, true, 1)
    const occupants = west[1].people.filter((person) => person.group.visible)
    const positions = occupants.map((person) => person.group.position.clone())
    const normalMaterials = west.flatMap((level) =>
      [...level.materials.keys()].map((mesh) => [mesh, mesh.material] as const)
    )
    plan.updateXray(0.5, 1, 800, 600, 12)
    expect((west[1].slab.material as THREE.Material).opacity).toBeCloseTo(0.53)
    plan.updateXray(1, 1, 800, 600, 12)
    expect(occupants.length).toBeGreaterThan(0)
    for (const [index, person] of occupants.entries()) {
      expect(person.group.position.equals(positions[index])).toBe(true)
      expect(person.csi?.skeleton.object.parent).toBe(person.group)
      expect(person.csi?.skeleton.object.visible).toBe(true)
      expect(person.csi?.skeleton.object.material.opacity).toBe(1)
    }
    expect(west[1].wire.visible).toBe(true)
    expect(plan.levels.filter((level) => level.wifi.visible)).toEqual([west[1]])
    expect(west[1].wifi.parent).toBe(west[1].group)
    expect(west[1].wifi.layers.isEnabled(1)).toBe(true)
    const wave = west[1].waves[0]
    plan.updateXray(1, 1, 800, 600, 12.5)
    const radius = wave.scale.x
    const opacity = wave.material.opacity
    plan.updateXray(1, 1, 800, 600, 13.5)
    expect(wave.scale.x).toBeGreaterThan(radius)
    expect(wave.material.opacity).toBeLessThan(opacity)
    // A frozen clock (pause / reduced motion) preserves the wavefronts.
    const heldRadius = wave.scale.x
    plan.updateXray(1, 1, 800, 600, 13.5)
    expect(wave.scale.x).toBe(heldRadius)
    plan.updateXray(1, 1, 800, 600, 16.5)
    expect(wave.scale.x).toBeCloseTo(radius)
    expect(wave.material.opacity).toBeCloseTo(opacity)
    plan.updateXray(0.5, 1, 800, 600, 16.5)
    expect(wave.material.opacity).toBeCloseTo(opacity / 2)
    plan.updateXray(0, 1, 800, 600, 12)
    for (const [mesh, material] of normalMaterials)
      expect(mesh.material).toBe(material)
    expect(west[1].wire.visible).toBe(false)
    expect(plan.levels.every((level) => !level.wifi.visible)).toBe(true)
    expect(
      occupants.every((person) => !person.csi?.skeleton.object.visible)
    ).toBe(true)
    plan.updatePeople(12, 0.8, true, true, 1, 'empty')
    expect(west[1].people.some((person) => person.group.visible)).toBe(false)
    plan.updateXray(1, 1, 800, 600, 12.5)
    expect(west[1].wifi.visible).toBe(true)
    expect(wave.material.opacity).toBeGreaterThan(0)
    plan.updateXray(0, 1, 800, 600, 12.5)
    // The greyed levels remain clickable in the stack, including without sensor data.
    plan.group.updateMatrixWorld(true)
    for (const level of west) {
      const origin = new THREE.Vector3(0, level.group.position.y + 0.1, 0)
      const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0))
      ray.layers.set(1)
      expect(
        ray.intersectObjects(
          plan.pickables.filter((object) => object.visible),
          false
        )[0]?.object.userData.band
      ).toBe(level.band)
    }
    plan.update(1, 'west', available, false, true)
    expect(
      plan.levels
        .filter((level) => level.group.visible)
        .map((level) => level.band)
    ).toEqual([1])
    expect(west.every((level) => !level.hvac.visible)).toBe(true)
    expect(plan.cells.filter((cell) => cell.visible)).toHaveLength(4)
    plan.updateXray(1, 1, 800, 600, 12.5)
    expect(plan.levels.filter((level) => level.wifi.visible)).toEqual([west[1]])
    plan.updateXray(0, 1, 800, 600, 12.5)
    plan.update(null, 'west', available)
    expect(
      west.every(
        (level) =>
          level.group.visible &&
          level.hvac.visible &&
          level.slab.material === level.materials.get(level.slab)
      )
    ).toBe(true)
    expect(
      plan.cells.filter(
        (cell) =>
          cell.visible && cell.material === cell.userData.source.material
      )
    ).toHaveLength(16)
    plan.updateXray(1, null, 800, 600, 12.5)
    expect(plan.levels.filter((level) => level.wifi.visible)).toEqual(west)
    plan.updateXray(0, null, 800, 600, 12.5)
    plan.update(2, 'west', new Set())
    expect(
      plan.cells.some((cell) => cell.material === cell.userData.source.material)
    ).toBe(false)
    expect(west.every((level) => level.group.visible)).toBe(true)
    plan.dispose()
    for (const mesh of [...panels.values()].flat()) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    plan.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        ;(object.material as THREE.Material).dispose()
      }
    })
  })
  it('tiles the wall across four columns, left to right, without overlap', () => {
    const edges = [0, 1, 2, 3].map((column) => bottomEdge(column, 4))
    expect(edges[0][0]).toBeCloseTo(-2, 1)
    expect(edges[3][1]).toBeCloseTo(2, 1)
    for (let column = 0; column < 3; column += 1) {
      expect(edges[column][1]).toBeLessThan(edges[column + 1][0])
    }
  })

  it('leans outward: the top edge sits further out than the bottom', () => {
    const position = slopedPanel(2, 3, 0, 1).getAttribute('position')
    expect(position.getZ(0)).toBeCloseTo(2)
    expect(position.getZ(2)).toBeCloseTo(3)
  })
})
