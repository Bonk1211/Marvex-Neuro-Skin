'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Box, Sun } from 'lucide-react'
import type {
  FacadeHeat,
  FacadeOrientation,
  RoofSegment,
  TickPayload,
} from '@/lib/types'

/** Which surface the inspector is pointed at. Walls and roof faces share a key. */
export type SurfaceId =
  | `wall:${FacadeOrientation}`
  | `roof:${FacadeOrientation}`

// Sequential single-hue ramp, light to dark, for sol-air surface temperature.
// One hue only: a rainbow would read as categories where there is a magnitude.
const HEAT_RAMP = [
  '#fde3d5',
  '#fbc4a9',
  '#f8a37c',
  '#f28353',
  '#eb6834',
  '#c74e22',
  '#973714',
]
// Fixed domain so a wall's colour means the same thing at every tick. An
// unshaded tropical wall in light wind measures ~65 C; calm air pushes past the
// top of the ramp, so the high end clamps and the legend says so.
const TEMP_MIN = 24
const TEMP_MAX = 70

// Mirrors SOLAR_ABSORPTANCE and the ASHRAE film coefficient in
// backend/app/domain/facade.py. Keep the two in step.
const ABSORPTANCE = 0.6
const FILM_BASE = 5.7
const FILM_WIND = 3.8

// Massing reconstructed from the ST Diamond Building's published figures: seven
// floors, facades tilted 25 degrees, 14,230 m2 gross. Solving those together
// gives a ~34.6 m square at ground flaring to ~54.7 m at roof level over 3.6 m
// floors. Scene units are metres / 10. The plan is square with its faces on the
// cardinals, which is what makes "the north and south facades" meaningful.
const FLOOR_HEIGHT = 0.36
const BASE_HALF_WIDTH = 1.73
// Floor-line hairline. Wide enough to read as separate storeys, narrow enough
// that the structure behind does not become the dominant colour.
const PANEL_GAP = 0.012

// Square plan on the cardinals: the distance from the centre to a wall equals
// half that wall's length, so one number describes both.
const halfWidthAt = (y: number, tiltFromVertical: number) =>
  BASE_HALF_WIDTH + y * Math.tan(THREE.MathUtils.degToRad(tiltFromVertical))

const WALLS: Record<FacadeOrientation, number> = {
  north: Math.PI,
  east: Math.PI / 2,
  south: 0,
  west: -Math.PI / 2,
}

const ORIENTATIONS = Object.keys(WALLS) as FacadeOrientation[]

/**
 * One floor's slice of one wall, as a trapezoid leaning outward.
 *
 * Local frame: x runs along the wall, y is up, z points outward. The top edge
 * sits further out than the bottom, which is the overhang that shades the
 * floors below it.
 */
function wallPanel(halfBottom: number, halfTop: number, height: number) {
  const geometry = new THREE.BufferGeometry()
  const xb = halfBottom - PANEL_GAP
  const xt = halfTop - PANEL_GAP
  const yb = PANEL_GAP / 2
  const yt = height - PANEL_GAP / 2
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([
        -xb,
        yb,
        halfBottom,
        xb,
        yb,
        halfBottom,
        xt,
        yt,
        halfTop,
        -xt,
        yt,
        halfTop,
      ]),
      3
    )
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  return geometry
}

/**
 * One quadrant of the pitched roof: the two top-of-wall corners rising to a
 * central apex. Same local frame as a wall panel, so the same rotation places
 * it. At pitch 0 the apex sits level and the four faces form a flat roof.
 */
function roofPanel(halfTop: number, height: number, apexHeight: number) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([
        -halfTop,
        height,
        halfTop,
        halfTop,
        height,
        halfTop,
        0,
        apexHeight,
        0,
      ]),
      3
    )
  )
  geometry.computeVertexNormals()
  return geometry
}

const apexHeightFor = (halfTop: number, height: number, pitch: number) =>
  // Lifted a hair so a flat roof does not z-fight with the structure below it.
  height + 0.006 + halfTop * Math.tan(THREE.MathUtils.degToRad(pitch))

