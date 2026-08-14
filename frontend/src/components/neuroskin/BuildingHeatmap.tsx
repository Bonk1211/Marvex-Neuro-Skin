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
// Every facade is a 4 x 4 grid of zones, N1..N16 by row from the bottom. Each
// zone is its own mesh with its own material, so it can be hovered, selected
// and shaded on its own.
const PANEL_ROWS = 4
const PANEL_COLUMNS = 4

// Massing proportions, as fractions of overall height or of the roof-level half
// width. Taken from the reference model: a 1.0 podium under an 8.5 facade, a
// roof slab oversailing by 0.9 and stepping in to a 5.0 crown deck, carrying a
// 4.2 wide diamond skylight.
const PODIUM_FRACTION = 1.0 / 9.5
const ROOF_OVERHANG = 0.9 / 15.5
const ROOF_DECK_RATIO = 5.0 / 15.5
const CROWN_RATIO = 4.2 / 15.5
const CROWN_HEIGHT_FRACTION = 1.0 / 9.5

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
 * A leaning trapezoid on one wall: the shared shape of a facade zone and of a
 * roof quadrant.
 *
 * Local frame: x runs along the wall, y is up, z points outward. The top edge
 * sits further out than the bottom, which is the overhang that shades whatever
 * is below it. Rotating about y drops the same shape on any cardinal wall.
 */
export function slopedPanel(
  halfBottom: number,
  halfTop: number,
  bottomY: number,
  topY: number,
  column = 0,
  columns = 1
) {
  const geometry = new THREE.BufferGeometry()
  const bay = (half: number, index: number) =>
    -half + (index / columns) * 2 * half
  const gap = columns > 1 ? PANEL_GAP : 0
  const xb0 = bay(halfBottom, column) + gap
  const xb1 = bay(halfBottom, column + 1) - gap
  const xt0 = bay(halfTop, column) + gap
  const xt1 = bay(halfTop, column + 1) - gap
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([
        xb0,
        bottomY,
        halfBottom,
        xb1,
        bottomY,
        halfBottom,
        xt1,
        topY,
        halfTop,
        xt0,
        topY,
        halfTop,
      ]),
      3
    )
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  return geometry
}

/** The same quad as an outline: LineLoop follows the index, so drop it. */
function frameGeometry(panel: THREE.BufferGeometry) {
  const frame = panel.clone()
  frame.setIndex(null)
  return frame
}

// Roof slab: it oversails the walls, then steps in to the crown deck. The rise
// over that step is what the pitch controls, so the four quadrant faces stay
// the sloping surfaces the backend computes a plane-of-array for.
const roofDeckHeightFor = (
  halfBottom: number,
  halfTop: number,
  height: number,
  pitch: number
) =>
  // Lifted a hair so a flat roof does not z-fight with the structure below it.
  height +
  0.006 +
  (halfBottom - halfTop) * Math.tan(THREE.MathUtils.degToRad(pitch))

// Where the sun sits on the scene's dome. Azimuth is measured from north through
// east, matching the backend, so -cos puts north at -z where the compass says.
const SUN_RADIUS = 11

function sunAt(azimuth: number, elevation: number) {
  const a = THREE.MathUtils.degToRad(azimuth)
  const e = THREE.MathUtils.degToRad(elevation)
  return new THREE.Vector3(
    SUN_RADIUS * Math.cos(e) * Math.sin(a),
    SUN_RADIUS * Math.sin(e),
    -SUN_RADIUS * Math.cos(e) * Math.cos(a)
  )
}

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

