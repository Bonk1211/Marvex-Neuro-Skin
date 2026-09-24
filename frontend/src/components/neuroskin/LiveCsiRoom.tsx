'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { LiveCsiReading } from '@/lib/api-client'

function roomSignal(reading: LiveCsiReading | null | undefined) {
  const receiving = !!(
    reading?.enabled &&
    reading.frames > 0 &&
    reading.state !== 'offline' &&
    reading.state !== 'unavailable'
  )
  const classified =
    receiving && (reading?.state === 'motion' || reading?.state === 'quiet')
  const ratio =
    classified && reading?.threshold && reading.sigma != null
      ? reading.sigma / reading.threshold
      : null
  return { receiving, ratio, motion: classified && reading?.state === 'motion' }
}

/** A schematic room. The bridge supplies a link measurement, never x/y positions. */
export function createLiveCsiRoom() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#07151e')
  scene.add(new THREE.HemisphereLight(0xaffff1, 0x091324, 2))
  const light = new THREE.DirectionalLight(0x75dcff, 2)
  light.position.set(2, 7, 5)
  scene.add(light)

  const cube = new THREE.BoxGeometry(1, 1, 1)
  const edges = new THREE.EdgesGeometry(cube)
  const outline = new THREE.LineBasicMaterial({
    color: '#387982',
    transparent: true,
    opacity: 0.65,
  })
  const furniture = new THREE.MeshStandardMaterial({
    color: '#122c39',
    roughness: 0.8,
    metalness: 0.2,
  })
  const glass = new THREE.MeshBasicMaterial({
    color: '#3da7ac',
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
  })
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: '#0b202a',
    roughness: 0.9,
  })
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material = furniture
  ) => {
    const mesh = new THREE.Mesh(cube, material)
    mesh.scale.set(w, h, d)
    mesh.position.set(x, y, z)
    mesh.add(new THREE.LineSegments(edges, outline))
    scene.add(mesh)
    return mesh
  }
  box(8, 0.16, 6, 0, -0.08, 0, floorMaterial)
  box(8, 2.8, 0.04, 0, 1.4, -3, glass)
  box(0.04, 2.8, 6, -4, 1.4, 0, glass)
  const frame = new THREE.LineSegments(edges, outline)
  frame.scale.set(8, 2.8, 6)
  frame.position.y = 1.4
  scene.add(frame)
  const grid = new THREE.GridHelper(8, 16, '#24565d', '#173740')
  grid.scale.z = 0.75
  grid.position.y = 0.015
  scene.add(grid)

  // Fixed props establish room scale; none are inferred from CSI.
  box(2.1, 0.1, 0.95, -2.3, 0.8, -1.9) // desk
  for (const x of [-3.15, -1.45]) box(0.08, 0.75, 0.7, x, 0.38, -1.9)
  box(0.85, 0.48, 0.06, -2.3, 1.12, -2.12) // monitor
  box(0.08, 0.15, 0.1, -2.3, 0.85, -2.12)
  box(0.6, 0.12, 0.6, -2.3, 0.5, -0.85) // chair
  box(0.6, 0.6, 0.08, -2.3, 0.76, -0.55)
  box(0.08, 0.45, 0.08, -2.3, 0.23, -0.85)
  box(2.25, 0.45, 0.95, 1.3, 0.3, -2.15) // sofa
  box(2.25, 0.8, 0.18, 1.3, 0.6, -2.58)
  for (const x of [0.1, 2.5]) box(0.2, 0.65, 0.95, x, 0.45, -2.15)
  box(1.6, 0.08, 0.8, 1.25, 0.5, -0.65) // low table
  for (const x of [0.6, 1.9]) box(0.07, 0.45, 0.6, x, 0.23, -0.65)
  for (const y of [0.2, 0.75, 1.3]) box(0.5, 0.06, 1.15, -3.65, y, 0.05)

  const anchors = [
    new THREE.Vector3(-3, 1.15, 1.8),
    new THREE.Vector3(3, 1.15, 1.2),
  ]
  for (const [index, anchor] of anchors.entries()) {
    box(0.46, 0.95, 0.46, anchor.x, 0.48, anchor.z)
    const device = new THREE.Mesh(
      cube,
      new THREE.MeshBasicMaterial({ color: index ? '#5de6df' : '#ba9cff' })
    )
    device.scale.set(index ? 0.32 : 0.2, index ? 0.1 : 0.32, 0.09)
    device.position.copy(anchor)
    scene.add(device)
  }
  const link = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(anchors),
    new THREE.LineDashedMaterial({
      color: '#5de6df',
      dashSize: 0.12,
      gapSize: 0.12,
      transparent: true,
      opacity: 0.2,
    })
  )
  link.computeLineDistances()
  scene.add(link)

  // ponytail: one link cannot locate motion. Use one uniform room tint; spatial
  // heatmaps need a measured position/zone model before replacing this layer.
  const activity = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 6),
    new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  )
  activity.name = 'room-activity'
  activity.rotation.x = -Math.PI / 2
  activity.position.y = 0.03
  scene.add(activity)

  const waves = new THREE.Group()
  waves.name = 'signal-waves'
  const ring = new THREE.RingGeometry(0.985, 1, 96)
  const clippingPlanes = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), 4),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), 4),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 3),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), 3),
  ]
  const rings = Array.from({ length: 5 }, () => {
    const wave = new THREE.Mesh(
      ring,
      new THREE.MeshBasicMaterial({
        color: '#5de6df',
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        clippingPlanes,
        blending: THREE.AdditiveBlending,
      })
    )
    wave.rotation.x = -Math.PI / 2
    wave.position.set(anchors[0].x, 0.06, anchors[0].z)
    waves.add(wave)
    return wave
  })
  scene.add(waves)

  const update = (
    reading: LiveCsiReading | null | undefined,
    seconds: number
  ) => {
    const { receiving, ratio, motion } = roomSignal(reading)
    const color = motion ? '#ffb65b' : '#5de6df'
    waves.visible = receiving
    activity.visible = ratio != null
    activity.material.color.set(color)
    activity.material.opacity =
      ratio == null ? 0 : 0.02 + Math.min(ratio, 2) * 0.09
    link.material.color.set(color)
    link.material.opacity = receiving ? 0.6 : 0.15
    for (const [index, wave] of rings.entries()) {
      const phase = (seconds / 4 + index / rings.length) % 1
      wave.scale.setScalar(0.15 + phase * 8)
      wave.material.color.set(color)
      wave.material.opacity = (1 - phase) * (motion ? 0.65 : 0.3)
    }
  }
  update(null, 0)

  return {
    scene,
    anchors,
    update,
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          geometries.add(object.geometry)
          for (const material of [object.material].flat())
            materials.add(material)
        }
      })
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
      scene.clear()
    },
  }
}