const rampColor = (() => {
  const stops = HEAT_RAMP.map((hex) => new THREE.Color(hex))
  const scratch = new THREE.Color()
  return (temperature: number) => {
    const t = THREE.MathUtils.clamp(
      (temperature - TEMP_MIN) / (TEMP_MAX - TEMP_MIN),
      0,
      1
    )
    const position = t * (stops.length - 1)
    const low = Math.floor(position)
    const high = Math.min(stops.length - 1, low + 1)
    return scratch.copy(stops[low]).lerp(stops[high], position - low)
  }
})()

/**
 * Sol-air temperature for one floor of one wall.
 *
 * Upper floors see more sky, lower floors catch more ground-reflected light.
 * Both scale factors average to 1 across the stack, so the wall as a whole
 * still carries the value the backend computed.
 */
function floorTemperature(
  wall: FacadeHeat,
  fraction: number,
  outdoorTemp: number,
  wind: number
) {
  const transmittance = wall.incident > 0 ? wall.transmitted / wall.incident : 1
  const direct = Math.max(
    0,
    wall.incident - wall.sky_diffuse - wall.ground_diffuse
  )
  const sky = wall.sky_diffuse * (0.6 + 0.8 * fraction)
  const ground = wall.ground_diffuse * (1.4 - 0.8 * fraction)
  const poa = transmittance * (direct + sky + ground)
  return (
    outdoorTemp +
    (ABSORPTANCE * poa) / (FILM_BASE + FILM_WIND * Math.max(0, wind))
  )
}

function labelSprite(text: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = '#898781'
    context.font = 'bold 72px system-ui, -apple-system, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, 64, 64)
  }
  const texture = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    })
  )
  sprite.scale.setScalar(0.5)
  return sprite
}

interface BuildingHeatmapProps {
  tick: TickPayload
  floors: number
  facadeTilt: number
  roofPitch: number
  timeLabel: string
  locationName: string
  selected: SurfaceId
  onSelect: (surface: SurfaceId) => void
}

