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
