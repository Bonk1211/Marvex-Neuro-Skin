'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { createBandPlan, FLOOR_STACK_GAP, WALL_ROTATION } from './bandPlan'
import { MEETING_SEATS } from './floorOccupants'
import { applyOrbit, orbitChanged, type OrbitAngles } from './sectionScene'
import { floorBeam, type FloorLightView } from './floorSunlight'
import type { CsiActivity } from './csiPosture'
import { FLOOR_PLANS, floorGroupLabel, floorProgram } from './floorWorkspaces'
import { createCloudCanopy } from './cloudCanopy'
import { createFacadeSunlight } from './facadeSunlight'
import type { SkyObservation } from './CloudVisionPanel'
import { Box, Focus, RotateCcw, Sun } from 'lucide-react'
import type {
  FacadeHeat,
  FacadeOrientation,
  DaylightProbePayload,
  RoofSegment,
  TickPayload,
} from '@/lib/types'
import {
  bakeExposure,
  bakeIrradiance,
  EXPOSURE_RAMP,
  exposureColor,
  facadeOccluders,
  IRRADIANCE_MAX,
  irradianceColor,
  roofGrid,
  sunSamples,
} from './solarExposure'
import {
  createLouvreAssembly,
  setLouvreAngle,
  type LouvreAssembly,
} from './louvreAssembly'
import {
  baselineSurfaceTemperature,
  BUILDING_VARIANTS,
  type BuildingVariant,
} from './buildingComparison'

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

// How far a right-drag may slide the point of interest from the building, in scene
// units. Wide enough to put a facade wherever you want it, tight enough that the
// building never leaves the frame.
const PAN_RADIUS = 6
// Floor-line hairline. Wide enough to read as separate storeys, narrow enough
// that the structure behind does not become the dominant colour.
const PANEL_GAP = 0.012
// Every facade is a 4 x 4 grid of zones, N1..N16 by row from the bottom. Each
// zone is its own mesh with its own material, so it can be hovered, selected
// and shaded on its own.
const PANEL_ROWS = 4
const PANEL_COLUMNS = 4
// Sample grid per roof quadrant for the daily-exposure bake, interpolated
// across the triangles between the vertices. The only things standing above the
// roof are the deck step and the crown, both large, so a finer grid would cost
// bake time to draw the same two shadow edges.
const ROOF_DIVISIONS = 48
const WALL_DIVISIONS = 24
// Sun positions per tick. An hourly run is 13 positions across a day, and 13
// discrete shadows stack into bands; walking the sun between ticks turns those
// bands back into an edge.
const SUN_SUBSTEPS = 3

const CAMERA_MODES = [
  ['orbit', 'Orbit'],
  ['plan', 'Floor plan'],
] as const
type CameraMode = (typeof CAMERA_MODES)[number][0]

const SURFACE_MODES = [
  ['irradiance', 'Irradiance'],
  ['model', '3D model'],
  ['temp', 'Surface temp'],
  ['exposure', 'Daily sun'],
] as const
type SurfaceMode = (typeof SURFACE_MODES)[number][0]
const IRRADIANCE_LEGEND = Array.from(
  { length: 33 },
  (_, index) =>
    `#${irradianceColor((index * IRRADIANCE_MAX) / 32).getHexString()}`
)

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

const WALLS = WALL_ROTATION

const ORIENTATIONS = Object.keys(WALLS) as FacadeOrientation[]

const poseOf = (controls: OrbitControls): OrbitAngles => ({
  azimuth: controls.getAzimuthalAngle(),
  polar: controls.getPolarAngle(),
})

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