export function BuildingHeatmap({
  tick,
  floors,
  facadeTilt,
  roofPitch,
  timeLabel,
  locationName,
  selected,
  onSelect,
}: BuildingHeatmapProps) {
  // pvlib surface tilt: 90 is a plain wall, 115 is the Diamond's 25 degree lean.
  const overhang = facadeTilt - 90
  const mountRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    panels: Map<FacadeOrientation, THREE.Mesh[]>
    roofFaces: Map<FacadeOrientation, THREE.Mesh>
    louvres: Map<FacadeOrientation, THREE.Group>
    outline: THREE.LineLoop
    roofOutline: THREE.LineLoop
    sunlight: THREE.DirectionalLight
    sunMarker: THREE.Mesh
  } | null>(null)
  const [supported, setSupported] = useState(true)
  // Kept in a ref so changing the handler never rebuilds the scene.
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const walls = useMemo(() => {
    const byOrientation = new Map<FacadeOrientation, FacadeHeat>()
    for (const wall of tick.facade ?? [])
      byOrientation.set(wall.orientation, wall)
    return byOrientation
  }, [tick])

  const roof = useMemo(() => {
    const byQuadrant = new Map<FacadeOrientation, RoofSegment>()
    for (const segment of tick.roof ?? [])
      byQuadrant.set(segment.quadrant, segment)
    return byQuadrant
  }, [tick])

  // Build the scene once. Ticks only repaint it.
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      // No WebGL (older browser, headless test runner). The table still carries the data.
      setSupported(false)
      return
    }

    const height = floors * FLOOR_HEIGHT
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      42,
      mount.clientWidth / Math.max(1, mount.clientHeight),
      0.1,
      100
    )
    // The building is wide and low, so stand back and look down on it.
    camera.position.set(9.5, height * 2.4, 9.5)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, height * 0.45, 0)
    controls.enableDamping = true
    controls.enablePan = false
    controls.minDistance = 7
    controls.maxDistance = 26
    controls.maxPolarAngle = Math.PI / 2 - 0.05
    controls.update()

    scene.add(new THREE.AmbientLight(0xffffff, 1.1))
    const sunlight = new THREE.DirectionalLight(0xfff2e0, 1.4)
    scene.add(sunlight)

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9, 64),
      new THREE.MeshBasicMaterial({
        color: 0x1a1a19,
        transparent: true,
        opacity: 0.14,
      })
    )
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)

    const grid = new THREE.PolarGridHelper(9, 8, 5, 64, 0x898781, 0x898781)
    const gridMaterial = grid.material as THREE.Material
    gridMaterial.opacity = 0.18
    gridMaterial.transparent = true
    scene.add(grid)

    // Structural core, lit so the massing reads as solid. The heat panels in
    // front of it stay unlit, so their colour is data rather than shading.
    // A four-sided frustum, turned so its faces land on the cardinals.
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(
        halfWidthAt(height, overhang) * Math.SQRT2 * 0.97,
        halfWidthAt(0, overhang) * Math.SQRT2 * 0.97,
        height,
        4
      ),
      new THREE.MeshStandardMaterial({ color: 0x9aa19d, roughness: 0.9 })
    )
    core.position.y = height / 2
    core.rotation.y = Math.PI / 4
    scene.add(core)

    const panels = new Map<FacadeOrientation, THREE.Mesh[]>()
    for (const orientation of ORIENTATIONS) {
      const stack: THREE.Mesh[] = []
      for (let floor = 0; floor < floors; floor += 1) {
        const base = floor * FLOOR_HEIGHT
        const panel = new THREE.Mesh(
          wallPanel(
            halfWidthAt(base, overhang),
            halfWidthAt(base + FLOOR_HEIGHT, overhang),
            FLOOR_HEIGHT
          ),
          new THREE.MeshBasicMaterial({
            color: 0xfde3d5,
            side: THREE.FrontSide,
          })
        )
        panel.position.y = base
        panel.rotation.y = WALLS[orientation]
        panel.userData.surface = `wall:${orientation}` satisfies SurfaceId
        scene.add(panel)
        stack.push(panel)
      }
      panels.set(orientation, stack)
    }

    // Segmented roof: one pitched face per quadrant, each with its own POA.
    const roofHalf = halfWidthAt(height, overhang)
    const apexHeight = apexHeightFor(roofHalf, height, roofPitch)
    const roofFaces = new Map<FacadeOrientation, THREE.Mesh>()
    for (const orientation of ORIENTATIONS) {
      const face = new THREE.Mesh(
        roofPanel(roofHalf - PANEL_GAP, height, apexHeight),
        new THREE.MeshBasicMaterial({
          color: 0xfde3d5,
          side: THREE.DoubleSide,
        })
      )
      face.rotation.y = WALLS[orientation]
      face.userData.surface = `roof:${orientation}` satisfies SurfaceId
      scene.add(face)
      roofFaces.set(orientation, face)
    }

    // Every wall carries its own louvres, driven by its own controller.
    const louvres = new Map<FacadeOrientation, THREE.Group>()
    const slatCount = floors * 3
    // Scene units are metres / 10, so these are 5 cm blades projecting 50 cm.
    // Sized against the real building: anything heavier hides the heat map the
    // blades are mounted on, which is the thing worth looking at.
    const slatGeometry = new THREE.BoxGeometry(1, 0.005, 0.05)
    const slatMaterial = new THREE.MeshStandardMaterial({
      color: 0x6f7b77,
      roughness: 0.35,
      metalness: 0.45,
    })
    for (const orientation of ORIENTATIONS) {
      const group = new THREE.Group()
      for (let slat = 0; slat < slatCount; slat += 1) {
        const mesh = new THREE.Mesh(slatGeometry, slatMaterial)
        // Follow the leaning facade: each slat stands off the wall it belongs to.
        const y = ((slat + 0.5) * height) / slatCount
        mesh.position.set(0, y, halfWidthAt(y, overhang) + 0.035)
        mesh.scale.x = 2 * halfWidthAt(y, overhang) - 0.12
        group.add(mesh)
      }
      group.rotation.y = WALLS[orientation]
      scene.add(group)
      louvres.set(orientation, group)
    }

    // Selection frame. The plan is square, so one outline serves every wall.
    const outlineGeometry = new THREE.BufferGeometry()
    const hb = halfWidthAt(0, overhang)
    const ht = halfWidthAt(height, overhang)
    outlineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          -hb,
          0.01,
          hb,
          hb,
          0.01,
          hb,
          ht,
          height,
          ht,
          -ht,
          height,
          ht,
        ]),
        3
      )
    )
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: 0x0b3128,
      depthTest: false,
    })
    const outline = new THREE.LineLoop(outlineGeometry, outlineMaterial)
    outline.renderOrder = 2
    scene.add(outline)

    const roofOutlineGeometry = new THREE.BufferGeometry()
    roofOutlineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          -roofHalf,
          height,
          roofHalf,
          roofHalf,
          height,
          roofHalf,
          0,
          apexHeight,
          0,
        ]),
        3
      )
    )
    const roofOutline = new THREE.LineLoop(roofOutlineGeometry, outlineMaterial)
    roofOutline.renderOrder = 2
    scene.add(roofOutline)

    // Click to select a surface, but never treat the end of an orbit drag as a click.
    const pickable = [...[...panels.values()].flat(), ...roofFaces.values()]
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let pressedAt: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent) => {
      pressedAt = { x: event.clientX, y: event.clientY }
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!pressedAt) return
      const travelled = Math.hypot(
        event.clientX - pressedAt.x,
        event.clientY - pressedAt.y
      )
      pressedAt = null
      if (travelled > 5) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(pickable, false)[0]
      const surface = hit?.object.userData.surface as SurfaceId | undefined
      if (surface) onSelectRef.current(surface)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    const sunMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xfab219 })
    )
    scene.add(sunMarker)

    const compass: Array<[string, number, number]> = [
      ['N', 0, -5.4],
      ['E', 5.4, 0],
      ['S', 0, 5.4],
      ['W', -5.4, 0],
    ]
    for (const [text, x, z] of compass) {
      const sprite = labelSprite(text)
      sprite.position.set(x, 0.25, z)
      scene.add(sprite)
    }

    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const observer = new ResizeObserver(() => {
      if (!mount.clientWidth || !mount.clientHeight) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    })
    observer.observe(mount)

    sceneRef.current = {
      renderer,
      scene,
      camera,
      controls,
      panels,
      roofFaces,
      louvres,
      outline,
      roofOutline,
      sunlight,
      sunMarker,
    }
    setSupported(true)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      controls.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          object.geometry?.dispose?.()
          const material = object.material
          if (Array.isArray(material))
            material.forEach((entry) => entry.dispose())
          else material?.dispose?.()
        }
      })
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      sceneRef.current = null
    }
  }, [floors, overhang, roofPitch])

  // Repaint for the selected tick.
  useEffect(() => {
    const context = sceneRef.current
    if (!context) return
    const height = floors * FLOOR_HEIGHT

    for (const orientation of ORIENTATIONS) {
      const wall = walls.get(orientation)
      const stack = context.panels.get(orientation)
      if (!stack) continue
      stack.forEach((panel, floor) => {
        const fraction = floors > 1 ? floor / (floors - 1) : 0.5
        const temperature = wall
          ? floorTemperature(wall, fraction, tick.outdoor_temp, tick.wind)
          : tick.outdoor_temp
        const material = panel.material as THREE.MeshBasicMaterial
        material.color.copy(rampColor(temperature))
      })
    }

    // Each wall's louvres sit at that wall's own angle.
    for (const orientation of ORIENTATIONS) {
      const group = context.louvres.get(orientation)
      const wall = walls.get(orientation)
      if (!group) continue
      group.visible = Boolean(wall)
      const angle = wall?.angle ?? 0
      group.children.forEach((slat) => {
        slat.rotation.x = THREE.MathUtils.degToRad(angle)
      })
    }
    // Roof faces carry raw plane-of-array gain: no louvres up there.
    for (const orientation of ORIENTATIONS) {
      const face = context.roofFaces.get(orientation)
      const segment = roof.get(orientation)
      if (!face) continue
      const material = face.material as THREE.MeshBasicMaterial
      material.color.copy(rampColor(segment?.sol_air_temp ?? tick.outdoor_temp))
    }

    const [kind, orientation] = selected.split(':') as [
      'wall' | 'roof',
      FacadeOrientation,
    ]
    context.outline.visible = kind === 'wall'
    context.roofOutline.visible = kind === 'roof'
    context.outline.rotation.y = WALLS[orientation]
    context.roofOutline.rotation.y = WALLS[orientation]

    const azimuth = THREE.MathUtils.degToRad(tick.solar_azimuth)
    const elevation = THREE.MathUtils.degToRad(
      Math.max(tick.solar_elevation, -5)
    )
    const radius = 11
    const sunPosition = new THREE.Vector3(
      radius * Math.cos(elevation) * Math.sin(azimuth),
      radius * Math.sin(elevation),
      -radius * Math.cos(elevation) * Math.cos(azimuth)
    )
    context.sunlight.position.copy(sunPosition)
    context.sunlight.intensity = tick.solar_elevation > 0 ? 1.4 : 0.2
    context.sunMarker.position.copy(sunPosition)
    context.sunMarker.visible = tick.solar_elevation > 0
    context.controls.target.set(0, height * 0.45, 0)
  }, [floors, roof, selected, tick, walls])

  return (
    <>
      {supported ? (
        <div
          ref={mountRef}
          className='absolute inset-0 cursor-grab active:cursor-grabbing'
          role='img'
          aria-label={`Three-dimensional model of the building with every wall shaded by its surface temperature at ${timeLabel}. The same values are listed in the wall readings table.`}
        />
      ) : (
        <p className='absolute inset-0 grid place-items-center p-6 text-center text-xs text-muted-foreground'>
          The 3D view needs WebGL. The wall readings carry the same data.
        </p>
      )}

      <div className='pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2'>
        <div className='stage-panel'>
          <p className='flex items-center gap-1.5 text-[11px] font-semibold'>
            <Box className='h-3.5 w-3.5 text-primary' />
            {locationName}
          </p>
          <div className='mt-2 flex items-center gap-2'>
            <span className='text-[9px] uppercase tracking-wider text-muted-foreground'>
              {TEMP_MIN}°
            </span>
            <span
              className='h-2 w-32 rounded-full'
              style={{
                backgroundImage: `linear-gradient(to right, ${HEAT_RAMP.join(', ')})`,
              }}
            />
            <span className='text-[9px] uppercase tracking-wider text-muted-foreground'>
              {TEMP_MAX}°C+
            </span>
          </div>
          <p className='mt-1 text-[9px] text-muted-foreground'>
            Sol-air surface temperature · drag to orbit · click any surface
          </p>
        </div>

        <div className='stage-panel flex flex-col items-end gap-1'>
          <span className='flex items-center gap-1.5 text-[10px] font-semibold'>
            <Sun className='h-3.5 w-3.5 text-amber-500' />
            {tick.solar_elevation > 0
              ? `Sun ${tick.solar_elevation.toFixed(0)}° · ${tick.solar_azimuth.toFixed(0)}°`
              : 'Sun below horizon'}
          </span>
          <span className='text-[9px] text-muted-foreground'>
            {overhang > 0
              ? `Facade tilted ${overhang.toFixed(0)}°`
              : 'Upright facade'}{' '}
            · louvres {tick.angle_final.toFixed(0)}°
          </span>
        </div>
      </div>
    </>
  )
}