export function LiveCsiRoom({
  reading,
}: {
  reading: LiveCsiReading | null | undefined
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const txLabelRef = useRef<HTMLSpanElement>(null)
  const rxLabelRef = useRef<HTMLSpanElement>(null)
  const runtime = useRef<{
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
  } | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [paused, setPaused] = useState(false)
  const current = useRef({ reading, paused })
  current.current = { reading, paused }
  const { receiving, motion, ratio } = roomSignal(reading)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    setPaused(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    if (!window.WebGLRenderingContext && !window.WebGL2RenderingContext) {
      setUnavailable(true)
      return
    }
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      setUnavailable(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.localClippingEnabled = true
    renderer.domElement.setAttribute('aria-hidden', 'true')
    mount.appendChild(renderer.domElement)
    const room = createLiveCsiRoom()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.set(10, 8, 10)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0.7, 0)
    controls.enableDamping = true
    controls.enablePan = false
    controls.minDistance = 8
    controls.maxDistance = 25
    controls.maxPolarAngle = Math.PI / 2 - 0.06
    runtime.current = { camera, controls }
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = mount
      if (!width || !height) return
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.zoom = Math.min(1, camera.aspect)
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    let frame = 0
    let seconds = 0
    let previous = performance.now()
    const projected = new THREE.Vector3()
    const render = (now: number) => {
      frame = requestAnimationFrame(render)
      const state = current.current
      if (!state.paused && roomSignal(state.reading).receiving) {
        seconds += Math.min((now - previous) / 1000, 0.1)
      }
      previous = now
      room.update(state.reading, seconds)
      controls.update()
      renderer.render(room.scene, camera)
      for (const [index, label] of [
        txLabelRef.current,
        rxLabelRef.current,
      ].entries()) {
        if (!label) continue
        projected.copy(room.anchors[index])
        projected.y += 0.4
        projected.project(camera)
        label.style.transform = `translate(${((projected.x + 1) * mount.clientWidth) / 2}px, ${((1 - projected.y) * mount.clientHeight) / 2}px) translate(-50%, -100%)`
      }
    }
    render(previous)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      room.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      runtime.current = null
    }
  }, [])

  const cameraView = (top: boolean) => {
    const view = runtime.current
    if (!view) return
    view.controls.target.set(0, 0.7, 0)
    view.camera.position.set(top ? 0 : 10, top ? 15 : 8, top ? 0.01 : 10)
    view.controls.update()
  }

  return (
    <figure className='overflow-hidden rounded-2xl border border-[#28444d] bg-[#07151e] text-slate-200'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3'>
        <div>
          <h3 className='text-xs font-semibold tracking-[0.15em] text-cyan-100'>
            ROOM OBSERVATORY
          </h3>
          <p className='mt-1 text-[10px] text-slate-400'>
            Illustrative layout · one Wi-Fi link
          </p>
        </div>
        <div className='flex gap-1 text-[11px] [&>button:disabled]:opacity-40 [&>button:hover]:bg-white/10 [&>button]:rounded-md [&>button]:border [&>button]:border-white/15 [&>button]:px-2.5 [&>button]:py-1.5 [&>button]:transition-colors'>
          <button
            type='button'
            disabled={unavailable}
            onClick={() => cameraView(false)}
          >
            3D view
          </button>
          <button
            type='button'
            disabled={unavailable}
            onClick={() => cameraView(true)}
          >
            Top view
          </button>
          <button
            type='button'
            disabled={unavailable}
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
          >
            {paused ? 'Resume waves' : 'Pause waves'}
          </button>
        </div>
      </div>
      <div
        className='relative h-[380px] sm:h-[440px]'
        role='img'
        aria-label={`Illustrative 3D room with a phone hotspot and one ESP32. ${motion ? 'Measured signal motion lights the entire room amber.' : receiving ? 'Receiving live CSI.' : 'No live CSI; signal waves are hidden.'} Room geometry and device positions are not measured.`}
      >
        <div ref={mountRef} className='absolute inset-0' />
        {!unavailable && (
          <div
            className='pointer-events-none absolute inset-0 overflow-hidden'
            aria-hidden='true'
          >
            <span
              ref={txLabelRef}
              className='absolute left-0 top-0 whitespace-nowrap rounded border border-violet-300/30 bg-[#111d2d]/90 px-2 py-1 font-mono text-[10px] text-violet-200'
            >
              TX · Phone / AP
            </span>
            <span
              ref={rxLabelRef}
              className='absolute left-0 top-0 whitespace-nowrap rounded border border-cyan-300/30 bg-[#0b242c]/90 px-2 py-1 font-mono text-[10px] text-cyan-200'
            >
              RX · ESP32
            </span>
          </div>
        )}
        {unavailable ? (
          <p className='absolute inset-0 grid place-items-center px-8 text-center text-sm text-slate-400'>
            3D room requires WebGL. Live measurements remain available below.
          </p>
        ) : (
          <p className='pointer-events-none absolute left-4 top-4 text-[10px] text-slate-400'>
            Drag to orbit · scroll to zoom
          </p>
        )}
        <div className='pointer-events-none absolute bottom-4 left-4 rounded-lg border border-white/10 bg-[#07151e]/90 px-3 py-2'>
          <p className='text-[9px] uppercase tracking-widest text-slate-400'>
            Whole-link activity
          </p>
          <p
            className={`mt-1 font-mono text-sm ${motion ? 'text-amber-300' : 'text-cyan-200'}`}
          >
            {ratio != null
              ? `${ratio.toFixed(2)}× motion threshold`
              : receiving
                ? 'Collecting channel data'
                : 'Waiting for live CSI'}
          </p>
        </div>
      </div>
      <figcaption className='border-t border-white/10 px-4 py-3 text-[11px] leading-5 text-slate-400'>
        Room glow — <span className='text-cyan-200'>cyan: below threshold</span>{' '}
        · <span className='text-amber-300'>Amber: signal motion</span>. Waves
        illustrate the link; room glow uses measured CSI variation. The room,
        furniture and device locations are a schematic, not a scan. This stream
        cannot locate people or reconstruct poses.
      </figcaption>
    </figure>
  )
}
