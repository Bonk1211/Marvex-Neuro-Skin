import * as THREE from 'three'

/** Rounded cloud volumes, with the camera mask retained for projected shadows. */
export function createCloudCanopy(height: number) {
  const size = 11
  const width = 128
  const rows = 72
  const pixels = new Uint8Array(width * rows * 4)
  const texture = new THREE.DataTexture(pixels, width, rows, THREE.RGBAFormat)
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    colorWrite: false,
    alphaTest: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 1,
  })
  const mesh = new THREE.Group()
  mesh.name = 'AI cloud canopy'
  mesh.position.y = height
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material)
  shadow.rotation.x = -Math.PI / 2
  shadow.castShadow = true
  shadow.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: texture,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  })
  mesh.add(shadow)
  // Five overlapping ellipsoids per cluster read as cumulus rather than a sheet.
  // One instanced draw keeps this lightweight alongside the facade mechanisms.
  const puffs = [
    [0, 0.25, 0, 1.1, 0.65, 0.85],
    [-0.7, 0.12, 0.05, 0.8, 0.45, 0.65],
    [0.7, 0.15, -0.05, 0.85, 0.48, 0.7],
    [-0.15, 0.65, -0.1, 0.75, 0.6, 0.65],
    [0.1, 0.18, 0.55, 0.8, 0.4, 0.65],
  ]
  const clouds = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xe7edf5,
      roughness: 1,
      envMapIntensity: 0.25,
    }),
    4 * 3 * puffs.length
  )
  clouds.name = 'Cloud volume'
  clouds.count = 0
  mesh.add(clouds)
  const puff = new THREE.Object3D()
  // ponytail: mask placement, canopy height and drift illustrate shading;
  // calibrate camera pose/cloud altitude before claiming measured shadow locations.
  const pattern = Array.from({ length: width * rows }, (_, index) => {
    const x = (index % width) / width
    const y = Math.floor(index / width) / rows
    return (
      Math.sin(x * 17 + Math.sin(y * 9)) +
      Math.cos(y * 13 + x * 5) +
      0.45 * Math.sin(x * 35 - y * 23)
    )
  })
  const ordered = [...pattern].sort((a, b) => b - a)

  function update(cover: number, mask?: number[][] | null) {
    const coverage = Number.isFinite(cover)
      ? THREE.MathUtils.clamp(cover, 0, 1)
      : 0
    const threshold =
      ordered[
        Math.min(ordered.length - 1, Math.floor(coverage * ordered.length))
      ]
    const usable =
      mask?.length &&
      mask[0]?.length &&
      mask.every((row) => row.length === mask[0].length)
    for (let index = 0; index < pattern.length; index++) {
      const x = index % width
      const y = Math.floor(index / width)
      const value = usable
        ? mask[Math.min(mask.length - 1, Math.floor((y / rows) * mask.length))][
            Math.min(
              mask[0].length - 1,
              Math.floor((x / width) * mask[0].length)
            )
          ]
        : coverage === 0
          ? 0
          : coverage === 1 || pattern[index] > threshold
            ? 1
            : 0
      pixels.set([255, 255, 255, value ? 255 : 0], index * 4)
    }
    mesh.visible = coverage > 0
    texture.needsUpdate = true
    clouds.count = 0
    if (!mesh.visible) return
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 4; column++) {
        let covered = 0
        for (let y = row * 24; y < (row + 1) * 24; y++)
          for (let x = column * 32; x < (column + 1) * 32; x++)
            covered += pixels[(y * width + x) * 4 + 3] / 255
        const density = covered / (24 * 32)
        if (density < 0.06) continue
        const scale = Math.sqrt(density)
        for (const [x, y, z, sx, sy, sz] of puffs) {
          puff.position.set(
            ((column + 0.5) / 4 - 0.5) * size + x * scale,
            y * scale,
            (0.5 - (row + 0.5) / 3) * size + z * scale
          )
          puff.scale.set(sx * scale, sy * scale, sz * scale)
          puff.updateMatrix()
          clouds.setMatrixAt(clouds.count++, puff.matrix)
        }
      }
    }
    clouds.instanceMatrix.needsUpdate = true
    clouds.computeBoundingSphere()
  }

  function transmission(x: number, y: number, z: number, sun: THREE.Vector3) {
    if (!mesh.visible || sun.y <= 0 || y >= height) return 1
    const distance = (height - y) / sun.y
    const u = 0.5 + (x + distance * sun.x - mesh.position.x) / size
    const v = 0.5 - (z + distance * sun.z - mesh.position.z) / size
    if (u < 0 || u > 1 || v < 0 || v > 1) return 1
    const column = Math.min(width - 1, Math.floor(u * width))
    const row = Math.min(rows - 1, Math.floor(v * rows))
    return 1 - pixels[(row * width + column) * 4 + 3] / 255
  }

  return {
    mesh,
    update,
    transmission,
    dispose: () => {
      texture.dispose()
      shadow.customDepthMaterial?.dispose()
    },
  }
}
