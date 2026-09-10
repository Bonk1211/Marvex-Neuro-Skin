import * as THREE from 'three'

export interface LouvreAssembly {
  group: THREE.Group
  occluders: THREE.Object3D[]
  angle: number
  targetAngle: number
}

interface Mechanics {
  pivots: THREE.Group[]
  actuator: THREE.InstancedMesh
  anchor: THREE.Vector3
  crankTips: THREE.Vector3[]
  tip: THREE.Vector3
  tieStart: THREE.Vector3
  tieEnd: THREE.Vector3
}

const UP = new THREE.Vector3(0, 1, 0)
const X_AXIS = new THREE.Vector3(1, 0, 0)
const transform = new THREE.Object3D()
const direction = new THREE.Vector3()

/** Place a unit-length rail, bearing or actuator between two mounting points. */
function segment(
  mesh: THREE.InstancedMesh,
  index: number,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number
) {
  direction.subVectors(to, from)
  transform.position.copy(from).lerp(to, 0.5)
  transform.scale.set(radius, direction.length(), radius)
  transform.quaternion.setFromUnitVectors(UP, direction.normalize())
  transform.updateMatrix()
  mesh.setMatrixAt(index, transform.matrix)
}

export function createLouvreAssembly({
  bottomY,
  topY,
  halfWidthAt,
  column,
  columns,
}: {
  bottomY: number
  topY: number
  halfWidthAt: (y: number) => number
  column: number
  columns: number
}): LouvreAssembly {
  const group = new THREE.Group()
  group.name = 'louvre-assembly'
  // Two deeper blades per zone double the visible sweep while retaining clearance.
  const bladeCount = 2
  const pitch = (topY - bottomY) / bladeCount
  const chord = pitch * 1.05
  const thickness = 0.009
  const slope = (halfWidthAt(topY) - halfWidthAt(bottomY)) / (topY - bottomY)
  // Clear the leaning facade over the complete blade rotation, including ribs.
  const standOff = ((chord + thickness) / 2) * Math.hypot(1, slope) + 0.025
  const metal = new THREE.MeshStandardMaterial({
    color: 0xaab8ba,
    metalness: 0.75,
    roughness: 0.3,
  })
  const hardware = new THREE.MeshStandardMaterial({
    color: 0x39484d,
    metalness: 0.6,
    roughness: 0.4,
  })
  const box = new THREE.BoxGeometry(1, 1, 1)
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8)

  // A chamfered extrusion with two raised longitudinal ribs, in one draw call.
  const profile = new THREE.Shape()
  profile.moveTo(-chord / 2, 0)
  profile.lineTo(-chord / 2 + 0.008, 0.003)
  for (const rib of [-chord * 0.28, chord * 0.28]) {
    profile.lineTo(rib - 0.003, 0.003)
    profile.lineTo(rib - 0.003, thickness / 2)
    profile.lineTo(rib + 0.003, thickness / 2)
    profile.lineTo(rib + 0.003, 0.003)
  }
  profile.lineTo(chord / 2 - 0.008, 0.003)
  profile.lineTo(chord / 2, 0)
  profile.lineTo(chord / 2 - 0.008, -thickness / 2)
  profile.lineTo(-chord / 2 + 0.008, -thickness / 2)
  profile.closePath()
  const bladeGeometry = new THREE.ExtrudeGeometry(profile, {
    depth: 1,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  })
  bladeGeometry.rotateY(Math.PI / 2)
  bladeGeometry.translate(-0.5, 0, 0)
  const proxyGeometry = new THREE.BoxGeometry(1, thickness, chord)
  const proxyMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })

  const mounts = new THREE.Group()
  mounts.name = 'static-mounts'
  const rails = new THREE.InstancedMesh(box, hardware, 6)
  const bearings = new THREE.InstancedMesh(cylinder, hardware, bladeCount * 3)
  mounts.add(rails, bearings)
  group.add(mounts)
  const bayX = (y: number, fraction: number) =>
    halfWidthAt(y) * (-1 + (2 * (column + fraction)) / columns)
  for (let side = 0; side < 2; side += 1) {
    const ends = [bottomY + pitch * 0.25, topY - pitch * 0.25].map(
      (y) =>
        new THREE.Vector3(
          bayX(y, side) + (side ? -0.03 : 0.03),
          y,
          halfWidthAt(y) + standOff
        )
    )
    segment(rails, side, ends[0], ends[1], 0.016)
    ends.forEach((end, index) => {
      const wall = end.clone()
      wall.z = halfWidthAt(wall.y) + 0.008
      segment(rails, 2 + side * 2 + index, wall, end, 0.02)
    })
  }

  const pivots: THREE.Group[] = []
  const occluders: THREE.Object3D[] = []
  for (let blade = 0; blade < bladeCount; blade += 1) {
    const y = bottomY + (blade + 0.5) * pitch
    const width = (2 * halfWidthAt(y)) / columns - 0.08
    const pivot = new THREE.Group()
    pivot.name = `blade-pivot-${blade}`
    pivot.position.set(bayX(y, 0.5), y, halfWidthAt(y) + standOff)
    const surface = new THREE.Mesh(bladeGeometry, metal)
    surface.name = 'extruded-blade'
    surface.scale.x = width
    surface.castShadow = true
    surface.receiveShadow = true
    const proxy = new THREE.Mesh(proxyGeometry, proxyMaterial)
    proxy.name = 'irradiance-proxy'
    proxy.scale.x = width
    // Raycaster includes invisible meshes; the renderer and shadow map skip
    // them. Parenting to the pivot keeps the shadow envelope in the exact pose.
    proxy.visible = false
    pivot.add(surface, proxy)
    group.add(pivot)
    pivots.push(pivot)
    occluders.push(proxy)
    const left = pivot.position
      .clone()
      .add(new THREE.Vector3(-width / 2 - 0.02, 0, 0))
    const right = pivot.position
      .clone()
      .add(new THREE.Vector3(width / 2 + 0.02, 0, 0))
    segment(bearings, blade * 3, left, right, 0.003)
    segment(
      bearings,
      blade * 3 + 1,
      left,
      left.clone().add(new THREE.Vector3(0.02, 0, 0)),
      0.012
    )
    segment(
      bearings,
      blade * 3 + 2,
      right,
      right.clone().add(new THREE.Vector3(-0.02, 0, 0)),
      0.012
    )
  }

  const driven = pivots[1]
  const crankTips = pivots.map((pivot, index) => {
    const tip = new THREE.Vector3(
      halfWidthAt(pivot.position.y) / columns,
      0,
      pitch * 0.3
    )
    const crank = new THREE.Mesh(box, hardware)
    crank.name = index === 1 ? 'actuator-crank' : `blade-crank-${index}`
    crank.position.copy(tip).multiply(new THREE.Vector3(1, 1, 0.5))
    crank.scale.set(0.009, 0.014, tip.z)
    pivot.add(crank)
    return tip
  })
  const actuator = new THREE.InstancedMesh(cylinder, metal, 3)
  actuator.name = 'telescopic-actuator'
  group.add(actuator)
  const anchor = driven.position
    .clone()
    .add(new THREE.Vector3(crankTips[1].x, -pitch * 0.65, 0.025))
  group.userData.mechanics = {
    pivots,
    actuator,
    anchor,
    crankTips,
    tip: new THREE.Vector3(),
    tieStart: new THREE.Vector3(),
    tieEnd: new THREE.Vector3(),
  } satisfies Mechanics
  const assembly = { group, occluders, angle: 0, targetAngle: 0 }
  setLouvreAngle(assembly, 0)
  return assembly
}