function labelSprite(text: string, captionColor?: string) {
  const canvas = document.createElement('canvas')
  canvas.width = captionColor ? 320 : 128
  canvas.height = captionColor ? 80 : 128
  const context = canvas.getContext('2d')
  if (context) {
    if (captionColor) {
      context.fillStyle = '#fffffff0'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = captionColor
      context.fillRect(0, 0, 10, canvas.height)
    }
    context.fillStyle = captionColor ?? '#898781'
    context.font = `bold ${captionColor ? 32 : 72}px system-ui, -apple-system, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, canvas.width / 2, canvas.height / 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: !captionColor,
      toneMapped: !captionColor,
    })
  )
  if (captionColor) sprite.scale.set(2, 0.5, 1)
  else sprite.scale.setScalar(0.5)
  return sprite
}

/** One zone's own readings, pinned to that zone in the 3D view. */
function ZoneBubble({
  wall,
  zone,
  buildingVariant,
  outdoorTemp,
  wind,
}: {
  wall: FacadeHeat | undefined
  zone: { id: string; orientation: FacadeOrientation; index: number }
  buildingVariant: BuildingVariant
  outdoorTemp: number
  wind: number
}) {
  const baseline = buildingVariant === 'baseline'
  const reading = wall?.zones?.find((reading) => reading.zone === zone.id)
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
          {!baseline && reading.sensors && (
            <>
              <div className='flex justify-between gap-2'>
                <dt className='text-muted-foreground'>Sensor</dt>
                <dd>{reading.sensors.sensor_id}</dd>
              </div>
              <div className='flex justify-between gap-2'>
                <dt className='text-muted-foreground'>Measured light</dt>
                <dd>{reading.sensors.illuminance.toFixed(0)} lx</dd>
              </div>
            </>
          )}
          <div className='flex justify-between gap-2'>
            <dt className='text-muted-foreground'>Incident</dt>
            <dd className='tabular-nums'>{reading.incident.toFixed(0)} W/m²</dd>
          </div>
          {!baseline && (
            <div className='flex justify-between gap-2'>
              <dt className='text-muted-foreground'>Through louvres</dt>
              <dd className='tabular-nums'>
                {reading.transmitted.toFixed(0)} W/m²
              </dd>
            </div>
          )}
          <div className='flex justify-between gap-2'>
            <dt className='text-muted-foreground'>Surface</dt>
            <dd className='tabular-nums'>
              {(baseline
                ? baselineSurfaceTemperature(
                    reading.incident,
                    outdoorTemp,
                    wind
                  )
                : reading.sol_air_temp
              ).toFixed(1)}{' '}
              °C
            </dd>
          </div>
          <div className='flex justify-between gap-2'>
            <dt className='text-muted-foreground'>Roof-unshaded</dt>
            <dd className='tabular-nums'>
              {(reading.sunlit_fraction * 100).toFixed(0)}%
            </dd>
          </div>
          {!baseline && (
            <>
              <div className='flex justify-between gap-2 border-t border-border/50 pt-0.5'>
                <dt className='text-muted-foreground'>Louvres</dt>
                <dd className='tabular-nums'>
                  {reading.angle.toFixed(1)}° · {reading.mode.toLowerCase()}
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
            </>
          )}
        </dl>
      ) : (
        <p className='mt-1.5 text-[10px] text-muted-foreground'>
          No reading for this zone at this tick.
        </p>
      )}
      {baseline && (
        <p className='mt-1.5 text-[9px] leading-snug text-muted-foreground'>
          No external louvres or control brain. Passive roof shading remains.
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
  active?: boolean
  cameraMode?: CameraMode
  csiView?: boolean
  solarTracking?: boolean
  csiActivity?: CsiActivity
  band?: number
  focusedBand?: number | null
  onSelectBand?: (band: number | null) => void
  visionSky?: SkyObservation | null
  tick: TickPayload
  floors: number
  facadeTilt: number
  roofPitch: number
  timeLabel: string
  locationName: string
  selected: SurfaceId
  onSelect: (surface: SurfaceId) => void
  selectedZone?: string | null
  onSelectZone?: (zone: string | null) => void
  /** The day's solar positions as [azimuth, elevation] pairs, for the sun path. */
  sunTrack?: Array<[number, number]>
  /** The whole run, for the optional daily roof-exposure bake. */
  ticks?: TickPayload[]
  onSelectTick?: (index: number) => void
  buildingVariant?: BuildingVariant
  onBuildingVariantChange?: (variant: BuildingVariant) => void
  /** Render the scene controls into this element instead of over the canvas. */
  controlsSlot?: HTMLElement | null
  /** Shared orbit pose, so the floor section can face the same way as this scene. */
  orbit?: OrbitAngles | null
  onOrbitChange?: (orbit: OrbitAngles) => void
}

/* ponytail: a portal moves the panel's DOM only -- every control keeps its
   state and handlers here, so nothing had to be lifted into the dashboard. */
function Hosted({
  slot,
  children,
}: {
  slot?: HTMLElement | null
  children: ReactNode
}) {
  return slot ? createPortal(children, slot) : <>{children}</>
}

export function BuildingHeatmap({
  active = true,
  cameraMode = 'orbit',
  csiView = false,
  solarTracking = false,
  csiActivity = 'auto',
  orbit = null,
  onOrbitChange,
  band = 0,
  focusedBand = null,
  onSelectBand,
  visionSky = null,
  tick,
  floors,
  facadeTilt,
  roofPitch,
  timeLabel,
  locationName,
  selected,
  onSelect,
  selectedZone = null,
  onSelectZone,
  sunTrack,
  ticks,
  onSelectTick,
  buildingVariant = 'controlled',
  onBuildingVariantChange,
  controlsSlot = null,
}: BuildingHeatmapProps) {
  const activeRef = useRef(active)
  const [showSunPaths, setShowSunPaths] = useState(true)
  const sunPathsRef = useRef(showSunPaths)
  sunPathsRef.current = showSunPaths
  activeRef.current = active
  const csiRef = useRef({ enabled: csiView, activity: csiActivity })
  csiRef.current = { enabled: csiView, activity: csiActivity }
  const [viewControlsOpen, setViewControlsOpen] = useState(true)
  useEffect(() => {
    if (window.matchMedia('(max-width: 639px)').matches)
      setViewControlsOpen(false)
  }, [])
  const daylightTickRef = useRef<TickPayload | undefined>(undefined)
  daylightTickRef.current = buildingVariant === 'controlled' ? tick : undefined
  const [planAngle, setPlanAngle] = useState<'cutaway' | 'top'>('cutaway')
  const planAngleRef = useRef(planAngle)
  planAngleRef.current = planAngle
  const [showHvac, setShowHvac] = useState(false)
  const [floorLight, setFloorLight] = useState<FloorLightView>('sun')
  useEffect(() => {
    if (!tick.meeting_demo) return
    setFloorLight('sun')
    setShowPeople(true)
    setShowDetections(true)
  }, [tick.meeting_demo])
  const lightingRef = useRef({
    tick,
    mode: csiView ? ('off' as const) : floorLight,
    controlled: buildingVariant === 'controlled',
  })
  lightingRef.current = {
    tick,
    mode: csiView ? ('off' as const) : floorLight,
    controlled: buildingVariant === 'controlled',
  }
  const showHvacRef = useRef(showHvac)
  showHvacRef.current = showHvac
  const [showPeople, setShowPeople] = useState(true)
  const [showDetections, setShowDetections] = useState(true)
  const [peoplePaused, setPeoplePaused] = useState(false)
  const peopleRef = useRef({
    showPeople,
    showDetections,
    peoplePaused,
    occupancy: tick.occupancy,
  })
  peopleRef.current = {
    showPeople,
    showDetections,
    peoplePaused,
    occupancy: tick.occupancy,
  }
  const [cameraOverride, setCameraOverride] = useState<CameraMode | null>(null)
  useEffect(() => setCameraOverride(null), [cameraMode])
  const activeCameraMode = cameraOverride ?? cameraMode
  const cameraModeRef = useRef(activeCameraMode)
  cameraModeRef.current = activeCameraMode
  const focusedBandRef = useRef(focusedBand)
  focusedBandRef.current = focusedBand
  const onSelectBandRef = useRef(onSelectBand)
  onSelectBandRef.current = onSelectBand
  useEffect(() => {
    if (focusedBand === null) setPlanAngle('cutaway')
  }, [focusedBand])
  const availableZones = useRef(new Set<string>())
  availableZones.current = new Set(
    tick.facade.flatMap((wall) => wall.zones?.map((zone) => zone.zone) ?? [])
  )
  const controlled = buildingVariant === 'controlled'
  const buildingVariantRef = useRef(buildingVariant)
  buildingVariantRef.current = buildingVariant
  // pvlib surface tilt: 90 is a plain wall, 115 is the Diamond's 25 degree lean.
  const overhang = facadeTilt - 90
  const mountRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    planCamera: THREE.OrthographicCamera
    planControls: OrbitControls
    fitPlan: () => void
    controls: OrbitControls
    panels: Map<FacadeOrientation, THREE.Mesh[]>
    roofFaces: Map<FacadeOrientation, THREE.Mesh>
    /** What the roof bake casts rays at. Low-poly stand-ins, never rendered. */
    roofOccluders: THREE.Object3D[]
    wallOccluders: THREE.Object3D[]
    glassMaterial: THREE.MeshPhysicalMaterial
    roofMaterial: THREE.MeshStandardMaterial
    irradianceTexture: THREE.DataTexture
    louvres: Map<FacadeOrientation, LouvreAssembly[]>
    posed: boolean
    repaintWalls: ((orientations: Set<FacadeOrientation>) => void) | null
    repaintClouds: (() => void) | null
    cloudCanopy: ReturnType<typeof createCloudCanopy>
    refreshProbe: () => void
    highlightZone: (zone: string | null) => void
    outline: THREE.LineLoop
    roofOutline: THREE.LineLoop
    sunlight: THREE.DirectionalLight
    sunMarker: THREE.Mesh
  } | null>(null)
  const [supported, setSupported] = useState(true)
  // Bumped whenever the scene is rebuilt, so the orbit sync can re-attach to the
  // new OrbitControls instead of holding a disposed one.
  const [sceneEpoch, setSceneEpoch] = useState(0)
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>('irradiance')
  useEffect(() => {
    if (activeCameraMode === 'plan' && surfaceMode === 'exposure')
      setSurfaceMode('temp')
  }, [activeCameraMode, surfaceMode])
  const [showClouds, setShowClouds] = useState(true)
  const cloudCover =
    visionSky?.cloud_cover ?? tick.environment_cloud ?? tick.cloud
  const cloudMask = visionSky?.cloud_mask
  const surfaceModeRef = useRef(surfaceMode)
  surfaceModeRef.current = surfaceMode
  const probeRef = useRef<HTMLDivElement | null>(null)
  const motionReadoutRef = useRef<HTMLParagraphElement | null>(null)
  const [detailedView, setDetailedView] = useState(false)
  const activeWall = selected.startsWith('wall:')
    ? (selected.split(':')[1] as FacadeOrientation)
    : (tick.facade.find((wall) => wall.primary)?.orientation ?? 'west')
  const planSide = selected.split(':')[1] as FacadeOrientation
  const bestSunlight = useMemo(() => {
    let index = -1,
      strongest = 1
    ticks?.forEach((sample, at) => {
      const strength = floorBeam(sample, planSide, band, controlled)
      if (strength > strongest) {
        strongest = strength
        index = at
      }
    })
    return index
  }, [ticks, planSide, band, controlled])
  const planSideRef = useRef(planSide)
  planSideRef.current = planSide
  const activeWallRef = useRef(activeWall)
  activeWallRef.current = activeWall
  // Daily exposure range across all four quadrants, kWh/m2. One shared domain,
  // or the quadrants would not be comparable with each other.
  const [roofRange, setRoofRange] = useState<[number, number]>([0, 0])
  // The matrix and 3D inspector share the same zone selection.
  const selectedReading = tick.facade
    .find((wall) => `wall:${wall.orientation}` === selected)
    ?.zones?.find((reading) => reading.zone === selectedZone)
  const zone = selectedReading
    ? {
        id: selectedReading.zone,
        orientation: activeWall,
        index: selectedReading.row * PANEL_COLUMNS + selectedReading.column,
      }
    : null
  const activeZoneRef = useRef(zone)
  activeZoneRef.current = zone
  // The bubble is moved by the render loop, not by React: it has to track the
  // zone through every orbit frame, and re-rendering at 60 fps to do that would
  // be absurd.
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  // Kept in a ref so changing the handler never rebuilds the scene.
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onSelectZoneRef = useRef(onSelectZone)
  onSelectZoneRef.current = onSelectZone

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

  const focusFacade = () => {
    const context = sceneRef.current
    if (!context) return
    setCameraOverride('orbit')
    const index = zone?.orientation === activeWall ? zone.index : 9
    const anchor = context.panels.get(activeWall)?.[index]?.userData.anchor as
      | THREE.Vector3
      | undefined
    if (!anchor) return
    context.controls.minDistance = 1.5
    context.controls.target.copy(anchor)
    // Re-anchor the pan bound, or update() would drag this framing back towards the
    // building centre the cursor was left on.
    context.controls.cursor.copy(anchor)
    context.camera.position
      .copy(anchor)
      .add(
        new THREE.Vector3(0.7, 0.45, 3.5).applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          WALLS[activeWall]
        )
      )
    context.controls.update()
    setDetailedView(true)
  }
  const showBuilding = () => {
    const context = sceneRef.current
    if (!context) return
    context.controls.minDistance = 7
    context.controls.target.set(0, floors * FLOOR_HEIGHT * 0.95, 0)
    context.controls.cursor.copy(context.controls.target)
    context.camera.position.set(-10.5, floors * FLOOR_HEIGHT * 3.3, 10.5)
    context.controls.update()
    setDetailedView(false)
  }

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
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const environment = new RoomEnvironment()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const environmentMap = pmrem.fromScene(environment)
    scene.environment = environmentMap.texture
    scene.environmentIntensity = 0.65
    environment.dispose()
    pmrem.dispose()
    const aspect = mount.clientWidth / Math.max(1, mount.clientHeight)
    // Preserve the horizontal field of view in the narrow dashboard stage.
    const fieldOfView = (ratio: number) =>
      THREE.MathUtils.radToDeg(
        2 *
          Math.atan(
            Math.tan(THREE.MathUtils.degToRad(42) / 2) / Math.min(1, ratio)
          )
      )
    const camera = new THREE.PerspectiveCamera(
      fieldOfView(aspect),
      aspect,
      0.1,
      100
    )
    // Show the default west facade and its afternoon actuator response.
    camera.position.set(-10.5, height * 3.3, 10.5)

    const planCamera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100)
    planCamera.position.set(-10, 17, 13)
    planCamera.lookAt(0, FLOOR_STACK_GAP * 1.5, 0)
    planCamera.layers.set(1)
    const sizePlan = (ratio: number) => {
      const top = planAngleRef.current === 'top'
      const focused = focusedBandRef.current !== null
      const span = (top ? 5.3 : focused ? 6.5 : 10.4) / Math.min(1, ratio)
      const offset = top ? 0 : focused ? 1.3 : 2.4
      Object.assign(planCamera, {
        left: -span * ratio - offset,
        right: span * ratio - offset,
        top: span,
        bottom: -span,
      })
      planCamera.updateProjectionMatrix()
    }
    sizePlan(aspect)
    const renderCamera = () =>
      cameraModeRef.current === 'plan' ? planCamera : camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, height * 0.95, 0)
    controls.enableDamping = true
    // Right-drag pans (OrbitControls' default RIGHT button). Bounded to a sphere
    // around the building so the view cannot be slid off into empty space.
    controls.enablePan = true
    controls.cursor.copy(controls.target)
    controls.maxTargetRadius = PAN_RADIUS
    controls.minDistance = 7
    controls.maxDistance = 26
    controls.maxPolarAngle = Math.PI / 2 - 0.05
    controls.update()
    const planControls = new OrbitControls(planCamera, renderer.domElement)
    planControls.target.set(0, FLOOR_STACK_GAP * 1.5, 0)
    planControls.enableDamping = true
    planControls.enablePan = true
    planControls.maxTargetRadius = PAN_RADIUS
    planControls.minZoom = 0.7
    planControls.maxZoom = 2.5
    planControls.minPolarAngle = 0
    planControls.maxPolarAngle = Math.PI / 2.8
    planControls.enabled = cameraModeRef.current === 'plan'
    planControls.update()
    const fitPlan = () => {
      sizePlan(mount.clientWidth / Math.max(1, mount.clientHeight))
      if (planAngleRef.current === 'top') {
        const elevation = (focusedBandRef.current ?? 0) * FLOOR_STACK_GAP
        planCamera.position.set(0, elevation + 20, 0.001)
        planControls.target.set(0, elevation + 0.15, 0)
      } else {
        const elevation =
          focusedBandRef.current === null
            ? FLOOR_STACK_GAP * 1.5
            : focusedBandRef.current * FLOOR_STACK_GAP + 0.15
        planCamera.position.set(-10, elevation + 10.4, 13)
        planControls.target.set(0, elevation, 0)
      }
      // Keep the pan bound centred on whatever band was just framed.
      planControls.cursor.copy(planControls.target)
      planCamera.zoom = 1
      planCamera.updateProjectionMatrix()
      planControls.update()
    }

    const ambient = new THREE.HemisphereLight(0xdceeff, 0x77725e, 1.6)
    ambient.layers.enable(1)
    scene.add(ambient)
    const sunlight = new THREE.DirectionalLight(0xfff2e0, 3)
    sunlight.castShadow = true
    const shadowSize = Math.min(4096, renderer.capabilities.maxTextureSize)
    sunlight.shadow.mapSize.set(shadowSize, shadowSize)
    Object.assign(sunlight.shadow.camera, {
      left: -7,
      right: 7,
      top: 7,
      bottom: -7,
      near: 0.1,
      far: 35,
    })
    sunlight.shadow.normalBias = 0.006
    sunlight.shadow.bias = -0.0002
    scene.add(sunlight)

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9, 64),
      new THREE.MeshStandardMaterial({ color: 0xd8ded7, roughness: 1 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    ground.receiveShadow = true
    scene.add(ground)

    const grid = new THREE.PolarGridHelper(9, 8, 5, 64, 0x898781, 0x898781)
    const gridMaterial = grid.material as THREE.Material
    gridMaterial.opacity = 0.1
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

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x5a8b94,
      metalness: 0.35,
      roughness: 0.16,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    })
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0xa7b3b3,
      metalness: 0.3,
      roughness: 0.55,
      side: THREE.DoubleSide,
    })

    // Interpolate irradiance first, then look up its colour. Blending blue/red
    // vertex colours would invent purple at a green-valued shadow edge.
    const palette = new Uint8Array(256 * 4)
    for (let index = 0; index < 256; index += 1) {
      const hex = irradianceColor((index * IRRADIANCE_MAX) / 255).getHex()
      palette.set([hex >> 16, (hex >> 8) & 255, hex & 255, 255], index * 4)
    }
    const irradianceTexture = new THREE.DataTexture(palette, 256, 1)
    irradianceTexture.colorSpace = THREE.SRGBColorSpace
    irradianceTexture.minFilter = THREE.LinearFilter
    irradianceTexture.magFilter = THREE.LinearFilter
    irradianceTexture.needsUpdate = true

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
            roofGrid(
              halfWidthAt(bottomY + PANEL_GAP / 2, overhang),
              halfWidthAt(topY - PANEL_GAP / 2, overhang),
              bottomY + PANEL_GAP / 2,
              topY - PANEL_GAP / 2,
              WALL_DIVISIONS,
              column,
              PANEL_COLUMNS,
              PANEL_GAP
            ),
            new THREE.MeshBasicMaterial({
              color: 0xfde3d5,
              side: THREE.FrontSide,
              toneMapped: false,
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
          panel.userData.heatMaterial = panel.material
          panel.userData.frame = frameGeometry(
            slopedPanel(
              halfWidthAt(bottomY + PANEL_GAP / 2, overhang),
              halfWidthAt(topY - PANEL_GAP / 2, overhang),
              bottomY + PANEL_GAP / 2,
              topY - PANEL_GAP / 2,
              column,
              PANEL_COLUMNS
            )
          )
          frames.push(panel.userData.frame as THREE.BufferGeometry)
          scene.add(panel)
          zones.push(panel)
        }
      }
      panels.set(orientation, zones)
    }

    const plan = createBandPlan(panels, WALL_DIVISIONS)
    for (const level of plan.levels) {
      const label = labelSprite(
        floorGroupLabel(level.band, floors),
        FLOOR_PLANS[level.orientation].color
      )
      label.position.set(3, 0.3, 3)
      label.scale.multiplyScalar(1.15)
      label.layers.set(1)
      label.renderOrder = 5
      label.userData = {
        band: level.band,
        surface: `wall:${level.orientation}`,
      }
      level.group.add(label)
      plan.pickables.push(label)
      for (const person of level.people) {
        const tag = labelSprite(person.id, '#087f9c')
        tag.scale.set(0.48, 0.12, 1)
        tag.position.y = 0.83
        tag.layers.set(1)
        person.marker.add(tag)
        const index = level.people.indexOf(person)
        if (
          level.orientation === 'west' &&
          level.band === 3 &&
          index < MEETING_SEATS.length
        ) {
          tag.userData.regularLabel = true
          const seatTag = labelSprite(
            `Seat ${MEETING_SEATS[index] + 1}`,
            index < 4 ? '#b77916' : '#087f9c'
          )
          seatTag.scale.set(0.58, 0.145, 1)
          seatTag.position.y = 0.83
          seatTag.layers.set(1)
          seatTag.userData.meetingLabel = true
          seatTag.visible = false
          person.marker.add(seatTag)
        }
      }
      if (level.orientation === 'west' && level.band === 3) {
        for (const [caption, x, z, color] of [
          ['MEETING · W13', -1.57, -2.2, '#b77916'],
          ['CLOUD SHADE · W16', -2.14, 2.17, '#087f9c'],
        ] as const) {
          const tag = labelSprite(caption, color)
          tag.position.set(x, 1.3, z)
          tag.scale.set(1.6, 0.4, 1)
          tag.layers.set(1)
          tag.userData.meetingLabel = true
          tag.visible = false
          level.group.add(tag)
        }
      }
    }
    scene.add(plan.group)

    // Roof slab: oversails the walls, then steps in to the crown deck. One
    // sloping quadrant per cardinal, each carrying its own plane-of-array.
    const roofHalf = halfWidthAt(height, overhang) * (1 + ROOF_OVERHANG)
    const deckHalf = roofHalf * ROOF_DECK_RATIO
    const deckHeight = roofDeckHeightFor(roofHalf, deckHalf, height, roofPitch)
    // Flat quad version of a quadrant. The outline traces it, and the bake
    // casts rays at it: two triangles instead of the drawn mesh's two thousand.
    const roofFaceGeometry = slopedPanel(roofHalf, deckHalf, height, deckHeight)
    frames.push(roofFaceGeometry)
    const roofFaces = new Map<FacadeOrientation, THREE.Mesh>()
    // Occluder proxies never join the scene: they exist only to be raycast at,
    // so they carry no material cost and cannot be drawn by accident.
    const occluderMaterial = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
    })
    // Only what stands above the roof can shade it. The core and the podium are
    // both entirely below it, so a ray heading up from a quadrant can never
    // reach them — and their bounding spheres are large enough that leaving
    // them in costs every ray a triangle test for a shadow that cannot happen.
    const roofOccluders: THREE.Object3D[] = []
    for (const orientation of ORIENTATIONS) {
      // Each quadrant needs its own geometry: they bake different colours.
      const face = new THREE.Mesh(
        roofGrid(roofHalf, deckHalf, height, deckHeight, ROOF_DIVISIONS),
        new THREE.MeshBasicMaterial({
          color: 0xfde3d5,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
      )
      face.rotation.y = WALLS[orientation]
      face.userData.surface = `roof:${orientation}` satisfies SurfaceId
      face.userData.heatMaterial = face.material
      scene.add(face)
      roofFaces.set(orientation, face)

      const seams: THREE.Vector3[] = []
      for (let sheet = 1; sheet < 16; sheet += 1) {
        const fraction = -1 + sheet / 8
        seams.push(
          new THREE.Vector3(roofHalf * fraction, height + 0.004, roofHalf),
          new THREE.Vector3(deckHalf * fraction, deckHeight + 0.004, deckHalf)
        )
      }
      const roofSeams = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(seams),
        new THREE.LineBasicMaterial({
          color: 0x34494e,
          transparent: true,
          opacity: 0.16,
        })
      )
      roofSeams.rotation.y = WALLS[orientation]
      scene.add(roofSeams)

      const proxy = new THREE.Mesh(roofFaceGeometry, occluderMaterial)
      proxy.rotation.y = WALLS[orientation]
      proxy.userData.surface = `roof:${orientation}` satisfies SurfaceId
      roofOccluders.push(proxy)
    }

    // Crown deck between the four quadrants, and the diamond skylight on it.
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(deckHalf * 2, 0.012, deckHalf * 2),
      new THREE.MeshStandardMaterial({ color: 0x56636a, roughness: 0.45 })
    )
    deck.position.y = deckHeight
    scene.add(deck)
    roofOccluders.push(deck)

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
    roofOccluders.push(crown)

    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0x34494e,
      metalness: 0.6,
      roughness: 0.3,
      side: THREE.DoubleSide,
    })
    // Real storey lines and window mullions sit over the independent sensor zones.
    const beam = (from: THREE.Vector3, to: THREE.Vector3, radius: number) => {
      const direction = to.clone().sub(from)
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, direction.length(), 4),
        trimMaterial
      )
      mesh.position.copy(from).add(to).multiplyScalar(0.5)
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize()
      )
      return mesh
    }
    for (const orientation of ORIENTATIONS) {
      const framing = new THREE.Group()
      framing.rotation.y = WALLS[orientation]
      for (let floor = 0; floor <= floors; floor += 1) {
        const y = facadeBase + ((height - facadeBase) * floor) / floors
        framing.add(
          new THREE.Mesh(
            slopedPanel(
              halfWidthAt(y - 0.014, overhang) + 0.007,
              halfWidthAt(y + 0.014, overhang) + 0.007,
              y - 0.014,
              y + 0.014
            ),
            trimMaterial
          )
        )
      }
      for (let bay = 0; bay <= 16; bay += 1) {
        const fraction = -1 + bay / 8
        const bottom = halfWidthAt(facadeBase, overhang) + 0.009
        const top = halfWidthAt(height, overhang) + 0.009
        framing.add(
          beam(
            new THREE.Vector3(bottom * fraction, facadeBase, bottom),
            new THREE.Vector3(top * fraction, height, top),
            0.007
          )
        )
      }
      framing.add(
        new THREE.Mesh(
          slopedPanel(roofHalf, roofHalf, height - 0.055, height),
          roofMaterial
        )
      )
      scene.add(framing)
    }
    const crownFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(crown.geometry),
      new THREE.LineBasicMaterial({ color: 0x385b65 })
    )
    crownFrame.position.copy(crown.position)
    scene.add(crownFrame)

    for (let step = 0; step < 3; step += 1) {
      const stair = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.06, 0.22 + step * 0.16),
        new THREE.MeshStandardMaterial({ color: 0xb6b9ac, roughness: 0.95 })
      )
      stair.position.set(0, podiumHeight - 0.03 - step * 0.06, podiumHalf + 0.1)
      scene.add(stair)
    }
    const wallOccluders = [core, podium, ...roofOccluders]

    const louvres = new Map<FacadeOrientation, LouvreAssembly[]>()
    for (const orientation of ORIENTATIONS) {
      const assemblies: LouvreAssembly[] = []
      for (let row = 0; row < PANEL_ROWS; row += 1) {
        for (let column = 0; column < PANEL_COLUMNS; column += 1) {
          const assembly = createLouvreAssembly({
            bottomY: facadeBase + row * rowHeight,
            topY: facadeBase + (row + 1) * rowHeight,
            halfWidthAt: (y) => halfWidthAt(y, overhang),
            column,
            columns: PANEL_COLUMNS,
          })
          assembly.group.rotation.y = WALLS[orientation]
          scene.add(assembly.group)
          assemblies.push(assembly)
        }
      }
      louvres.set(orientation, assemblies)
    }

    // Selection frame. The plan is square, so one outline serves every wall.
    const hb = halfWidthAt(facadeBase, overhang)
    const ht = halfWidthAt(height, overhang)
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: 0x0b3128,
      depthTest: true,
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
    const visibleInScene = (object: THREE.Object3D): boolean =>
      object.visible && (!object.parent || visibleInScene(object.parent))
    const pick = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      const isPlan = cameraModeRef.current === 'plan'
      raycaster.layers.set(isPlan ? 1 : 0)
      raycaster.setFromCamera(pointer, renderCamera())
      return raycaster.intersectObjects(
        isPlan
          ? plan.pickables.filter(
              (object) =>
                visibleInScene(object) &&
                object.userData.surface === `wall:${planSideRef.current}` &&
                (!object.userData.zone ||
                  availableZones.current.has(object.userData.zone))
            )
          : pickable,
        false
      )[0]
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
    const highlightZone = (id: string | null) => {
      const target = id
        ? pickable.find((mesh) => mesh.userData.zone === id)
        : undefined
      traceZone(zoneOutline, target)
      anchor = (target?.userData.anchor as THREE.Vector3 | undefined) ?? null
    }
    let pressedAt: { x: number; y: number } | null = null
    let sample: {
      mesh: THREE.Mesh
      indices: [number, number, number]
      weights: THREE.Vector3
    } | null = null
    let inspected: THREE.Object3D | null = null
    const formatLux = (value: number | null | undefined) =>
      value != null && Number.isFinite(value)
        ? `${value.toFixed(1)} lux`
        : 'unavailable'
    const refreshProbe = () => {
      const probe = probeRef.current
      if (!probe) return
      if (
        inspected &&
        cameraModeRef.current === 'plan' &&
        visibleInScene(inspected)
      ) {
        const data = inspected.userData
        const light = data.reading as DaylightProbePayload | undefined
        const place = `${planSideRef.current} · ${floorGroupLabel(data.band, floors)}`
        probe.hidden = false
        probe.textContent = data.occupant
          ? `${place} · ${data.occupant} · ${data.state} · mock detection${data.seatIndex != null ? ` · seat ${data.seatIndex + 1} · Et ${formatLux(light?.task_illuminance)} · Ev ${formatLux(light?.eye_illuminance)}` : ''}`
          : `${place} · ${data.probe.kind} ${data.probe.index + 1} · Et ${formatLux(light?.task_illuminance)}${data.probe.kind === 'seat' ? ` · Ev ${formatLux(light?.eye_illuminance)}` : ''} · fixed probe`
        return
      }
      const values = sample?.mesh.userData.irradiance as
        | Float32Array
        | undefined
      probe.hidden =
        !sample || !values || surfaceModeRef.current !== 'irradiance'
      if (probe.hidden || !sample || !values) return
      const [a, b, c] = sample.indices
      const value =
        values[a] * sample.weights.x +
        values[b] * sample.weights.y +
        values[c] * sample.weights.z
      probe.textContent = `${String(sample.mesh.userData.surface).replace(':', ' · ')} · ${value.toFixed(0)} W/m²`
    }
    const onPointerDown = (event: PointerEvent) => {
      // Left button only. Right-drag pans, and a short right-click must not land as
      // a zone selection on the way back up.
      pressedAt =
        event.button === 0 ? { x: event.clientX, y: event.clientY } : null
    }
    const onPointerMove = (event: PointerEvent) => {
      const hit = pick(event)
      const target = hit?.object
      traceZone(hoverOutline, target)
      renderer.domElement.style.cursor = target ? 'pointer' : ''
      const probe = probeRef.current
      if (!probe) return
      sample = null
      inspected =
        target?.userData.probe || target?.userData.occupant ? target : null
      const rect = renderer.domElement.getBoundingClientRect()
      probe.style.left = `${Math.max(8, Math.min(rect.width - 245, event.clientX - rect.left + 14))}px`
      probe.style.top = `${Math.max(8, event.clientY - rect.top - 60)}px`
      if (inspected) {
        refreshProbe()
        return
      }
      const values = target?.userData.irradiance as Float32Array | undefined
      probe.hidden =
        surfaceModeRef.current !== 'irradiance' || !hit?.face || !values
      if (probe.hidden || !hit?.face || !values) return
      const mesh = target as THREE.Mesh
      const positions = mesh.geometry.getAttribute('position')
      const { a, b, c } = hit.face
      const barycentric = THREE.Triangle.getBarycoord(
        mesh.worldToLocal(hit.point.clone()),
        new THREE.Vector3().fromBufferAttribute(positions, a),
        new THREE.Vector3().fromBufferAttribute(positions, b),
        new THREE.Vector3().fromBufferAttribute(positions, c),
        new THREE.Vector3()
      )
      if (!barycentric) return
      sample = { mesh, indices: [a, b, c], weights: barycentric }
      refreshProbe()
      probe.style.left = `${Math.max(8, Math.min(rect.width - 205, event.clientX - rect.left + 14))}px`
      probe.style.top = `${Math.max(8, event.clientY - rect.top - 38)}px`
    }
    const onPointerLeave = () => {
      sample = null
      inspected = null
      hoverOutline.visible = false
      if (probeRef.current) probeRef.current.hidden = true
    }
    controls.addEventListener('start', onPointerLeave)
    planControls.addEventListener('start', onPointerLeave)
    const onPointerUp = (event: PointerEvent) => {
      if (!pressedAt || event.button !== 0) return
      const travelled = Math.hypot(
        event.clientX - pressedAt.x,
        event.clientY - pressedAt.y
      )
      pressedAt = null
      if (travelled > 5) return
      const target = pick(event)?.object
      if (
        cameraModeRef.current === 'plan' &&
        typeof target?.userData.band === 'number'
      )
        onSelectBandRef.current?.(target.userData.band)
      const surface = target?.userData.surface as SurfaceId | undefined
      const id = target?.userData.zone as string | undefined
      if (surface) onSelectRef.current(surface)
      onSelectZoneRef.current?.(id ?? null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      highlightZone(null)
      if (cameraModeRef.current === 'plan') onSelectBandRef.current?.(null)
      onSelectZoneRef.current?.(null)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)
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

    scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh &&
        !object.userData.floorLight &&
        object !== ground &&
        object !== sunMarker
      ) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    // Service and signal overlays should not cast false shadows on rooms.
    for (const level of plan.levels)
      for (const overlay of [level.hvac, level.wifi])
        overlay.traverse((object) => {
          object.castShadow = false
          object.receiveShadow = false
        })

    const cloudCanopy = createCloudCanopy(height + 3)
    scene.add(cloudCanopy.mesh)
    const sunPaths = createFacadeSunlight()
    scene.add(sunPaths.group)
    let lastRayPaint = 0

    let frame = 0
    const projected = new THREE.Vector3()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const dirtyWalls = new Set<FacadeOrientation>()
    let previousTime = performance.now()
    let lastBake = 0
    let lastReadout = 0
    let lastCloudPaint = 0
    let lastPeopleShadow = 0
    let peopleSeconds = 0
    let csiMix = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      const now = performance.now()
      const delta = Math.min((now - previousTime) / 1000, 0.1)
      previousTime = now
      if (!activeRef.current || document.hidden) return
      const context = sceneRef.current
      sunPaths.group.visible =
        sunPathsRef.current &&
        cameraModeRef.current !== 'plan' &&
        buildingVariantRef.current === 'controlled'
      if (sunPaths.group.visible && now - lastRayPaint >= 100) {
        const currentTick = lightingRef.current.tick
        sunPaths.update(
          sunAt(
            currentTick.solar_azimuth,
            currentTick.solar_elevation
          ).normalize(),
          louvres.get(activeWallRef.current) ?? [],
          wallOccluders
        )
        lastRayPaint = now
      }
      if (cloudCanopy.mesh.visible && !reducedMotion.matches) {
        cloudCanopy.mesh.position.x = Math.sin(now / 30000) * 1.5
        cloudCanopy.mesh.position.z = Math.cos(now / 45000) * 0.8
      }
      // Reuse cached building shadows; cloud movement needs only a mask lookup.
      if (cloudCanopy.mesh.visible && now - lastCloudPaint >= 200) {
        context?.repaintClouds?.()
        renderer.shadowMap.needsUpdate = true
        lastCloudPaint = now
      }
      let moving = false
      let activeMoving = false
      if (context?.posed && buildingVariantRef.current === 'controlled') {
        for (const [orientation, assemblies] of louvres) {
          for (const assembly of assemblies) {
            const target = assembly.targetAngle
            const next = reducedMotion.matches
              ? target
              : THREE.MathUtils.damp(assembly.angle, target, 9, delta)
            const unsettled = Math.abs(next - target) > 0.03
            const angle = unsettled ? next : target
            if (angle !== assembly.angle) {
              setLouvreAngle(assembly, angle)
              dirtyWalls.add(orientation)
              renderer.shadowMap.needsUpdate = true
            }
            moving ||= unsettled
            if (orientation === activeWallRef.current)
              activeMoving ||= unsettled
          }
        }
        // ponytail: sample moving blade shadows at 10 Hz while geometry renders
        // every frame; move the bake to a worker if much denser meshes are needed.
        if (dirtyWalls.size && (now - lastBake >= 100 || !moving)) {
          context.repaintWalls?.(dirtyWalls)
          dirtyWalls.clear()
          lastBake = performance.now()
          refreshProbe()
        }
        if (now - lastReadout >= 100 && motionReadoutRef.current) {
          const angles = (louvres.get(activeWallRef.current) ?? []).map(
            (bank) => bank.angle
          )
          const low = Math.min(...angles).toFixed(1)
          const high = Math.max(...angles).toFixed(1)
          const selectedZone = activeZoneRef.current
          const bank = selectedZone
            ? louvres.get(selectedZone.orientation)?.[selectedZone.index]
            : undefined
          motionReadoutRef.current.textContent =
            bank && selectedZone
              ? `${selectedZone.id} actuator · ${bank.angle.toFixed(1)}° → ${bank.targetAngle.toFixed(1)}° · ${Math.abs(bank.angle - bank.targetAngle) > 0.03 ? 'adjusting' : 'holding'}`
              : `${activeWallRef.current} louvres · ${low === high ? `${low}°` : `${low}–${high}°`} · ${activeMoving ? 'adjusting' : 'holding'}`
          lastReadout = now
        }
      } else {
        dirtyWalls.clear()
      }
      const isPlan = cameraModeRef.current === 'plan'
      ambient.intensity = isPlan ? 0.65 : 1.6
      scene.environmentIntensity = isPlan ? 0.35 : 0.65
      controls.enabled = !isPlan
      controls.enableRotate = !isPlan
      planControls.enabled = isPlan
      planControls.enableRotate = planAngleRef.current === 'cutaway'
      if (!isPlan) controls.update()
      else {
        planControls.update()
        if (
          plan.update(
            focusedBandRef.current,
            planSideRef.current,
            availableZones.current,
            showHvacRef.current,
            planAngleRef.current === 'top',
            daylightTickRef.current,
            lightingRef.current
          )
        )
          renderer.shadowMap.needsUpdate = true
        const people = peopleRef.current
        if (!people.peoplePaused && !reducedMotion.matches)
          peopleSeconds += delta
        plan.updatePeople(
          peopleSeconds,
          people.occupancy,
          people.showPeople,
          people.showDetections,
          focusedBandRef.current,
          csiRef.current.activity,
          !!daylightTickRef.current?.meeting_demo
        )
        const target = Number(csiRef.current.enabled)
        csiMix = reducedMotion.matches
          ? target
          : THREE.MathUtils.damp(csiMix, target, 5, delta)
        if (Math.abs(csiMix - target) < 0.002) csiMix = target
        plan.updateXray(
          csiMix,
          focusedBandRef.current,
          mount.clientWidth,
          mount.clientHeight,
          peopleSeconds
        )
        // Readable state for browser checks; the WebGL canvas and camera never swap.
        mount.dataset.csiBlend = csiMix.toFixed(3)
        if (
          !people.peoplePaused &&
          people.occupancy > 0 &&
          focusedBandRef.current !== null &&
          now - lastPeopleShadow > 200
        ) {
          renderer.shadowMap.needsUpdate = true
          lastPeopleShadow = now
        }
        if (inspected) refreshProbe()
      }
      renderer.render(scene, renderCamera())
      // Keep the bubble pinned to its zone as the model turns.
      const bubble = bubbleRef.current
      if (!bubble) return
      if (!anchor || isPlan) {
        bubble.style.visibility = 'hidden'
        return
      }
      projected.copy(anchor).project(renderCamera())
      bubble.style.visibility = projected.z > 1 ? 'hidden' : 'visible'
      bubble.style.left = `${((projected.x + 1) / 2) * 100}%`
      bubble.style.top = `${((1 - projected.y) / 2) * 100}%`
    }
    animate()

    const observer = new ResizeObserver(() => {
      if (!mount.clientWidth || !mount.clientHeight) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.fov = fieldOfView(camera.aspect)
      camera.updateProjectionMatrix()
      sizePlan(camera.aspect)
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    })
    observer.observe(mount)

    sceneRef.current = {
      renderer,
      scene,
      camera,
      planCamera,
      planControls,
      fitPlan,
      controls,
      panels,
      roofFaces,
      roofOccluders,
      wallOccluders,
      glassMaterial,
      roofMaterial,
      irradianceTexture,
      louvres,
      posed: false,
      repaintWalls: null,
      repaintClouds: null,
      cloudCanopy,
      refreshProbe,
      highlightZone,
      outline,
      roofOutline,
      sunlight,
      sunMarker,
    }
    setSupported(true)
    setSceneEpoch((epoch) => epoch + 1)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('keydown', onKeyDown)
      controls.removeEventListener('start', onPointerLeave)
      controls.dispose()
      planControls.removeEventListener('start', onPointerLeave)
      planControls.dispose()
      plan.dispose()
      frames.forEach((geometry) => geometry.dispose())
      pickable.forEach((mesh) => mesh.userData.heatMaterial.dispose())
      occluderMaterial.dispose()
      glassMaterial.dispose()
      roofMaterial.dispose()
      environmentMap.dispose()
      irradianceTexture.dispose()
      cloudCanopy.dispose()
      sunlight.shadow.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) object.dispose()
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.Sprite ||
          object instanceof THREE.Line
        ) {
          object.geometry?.dispose?.()
          const material = object.material
          if (Array.isArray(material))
            material.forEach((entry) => entry.dispose())
          else {
            if (object instanceof THREE.Sprite) object.material.map?.dispose()
            material?.dispose?.()
          }
        }
      })
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      sceneRef.current = null
    }
  }, [floors, overhang, roofPitch])

  useEffect(() => {
    sceneRef.current?.fitPlan()
  }, [planAngle, focusedBand, floors, overhang, roofPitch])

  // Orbit sync. The floor lens drives the plan camera and the others the orbit one,
  // so the sync follows whichever is live. Only a drag emits, so applying a pose from
  // the other view cannot echo back and leave the two scenes chasing each other.
  const draggingRef = useRef(false)
  const onOrbitChangeRef = useRef(onOrbitChange)
  onOrbitChangeRef.current = onOrbitChange
  const lastOrbitRef = useRef<OrbitAngles | null>(null)
  const liveControls = useCallback(
    () =>
      activeCameraMode === 'plan'
        ? sceneRef.current?.planControls
        : sceneRef.current?.controls,
    [activeCameraMode]
  )

  useEffect(() => {
    const controls = liveControls()
    if (!controls) return
    const start = () => {
      draggingRef.current = true
    }
    const end = () => {
      draggingRef.current = false
    }
    const change = () => {
      if (!draggingRef.current) return
      const pose = poseOf(controls)
      if (!orbitChanged(lastOrbitRef.current, pose)) return
      lastOrbitRef.current = pose
      onOrbitChangeRef.current?.(pose)
    }
    controls.addEventListener('start', start)
    controls.addEventListener('end', end)
    controls.addEventListener('change', change)
    return () => {
      controls.removeEventListener('start', start)
      controls.removeEventListener('end', end)
      controls.removeEventListener('change', change)
    }
  }, [sceneEpoch, liveControls])

  useEffect(() => {
    const controls = liveControls()
    if (!controls || !orbit || draggingRef.current) return
    if (!orbitChanged(poseOf(controls), orbit)) return
    lastOrbitRef.current = orbit
    applyOrbit(controls.object, controls, orbit)
  }, [orbit, sceneEpoch, liveControls])

  // fitPlan re-frames the plan camera outright on a band or plan-angle change, and a
  // camera-mode switch swaps which camera is authoritative. Publish the new pose so
  // the section follows instead of holding the angle nobody is looking from any more.
  useEffect(() => {
    const controls = liveControls()
    if (!controls || draggingRef.current) return
    const pose = poseOf(controls)
    if (!orbitChanged(lastOrbitRef.current, pose)) return
    lastOrbitRef.current = pose
    onOrbitChangeRef.current?.(pose)
  }, [sceneEpoch, liveControls, planAngle, focusedBand])

  useEffect(() => {
    const context = sceneRef.current
    if (!context) return
    context.cloudCanopy.update(
      showClouds ? cloudCover : 0,
      showClouds ? cloudMask : null
    )
    context.repaintClouds?.()
    context.renderer.shadowMap.needsUpdate = true
  }, [cloudCover, cloudMask, showClouds, floors, overhang, roofPitch])

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

  // Daily solar exposure on the roof. Baked once per run, because it is a
  // whole-day total: how much beam each point on each quadrant collects, minus
  // whatever the crown, the deck and the neighbouring quadrants take away.
  useEffect(() => {
    const context = sceneRef.current
    if (!context) return

    if (surfaceMode !== 'exposure' || !ticks?.length) {
      // Hand the roof back to the per-tick effect below.
      for (const face of context.roofFaces.values()) {
        const material = face.userData.heatMaterial as THREE.MeshBasicMaterial
        if (!material.vertexColors) continue
        material.vertexColors = false
        material.needsUpdate = true
      }
      setRoofRange([0, 0])
      return
    }

    // Two passes: bake every quadrant first, so the colour domain spans the
    // whole roof rather than each quadrant's own range.
    const bakes = new Map<FacadeOrientation, Float32Array>()
    let floor = Infinity
    let peak = 0
    for (const orientation of ORIENTATIONS) {
      const face = context.roofFaces.get(orientation)
      if (!face) continue
      const { exposure, min, max } = bakeExposure(
        face,
        // A quadrant cannot shadow itself, and its own proxy sits in the same
        // plane, so drop it or every point reads as shaded.
        context.roofOccluders.filter(
          (occluder) => occluder.userData.surface !== `roof:${orientation}`
        ),
        sunSamples(ticks, orientation, sunAt, SUN_SUBSTEPS)
      )
      bakes.set(orientation, exposure)
      floor = Math.min(floor, min)
      peak = Math.max(peak, max)
    }
    if (!Number.isFinite(floor)) floor = 0

    for (const [orientation, exposure] of bakes) {
      const face = context.roofFaces.get(orientation)
      if (!face) continue
      const colors = face.geometry.getAttribute(
        'color'
      ) as THREE.BufferAttribute
      for (let vertex = 0; vertex < exposure.length; vertex += 1) {
        // THREE.Color already holds linear-sRGB, the vertex attribute's space.
        const color = exposureColor(exposure[vertex], floor, peak)
        colors.setXYZ(vertex, color.r, color.g, color.b)
      }
      colors.needsUpdate = true
      const material = face.userData.heatMaterial as THREE.MeshBasicMaterial
      // vertexColors multiplies against the base colour, so it has to be white.
      material.color.set(0xffffff)
      material.map = null
      material.vertexColors = true
      material.needsUpdate = true
    }
    setRoofRange([floor, peak])
  }, [floors, overhang, roofPitch, surfaceMode, ticks])

  // Repaint for the selected tick.
  useEffect(() => {
    const context = sceneRef.current
    if (!context) return
    if (probeRef.current) probeRef.current.hidden = true

    // Set controller targets; the render loop moves the actual mechanisms.
    for (const orientation of ORIENTATIONS) {
      const assemblies = context.louvres.get(orientation)
      const wall = walls.get(orientation)
      if (!assemblies) continue
      assemblies.forEach((assembly, index) => {
        if (assembly.reflector !== solarTracking) {
          assembly.reflector = solarTracking
          setLouvreAngle(assembly, assembly.angle)
        }
        const wasVisible = assembly.group.visible
        assembly.group.visible = controlled && Boolean(wall)
        const zoneId = `${orientation[0].toUpperCase()}${index + 1}`
        const reading = wall?.zones?.find((zone) => zone.zone === zoneId)
        // A missing channel holds its last target; wall targets never drive zones.
        if (!reading || !Number.isFinite(reading.angle)) return
        assembly.targetAngle = THREE.MathUtils.clamp(reading.angle, 0, 180)
        if (controlled && (!context.posed || !wasVisible))
          setLouvreAngle(assembly, assembly.targetAngle)
      })
    }
    context.posed = true
    const sunPosition = sunAt(
      tick.solar_azimuth,
      Math.max(tick.solar_elevation, -5)
    )
    const direction = sunPosition.clone().normalize()
    const cloudReceivers = new Map<
      THREE.Mesh,
      { values: Float32Array; diffuse: number }
    >()
    const shadeClouds = (
      mesh: THREE.Mesh,
      values: Float32Array,
      diffuse: number
    ) => {
      let points = mesh.userData.cloudPoints as Float32Array | undefined
      if (!points) {
        mesh.updateWorldMatrix(true, false)
        const positions = mesh.geometry.getAttribute('position')
        const point = new THREE.Vector3()
        points = new Float32Array(values.length * 3)
        for (let index = 0; index < values.length; index++) {
          point
            .fromBufferAttribute(positions, index)
            .applyMatrix4(mesh.matrixWorld)
          point.toArray(points, index * 3)
        }
        mesh.userData.cloudPoints = points
      }
      const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute
      const shaded =
        (mesh.userData.irradiance as Float32Array | undefined) ??
        new Float32Array(values.length)
      for (let vertex = 0; vertex < values.length; vertex++) {
        const index = vertex * 3
        const transmission = context.cloudCanopy.transmission(
          points[index],
          points[index + 1],
          points[index + 2],
          direction
        )
        // A cloud blocks beam; diffuse light remains in building/louvre shade.
        shaded[vertex] =
          Math.min(values[vertex], diffuse) +
          Math.max(0, values[vertex] - diffuse) * transmission
        uv.setXY(
          vertex,
          ((shaded[vertex] / IRRADIANCE_MAX) * 255 + 0.5) / 256,
          0.5
        )
      }
      uv.needsUpdate = true
      mesh.userData.irradiance = shaded
    }
    const paintIrradiance = (
      mesh: THREE.Mesh,
      reading: FacadeHeat | RoofSegment | undefined,
      occluders: THREE.Object3D[],
      diffuseOverride?: number
    ) => {
      const material = mesh.userData.heatMaterial as THREE.MeshBasicMaterial
      material.color.set(reading ? 0xffffff : 0x9ca3af)
      material.vertexColors = false
      material.map = reading ? context.irradianceTexture : null
      material.needsUpdate = true
      mesh.userData.irradiance = undefined
      if (!reading) return
      const values = bakeIrradiance(
        mesh,
        occluders,
        reading,
        direction,
        diffuseOverride
      )
      let uv = mesh.geometry.getAttribute('uv') as
        | THREE.BufferAttribute
        | undefined
      if (!uv) {
        uv = new THREE.BufferAttribute(new Float32Array(values.length * 2), 2)
        mesh.geometry.setAttribute('uv', uv)
      }
      const diffuse = Math.max(
        0,
        diffuseOverride ?? reading.sky_diffuse + reading.ground_diffuse
      )
      cloudReceivers.set(mesh, { values, diffuse })
      shadeClouds(mesh, values, diffuse)
    }

    const wallOccludersFor = (orientation: FacadeOrientation) =>
      facadeOccluders(
        context.wallOccluders,
        context.louvres.get(orientation) ?? [],
        controlled && walls.has(orientation)
      )
    const paintWall = (
      panel: THREE.Mesh,
      wall: FacadeHeat,
      occluders: THREE.Object3D[]
    ) => {
      const zone = wall.zones?.find((zone) => zone.zone === panel.userData.zone)
      // Diffuse optics are sampled at the achieved tick angle; direct shadows
      // follow the interpolated mesh pose between ticks.
      paintIrradiance(
        panel,
        wall,
        occluders,
        controlled ? zone?.diffuse_transmitted : zone?.diffuse_incident
      )
    }
    context.repaintWalls =
      controlled && surfaceMode === 'irradiance'
        ? (orientations) => {
            for (const orientation of orientations) {
              const wall = walls.get(orientation)
              if (!wall || direction.y <= 0) continue
              const occluders = wallOccludersFor(orientation)
              context.panels
                .get(orientation)
                ?.forEach((panel) => paintWall(panel, wall, occluders))
            }
          }
        : null

    for (const orientation of ORIENTATIONS) {
      const wall = walls.get(orientation)
      // Incident POA is before shading. The mesh resolves overhang and blade
      // visibility once; zone.transmitted would count that shading a second time.
      const wallOccluders = wallOccludersFor(orientation)
      context.panels.get(orientation)?.forEach((panel, index) => {
        const material = panel.userData.heatMaterial as THREE.MeshBasicMaterial
        panel.material =
          surfaceMode === 'model' ? context.glassMaterial : material
        if (surfaceMode === 'model') return
        if (surfaceMode === 'irradiance') {
          if (wall) paintWall(panel, wall, wallOccluders)
          else paintIrradiance(panel, undefined, wallOccluders)
          return
        }
        const zone = wall?.zones?.[index]
        const fraction = Math.floor(index / PANEL_COLUMNS) / (PANEL_ROWS - 1)
        const temperature = !controlled
          ? baselineSurfaceTemperature(
              zone?.incident ?? wall?.incident ?? 0,
              tick.outdoor_temp,
              tick.wind
            )
          : (zone?.sol_air_temp ??
            (wall
              ? floorTemperature(wall, fraction, tick.outdoor_temp, tick.wind)
              : tick.outdoor_temp))
        material.vertexColors = false
        material.map = null
        material.needsUpdate = true
        material.color.copy(rampColor(temperature))
      })

      const face = context.roofFaces.get(orientation)
      if (!face) continue
      const material = face.userData.heatMaterial as THREE.MeshBasicMaterial
      face.material = surfaceMode === 'model' ? context.roofMaterial : material
      if (surfaceMode === 'irradiance') {
        paintIrradiance(
          face,
          roof.get(orientation),
          context.roofOccluders.filter(
            (occluder) => occluder.userData.surface !== `roof:${orientation}`
          )
        )
      } else if (surfaceMode === 'temp') {
        material.vertexColors = false
        material.map = null
        material.needsUpdate = true
        material.color.copy(
          rampColor(roof.get(orientation)?.sol_air_temp ?? tick.outdoor_temp)
        )
      }
    }

    context.repaintClouds =
      surfaceMode === 'irradiance'
        ? () => {
            for (const [mesh, { values, diffuse }] of cloudReceivers)
              shadeClouds(mesh, values, diffuse)
            context.refreshProbe()
          }
        : null
    context.sunlight.position.copy(sunPosition)
    context.sunlight.intensity = tick.solar_elevation > 0 ? 3 : 0.2
    context.sunMarker.position.copy(sunPosition)
    context.sunMarker.visible = tick.solar_elevation > 0
    context.renderer.shadowMap.needsUpdate = true
    if (!controlled && motionReadoutRef.current)
      motionReadoutRef.current.textContent =
        'No external louvres, actuators or control brain'
    context.refreshProbe()
  }, [
    floors,
    overhang,
    roofPitch,
    roof,
    surfaceMode,
    tick,
    walls,
    controlled,
    solarTracking,
  ])

  useEffect(() => {
    const context = sceneRef.current
    if (!context) return
    const [kind, orientation] = selected.split(':') as [
      'wall' | 'roof',
      FacadeOrientation,
    ]
    context.outline.visible = kind === 'wall'
    context.roofOutline.visible = kind === 'roof'
    context.outline.rotation.y = WALLS[orientation]
    context.roofOutline.rotation.y = WALLS[orientation]
    context.highlightZone(kind === 'wall' ? selectedZone : null)
  }, [selected, selectedZone, floors, overhang, roofPitch])

  return (
    <>
      {supported ? (
        <div
          ref={mountRef}
          className='absolute inset-0 cursor-grab active:cursor-grabbing'
          role='img'
          data-floor-scene={activeCameraMode === 'plan' ? 'true' : undefined}
          aria-label={
            activeCameraMode === 'plan'
              ? `${csiView ? 'CSI X-ray view' : planAngle === 'top' ? 'Top-down detail' : 'Stacked 3D view'} of the ${planSide} floor plans · ${focusedBand === null ? 'all four floor groups' : `${floorGroupLabel(focusedBand, floors)} selected; other levels greyed out`} · ${csiView ? 'transparent structure, simulated Wi-Fi signal waves and occupant skeletons; same camera and floor geometry' : `illustrative interiors; ${showHvac ? 'illustrative overhead HVAC supply, return and air-handling unit shown' : 'HVAC hidden'}; coloured edge shows only the ${planSide} facade readings`}`
              : surfaceMode === 'irradiance'
                ? `${BUILDING_VARIANTS[buildingVariant]}. Three-dimensional irradiance heatmap at ${timeLabel}. Blue means low irradiance, red means ${IRRADIANCE_MAX} watts per square metre or more. ${controlled ? 'Roof and louvre' : 'Passive roof and building'} shadows are sampled from the building mesh. Hover a surface for its local irradiance. Use Inspect surface for keyboard selection and the timeline for readings.`
                : surfaceMode === 'model'
                  ? `${BUILDING_VARIANTS[buildingVariant]}. Three-dimensional architectural model of ${locationName}, with glazing, floor bands, ${controlled ? 'louvres and actuators, ' : 'no external louvres or actuators, '}and a roof skylight. Drag to orbit, right-drag to pan.`
                  : surfaceMode === 'exposure'
                    ? `${BUILDING_VARIANTS[buildingVariant]}. Three-dimensional model of the building with every wall shaded by its surface temperature at ${timeLabel} and the roof shaded by its daily solar exposure, ranging from ${(roofRange[0] * 3.6).toFixed(1)} to ${(roofRange[1] * 3.6).toFixed(1)} megajoules per square metre. The roof legend shows the full daily range; the timeline shows the selected time.`
                    : `${BUILDING_VARIANTS[buildingVariant]}. Three-dimensional model of the building with every wall shaded by its surface temperature at ${timeLabel}. Select a surface to read its values in the timeline.`
          }
        />
      ) : (
        <p className='absolute inset-0 grid place-items-center p-6 text-center text-xs text-muted-foreground'>
          The 3D view needs WebGL. Select a surface above to inspect its
          readings in the timeline.
        </p>
      )}

      <div
        ref={probeRef}
        hidden
        className='pointer-events-none absolute z-20 max-w-[245px] rounded-lg border border-white/20 bg-slate-950/90 px-3 py-2 font-mono text-[11px] capitalize text-white shadow-lg'
      />

      {/* Zone bubble. The render loop positions it; React only fills it in. */}
      <div
        ref={bubbleRef}
        className='pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full pb-2'
        style={{ visibility: 'hidden' }}
      >
        {zone && (
          <ZoneBubble
            wall={walls.get(zone.orientation)}
            zone={zone}
            buildingVariant={buildingVariant}
            outdoorTemp={tick.outdoor_temp}
            wind={tick.wind}
          />
        )}
      </div>

      <div className='pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2'>
        <Hosted slot={controlsSlot}>
          <details
            className={
              controlsSlot
                ? 'console-card w-full'
                : 'stage-panel w-full max-w-[340px]'
            }
            open={viewControlsOpen}
            onToggle={(event) => setViewControlsOpen(event.currentTarget.open)}
          >
            <summary className='cursor-pointer text-[11px] font-semibold'>
              Scene controls
            </summary>
            <p
              className={
                activeCameraMode === 'plan'
                  ? 'hidden'
                  : 'flex items-center gap-1.5 text-[11px] font-semibold'
              }
            >
              <Box className='h-3.5 w-3.5 text-primary' />
              {locationName}
            </p>
            <label className='mt-2 block text-[9px] uppercase tracking-wider text-muted-foreground'>
              Monitored building
              <select
                aria-label='Monitored building'
                className='mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-semibold normal-case tracking-normal text-foreground'
                value={buildingVariant}
                disabled={!onBuildingVariantChange}
                onChange={(event) =>
                  onBuildingVariantChange?.(
                    event.target.value as BuildingVariant
                  )
                }
              >
                {Object.entries(BUILDING_VARIANTS).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {activeCameraMode !== 'plan' && (
              <label className='mt-2 block text-[9px] uppercase tracking-wider text-muted-foreground'>
                Inspect surface
                <select
                  aria-label='Inspect surface'
                  className='mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-semibold normal-case tracking-normal text-foreground'
                  value={selected}
                  onChange={(event) =>
                    onSelect(event.target.value as SurfaceId)
                  }
                >
                  {(['wall', 'roof'] as const).map((kind) => (
                    <optgroup
                      label={kind === 'wall' ? 'Facade' : 'Roof'}
                      key={kind}
                    >
                      {ORIENTATIONS.map((side) => (
                        <option key={side} value={`${kind}:${side}`}>
                          {side} {kind === 'wall' ? 'facade' : 'roof'}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
            <p
              className={
                activeCameraMode === 'plan'
                  ? 'hidden'
                  : 'mt-1 hidden text-[9px] text-muted-foreground sm:block'
              }
            >
              Same geometry, sun, time and colour scales. Only the external
              adaptive facade changes.
            </p>
            <div
              role='group'
              aria-label='Camera mode'
              className='mt-2 flex gap-1'
            >
              {CAMERA_MODES.map(([mode, label]) => (
                <button
                  type='button'
                  className='band-button'
                  aria-pressed={activeCameraMode === mode}
                  key={mode}
                  onClick={() => setCameraOverride(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            {activeCameraMode === 'plan' && (
              <>
                <div
                  role='group'
                  aria-label='Floor light visualisation'
                  className='mt-3 flex flex-wrap gap-1'
                >
                  {(
                    [
                      ['sun', 'Sun & shadows'],
                      ['et', 'Et · desk light'],
                      ['ev', 'Ev · eye light'],
                      ['off', 'Off'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type='button'
                      className='band-button'
                      aria-pressed={floorLight === mode}
                      disabled={
                        (mode === 'et' || mode === 'ev') &&
                        (!controlled || !tick.daylight)
                      }
                      onClick={() => setFloorLight(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className='mt-1 text-[9px] leading-4' aria-live='polite'>
                  {floorLight === 'sun'
                    ? tick.solar_elevation <= 0
                      ? 'Night · no direct sunlight'
                      : floorBeam(tick, planSide, band, controlled) <= 1
                        ? 'This side is shaded now. Find sunlight or move the timeline.'
                        : 'Gold: window sunlight · lines: sun paths · dark: furniture shadows.'
                    : floorLight === 'off'
                      ? 'Light overlay hidden'
                      : !controlled || !tick.daylight
                        ? 'Et/Ev readings are unavailable in this run'
                        : tick.daylight?.night
                          ? 'Night / low sun · probe readings unavailable'
                          : floorLight === 'et'
                            ? 'Et markers: blue = low · green = in band · amber = high'
                            : 'Ev markers: green → red as eye light reaches the cap'}
                </p>
                <p className='mt-1 text-[9px] text-muted-foreground'>
                  Sun paths are illustrative. Et/Ev colours use fixed model
                  probes.
                </p>
                {floorLight === 'sun' && onSelectTick && (
                  <button
                    type='button'
                    className='band-button mt-2 w-full'
                    disabled={bestSunlight < 0}
                    onClick={() => {
                      onSelectBand?.(band)
                      onSelectTick(bestSunlight)
                    }}
                  >
                    {bestSunlight < 0
                      ? 'No direct sun on this side in this run'
                      : 'Find sunlight on this side'}
                  </button>
                )}
                <div className='mt-2 flex flex-wrap gap-1'>
                  <div
                    role='group'
                    aria-label='Floor viewing angle'
                    className='flex gap-1'
                  >
                    <button
                      type='button'
                      className='band-button'
                      aria-pressed={planAngle === 'cutaway'}
                      onClick={() => setPlanAngle('cutaway')}
                    >
                      3D stack
                    </button>
                    <button
                      type='button'
                      className='band-button'
                      aria-pressed={planAngle === 'top'}
                      onClick={() => {
                        if (focusedBand === null) onSelectBand?.(band)
                        setPlanAngle('top')
                      }}
                    >
                      Top down
                    </button>
                  </div>
                  <button
                    type='button'
                    className='band-button'
                    aria-pressed={showHvac}
                    onClick={() => setShowHvac((shown) => !shown)}
                  >
                    HVAC overlay
                  </button>
                </div>
                {showHvac && (
                  <p className='mt-1 text-[9px] leading-4'>
                    <span className='font-semibold text-cyan-700'>
                      Supply → rooms
                    </span>
                    {' · '}
                    <span className='font-semibold text-amber-800'>
                      Return → AHU
                    </span>
                    {' · schematic'}
                  </p>
                )}
                <div
                  className='mt-2 flex flex-wrap gap-1'
                  role='group'
                  aria-label='Mock occupant controls'
                >
                  <button
                    type='button'
                    className='band-button'
                    aria-pressed={showPeople}
                    onClick={() => setShowPeople((shown) => !shown)}
                  >
                    People
                  </button>
                  <button
                    type='button'
                    className='band-button'
                    aria-pressed={showDetections}
                    disabled={!showPeople}
                    onClick={() => setShowDetections((shown) => !shown)}
                  >
                    Detection markers
                  </button>
                  <button
                    type='button'
                    className='band-button'
                    aria-pressed={peoplePaused}
                    disabled={!showPeople && !csiView}
                    onClick={() => setPeoplePaused((paused) => !paused)}
                  >
                    {peoplePaused ? 'Resume' : 'Pause'}{' '}
                    {csiView ? 'motion' : 'people'}
                  </button>
                </div>
                <p className='mt-1 text-[9px] text-muted-foreground'>
                  {csiView &&
                    'Expanding cyan waves: simulated Wi-Fi signal from each floor’s transmitter. '}
                  Cyan rings: mock detection. Select a floor for tracking IDs.
                  Hover people, seats or desks for details.
                </p>
                {controlled && tick.daylight && (
                  <p className='mt-1 text-[9px] leading-4'>
                    Et desks: <span className='text-blue-700'>low</span> /{' '}
                    <span className='text-emerald-700'>in band</span> /{' '}
                    <span className='text-amber-700'>high</span> (
                    {tick.daylight.et_band_low_lux}–
                    {tick.daylight.et_band_high_lux} lx). Ev seats: green → red
                    at {tick.daylight.ev_cap_lux} lx.
                    {tick.daylight.night ? ' Night: readings unavailable.' : ''}
                  </p>
                )}
                <p className='mt-2 text-[10px] font-semibold'>
                  {planSide.toUpperCase()} FLOOR STACK
                </p>
                <p className='mt-1 text-[9px] leading-4 text-muted-foreground'>
                  {focusedBand === null
                    ? 'Four levels · click a floor group to inspect'
                    : `${floorGroupLabel(focusedBand, floors)} · ${FLOOR_PLANS[floorProgram(planSide, focusedBand)].name}`}
                  <br />
                  {planAngle === 'cutaway'
                    ? 'Other levels grey out on selection · drag to rotate · right-drag to pan · scroll to zoom.'
                    : 'North up · right-drag to pan · scroll to zoom.'}
                </p>
              </>
            )}
            <details open={activeCameraMode !== 'plan'}>
              <summary
                className={
                  activeCameraMode === 'plan'
                    ? 'mt-2 cursor-pointer text-[10px] font-semibold'
                    : 'hidden'
                }
              >
                View settings
              </summary>
              {activeCameraMode !== 'plan' && controlled && (
                <label className='mt-2 block text-[10px]'>
                  <input
                    type='checkbox'
                    checked={showSunPaths}
                    onChange={(event) => setShowSunPaths(event.target.checked)}
                  />{' '}
                  Sunlight paths
                  <span className='mt-1 block text-muted-foreground'>
                    Amber → incoming · cyan → reflected. Illustrative beam
                    directions; reflected energy depends on the surface finish.
                  </span>
                </label>
              )}
              <div
                aria-label='Surface colouring'
                className='mt-2 flex flex-wrap gap-1'
                role='group'
              >
                {SURFACE_MODES.filter(
                  ([mode]) =>
                    mode !== 'exposure' ||
                    (ticks?.length && activeCameraMode !== 'plan')
                ).map(([mode, label]) => (
                  <button
                    aria-pressed={surfaceMode === mode}
                    className={
                      surfaceMode === mode
                        ? 'rounded-md bg-primary px-2 py-1.5 text-[10px] font-semibold text-primary-foreground'
                        : 'rounded-md border border-border px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-secondary/60'
                    }
                    key={mode}
                    onClick={() => setSurfaceMode(mode)}
                    type='button'
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className='mt-3 flex items-center gap-2 text-[10px]'>
                <input
                  type='checkbox'
                  checked={showClouds}
                  onChange={(event) => setShowClouds(event.target.checked)}
                />
                Clouds overhead · {Math.round(cloudCover * 100)}% ·{' '}
                {visionSky ? 'AI vision' : 'weather / simulation'}
              </label>
              {showClouds && (
                <p className='mt-1 text-[9px] text-muted-foreground'>
                  Projected cloud shadows · placement and drift modelled
                </p>
              )}
              {surfaceMode !== 'model' && (
                <div className='mt-3'>
                  <p className='mb-1.5 flex justify-between text-[9px] font-semibold uppercase tracking-wider text-muted-foreground'>
                    <span>
                      {surfaceMode === 'irradiance'
                        ? 'Surface irradiance'
                        : surfaceMode === 'exposure'
                          ? 'Roof · daily solar exposure'
                          : 'Sol-air temperature'}
                    </span>
                    <span>
                      {surfaceMode === 'irradiance'
                        ? 'W/m²'
                        : surfaceMode === 'exposure'
                          ? 'MJ/m²'
                          : '°C'}
                    </span>
                  </p>
                  <span
                    className='block h-2.5 w-full rounded-sm'
                    style={{
                      backgroundImage: `linear-gradient(to right, ${(surfaceMode ===
                      'irradiance'
                        ? IRRADIANCE_LEGEND
                        : surfaceMode === 'exposure'
                          ? EXPOSURE_RAMP
                          : HEAT_RAMP
                      ).join(', ')})`,
                    }}
                  />
                  <div className='mt-1 flex justify-between font-mono text-[9px] tabular-nums text-muted-foreground'>
                    {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                      <span key={fraction}>
                        {surfaceMode === 'irradiance'
                          ? `${fraction * IRRADIANCE_MAX}${fraction === 1 ? '+' : ''}`
                          : surfaceMode === 'exposure'
                            ? (
                                (roofRange[0] +
                                  fraction * (roofRange[1] - roofRange[0])) *
                                3.6
                              ).toFixed(1)
                            : `${Math.round(TEMP_MIN + fraction * (TEMP_MAX - TEMP_MIN))}${fraction === 1 ? '+' : ''}`}
                      </span>
                    ))}
                  </div>
                  {surfaceMode === 'exposure' && (
                    <p className='mt-1 text-[9px] text-muted-foreground'>
                      Walls: surface temperature · {TEMP_MIN}–{TEMP_MAX} °C
                      <span
                        className='ml-2 inline-block h-1.5 w-16 rounded-full'
                        style={{
                          backgroundImage: `linear-gradient(to right, ${HEAT_RAMP.join(', ')})`,
                        }}
                      />
                    </p>
                  )}
                </div>
              )}
              <p className='mt-2 hidden text-[10px] leading-relaxed text-muted-foreground sm:block'>
                {surfaceMode === 'irradiance'
                  ? controlled
                    ? 'Modelled sunlight with roof, skylight and louvre shadows. Diffuse light uses the selected tick’s optical estimate. Hover to inspect.'
                    : 'No external facade: passive roof and skylight shadows remain, without louvre shading. Hover to inspect.'
                  : surfaceMode === 'exposure'
                    ? 'Whole-day roof exposure. Unchanged between buildings; holds still as you scrub the timeline.'
                    : surfaceMode === 'model'
                      ? controlled
                        ? 'Glazed facades, metal louvres and a diamond skylight.'
                        : 'Glazing, building mass and skylight remain. No external louvres or actuators.'
                      : controlled
                        ? 'Estimated surface temperature after louvre shading.'
                        : 'Estimated surface temperature with passive shading only; no external louvres.'}
              </p>
              <p className='mt-1 text-[9px] text-muted-foreground'>
                {activeCameraMode === 'plan'
                  ? 'Select a coloured facade zone · '
                  : 'Drag to orbit · scroll to zoom · '}
                {zone
                  ? `zone ${zone.id} selected · esc to clear`
                  : 'click any zone'}
              </p>
              <div className='mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2'>
                <button
                  type='button'
                  aria-label='Focus selected facade'
                  onClick={focusFacade}
                  className='flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[10px] hover:bg-secondary/60'
                >
                  <Focus className='h-3 w-3' /> Façade detail
                </button>
                {detailedView && (
                  <button
                    type='button'
                    aria-label='Show whole building'
                    onClick={showBuilding}
                    className='rounded-md border border-border p-1.5 hover:bg-secondary/60'
                  >
                    <RotateCcw className='h-3 w-3' />
                  </button>
                )}
              </div>
              <p
                ref={motionReadoutRef}
                className='mt-1.5 font-mono text-[9px] capitalize text-muted-foreground'
              >
                {controlled
                  ? `${activeWall} louvres · follows timeline`
                  : 'No external louvres, actuators or control brain'}
              </p>
            </details>
          </details>
        </Hosted>

        <div className='stage-panel ml-auto hidden flex-col items-end gap-1 sm:flex'>
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
            · {PANEL_ROWS * PANEL_COLUMNS}{' '}
            {controlled ? 'independent sensor zones' : 'comparison regions'} per
            façade
          </span>
        </div>
      </div>
    </>
  )
}
