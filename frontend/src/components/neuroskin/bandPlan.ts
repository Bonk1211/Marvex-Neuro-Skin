import * as THREE from 'three'
import type { FacadeOrientation, TickPayload } from '@/lib/types'
import { roofGrid } from './solarExposure'
import { FLOOR_PLANS, floorProgram, WALL_ROTATION } from './floorWorkspaces'
import { mockOccupancy, occupantId, walkingPosition } from './floorOccupants'
import { poseSkeleton, type PosedSkeleton } from './sectionScene'
import type { CsiActivity, CsiDetection } from './csiPosture'

import { daylightColor } from './DaylightPanel'
import {
  createFloorSunlight,
  floorSunDirection,
  type FloorLightView,
} from './floorSunlight'

export const FLOOR_STACK_GAP = 4.4

/**
 * World Y rotation of each wall in the building scene. South faces the camera at
 * rotation 0, so a wall reads head-on when the orbit azimuth equals its entry here.
 * Single source of truth: BuildingHeatmap frames walls with it and the floor section
 * converts its own orbit through it.
 */
export { WALL_ROTATION } from './floorWorkspaces'

/** Illustrative furnished cutaway with optional modelled occupant-plane readings. */
export function createBandPlan(
  panels: Map<FacadeOrientation, THREE.Mesh[]>,
  divisions: number
) {
  const group = new THREE.Group()
  group.name = 'Illustrative office interior — not measured drawings'
  let furnishing: THREE.Group = group
  let probeRegistry: THREE.Object3D[] = []
  const material = (color: number) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
  const white = material(0xf7f6ef)
  const wood = material(0xcaa577)
  const oak = material(0xe1c69f)
  const dark = material(0x394743)
  const fabric = material(0x719489)
  const upholstery = material(0xb8754c)
  const blue = material(0x476986)
  const purple = material(0x887299)
  const tile = material(0xdedfd9)
  const green = material(0x507a43)
  const leaf = material(0x83a568)
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xbeded9,
    transparent: true,
    opacity: 0.24,
    roughness: 0.15,
    depthWrite: false,
  })
  const unit = new THREE.BoxGeometry(1, 1, 1)
  const round = new THREE.CylinderGeometry(1, 1, 1, 20)
  const foliage = new THREE.SphereGeometry(1, 8, 6)
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    finish: THREE.Material,
    parent: THREE.Object3D = furnishing
  ) => {
    const mesh = new THREE.Mesh(unit, finish)
    mesh.scale.set(w, h, d)
    mesh.position.set(x, y, z)
    parent.add(mesh)
    return mesh
  }
  const cylinder = (
    r: number,
    h: number,
    x: number,
    y: number,
    z: number,
    finish: THREE.Material,
    parent: THREE.Object3D = furnishing
  ) => {
    const mesh = new THREE.Mesh(round, finish)
    mesh.scale.set(r, h, r)
    mesh.position.set(x, y, z)
    parent.add(mesh)
    return mesh
  }
  const at = (x: number, z: number, rotation = 0) => {
    const item = new THREE.Group()
    item.position.set(x, 0, z)
    item.rotation.y = rotation
    furnishing.add(item)
    return item
  }
  const chair = (x: number, z: number, rotation = 0, finish = fabric) => {
    const item = at(x, z, rotation)
    item.userData.daylight = { index: probeRegistry.length, kind: 'seat' }
    probeRegistry.push(item)
    box(0.27, 0.065, 0.28, 0, 0.23, 0, finish, item)
    box(0.27, 0.27, 0.055, 0, 0.38, 0.12, finish, item)
    cylinder(0.025, 0.2, 0, 0.12, 0, dark, item)
    box(0.31, 0.025, 0.035, 0, 0.025, 0, dark, item)
    box(0.035, 0.025, 0.31, 0, 0.025, 0, dark, item)
  }
  const desk = (x: number, z: number, rotation = 0) => {
    const item = at(x, z, rotation)
    item.userData.daylight = { index: probeRegistry.length, kind: 'desk' }
    probeRegistry.push(item)
    box(0.85, 0.05, 0.43, 0, 0.4, 0, oak, item)
    for (const side of [-1, 1])
      box(0.05, 0.38, 0.35, side * 0.35, 0.2, 0, white, item)
    box(0.28, 0.18, 0.025, 0, 0.55, -0.12, dark, item)
    box(0.045, 0.08, 0.045, 0, 0.45, -0.12, dark, item)
    box(0.22, 0.014, 0.09, 0, 0.433, 0.08, white, item)
    box(0.1, 0.016, 0.15, 0.28, 0.435, 0.06, fabric, item)
    chair(
      x + Math.sin(rotation) * 0.47,
      z + Math.cos(rotation) * 0.47,
      rotation
    )
  }
  const plant = (x: number, z: number) => {
    cylinder(0.12, 0.22, x, 0.13, z, white)
    cylinder(0.018, 0.48, x, 0.4, z, wood)
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.4
      const mesh = new THREE.Mesh(foliage, i % 2 ? green : leaf)
      mesh.scale.set(0.12, 0.18, 0.1)
      mesh.position.set(
        x + Math.sin(angle) * 0.13,
        0.46 + (i % 3) * 0.075,
        z + Math.cos(angle) * 0.13
      )
      mesh.rotation.z = Math.sin(angle) * 0.5
      furnishing.add(mesh)
    }
  }
  const sofa = (x: number, z: number, rotation = 0) => {
    const item = at(x, z, rotation)
    box(1.15, 0.16, 0.43, 0, 0.18, 0, upholstery, item)
    box(1.15, 0.32, 0.1, 0, 0.35, 0.21, upholstery, item)
    for (const side of [-1, 1])
      box(0.1, 0.24, 0.5, side * 0.56, 0.3, 0, upholstery, item)
    for (const side of [-1, 0, 1])
      box(0.32, 0.045, 0.32, side * 0.35, 0.285, -0.015, white, item)
  }

  // A representative office, deliberately independent of facade/room measurements.
  box(6.72, 0.14, 6.72, 0, -0.085, 0, white).name = 'Floor slab'
  box(6.4, 0.025, 6.4, 0, -0.004, 0, wood)
  for (let row = 0; row < 32; row++) {
    const z = -3.1 + row * 0.2
    box(6.38, 0.012, 0.194, 0, 0.013, z, row % 3 ? oak : wood)
    for (const x of [-2.2, -0.6, 1, 2.6]) {
      box(0.006, 0.014, 0.194, x + (row % 2) * 0.35, 0.015, z, wood)
    }
  }
  // Back walls retain windows. Front walls are cut low to reveal the interior.
  for (const z of [-3.18, 3.18]) {
    const height = z < 0 ? 0.72 : 0.16
    box(6.4, height, 0.085, 0, height / 2, z, white)
    if (z < 0)
      for (const x of [-2.1, 0, 2.1]) {
        box(1.4, 0.4, 0.09, x, 0.43, z, dark)
        box(1.3, 0.34, 0.1, x, 0.44, z + 0.012, glass)
        box(0.035, 0.38, 0.11, x, 0.44, z + 0.018, white)
        box(1.45, 0.04, 0.14, x, 0.22, z + 0.02, white)
      }
  }
  box(0.085, 0.16, 6.4, -3.18, 0.08, 0, white)
  box(0.085, 0.72, 6.4, 3.18, 0.36, 0, white)
  for (const z of [-2.1, 0, 2.1]) {
    box(0.09, 0.36, 1.4, 3.17, 0.44, z, dark)
    box(0.11, 0.3, 1.3, 3.15, 0.45, z, glass)
    box(0.12, 0.34, 0.035, 3.14, 0.45, z, white)
  }
  // Service core is shown spatially; no thermal or occupancy values are assigned.
  box(1.45, 0.025, 1.4, 0, 0.025, 0.15, tile)
  box(1.5, 0.57, 0.075, 0, 0.285, -0.58, white)
  for (const x of [-0.76, 0.76]) box(0.075, 0.57, 1.45, x, 0.285, 0.12, white)
  box(0.075, 0.46, 1.38, 0, 0.23, 0.12, white)
  for (let step = 0; step < 7; step++)
    box(
      0.57,
      0.035 + step * 0.045,
      0.13,
      -0.38,
      (0.035 + step * 0.045) / 2,
      0.6 - step * 0.14,
      white
    )
  box(0.57, 0.48, 0.5, 0.38, 0.24, -0.24, dark)
  box(0.5, 0.43, 0.02, 0.38, 0.23, 0.02, tile)
  box(0.012, 0.43, 0.025, 0.38, 0.23, 0.04, dark)

  // Each facade owns an entire furnished plan. Bands select readings, not rooms.
  const layouts = (Object.keys(FLOOR_PLANS) as FacadeOrientation[]).map(
    (orientation, designIndex) => {
      probeRegistry = []
      const design = FLOOR_PLANS[orientation]
      const layout = new THREE.Group()
      layout.name = `${orientation} floor plan · ${design.name}`
      layout.userData.orientation = orientation
      layout.visible = orientation === 'west'
      group.add(layout)
      const room = (name: string) => {
        furnishing = new THREE.Group()
        furnishing.name = name
        layout.add(furnishing)
      }
      const roundTable = (x: number, z: number, radius = 0.43) => {
        cylinder(radius, 0.055, x, 0.4, z, oak)
        cylinder(0.085, 0.37, x, 0.2, z, dark)
      }
      const stool = (x: number, z: number) => {
        cylinder(0.13, 0.055, x, 0.37, z, upholstery)
        cylinder(0.035, 0.34, x, 0.18, z, dark)
      }

      room('Meeting and training rooms')
      box(6.17, 0.022, 1.9, 0, 0.028, -2.18, material(design.floor))
      if (designIndex === 0) {
        // A wide enclosed boardroom and a much smaller open huddle alcove.
        box(0.085, 0.78, 2.02, 1.04, 0.39, -2.18, white)
        box(2.92, 0.14, 0.06, -1.61, 0.07, -1.15, white)
        box(2.92, 0.54, 0.025, -1.61, 0.4, -1.15, glass)
        for (const x of [-3.06, -0.15])
          box(0.045, 0.7, 0.045, x, 0.35, -1.15, blue)
        box(2.72, 0.07, 0.72, -0.99, 0.41, -2.21, wood)
        for (const x of [-2.03, -1.33, -0.63, 0.07]) {
          chair(x, -2.83, Math.PI, blue)
          chair(x, -1.58, 0, blue)
        }
        box(0.07, 0.38, 1.12, -3.04, 0.46, -2.2, dark)
        roundTable(2.14, -2.2)
        chair(1.5, -2.2, -Math.PI / 2, blue)
        chair(2.78, -2.2, Math.PI / 2, blue)
      } else if (designIndex === 1) {
        // One open training room with a raised teaching platform.
        box(3.75, 0.12, 0.44, 0, 0.075, -2.87, wood)
        box(2.4, 0.5, 0.045, 0, 0.56, -3.06, dark)
        box(0.38, 0.42, 0.3, -2.43, 0.21, -2.84, blue)
        for (const x of [-2.3, -1.15, 0, 1.15, 2.3])
          for (const z of [-2.15, -1.47]) chair(x, z, 0, blue)
      } else if (designIndex === 2) {
        // Two equal huddle rooms with circular tables and a dividing wall.
        box(0.085, 0.75, 1.97, 0, 0.375, -2.18, white)
        for (const x of [-1.57, 1.57]) {
          roundTable(x, -2.2, 0.47)
          chair(x - 0.67, -2.2, -Math.PI / 2, blue)
          chair(x + 0.67, -2.2, Math.PI / 2, blue)
          chair(x, -2.86, Math.PI, blue)
          chair(x, -1.53, 0, blue)
          box(1.5, 0.38, 0.06, x - 0.43, 0.19, -1.16, white)
        }
      } else {
        // A horseshoe seminar table, open towards the shared corridor.
        box(4.55, 0.07, 0.4, 0, 0.42, -2.79, wood)
        for (const x of [-2.08, 2.08]) {
          box(0.4, 0.07, 1.38, x, 0.42, -2.19, wood)
          chair(
            x + Math.sign(x) * 0.62,
            -2.25,
            (Math.sign(x) * Math.PI) / 2,
            blue
          )
          box(0.2, 0.38, 0.9, x, 0.2, -2.25, white)
        }
        for (const x of [-1.35, -0.45, 0.45, 1.35]) chair(x, -2.12, 0, blue)
      }

      room('Quiet rooms')
      box(1.92, 0.024, 2.18, -2.17, 0.028, 0.02, tile)
      if (designIndex === 0 || designIndex === 3) {
        // Solid acoustic pods; the three-booth studio uses smaller built-in desks.
        const splits =
          designIndex === 0 ? [-1.06, 0.02, 1.1] : [-1.06, -0.34, 0.38, 1.1]
        for (const z of splits) box(1.55, 0.74, 0.07, -2.32, 0.37, z, purple)
        box(0.08, 0.74, 2.16, -3.08, 0.37, 0.02, purple)
        for (let i = 0; i < splits.length - 1; i++) {
          const z = (splits[i] + splits[i + 1]) / 2
          box(
            0.37,
            0.055,
            splits[i + 1] - splits[i] - 0.23,
            -2.73,
            0.39,
            z,
            oak
          )
          box(0.03, 0.18, 0.25, -2.83, 0.52, z, dark)
          chair(-2.17, z, Math.PI / 2, purple)
        }
      } else if (designIndex === 1) {
        // Library wall and a reading bench instead of computer stations.
        box(0.25, 0.72, 2.07, -3, 0.36, 0.02, wood)
        for (const y of [0.22, 0.47]) {
          box(0.28, 0.035, 2.09, -2.98, y, 0.02, oak)
          for (let book = 0; book < 12; book++)
            box(
              0.16,
              0.16,
              0.075,
              -2.94,
              y + 0.1,
              -0.86 + book * 0.16,
              book % 2 ? blue : purple
            )
        }
        box(0.43, 0.24, 1.53, -2.15, 0.16, 0, purple)
        cylinder(0.31, 0.045, -1.57, 0.33, 0.1, oak)
        cylinder(0.05, 0.3, -1.57, 0.17, 0.1, dark)
      } else {
        // A single private office with an L-shaped desk and storage.
        box(1.9, 0.68, 0.065, -2.16, 0.34, -1.06, white)
        box(0.065, 0.68, 1.15, -1.17, 0.34, -0.49, white)
        desk(-2.21, -0.41, Math.PI / 2)
        box(0.75, 0.055, 0.35, -1.97, 0.4, -0.86, oak)
        box(0.27, 0.48, 1.02, -2.96, 0.24, 0.4, purple)
        chair(-1.93, 0.67, Math.PI, purple)
      }

      room('Café and lounge')
      box(1.92, 0.025, 2.18, 2.17, 0.028, 0.02, oak)
      if (designIndex === 0) {
        // L-shaped coffee bar and a large corner banquette.
        box(1.62, 0.43, 0.3, 2.25, 0.23, -0.85, wood)
        box(0.3, 0.43, 0.95, 2.91, 0.23, -0.5, wood)
        box(1.67, 0.045, 0.34, 2.25, 0.47, -0.85, white)
        sofa(2.82, 0.49, Math.PI / 2)
        sofa(2.16, 0.87)
        roundTable(2.12, 0.32, 0.28)
      } else if (designIndex === 1) {
        // Two cafe tables and a standing counter along the window.
        box(0.3, 0.06, 1.99, 2.93, 0.51, 0, wood)
        for (const z of [-0.54, 0.6]) {
          roundTable(1.87, z, 0.31)
          stool(1.39, z)
          stool(2.35, z)
        }
      } else if (designIndex === 2) {
        // A curved upholstered booth makes this side read as a lounge immediately.
        const seat = new THREE.Mesh(
          new THREE.TorusGeometry(0.57, 0.15, 6, 28, Math.PI),
          upholstery
        )
        seat.rotation.x = Math.PI / 2
        seat.rotation.z = -Math.PI / 2
        seat.position.set(2.13, 0.23, 0.02)
        furnishing.add(seat)
        const back = new THREE.Mesh(
          new THREE.CylinderGeometry(0.73, 0.73, 0.34, 28, 1, true, 0, Math.PI),
          upholstery
        )
        back.material.side = THREE.DoubleSide
        back.position.set(2.13, 0.42, 0.02)
        furnishing.add(back)
        roundTable(2, 0.02, 0.3)
        stool(1.5, 0.02)
        box(1.4, 0.41, 0.32, 2.32, 0.22, -0.9, wood)
      } else {
        // Facing sofas and a low rectangular coffee table.
        sofa(1.58, 0, -Math.PI / 2)
        sofa(2.86, 0, Math.PI / 2)
        box(0.53, 0.22, 0.72, 2.22, 0.14, 0, wood)
        box(1.62, 0.43, 0.3, 2.25, 0.23, -0.85, wood)
      }
      box(0.2, 0.2, 0.2, 2.73, 0.59, -0.84, dark)

      room('Workstations')
      box(6.17, 0.024, 1.87, 0, 0.028, 2.18, material(design.floor))
      if (designIndex === 0) {
        // Two rotated desk islands, separated by an open central aisle.
        for (const x of [-1.56, 1.56]) {
          const parent = furnishing
          furnishing = at(x, 2.16, x < 0 ? -0.15 : 0.15)
          for (const dx of [-0.49, 0.49]) {
            desk(dx, -0.24, Math.PI)
            desk(dx, 0.24)
          }
          box(1.85, 0.25, 0.055, 0, 0.51, 0, fabric)
          furnishing = parent
        }
      } else if (designIndex === 1) {
        // Long parallel bench rows instead of separate desk islands.
        for (const x of [-2.35, -0.8, 0.8, 2.35]) {
          desk(x, 1.78, Math.PI)
          desk(x, 2.53)
        }
        for (const z of [1.78, 2.53]) box(5.65, 0.055, 0.43, 0, 0.4, z, oak)
      } else if (designIndex === 2) {
        // Round collaboration hubs replace linear workstation benches.
        for (const x of [-2.14, 0, 2.14]) {
          roundTable(x, 2.17, 0.49)
          chair(x - 0.68, 2.17, -Math.PI / 2)
          chair(x + 0.68, 2.17, Math.PI / 2)
          chair(x, 2.87)
          box(0.25, 0.018, 0.18, x, 0.44, 2.17, dark)
        }
      } else {
        // Four staggered L-shaped studio desks with tall pin-up screens.
        for (const [i, x] of [-2.37, -0.79, 0.79, 2.37].entries()) {
          const z = i % 2 ? 2.33 : 1.78
          desk(x, z, i % 2 ? 0 : Math.PI)
          box(0.35, 0.055, 0.93, x + 0.4, 0.4, 2.12, oak)
          box(0.055, 0.67, 1.07, x + 0.64, 0.335, 2.12, fabric)
        }
      }
      for (const [x, z] of [
        [-2.95, -2.92],
        [2.95, -2.92],
        [1.16, 1.02],
        [-0.9, -0.89],
      ])
        plant(x, z)
      return layout
    }
  )
  furnishing = group

  // A suspended schematic: supply and return are separate connected routes.
  // No airflow, equipment sizing or room loads are inferred from facade data.
  const hvac = new THREE.Group()
  hvac.name = 'Illustrative HVAC · supply, return and air-handling unit'
  group.add(hvac)
  const supply = material(0x49a9c5)
  const returning = material(0xc49967)
  box(0.76, 0.44, 0.72, 0, 1.32, 0, white, hvac).name =
    'Air-handling unit · schematic'
  for (const x of [-0.19, 0.19]) {
    cylinder(0.135, 0.025, x, 1.555, 0, dark, hvac)
    for (let blade = 0; blade < 3; blade++) {
      const fan = box(0.22, 0.018, 0.045, x, 1.575, 0, tile, hvac)
      fan.rotation.y = (blade * Math.PI) / 3
    }
  }
  for (let i = 0; i < 6; i++)
    box(0.05, 0.23, 0.02, -0.22 + i * 0.09, 1.3, 0.367, dark, hvac)
  const arrow = new THREE.ConeGeometry(0.095, 0.2, 3)
  const hvacLayouts = layouts.map((layout, designIndex) => {
    const routes = new THREE.Group()
    routes.name = `${layout.userData.orientation} floor plan HVAC`
    routes.userData.orientation = layout.userData.orientation
    routes.visible = layout.visible
    hvac.add(routes)
    const terminals: Record<FacadeOrientation, number[]> = [
      {
        north: [-2.14, 0, 2.14],
        east: [-0.55, 0.55],
        south: [-2.4, -0.8, 0.8, 2.4],
        west: [-0.55, 0.55],
      },
      {
        north: [-2.3, 0, 2.3],
        east: [-0.6, 0.54],
        south: [-2.35, -0.8, 0.8, 2.35],
        west: [-0.55, 0.55],
      },
      { north: [-1.57, 1.57], east: [0], south: [-2.14, 0, 2.14], west: [0] },
      {
        north: [-2.08, 0, 2.08],
        east: [-0.4, 0.4],
        south: [-2.37, -0.79, 0.79, 2.37],
        west: [-0.72, 0, 0.72],
      },
    ][designIndex]
    for (const [orientation, rotation] of Object.entries(WALL_ROTATION)) {
      const branch = new THREE.Group()
      branch.name = `${orientation} route · supply and return`
      branch.rotation.y = rotation
      routes.add(branch)
      const outlets = terminals[orientation as FacadeOrientation]
      for (const [finish, x, y, end, direction] of [
        [supply, -0.16, 1.18, 2.24, 1],
        [returning, 0.16, 1.46, 2.77, -1],
      ] as const) {
        box(0.095, 0.09, end, x, y, end / 2, finish, branch)
        const first = Math.min(x, outlets[0])
        const last = Math.max(x, outlets[outlets.length - 1])
        box(
          last - first + 0.095,
          0.09,
          0.095,
          (first + last) / 2,
          y,
          end,
          finish,
          branch
        )
        const flow = new THREE.Mesh(arrow, finish)
        flow.rotation.x = (direction * Math.PI) / 2
        flow.position.set(x, y + 0.07, 1.45)
        branch.add(flow)
        for (const outlet of outlets) {
          box(0.09, 0.16, 0.09, outlet, y - 0.08, end, finish, branch)
          box(0.33, 0.04, 0.29, outlet, y - 0.17, end, white, branch).name =
            direction === 1 ? 'Supply diffuser' : 'Return grille'
          for (let fin = -1; fin <= 1; fin++)
            box(
              0.24,
              0.047,
              0.035,
              outlet,
              y - 0.17,
              end + fin * 0.065,
              finish,
              branch
            )
        }
      }
    }

    return routes
  })

  // Reuse the shared shell and furnishings as four independent levels per side.
  const shell = new THREE.Group()
  for (const object of [...group.children])
    if (object !== hvac && !layouts.includes(object as THREE.Group))
      shell.add(object)
  for (const layout of layouts) layout.removeFromParent()
  hvac.removeFromParent()
  for (const routes of hvacLayouts) routes.removeFromParent()
  const pickables: THREE.Object3D[] = []
  const grey = new THREE.MeshBasicMaterial({
    color: 0xabb5b0,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
  })
  const greySlab = new THREE.MeshBasicMaterial({
    color: 0xbac2be,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  })
  const skin = material(0xd6a57c)
  const shirt = material(0x245878)
  const detection = new THREE.MeshBasicMaterial({
    color: 0x087f9c,
    side: THREE.DoubleSide,
  })
  const detectionRing = new THREE.RingGeometry(0.19, 0.215, 24)
  const probeRing = new THREE.RingGeometry(0.19, 0.31, 32)
  const floorShadowGeometry = new THREE.PlaneGeometry(6.2, 6.2)
  const floorShadowMaterial = new THREE.ShadowMaterial({
    color: 0x152a35,
    opacity: 0.5,
    depthWrite: false,
  })
  // The X-ray is a material layer on the existing meshes, not another room.
  const wireMaterial = new THREE.LineBasicMaterial({
    color: 0x72d8f2,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const edgeCache = new Map<THREE.BufferGeometry, THREE.BufferAttribute>()
  const point = new THREE.Vector3()
  const glowPixels = new Uint8Array(32 * 32 * 4)
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4
      glowPixels.set(
        [
          32,
          204,
          255,
          Math.round(
            160 * Math.max(0, 1 - Math.hypot(x - 15.5, y - 15.5) / 16) ** 2
          ),
        ],
        i
      )
    }
  const glowTexture = new THREE.DataTexture(glowPixels, 32, 32)
  glowTexture.needsUpdate = true
  // Illustrative wavefronts only; no measured RF propagation or signal strength.
  const waveGeometry = new THREE.RingGeometry(0.985, 1, 96)
  const wifiMaterial = new THREE.MeshBasicMaterial({
    color: 0x61f3ff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  })
  const waveMaterials = Array.from({ length: 4 }, () => wifiMaterial.clone())
  const ghostMaterials = new Map<THREE.Material, THREE.Material>()
  const originalMaterials = new Map<THREE.Material, THREE.Material>()
  const xrayColor = new THREE.Color(0x52badb)
  let previousXray = 0
  const sides = Object.keys(FLOOR_PLANS) as FacadeOrientation[]
  const levels = sides.flatMap((orientation) =>
    Array.from({ length: 4 }, (_, band) => {
      const level = new THREE.Group()
      level.name = `${orientation} · floor group ${band + 1}`
      level.position.y = band * FLOOR_STACK_GAP
      level.visible = orientation === 'west'
      const designIndex = sides.indexOf(floorProgram(orientation, band))
      const interior = layouts[designIndex].clone(true)
      interior.visible = true
      const climate = hvac.clone(true)
      const routes = hvacLayouts[designIndex].clone(true)
      routes.visible = true
      climate.add(routes)
      climate.name = 'Illustrative HVAC'
      level.add(shell.clone(true), interior, climate)
      const slab = level.getObjectByName('Floor slab') as THREE.Mesh
      slab.userData = { band, surface: `wall:${orientation}` }
      const materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
      level.traverse((object) => {
        if (object instanceof THREE.Mesh) materials.set(object, object.material)
      })
      const probes: {
        index: number
        kind: 'seat' | 'desk'
        x: number
        z: number
        rotation: number
        mesh: THREE.Mesh
        color: THREE.MeshStandardMaterial
        halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
      }[] = []
      level.updateMatrixWorld(true)
      const edges: number[] = []
      const inverse = level.matrixWorld.clone().invert()
      for (const mesh of materials.keys()) {
        let vertices = edgeCache.get(mesh.geometry)
        if (!vertices) {
          const geometry = new THREE.EdgesGeometry(mesh.geometry, 35)
          vertices = geometry.getAttribute('position') as THREE.BufferAttribute
          edgeCache.set(mesh.geometry, vertices)
          geometry.dispose()
        }
        const transform = inverse.clone().multiply(mesh.matrixWorld)
        for (let i = 0; i < vertices.count; i++) {
          point.fromBufferAttribute(vertices, i).applyMatrix4(transform)
          edges.push(point.x, point.y, point.z)
        }
      }
      const wire = new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute(
          'position',
          new THREE.Float32BufferAttribute(edges, 3)
        ),
        wireMaterial
      )
      wire.visible = false
      wire.renderOrder = 2
      level.add(wire)
      const wifi = new THREE.Group()
      wifi.name = 'Wi-Fi transmitter and signal waves · simulated'
      wifi.position.y = 0.82
      wifi.visible = false
      box(0.3, 0.07, 0.2, 0, 0, 0, wifiMaterial, wifi)
      for (const x of [-0.1, 0.1])
        cylinder(0.012, 0.18, x, 0.1, -0.06, wifiMaterial, wifi)
      const waves = waveMaterials.map((finish) => {
        const wave = new THREE.Mesh(waveGeometry, finish)
        wave.rotation.x = -Math.PI / 2
        wifi.add(wave)
        return wave
      })
      for (const object of wifi.children) object.renderOrder = 3
      level.add(wifi)
      interior.traverse((object) => {
        if (!object.userData.daylight) return
        const point = object.getWorldPosition(new THREE.Vector3())
        const mesh = object.children[0] as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshStandardMaterial
        >
        const halo = new THREE.Mesh(
          probeRing,
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        )
        halo.rotation.x = -Math.PI / 2
        halo.position.set(point.x, 0.79, point.z)
        halo.visible = false
        halo.userData.floorLight = true
        level.add(halo)
        probes.push({
          ...object.userData.daylight,
          x: point.x,
          z: point.z,
          rotation: Math.atan2(
            object.matrixWorld.elements[8],
            object.matrixWorld.elements[10]
          ),
          mesh,
          color: mesh.material.clone(),
          halo,
        })
        mesh.userData = {
          band,
          surface: `wall:${orientation}`,
          probe: object.userData.daylight,
        }
        halo.userData = { ...mesh.userData, floorLight: true }
        pickables.push(mesh, halo)
      })
      const seats = probes.filter((probe) => probe.kind === 'seat')
      const people = Array.from({ length: 12 }, (_, index) => {
        const person = new THREE.Group()
        const id = occupantId(orientation, band, index)
        person.name = `Mock occupant ${id}`
        person.visible = false
        const body = new THREE.Group()
        person.add(body)
        cylinder(0.078, 0.22, 0, 0.43, 0, shirt, body)
        const head = new THREE.Mesh(foliage, skin)
        head.scale.setScalar(0.079)
        head.position.y = 0.62
        body.add(head)
        const legs = [-1, 1].map((side) => {
          const thigh = new THREE.Group()
          thigh.position.set(side * 0.046, 0.32, 0)
          body.add(thigh)
          box(0.06, 0.15, 0.065, 0, -0.075, 0, dark, thigh)
          const shin = new THREE.Group()
          shin.position.y = -0.15
          thigh.add(shin)
          box(0.055, 0.15, 0.06, 0, -0.075, 0, dark, shin)
          return { thigh, shin }
        })
        for (const side of [-1, 1])
          box(0.045, 0.21, 0.045, side * 0.105, 0.4, 0, shirt, body)
        const marker = new THREE.Group()
        const ring = new THREE.Mesh(detectionRing, detection)
        ring.rotation.x = -Math.PI / 2
        ring.position.y = 0.045
        marker.add(ring)
        person.add(marker)
        person.userData = { band, surface: `wall:${orientation}`, occupant: id }
        body.traverse((mesh) => {
          if (mesh instanceof THREE.Mesh) {
            mesh.userData = person.userData
            materials.set(mesh, mesh.material)
          }
        })
        ring.userData = person.userData
        pickables.push(ring, head)
        level.add(person)
        return {
          group: person,
          body,
          legs,
          marker,
          id,
          csi: null as {
            detection: CsiDetection
            skeleton: PosedSkeleton
            glow: THREE.Sprite
          } | null,
          seat: seats[
            index % 2
              ? seats.length - 1 - Math.floor(index / 2)
              : Math.floor(index / 2)
          ],
        }
      })
      pickables.push(slab)
      const sunlight = createFloorSunlight(orientation, band)
      level.add(sunlight.group)
      const shadow = new THREE.Mesh(floorShadowGeometry, floorShadowMaterial)
      shadow.rotation.x = -Math.PI / 2
      shadow.position.y = 0.085
      shadow.receiveShadow = true
      shadow.userData.floorLight = true
      level.add(shadow)
      const occluders: THREE.Object3D[] = []
      for (const root of [level.children[0], interior])
        root.traverse((object) => {
          if (
            object instanceof THREE.Mesh &&
            !(object.material as THREE.Material).transparent
          )
            occluders.push(object)
        })
      group.add(level)
      return {
        group: level,
        band,
        orientation,
        hvac: climate,
        slab,
        materials,
        probes,
        people,
        sunlight,
        occluders,
        shadow,
        wire,
        wifi,
        waves,
      }
    })
  )

  const light = new THREE.DirectionalLight(0xfff4df, 3.2)
  light.position.set(-3, 23, 5)
  light.target.position.y = FLOOR_STACK_GAP * 1.5
  light.castShadow = true
  light.shadow.mapSize.set(2048, 2048)
  Object.assign(light.shadow.camera, {
    left: -10,
    right: 10,
    top: 10,
    bottom: -10,
    near: 0.1,
    far: 40,
  })
  light.shadow.camera.layers.set(1)
  light.shadow.normalBias = 0.015
  light.shadow.bias = -0.0001
  group.add(light, light.target)

  const muted = new THREE.MeshBasicMaterial({ color: 0xd5dcd8 })
  const cells: THREE.Mesh[] = []
  for (const wall of panels.values())
    for (const source of wall) {
      const index = source.userData.index as number
      const cell = new THREE.Mesh(
        roofGrid(3.48, 3.27, 0.035, 0.035, divisions, index % 4, 4, 0.02),
        muted
      )
      cell.rotation.copy(source.rotation)
      cell.position.y = Math.floor(index / 4) * FLOOR_STACK_GAP
      cell.userData = {
        ...source.userData,
        source,
        band: Math.floor(index / 4),
      }
      cell.geometry.computeBoundingBox()
      cell.updateMatrixWorld()
      cell.userData.anchor = cell.localToWorld(
        cell.geometry.boundingBox!.getCenter(new THREE.Vector3())
      )
      cell.userData.frame = undefined
      group.add(cell)
      cells.push(cell)
      pickables.push(cell)
    }
  group.traverse((object) => object.layers.set(1))
  let previousView = ''
  let previousDaylight: TickPayload | undefined
  let previousSun: TickPayload | undefined
  return {
    group,
    levels,
    cells,
    pickables,
    light,
    update(
      focusedBand: number | null,
      orientation: FacadeOrientation,
      available: Set<string>,
      showHvac = true,
      topDown = false,
      daylightTick?: TickPayload,
      lighting?: {
        tick: TickPayload
        mode: FloorLightView
        controlled: boolean
      }
    ) {
      const mode = lighting?.mode ?? 'sun'
      const solar = lighting?.tick ?? daylightTick
      const view = `${orientation}:${focusedBand}:${showHvac}:${topDown}:${mode}:${lighting?.controlled}`
      const changed = previousView !== view
      if (changed) {
        for (const level of levels) {
          const focused = focusedBand === null || level.band === focusedBand
          level.group.visible =
            level.orientation === orientation && (!topDown || focused)
          level.slab.visible = level.group.visible
          level.hvac.visible = showHvac
          for (const [mesh, original] of level.materials) {
            mesh.material = focused
              ? original
              : mesh === level.slab
                ? greySlab
                : grey
            // Exploded/ghost levels are presentation, not ceilings above the selected room.
            mesh.castShadow =
              focusedBand !== null &&
              focused &&
              !(original as THREE.Material).transparent
          }
          level.hvac.traverse((object) => {
            object.castShadow = false
          })
          for (const person of level.people)
            person.body.traverse((object) => {
              object.castShadow = focusedBand !== null && focused
            })
          for (const child of level.group.children) {
            if (child instanceof THREE.Sprite) {
              child.visible = level.group.visible
              child.material.opacity = focused ? 1 : 0.45
            }
          }
        }
        previousView = view
      }
      if (changed || previousDaylight !== daylightTick) {
        for (const level of levels) {
          const focused = focusedBand === null || level.band === focusedBand
          const status = daylightTick?.daylight
          const readings = new Map(
            daylightTick?.facade
              .find((wall) => wall.orientation === level.orientation)
              ?.zones?.filter((zone) => zone.row === level.band)
              .flatMap((zone) => zone.conditions?.daylight_probes ?? [])
              .map((probe) => [probe.index, probe]) ?? []
          )
          for (const probe of level.probes) {
            const reading = readings.get(probe.index)
            probe.mesh.userData.reading = reading
            probe.halo.userData.reading = reading
            const markerColor =
              reading && status
                ? daylightColor(
                    mode === 'et' ? { ...reading, kind: 'desk' } : reading,
                    status
                  )
                : null
            probe.halo.visible =
              focused &&
              !!markerColor &&
              !status?.night &&
              (mode === 'et' || (mode === 'ev' && probe.kind === 'seat'))
            if (markerColor) probe.halo.material.color.set(markerColor)
            const color =
              mode === 'et'
                ? markerColor
                : mode === 'ev' && probe.kind === 'desk'
                  ? null
                  : reading && status
                    ? daylightColor(reading, status)
                    : null
            if (color && focused) {
              probe.color.color.set(color)
              probe.mesh.material = probe.color
            } else {
              probe.mesh.material = focused
                ? level.materials.get(probe.mesh)!
                : grey
            }
          }
        }
        previousDaylight = daylightTick
      }
      const sunChanged = previousSun !== solar
      if (changed || sunChanged) {
        const centre = (focusedBand ?? 1.5) * FLOOR_STACK_GAP
        light.target.position.set(0, centre, 0)
        light.position.copy(
          solar &&
            Number.isFinite(solar.solar_azimuth) &&
            Number.isFinite(solar.solar_elevation)
            ? floorSunDirection(
                solar.solar_azimuth,
                solar.solar_elevation
              ).multiplyScalar(20)
            : new THREE.Vector3(-3, 20, 5)
        )
        light.position.y += centre
        light.intensity = solar && solar.solar_elevation <= 0 ? 0.2 : 3.2
        group.updateMatrixWorld(true)
        for (const level of levels) {
          level.shadow.visible =
            level.group.visible &&
            level.band === focusedBand &&
            mode === 'sun' &&
            !!solar &&
            solar.solar_elevation > 0
          const visible =
            level.group.visible &&
            (focusedBand === null || level.band === focusedBand) &&
            mode === 'sun'
          if (visible)
            level.sunlight.update(
              solar,
              lighting?.controlled ?? true,
              level.occluders
            )
          else level.sunlight.group.visible = false
        }
        previousSun = solar
      }
      for (const cell of cells) {
        const source = cell.userData.source as THREE.Mesh
        const focused =
          focusedBand === null || cell.userData.band === focusedBand
        cell.visible =
          cell.userData.surface === `wall:${orientation}` &&
          (!topDown || focused)
        cell.material = !focused
          ? grey
          : cell.visible && available.has(cell.userData.zone)
            ? source.material
            : muted
        cell.userData.irradiance = source.userData.irradiance
        for (const name of ['uv', 'color']) {
          const attribute = source.geometry.getAttribute(name)
          if (attribute) cell.geometry.setAttribute(name, attribute)
        }
      }
      return changed || sunChanged
    },
    updatePeople(
      seconds: number,
      occupancy: number,
      showPeople = true,
      showMarkers = true,
      focusedBand: number | null = null,
      activity: CsiActivity = 'auto'
    ) {
      for (const level of levels) {
        const counts = mockOccupancy(
          activity === 'empty' ? 0 : occupancy,
          level.orientation,
          level.band
        )
        for (const [index, person] of level.people.entries()) {
          person.group.visible =
            showPeople &&
            level.group.visible &&
            index < counts.total &&
            (focusedBand === null || level.band === focusedBand)
          person.marker.visible = showMarkers
          if (!person.group.visible) continue
          const walking =
            activity === 'walking' ||
            (activity === 'auto' && index < counts.walking)
          const point = walking
            ? walkingPosition(seconds, index, level.orientation, level.band)
            : person.seat
          person.group.position.set(point.x, 0, point.z)
          person.group.rotation.y =
            activity === 'window'
              ? {
                  north: 0,
                  east: -Math.PI / 2,
                  south: Math.PI,
                  west: Math.PI / 2,
                }[level.orientation]
              : point.rotation
          person.body.position.y = walking ? 0 : -0.06
          person.group.userData.state = walking ? 'walking' : 'seated'
          person.group.userData.seatIndex = walking ? null : person.seat.index
          person.group.userData.reading = walking
            ? undefined
            : person.seat.mesh.userData.reading
          for (const [leg, { thigh, shin }] of person.legs.entries()) {
            thigh.rotation.x = walking
              ? Math.sin(seconds * 4 + index + leg * Math.PI) * 0.4
              : Math.PI / 2
            shin.rotation.x = walking ? 0 : -Math.PI / 2
          }
          // Tracking labels appear in the focused floor; rings remain readable in the stack.
          for (const child of person.marker.children)
            if (child instanceof THREE.Sprite)
              child.visible = focusedBand === level.band
        }
      }
    },
    updateXray(
      amount: number,
      focusedBand: number | null,
      width: number,
      height: number,
      seconds = 0
    ) {
      if (amount === 0 && previousXray === 0) return
      const blendMaterial = (material: THREE.Material) => {
        const original = originalMaterials.get(material) ?? material
        if (!amount) return original
        let ghost = ghostMaterials.get(original)
        if (!ghost) {
          ghost = original.clone()
          ghost.transparent = true
          ghost.depthWrite = false
          ghostMaterials.set(original, ghost)
          originalMaterials.set(ghost, original)
        }
        ghost.opacity = original.opacity * (1 - amount * 0.94)
        if ('color' in ghost && 'color' in original)
          (ghost.color as THREE.Color)
            .copy(original.color as THREE.Color)
            .lerp(xrayColor, amount)
        return ghost
      }
      const shade = (mesh: THREE.Mesh) => {
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(blendMaterial)
          : blendMaterial(mesh.material)
      }
      wireMaterial.opacity = amount * 0.28
      wifiMaterial.opacity = amount
      for (const level of levels) {
        level.wire.visible =
          amount > 0 && (focusedBand === null || level.band === focusedBand)
        level.wifi.visible = level.group.visible && level.wire.visible
        if (level.wifi.visible)
          for (const [index, wave] of level.waves.entries()) {
            const phase = (seconds / 4 + index / level.waves.length) % 1
            wave.scale.setScalar(0.12 + phase * 4.5)
            wave.material.opacity =
              amount * 0.65 * (1 - phase) * Math.min(1, phase * 8)
          }
        if (level.group.visible || amount === 0)
          for (const mesh of level.materials.keys()) shade(mesh)
        for (const person of level.people) {
          if (amount > 0 && person.group.visible && !person.csi) {
            const detection: CsiDetection = {
              probeIndex: person.seat.index,
              zone: person.id,
              posture: 'seated',
              facingDeg: 0,
              confidence: 0.85,
              breathingBpm: 15,
            }
            const skeleton = poseSkeleton(
              detection,
              new THREE.Vector3(),
              new THREE.Vector3(1, 0, 0),
              0
            )
            skeleton.object.scale.setScalar(0.72 / 1.7)
            skeleton.object.material.depthTest = false
            skeleton.object.material.depthWrite = false
            skeleton.object.renderOrder = 8
            skeleton.object.layers.set(1)
            const glow = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: glowTexture,
                transparent: true,
                depthWrite: false,
                depthTest: false,
                blending: THREE.AdditiveBlending,
              })
            )
            glow.position.y = 0.38
            glow.scale.set(0.9, 1.25, 1)
            glow.layers.set(1)
            glow.renderOrder = 7
            person.group.add(glow, skeleton.object)
            person.csi = { detection, skeleton, glow }
          }
          if (!person.csi) continue
          const { detection, skeleton, glow } = person.csi
          skeleton.object.visible = glow.visible = amount > 0
          if (!amount || !person.group.visible) continue
          detection.posture = person.group.userData.state
          detection.confidence = detection.posture === 'walking' ? 0.94 : 0.85
          skeleton.object.material.opacity = amount
          skeleton.setResolution(width, height)
          skeleton.update(seconds)
          glow.material.opacity = amount * 0.6
        }
      }
      for (const cell of cells) shade(cell)
      previousXray = amount
    },
    dispose() {
      for (const level of levels) {
        for (const probe of level.probes) probe.color.dispose()
        level.wire.geometry.dispose()
        for (const person of level.people)
          if (person.csi) {
            person.csi.skeleton.object.geometry.dispose()
            person.csi.skeleton.object.material.dispose()
            person.csi.glow.material.dispose()
          }
      }
      for (const material of ghostMaterials.values()) material.dispose()
      wireMaterial.dispose()
      glowTexture.dispose()
      waveGeometry.dispose()
      wifiMaterial.dispose()
      for (const material of waveMaterials) material.dispose()
      muted.dispose()
      grey.dispose()
      greySlab.dispose()
      skin.dispose()
      shirt.dispose()
      detection.dispose()
      detectionRing.dispose()
      probeRing.dispose()
      floorShadowGeometry.dispose()
      floorShadowMaterial.dispose()
      light.shadow.dispose()
    },
  }
}