export function setLouvreAngle(
  assembly: LouvreAssembly,
  angleDeg: number
): void {
  assembly.angle = THREE.MathUtils.clamp(
    Number.isFinite(angleDeg) ? angleDeg : 0,
    0,
    60
  )
  const radians = -THREE.MathUtils.degToRad(assembly.angle)
  const { pivots, actuator, anchor, crankTips, tip, tieStart, tieEnd } =
    assembly.group.userData.mechanics as Mechanics
  for (const pivot of pivots) pivot.rotation.x = radians
  tip.copy(crankTips[1]).applyAxisAngle(X_AXIS, radians).add(pivots[1].position)
  const middle = anchor.clone().lerp(tip, 0.6)
  segment(actuator, 0, anchor, middle, 0.01)
  segment(actuator, 1, anchor.clone().lerp(tip, 0.5), tip, 0.005)
  // Parallel cranks share one tie rod along the leaning bank.
  tieStart
    .copy(crankTips[0])
    .applyAxisAngle(X_AXIS, radians)
    .add(pivots[0].position)
  tieEnd
    .copy(crankTips[crankTips.length - 1])
    .applyAxisAngle(X_AXIS, radians)
    .add(pivots[pivots.length - 1].position)
  segment(actuator, 2, tieStart, tieEnd, 0.005)
  actuator.instanceMatrix.needsUpdate = true
  // The moving rod's bounds must follow its current extension for culling.
  actuator.computeBoundingSphere()
  assembly.group.updateWorldMatrix(true, true)
}