/**
 * The stage's numbers as text, so the heat map is never colour-alone, and a
 * keyboard route to the same wall selection the 3D offers by clicking.
 */
export function FacadeReadout({
  tick,
  selected,
  onSelect,
}: {
  tick: TickPayload
  selected: SurfaceId
  onSelect: (surface: SurfaceId) => void
}) {
  const walls = new Map<FacadeOrientation, FacadeHeat>()
  for (const wall of tick.facade ?? []) walls.set(wall.orientation, wall)
  const roof = new Map<FacadeOrientation, RoofSegment>()
  for (const segment of tick.roof ?? []) roof.set(segment.quadrant, segment)

  const readout: Array<{
    id: SurfaceId
    label: string
    tag: string | null
    angle: string
    incident: number
    temperature: number
  }> = [
    ...ORIENTATIONS.map((orientation) => {
      const wall = walls.get(orientation)
      return {
        id: `wall:${orientation}` as SurfaceId,
        label: orientation,
        tag: wall?.primary ? 'primary' : null,
        angle: `${(wall?.angle ?? 0).toFixed(0)}°`,
        incident: wall?.incident ?? 0,
        temperature: wall
          ? floorTemperature(wall, 0.5, tick.outdoor_temp, tick.wind)
          : tick.outdoor_temp,
      }
    }),
    ...ORIENTATIONS.map((orientation) => {
      const segment = roof.get(orientation)
      return {
        id: `roof:${orientation}` as SurfaceId,
        label: `roof ${orientation}`,
        tag: null,
        // Roof pitch is fixed geometry, not a controlled angle.
        angle: segment ? `${segment.tilt.toFixed(0)}° pitch` : '—',
        incident: segment?.incident ?? 0,
        temperature: segment?.sol_air_temp ?? tick.outdoor_temp,
      }
    }),
  ]

  return (
    <section className='console-card' aria-label='Surface readings'>
      <p className='console-card-title'>Surface readings</p>
      <table className='mt-2 w-full text-left'>
        <caption className='sr-only'>
          Plane-of-array irradiance, angle and sol-air temperature per wall and
          roof face. Select a row to inspect that surface.
        </caption>
        <thead>
          <tr className='text-[9px] uppercase tracking-wider text-muted-foreground'>
            <th className='pb-1 font-semibold' scope='col'>
              Surface
            </th>
            <th className='pb-1 text-right font-semibold' scope='col'>
              Incident
            </th>
            <th className='pb-1 text-right font-semibold' scope='col'>
              Angle
            </th>
            <th className='pb-1 text-right font-semibold' scope='col'>
              Surface
            </th>
          </tr>
        </thead>
        <tbody className='font-mono text-xs'>
          {readout.map((surface) => (
            <tr
              key={surface.id}
              aria-selected={surface.id === selected}
              className={
                surface.id === selected
                  ? 'cursor-pointer border-t border-border/50 bg-secondary/60'
                  : 'cursor-pointer border-t border-border/50 hover:bg-secondary/30'
              }
              onClick={() => onSelect(surface.id)}
            >
              <th
                className='py-1 font-sans text-[11px] font-medium capitalize'
                scope='row'
              >
                <button
                  className='text-left'
                  type='button'
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelect(surface.id)
                  }}
                >
                  <span
                    aria-hidden
                    className='mr-1.5 inline-block h-2 w-2 rounded-full align-middle'
                    style={{
                      backgroundColor: `#${rampColor(surface.temperature).getHexString()}`,
                    }}
                  />
                  {surface.label}
                  {surface.tag && (
                    <span className='ml-1.5 text-[9px] uppercase tracking-wider text-primary'>
                      {surface.tag}
                    </span>
                  )}
                </button>
              </th>
              <td className='py-1 text-right tabular-nums'>
                {surface.incident.toFixed(0)} W/m²
              </td>
              <td className='whitespace-nowrap py-1 text-right tabular-nums'>
                {surface.angle}
              </td>
              <td className='py-1 text-right tabular-nums'>
                {surface.temperature.toFixed(1)} °C
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