/** One zone's own readings, pinned to that zone in the 3D view. */
function ZoneBubble({
  wall,
  zone,
}: {
  wall: FacadeHeat | undefined
  zone: { id: string; orientation: FacadeOrientation; index: number }
}) {
  const reading = wall?.zones?.[zone.index]
  return (
    <div className='stage-panel w-48'>
      <p className='flex items-baseline justify-between gap-2'>
        <span className='text-[11px] font-semibold capitalize'>
          {zone.orientation} · {zone.id}
        </span>
        <span className='text-[9px] uppercase tracking-wider text-muted-foreground'>
          {reading
            ? `row ${reading.row + 1} · bay ${reading.column + 1}`
            : `zone ${zone.index + 1}`}
        </span>
      </p>
      {reading ? (
        <dl className='mt-1.5 space-y-0.5 font-mono text-[10px]'>
          <div className='flex justify-between gap-2'>
            <dt className='text-muted-foreground'>Incident</dt>
            <dd className='tabular-nums'>{reading.incident.toFixed(0)} W/m²</dd>
          </div>
          <div className='flex justify-between gap-2'>
            <dt className='text-muted-foreground'>Through louvres</dt>
            <dd className='tabular-nums'>
              {reading.transmitted.toFixed(0)} W/m²
            </dd>
          </div>
          <div className='flex justify-between gap-2'>
            <dt className='text-muted-foreground'>Surface</dt>
            <dd className='tabular-nums'>
              {reading.sol_air_temp.toFixed(1)} °C
            </dd>
          </div>
          <div className='flex justify-between gap-2'>
            <dt className='text-muted-foreground'>Sunlit</dt>
            <dd className='tabular-nums'>
              {(reading.sunlit_fraction * 100).toFixed(0)}%
            </dd>
          </div>
          <div className='flex justify-between gap-2 border-t border-border/50 pt-0.5'>
            <dt className='text-muted-foreground'>Louvres</dt>
            <dd className='tabular-nums'>
              {reading.angle.toFixed(0)}° · {reading.mode.toLowerCase()}
            </dd>
          </div>
          <div className='flex justify-between gap-2'>
            <dt className='text-muted-foreground'>Daylight</dt>
            <dd className='tabular-nums'>{reading.lux.toFixed(0)} lx</dd>
          </div>
          <div className='flex justify-between gap-2'>
            <dt className='text-muted-foreground'>Load</dt>
            <dd className='tabular-nums'>
              {(reading.load_relative * 100).toFixed(0)}%
            </dd>
          </div>
        </dl>
      ) : (
        <p className='mt-1.5 text-[10px] text-muted-foreground'>
          No reading for this zone at this tick.
        </p>
      )}
      {wall && wall.sunlit === false && (
        <p className='mt-1.5 text-[9px] leading-snug text-muted-foreground'>
          Sun is behind this facade — the {wall.aoi?.toFixed(0)}° angle of
          incidence means the lean shades it and only diffuse light lands.
        </p>
      )}
    </div>
  )
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
  /** The day's solar positions as [azimuth, elevation] pairs, for the sun path. */
  sunTrack?: Array<[number, number]>
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
  sunTrack,
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
    louvres: Map<FacadeOrientation, THREE.Group[]>
    outline: THREE.LineLoop
    roofOutline: THREE.LineLoop
    sunlight: THREE.DirectionalLight
    sunMarker: THREE.Mesh
  } | null>(null)
  const [supported, setSupported] = useState(true)
  // Which 4 x 4 zone was last clicked, e.g. W7. Escape clears it.
  const [zone, setZone] = useState<{
    id: string
    orientation: FacadeOrientation
    index: number
  } | null>(null)
  // The bubble is moved by the render loop, not by React: it has to track the
  // zone through every orbit frame, and re-rendering at 60 fps to do that would
  // be absurd.
  const bubbleRef = useRef<HTMLDivElement | null>(null)
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

    // The tower stands on a plinth, so the facade grid starts above it.
    const podiumHeight = height * PODIUM_FRACTION
    const facadeBase = podiumHeight
    const rowHeight = (height - facadeBase) / PANEL_ROWS

    // Structural core, lit so the massing reads as solid. The heat panels in
    // front of it stay unlit, so their colour is data rather than shading.
    // A four-sided frustum, turned so its faces land on the cardinals.
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(
        halfWidthAt(height, overhang) * Math.SQRT2 * 0.97,
        halfWidthAt(facadeBase, overhang) * Math.SQRT2 * 0.97,
        height - facadeBase,
        4
      ),
      new THREE.MeshStandardMaterial({ color: 0x9aa19d, roughness: 0.9 })
    )
    core.position.y = (height + facadeBase) / 2
    core.rotation.y = Math.PI / 4
    scene.add(core)

    // Plinth. The tower's footprint is its narrowest point, so the base needs
    // something to stand on or it reads as floating.
    const podiumHalf = halfWidthAt(facadeBase, overhang) * 1.15
    const podium = new THREE.Mesh(
      new THREE.BoxGeometry(podiumHalf * 2, podiumHeight, podiumHalf * 2),
      new THREE.MeshStandardMaterial({ color: 0x7d837f, roughness: 0.85 })
    )
    podium.position.y = podiumHeight / 2
    scene.add(podium)

    // Facade zones: 4 rows x 4 columns per wall, each its own mesh, material
    // and zone id, indexed row-major from the bottom left as N1..N16.
    const panels = new Map<FacadeOrientation, THREE.Mesh[]>()
    // Outline geometries live outside the scene graph, so they are disposed by hand.
    const frames: THREE.BufferGeometry[] = []
    for (const orientation of ORIENTATIONS) {
      const zones: THREE.Mesh[] = []
      for (let row = 0; row < PANEL_ROWS; row += 1) {
        const bottomY = facadeBase + row * rowHeight
        const topY = bottomY + rowHeight
        for (let column = 0; column < PANEL_COLUMNS; column += 1) {
          const panel = new THREE.Mesh(
            slopedPanel(
              halfWidthAt(bottomY, overhang),
              halfWidthAt(topY, overhang),
              bottomY + PANEL_GAP / 2,
              topY - PANEL_GAP / 2,
              column,
              PANEL_COLUMNS
            ),
            new THREE.MeshBasicMaterial({
              color: 0xfde3d5,
              side: THREE.FrontSide,
            })
          )
          panel.rotation.y = WALLS[orientation]
          panel.userData.surface = `wall:${orientation}` satisfies SurfaceId
          panel.userData.zone = `${orientation[0].toUpperCase()}${
            row * PANEL_COLUMNS + column + 1
          }`
          panel.userData.index = row * PANEL_COLUMNS + column
          panel.userData.orientation = orientation
          // Centre of the zone in world space, for the bubble to hang off.
          panel.geometry.computeBoundingBox()
          panel.updateMatrixWorld()
          panel.userData.anchor = panel.localToWorld(
            panel.geometry.boundingBox!.getCenter(new THREE.Vector3())
          )
          // Kept for the hover and selection frames to borrow.
          panel.userData.frame = frameGeometry(panel.geometry)
          frames.push(panel.userData.frame as THREE.BufferGeometry)
          scene.add(panel)
          zones.push(panel)
        }
      }
      panels.set(orientation, zones)
    }

    // Roof slab: oversails the walls, then steps in to the crown deck. One
    // sloping quadrant per cardinal, each carrying its own plane-of-array.
    const roofHalf = halfWidthAt(height, overhang) * (1 + ROOF_OVERHANG)
    const deckHalf = roofHalf * ROOF_DECK_RATIO
    const deckHeight = roofDeckHeightFor(roofHalf, deckHalf, height, roofPitch)
    const roofFaceGeometry = slopedPanel(roofHalf, deckHalf, height, deckHeight)
    const roofFaces = new Map<FacadeOrientation, THREE.Mesh>()
    for (const orientation of ORIENTATIONS) {
      const face = new THREE.Mesh(
        roofFaceGeometry,
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

    // Crown deck between the four quadrants, and the diamond skylight on it.
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(deckHalf * 2, 0.012, deckHalf * 2),
      new THREE.MeshStandardMaterial({ color: 0x56636a, roughness: 0.45 })
    )
    deck.position.y = deckHeight
    scene.add(deck)

    const crownHeight = height * CROWN_HEIGHT_FRACTION
    const crown = new THREE.Mesh(
      // Four-sided cone: a diamond with its corners on the cardinals.
      new THREE.ConeGeometry(
        halfWidthAt(height, overhang) * CROWN_RATIO * Math.SQRT2,
        crownHeight,
        4
      ),
      new THREE.MeshPhysicalMaterial({
        color: 0x55b8c5,
        roughness: 0.08,
        metalness: 0.15,
        transparent: true,
        opacity: 0.8,
      })
    )
    crown.position.y = deckHeight + crownHeight / 2
    scene.add(crown)

    // Every zone carries its own louvres, driven by its own controller: one
    // group per cell of the grid, index-aligned with that wall's zone readings.
    const louvres = new Map<FacadeOrientation, THREE.Group[]>()
    // Scene units are metres / 10, so these are 5 cm blades projecting 50 cm.
    // Sized against the real building: anything heavier hides the heat map the
    // blades are mounted on, which is the thing worth looking at.
    const slatGeometry = new THREE.BoxGeometry(1, 0.005, 0.05)
    const slatMaterial = new THREE.MeshStandardMaterial({
      color: 0x6f7b77,
      roughness: 0.35,
      metalness: 0.45,
    })
    const SLATS_PER_ZONE = 2
    for (const orientation of ORIENTATIONS) {
      const zoneGroups: THREE.Group[] = []
      for (let row = 0; row < PANEL_ROWS; row += 1) {
        for (let column = 0; column < PANEL_COLUMNS; column += 1) {
          const group = new THREE.Group()
          for (let slat = 0; slat < SLATS_PER_ZONE; slat += 1) {
            const mesh = new THREE.Mesh(slatGeometry, slatMaterial)
            // Follow the leaning facade: each blade stands off its own bay.
            const y =
              facadeBase +
              ((row + (slat + 0.5) / SLATS_PER_ZONE) * (height - facadeBase)) /
                PANEL_ROWS
            const half = halfWidthAt(y, overhang)
            const bay = (2 * half) / PANEL_COLUMNS
            mesh.position.set(-half + (column + 0.5) * bay, y, half + 0.035)
            mesh.scale.x = bay - 0.06
            group.add(mesh)
          }
          group.rotation.y = WALLS[orientation]
          scene.add(group)
          zoneGroups.push(group)
        }
      }
      louvres.set(orientation, zoneGroups)
    }

    // Selection frame. The plan is square, so one outline serves every wall.
    const hb = halfWidthAt(facadeBase, overhang)
    const ht = halfWidthAt(height, overhang)
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: 0x0b3128,
      depthTest: false,
    })
    const outline = new THREE.LineLoop(
      frameGeometry(slopedPanel(hb, ht, facadeBase, height)),
      outlineMaterial
    )
    outline.renderOrder = 2
    scene.add(outline)

    const roofOutline = new THREE.LineLoop(
      frameGeometry(roofFaceGeometry),
      outlineMaterial
    )
    roofOutline.renderOrder = 2
    scene.add(roofOutline)

    // Zone frames: the hovered zone and the last zone clicked. Both borrow the
    // zone's own geometry, so they trace the leaning trapezoid exactly.
    const zoneOutline = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x0b3128, depthTest: false })
    )
    zoneOutline.renderOrder = 3
    zoneOutline.visible = false
    scene.add(zoneOutline)

    const hoverOutline = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x0b3128,
        depthTest: false,
        transparent: true,
        opacity: 0.45,
      })
    )
    hoverOutline.renderOrder = 3
    hoverOutline.visible = false
    scene.add(hoverOutline)

    // Corner mullions, base to eave, so the lean is legible from any angle.
    const corners: Array<[number, number]> = [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ]
    const cornerGeometry = new THREE.BufferGeometry()
    cornerGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array(
          corners.flatMap(([sx, sz]) => [
            sx * hb,
            facadeBase,
            sz * hb,
            sx * ht,
            height,
            sz * ht,
          ])
        ),
        3
      )
    )
    const corner = new THREE.LineSegments(
      cornerGeometry,
      new THREE.LineBasicMaterial({
        color: 0x5f6b66,
        transparent: true,
        opacity: 0.45,
      })
    )
    scene.add(corner)

    // Click to select a surface, but never treat the end of an orbit drag as a click.
    const pickable = [...[...panels.values()].flat(), ...roofFaces.values()]
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const pick = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      return raycaster.intersectObjects(pickable, false)[0]?.object
    }
    // A zone frame traces whichever zone it is pointed at.
    const traceZone = (outlineFor: THREE.LineLoop, target?: THREE.Object3D) => {
      const frame = target?.userData.frame as THREE.BufferGeometry | undefined
      outlineFor.visible = Boolean(frame)
      if (!frame) return
      outlineFor.geometry = frame
      outlineFor.rotation.y = target!.rotation.y
    }
    // World point the bubble hangs off, or null when nothing is selected.
    let anchor: THREE.Vector3 | null = null
    let pressedAt: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent) => {
      pressedAt = { x: event.clientX, y: event.clientY }
    }
    const onPointerMove = (event: PointerEvent) => {
      const target = pick(event)
      traceZone(hoverOutline, target)
      renderer.domElement.style.cursor = target ? 'pointer' : ''
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!pressedAt) return
      const travelled = Math.hypot(
        event.clientX - pressedAt.x,
        event.clientY - pressedAt.y
      )
      pressedAt = null
      if (travelled > 5) return
      const target = pick(event)
      const surface = target?.userData.surface as SurfaceId | undefined
      // The wall is what the louvres act on; the zone is where you clicked.
      traceZone(zoneOutline, target)
      anchor = (target?.userData.anchor as THREE.Vector3 | undefined) ?? null
      const id = target?.userData.zone as string | undefined
      setZone(
        id
          ? {
              id,
              orientation: target!.userData.orientation as FacadeOrientation,
              index: target!.userData.index as number,
            }
          : null
      )
      if (surface) onSelectRef.current(surface)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      zoneOutline.visible = false
      anchor = null
      setZone(null)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onKeyDown)

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
    const projected = new THREE.Vector3()
    const animate = () => {
      frame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
      // Keep the bubble pinned to its zone as the model turns.
      const bubble = bubbleRef.current
      if (!bubble) return
      if (!anchor) {
        bubble.style.visibility = 'hidden'
        return
      }
      projected.copy(anchor).project(camera)
      bubble.style.visibility = projected.z > 1 ? 'hidden' : 'visible'
      bubble.style.left = `${((projected.x + 1) / 2) * 100}%`
      bubble.style.top = `${((1 - projected.y) / 2) * 100}%`
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
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      controls.dispose()
      frames.forEach((geometry) => geometry.dispose())
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.Sprite ||
          object instanceof THREE.Line
        ) {
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

  // The day's solar track, drawn once per run: the arc the marker rides along.
  // Only the part above the horizon is drawn, since that is the part that heats
  // anything. Its own effect, so a new run redraws the arc without rebuilding
  // the building.
  useEffect(() => {
    const context = sceneRef.current
    if (!context || !sunTrack?.length) return
    const points = sunTrack
      .filter(([, elevation]) => elevation > 0)
      .map(([azimuth, elevation]) => sunAt(azimuth, elevation))
    if (points.length < 2) return

    const track = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: 0xfab219,
        transparent: true,
        opacity: 0.55,
      })
    )
    context.scene.add(track)
    return () => {
      context.scene.remove(track)
      track.geometry.dispose()
      track.material.dispose()
    }
  }, [floors, overhang, roofPitch, sunTrack, supported])

  // Repaint for the selected tick.
  useEffect(() => {
    const context = sceneRef.current
    if (!context) return
    const height = floors * FLOOR_HEIGHT

    for (const orientation of ORIENTATIONS) {
      const wall = walls.get(orientation)
      const stack = context.panels.get(orientation)
      if (!stack) continue
      stack.forEach((panel, index) => {
        // Zones are row-major on both sides of the wire, so the panel's index is
        // its reading's index. Rows separate on the roof overhang's shadow, the
        // end bays on their corner exposure, and every cell on its own louvres.
        const zone = wall?.zones?.[index]
        const row = Math.floor(index / PANEL_COLUMNS)
        const fraction = PANEL_ROWS > 1 ? row / (PANEL_ROWS - 1) : 0.5
        const temperature =
          zone?.sol_air_temp ??
          (wall
            ? floorTemperature(wall, fraction, tick.outdoor_temp, tick.wind)
            : tick.outdoor_temp)
        const material = panel.material as THREE.MeshBasicMaterial
        material.color.copy(rampColor(temperature))
      })
    }

    // Each zone's louvres sit at that zone's own angle. Where a wall's readings
    // predate per-zone control, every zone falls back to the wall's angle.
    for (const orientation of ORIENTATIONS) {
      const groups = context.louvres.get(orientation)
      const wall = walls.get(orientation)
      if (!groups) continue
      groups.forEach((group, index) => {
        group.visible = Boolean(wall)
        const angle = wall?.zones?.[index]?.angle ?? wall?.angle ?? 0
        group.children.forEach((slat) => {
          slat.rotation.x = THREE.MathUtils.degToRad(angle)
        })
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

    const sunPosition = sunAt(
      tick.solar_azimuth,
      Math.max(tick.solar_elevation, -5)
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

      {/* Zone bubble. The render loop positions it; React only fills it in. */}
      <div
        ref={bubbleRef}
        className='pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full pb-2'
        style={{ visibility: 'hidden' }}
      >
        {zone && <ZoneBubble wall={walls.get(zone.orientation)} zone={zone} />}
      </div>

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
            Sol-air surface temperature · drag to orbit ·{' '}
            {zone
              ? `zone ${zone.id} selected · esc to clear`
              : 'click any zone'}
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
        tag: wall?.primary
          ? 'primary'
          : wall && wall.sunlit === false
            ? 'self-shaded'
            : null,
        angle: `${(wall?.angle ?? 0).toFixed(0)}°`,
        incident: wall?.incident ?? 0,
        temperature:
          wall?.sol_air_temp ??
          (wall
            ? floorTemperature(wall, 0.5, tick.outdoor_temp, tick.wind)
            : tick.outdoor_temp),
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
