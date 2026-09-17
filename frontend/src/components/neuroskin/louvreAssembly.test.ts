import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createLouvreAssembly, setLouvreAngle } from './louvreAssembly'

const options = {
  bottomY: 0,
  topY: 0.56,
  halfWidthAt: () => 2,
  column: 1,
  columns: 4,
}

describe('louvre assembly', () => {
  it('clamps the blade angle, leaves mounts fixed, and moves its crank and rod', () => {
    const assembly = createLouvreAssembly(options)
    const mounts = assembly.group.getObjectByName('static-mounts')!
    const before = mounts.matrixWorld.clone()
    const blade = assembly.group.getObjectByName('blade-pivot-1')!
    const crank = assembly.group.getObjectByName('actuator-crank')!
    const actuator = assembly.group.getObjectByName(
      'telescopic-actuator'
    ) as THREE.InstancedMesh
    const crankBefore = crank.matrixWorld.clone()
    const rodBefore = new THREE.Matrix4()
    actuator.getMatrixAt(1, rodBefore)
    assembly.targetAngle = 45
    setLouvreAngle(assembly, 90)
    expect(assembly.angle).toBe(60)
    expect(assembly.targetAngle).toBe(45)
    expect(blade.rotation.x).toBeCloseTo(-Math.PI / 3)
    expect(mounts.matrixWorld.equals(before)).toBe(true)
    expect(crank.matrixWorld.equals(crankBefore)).toBe(false)
    const rodAfter = new THREE.Matrix4()
    actuator.getMatrixAt(1, rodAfter)
    expect(rodAfter.equals(rodBefore)).toBe(false)
    for (const invalid of [-10, NaN, Infinity]) {
      setLouvreAngle(assembly, invalid)
      expect(assembly.angle).toBe(0)
      expect(blade.rotation.x).toBeCloseTo(0)
    }
  })

  it('shares extrusion resources and keeps invisible proxies in the blade pose', () => {
    const assembly = createLouvreAssembly(options)
    const scene = new THREE.Group()
    scene.position.set(2, 1, -1)
    scene.add(assembly.group)
    assembly.group.rotation.y = Math.PI / 2
    setLouvreAngle(assembly, 35)
    expect(assembly.occluders).toHaveLength(2)
    let geometry: THREE.BufferGeometry | undefined
    for (const object of assembly.occluders) {
      const proxy = object as THREE.Mesh
      const blade = proxy.parent!.getObjectByName(
        'extruded-blade'
      ) as THREE.Mesh
      expect(proxy.visible).toBe(false)
      expect(proxy.matrixWorld.equals(blade.matrixWorld)).toBe(true)
      // Double the old four-blade chord; the shadow envelope grows with the mesh.
      blade.geometry.computeBoundingBox()
      proxy.geometry.computeBoundingBox()
      const depth = (options.topY - options.bottomY) * 0.525
      for (const shape of [blade.geometry, proxy.geometry]) {
        expect(shape.boundingBox!.max.z - shape.boundingBox!.min.z).toBeCloseTo(
          depth
        )
      }
      if (geometry) expect(blade.geometry).toBe(geometry)
      geometry = blade.geometry
    }
  })

  it('casts substantially more low-sun facade shadow when closed', () => {
    const assembly = createLouvreAssembly(options)
    const ray = new THREE.Raycaster()
    const sun = new THREE.Vector3(0, 0.15, 1).normalize()
    const shadowCount = () => {
      let count = 0
      for (let step = 0; step < 100; step += 1) {
        ray.set(new THREE.Vector3(-0.5, (step + 0.5) * 0.0056, 2.002), sun)
        if (ray.intersectObjects(assembly.occluders, false).length) count += 1
      }
      return count
    }
    const open = shadowCount()
    setLouvreAngle(assembly, 60)
    const closed = shadowCount()
    expect(closed).toBeGreaterThan(open + 40)
  })

  it('clears the leaning facade throughout the full blade sweep', () => {
    for (const tilt of [0, 25, 45]) {
      const halfWidthAt = (y: number) =>
        2 + y * Math.tan(THREE.MathUtils.degToRad(tilt))
      const assembly = createLouvreAssembly({ ...options, halfWidthAt })
      for (let angle = 0; angle <= 60; angle += 5) {
        setLouvreAngle(assembly, angle)
        const actuator = assembly.group.getObjectByName(
          'telescopic-actuator'
        ) as THREE.InstancedMesh
        const tieMatrix = new THREE.Matrix4()
        actuator.getMatrixAt(2, tieMatrix)
        tieMatrix.premultiply(actuator.matrixWorld)
        const tie = new THREE.Line3(
          new THREE.Vector3(0, -0.5, 0).applyMatrix4(tieMatrix),
          new THREE.Vector3(0, 0.5, 0).applyMatrix4(tieMatrix)
        )
        const jointGaps = [0, 1].map((index) => {
          const crank = assembly.group.getObjectByName(
            index === 1 ? 'actuator-crank' : `blade-crank-${index}`
          )!
          const joint = crank.localToWorld(new THREE.Vector3(0, 0, 0.5))
          return tie
            .closestPointToPoint(joint, true, new THREE.Vector3())
            .distanceTo(joint)
        })
        expect(Math.max(...jointGaps)).toBeLessThan(1e-6)
        for (const object of assembly.occluders) {
          const proxy = object as THREE.Mesh
          const position = proxy.geometry.getAttribute('position')
          for (let vertex = 0; vertex < position.count; vertex += 1) {
            const point = new THREE.Vector3()
              .fromBufferAttribute(position, vertex)
              .applyMatrix4(proxy.matrixWorld)
            expect(point.z - halfWidthAt(point.y)).toBeGreaterThan(0.02)
            // Independent neighbouring rows must not collide during their sweeps.
            expect(point.y).toBeGreaterThan(options.bottomY)
            expect(point.y).toBeLessThan(options.topY)
          }
        }
      }
    }
  })
})
