import * as THREE from 'three'
import type { LouvreAssembly } from './louvreAssembly'

/** Selected facade's parallel sun rays, intercepted by the actual blade poses. */
export function createFacadeSunlight() {
  const group = new THREE.Group()
  group.name = 'Incoming sunlight and reflected paths'
  const rays = Array.from({ length: 4 }, () => {
    const incoming = new THREE.ArrowHelper(undefined, undefined, 1, 0xffad16)
    const reflected = new THREE.ArrowHelper(undefined, undefined, 1, 0x00c9d7)
    group.add(incoming, reflected)
    return { incoming, reflected }
  })
  const caster = new THREE.Raycaster()
  const origin = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3()
  const point = new THREE.Vector3()
  const incomingDirection = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const outgoing = new THREE.Vector3()
  return {
    group,
    update(
      sun: THREE.Vector3,
      assemblies: LouvreAssembly[],
      passive: THREE.Object3D[]
    ) {
      const blades = assemblies.flatMap((assembly) => assembly.occluders)
      const blockers = [...passive, ...blades]
      blockers.forEach((object) => object.updateWorldMatrix(true, false))
      incomingDirection.copy(sun).normalize().negate()
      // The same four bays as the physical rig: W9/W10/W13/W14 on the west wall.
      rays.forEach(({ incoming, reflected }, index) => {
        incoming.visible = reflected.visible = false
        const assembly = assemblies[[8, 9, 12, 13][index]]
        if (!assembly || !assembly.group.visible || sun.y <= 0) return
        const proxy = assembly.occluders[1]
        normal.set(0, 0, 1).transformDirection(assembly.group.matrixWorld)
        if (normal.dot(sun) <= 0) return
        proxy.getWorldPosition(point)
        origin.copy(point).addScaledVector(sun, 5)
        caster.set(origin, incomingDirection)
        caster.far = 5.5
        const hit = caster.intersectObjects(blockers, false)[0]
        if (!hit) return
        incoming.visible = true
        incoming.position.copy(origin)
        incoming.setDirection(incomingDirection)
        incoming.setLength(hit.distance, 0.16, 0.09)
        if (!blades.includes(hit.object) || !hit.face) return
        normalMatrix.getNormalMatrix(hit.object.matrixWorld)
        normal.copy(hit.face.normal).applyNormalMatrix(normalMatrix)
        outgoing.copy(incomingDirection).reflect(normal).normalize()
        origin.copy(hit.point).addScaledVector(outgoing, 0.002)
        caster.set(origin, outgoing)
        caster.far = 3
        const stop = caster.intersectObjects(blockers, false)[0]
        const length = stop?.distance ?? 3
        if (length <= 0.01) return
        reflected.visible = true
        reflected.position.copy(origin)
        reflected.setDirection(outgoing)
        reflected.setLength(length, Math.min(0.16, length / 3), 0.09)
      })
    },
  }
}
