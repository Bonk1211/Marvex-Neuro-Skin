'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import { getDaylightSection, type SectionResponse } from '@/lib/api-client'
import { CsiPoseView } from './CsiPoseView'
import type { FacadeOrientation, TickPayload } from '@/lib/types'
import {
  csiFrame,
  csiFacadePreview,
  groupByPosture,
  primaryDetection,
  type CsiFrame,
  type CsiActivity,
  type Posture,
  type PostureGroup,
} from './csiPosture'
import {
  acrossAxis,
  applyOrbit,
  bandFlux,
  beamEntry,
  bounceRays,
  cutColumn,
  eyePoint,
  luxColor,
  patchMesh,
  roomFrame,
  sectionBar,
  orbitChanged,
  poseSkeleton,
  toBuildingAzimuth,
  toSectionAzimuth,
  topContributors,
  viewFan,
  yawExtremes,
  type OrbitAngles,
  type PatchField,
  type PosedSkeleton,
} from './sectionScene'

const SPLIT = 0.56 // share of the canvas given to the 3D view
const BOUNCE_RAYS = 14
const CSI_TICK_MS = 500

interface FloorSectionPanelProps {
  tick: TickPayload
  orientation: FacadeOrientation
  band: number
  controlled: boolean
  /** Facade zone selected elsewhere in the dashboard; scopes which occupant is cut. */
  zone?: string | null
  /** Shared orbit pose with the building scene, in that scene's frame. */
  orbit?: OrbitAngles | null
  onOrbitChange?: (orbit: OrbitAngles) => void
  compact?: boolean
  activity?: CsiActivity
  onActivityChange?: (activity: CsiActivity) => void
}

function isSectionResponse(body: unknown): body is SectionResponse {
  const candidate = body as Partial<SectionResponse> | null
  return Boolean(
    candidate &&
    Array.isArray(candidate.patches) &&
    Array.isArray(candidate.probes) &&
    Array.isArray(candidate.yaw_sweep) &&
    Array.isArray(candidate.sun) &&
    candidate.room &&
    Number.isFinite(candidate.room.width) &&
    Number.isFinite(candidate.room.height) &&
    Number.isFinite(candidate.room.depth)
  )
}

const FIELDS: { id: PatchField; label: string; hint: string }[] = [
  {
    id: 'radiosity',
    label: 'Radiosity',
    hint: 'Total light leaving each surface after four bounces',
  },
  {
    id: 'direct',
    label: 'Direct beam',
    hint: 'First-hit sun, before any bounce',
  },
  {
    id: 'contribution',
    label: 'To this eye',
    hint: 'What each surface delivers to the selected occupant',
  },
]

export function FloorSectionPanel({
  tick,
  orientation,
  band,
  controlled,
  zone = null,
  orbit = null,
  onOrbitChange,
  compact = false,
  activity: controlledActivity,
  onActivityChange,
}: FloorSectionPanelProps) {
  const [section, setSection] = useState<SectionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [field, setField] = useState<PatchField>('radiosity')
  const [followCsi, setFollowCsi] = useState(true)
  const [manualYaw, setManualYaw] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [localActivity, setLocalActivity] = useState<CsiActivity>('auto')
  const activity = controlledActivity ?? localActivity
  const setActivity = onActivityChange ?? setLocalActivity

  const flux = useMemo(
    () => bandFlux(tick, orientation, band, controlled),
    [tick, orientation, band, controlled]
  )

  // The CSI stand-in advances on its own clock so postures drift while the sun holds.
  useEffect(() => {
    const timer = setInterval(
      () => setSeconds((s) => s + CSI_TICK_MS / 1000),
      CSI_TICK_MS
    )
    return () => clearInterval(timer)
  }, [])

  const frame: CsiFrame = useMemo(() => {
    const next = csiFrame(
      section?.probes ?? [],
      activity === 'empty'
        ? 0
        : activity === 'auto'
          ? (tick.occupancy ?? 0)
          : 0.7,
      seconds
    )
    if (activity !== 'auto')
      next.detections = next.detections.map((entry) => ({
        ...entry,
        posture: activity === 'walking' ? 'walking' : 'seated',
        facingDeg: activity === 'window' ? 0 : 90,
        breathingBpm:
          activity === 'walking' ? null : (entry.breathingBpm ?? 15),
      }))
    return next
  }, [section?.probes, tick.occupancy, seconds, activity])
  const detection = useMemo(() => primaryDetection(frame, zone), [frame, zone])

  // Whole degrees: a head does not need sub-degree resolution, and rounding keeps
  // the drifting stand-in from refetching on every animation frame.
  const yawDeg = Math.round(followCsi ? (detection?.facingDeg ?? 0) : manualYaw)
  // Without a CSI detection to follow, the backend picks the brightest seat in the
  // selected zone. Pinning the previous index here would freeze the section on the
  // old occupant when the zone changes.
  const probeIndex = followCsi ? (detection?.probeIndex ?? null) : null

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      getDaylightSection(
        {
          orientation,
          band,
          beam_flux: flux.beam,
          diffuse_flux: flux.diffuse,
          solar_elevation: tick.solar_elevation,
          solar_azimuth: tick.solar_azimuth,
          probe_index: probeIndex,
          view_deg: yawDeg,
          zone,
        },
        controller.signal
      )
        .then((body) => {
          // Trust boundary: a stubbed or older backend can answer 200 with a
          // payload that has no field to draw. Refuse it rather than crash the
          // lens it is mounted in.
          if (!isSectionResponse(body)) {
            setSection(null)
            setError('Daylight section payload was not usable.')
            return
          }
          setSection(body)
          setError(null)
        })
        .catch((cause: Error) => {
          if (cause.name !== 'AbortError') setError(cause.message)
        })
    }, 120)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [
    orientation,
    band,
    flux.beam,
    flux.diffuse,
    tick.solar_elevation,
    tick.solar_azimuth,
    probeIndex,
    yawDeg,
    zone,
  ])

  const mountRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer
    world: THREE.Scene
    cut: THREE.Scene
    camera: THREE.PerspectiveCamera
    section: THREE.OrthographicCamera
    controls: OrbitControls
    content: THREE.Group[]
    people: THREE.Group[]
  } | null>(null)
  // Skeletons, animated by the render loop. Kept out of React state: the gait runs at
  // frame rate and re-rendering to move a limb would be absurd. Split by viewport
  // because LineMaterial sizes its width against the pane it is drawn into.
  const skeletonsRef = useRef<{ world: PosedSkeleton[]; cut: PosedSkeleton[] }>(
    {
      world: [],
      cut: [],
    }
  )

  // One renderer, two scissored viewports: a second WebGL context for the section
  // would double the GPU cost of the same room.
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      return // headless or WebGL-less: the readouts below still carry the numbers.
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setScissorTest(true)
    mount.appendChild(renderer.domElement)

    const world = new THREE.Scene()
    const cut = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200)
    camera.position.set(11, 7, 13)
    const sectionCamera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.1, 200)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(3.2, 1.4, 3.2)
    // Match the building scene's limits. A pose this view can reach but that one
    // clamps would desync the pair silently, since applying a pose never republishes.
    controls.minPolarAngle = 0.15
    controls.maxPolarAngle = Math.PI / 2 - 0.05
    // Right-drag pans here too, bounded to a sphere around the room so a stray drag
    // cannot leave an empty viewport with nothing to orbit back to.
    controls.cursor.copy(controls.target)
    controls.maxTargetRadius = 4

    const worldContent = new THREE.Group()
    const cutContent = new THREE.Group()
    const worldPeople = new THREE.Group()
    const cutPeople = new THREE.Group()
    world.add(worldContent, worldPeople)
    cut.add(cutContent, cutPeople)

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = (w * SPLIT) / h
      camera.updateProjectionMatrix()
      // Frame the whole room profile with a margin, so the section never crops.
      const half = 2.4
      const aspect = (w * (1 - SPLIT)) / h
      sectionCamera.top = half
      sectionCamera.bottom = -half
      sectionCamera.left = -half * aspect
      sectionCamera.right = half * aspect
      sectionCamera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(mount)

    let frameId = 0
    const started = performance.now()
    const render = () => {
      frameId = requestAnimationFrame(render)
      controls.update()
      const { clientWidth: w, clientHeight: h } = mount
      if (!w || !h) return
      const left = Math.floor(w * SPLIT)
      const seconds = (performance.now() - started) / 1000
      for (const skeleton of skeletonsRef.current.world) {
        skeleton.update(seconds)
        skeleton.setResolution(left, h)
      }
      for (const skeleton of skeletonsRef.current.cut) {
        skeleton.update(seconds)
        skeleton.setResolution(w - left, h)
      }
      renderer.setViewport(0, 0, left, h)
      renderer.setScissor(0, 0, left, h)
      renderer.render(world, camera)
      renderer.setViewport(left, 0, w - left, h)
      renderer.setScissor(left, 0, w - left, h)
      renderer.render(cut, sectionCamera)
    }
    render()

    sceneRef.current = {
      renderer,
      world,
      cut,
      camera,
      section: sectionCamera,
      controls,
      content: [worldContent, cutContent],
      people: [worldPeople, cutPeople],
    }
    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      sceneRef.current = null
    }
  }, [])

  // Orbit sync with the building scene. Only a drag emits, so applying a pose from
  // the other view cannot echo back and leave the two chasing each other.
  const draggingRef = useRef(false)
  const onOrbitChangeRef = useRef(onOrbitChange)
  onOrbitChangeRef.current = onOrbitChange
  const orientationRef = useRef(orientation)
  orientationRef.current = orientation
  const lastOrbitRef = useRef<OrbitAngles | null>(null)

  useEffect(() => {
    const controls = sceneRef.current?.controls
    if (!controls) return
    const start = () => {
      draggingRef.current = true
    }
    const end = () => {
      draggingRef.current = false
    }
    const change = () => {
      if (!draggingRef.current) return
      const pose = {
        azimuth: toBuildingAzimuth(
          controls.getAzimuthalAngle(),
          orientationRef.current
        ),
        polar: controls.getPolarAngle(),
      }
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
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !orbit || draggingRef.current) return
    const current = {
      azimuth: toBuildingAzimuth(
        scene.controls.getAzimuthalAngle(),
        orientation
      ),
      polar: scene.controls.getPolarAngle(),
    }
    if (!orbitChanged(current, orbit)) return
    lastOrbitRef.current = orbit
    applyOrbit(scene.camera, scene.controls, {
      azimuth: toSectionAzimuth(orbit.azimuth, orientation),
      polar: orbit.polar,
    })
  }, [orbit, orientation])

  // Rebuild both scenes whenever the solved field or the chosen channel changes.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !section) return
    const [worldContent, cutContent] = scene.content
    for (const group of scene.content) {
      group.clear()
    }
    const room = {
      width: section.room.width,
      height: section.room.height,
      depth: section.room.depth,
    }
    const cap = section.ev_cap_lux
    const probe = section.probes.find(
      (p) => p.index === section.selected?.index
    )
    const cutX = probe?.x ?? room.width / 2

    worldContent.add(roomFrame(room))
    for (const patch of section.patches) {
      worldContent.add(
        patchMesh(patch, field, cap, field === 'contribution' ? 0.75 : 0.55)
      )
    }

    if (probe) {
      const eye = eyePoint(probe)
      const rays = topContributors(section.patches, BOUNCE_RAYS)
      worldContent.add(bounceRays(rays, eye, cap))
      worldContent.add(viewFan(eye, section.selected?.view_deg ?? 0))
      cutContent.add(viewFan(eye, section.selected?.view_deg ?? 0, 1.4))

      // The unbounced beam: glazing entry to first-hit, for every lit patch in the cut.
      for (const patch of cutColumn(section.patches, cutX, room)) {
        if (patch.direct_lux <= 0) continue
        const hit = new THREE.Vector3(...patch.centre)
        const entry = beamEntry(section.sun, hit, room)
        if (!entry) continue
        for (const [group, x] of [
          [worldContent, null],
          [cutContent, cutX],
        ] as const) {
          const from = entry.clone()
          const to = hit.clone()
          if (x !== null) {
            from.setX(x)
            to.setX(x)
          }
          group.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([from, to]),
              new THREE.LineBasicMaterial({
                color: '#e8b86a',
                transparent: true,
                opacity: 0.9,
              })
            )
          )
        }
      }
    }

    // Section: the cut column as bars, plus the two planes the numbers refer to.
    for (const patch of cutColumn(section.patches, cutX, room)) {
      const bar = sectionBar(patch, room, field, cap, cutX)
      if (bar) cutContent.add(bar)
    }
    const profile = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(cutX, 0, 0),
      new THREE.Vector3(cutX, room.height, 0),
      new THREE.Vector3(cutX, room.height, room.depth),
      new THREE.Vector3(cutX, 0, room.depth),
      new THREE.Vector3(cutX, 0, 0),
    ])
    cutContent.add(
      new THREE.Line(profile, new THREE.LineBasicMaterial({ color: '#8b9691' }))
    )
    for (const [y, color] of [
      [section.room.desk_height, '#6484a0'],
      [probe?.height_m ?? 1.2, '#8fd4bb'],
    ] as const) {
      cutContent.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(cutX, y, 0),
            new THREE.Vector3(cutX, y, room.depth),
          ]),
          new THREE.LineDashedMaterial({ color, dashSize: 0.16, gapSize: 0.12 })
        ).computeLineDistances()
      )
    }
    if (probe) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 12, 12),
        new THREE.MeshBasicMaterial({ color: '#f4f7f5' })
      )
      eye.position.set(cutX, probe.height_m, probe.z)
      cutContent.add(eye)
      cutContent.add(
        bounceRays(
          topContributors(cutColumn(section.patches, cutX, room), 8),
          new THREE.Vector3(cutX, probe.height_m, probe.z),
          cap
        )
      )
    }

    scene.section.position.set(cutX - 12, room.height / 2, room.depth / 2)
    scene.section.lookAt(cutX, room.height / 2, room.depth / 2)
  }, [section, field])

  // Occupants, rebuilt whenever the CSI frame changes. Separate from the light scene
  // because detections tick several times a second and the radiosity field does not.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !section) return
    const [worldPeople, cutPeople] = scene.people
    for (const group of scene.people) {
      group.traverse((object) => {
        const disposable = object as Partial<THREE.Mesh>
        if (disposable.geometry) disposable.geometry.dispose()
        const material = disposable.material
        if (material && !Array.isArray(material)) material.dispose()
      })
      group.clear()
    }

    const world: PosedSkeleton[] = []
    const inCutPlane: PosedSkeleton[] = []
    const probes = new Map(section.probes.map((p) => [p.index, p]))
    const chosen = section.selected?.index ?? null
    const cutProbe = chosen === null ? undefined : probes.get(chosen)
    const cutX = cutProbe?.x ?? section.room.width / 2

    for (const d of frame.detections) {
      const probe = probes.get(d.probeIndex)
      if (!probe) continue
      const skeleton = poseSkeleton(
        d,
        new THREE.Vector3(probe.x, 0, probe.z),
        acrossAxis(d.facingDeg),
        d.probeIndex === chosen ? 1 : 0.5
      )
      worldPeople.add(skeleton.object)
      world.push(skeleton)

      // In the section the same occupant is laid into the cut plane, the way a section
      // drawing shows a figure it slices through rather than edge-on as a single line.
      if (d.probeIndex === chosen) {
        const inCut = poseSkeleton(
          d,
          new THREE.Vector3(cutX, 0, probe.z),
          new THREE.Vector3(0, 0, 1),
          0.95
        )
        cutPeople.add(inCut.object)
        inCutPlane.push(inCut)
      }
    }

    // Seats the layout models but the node did not detect anyone in.
    const detected = new Set(frame.detections.map((d) => d.probeIndex))
    for (const probe of section.probes) {
      if (probe.kind !== 'seat' || detected.has(probe.index)) continue
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 8, 8),
        new THREE.MeshBasicMaterial({ color: '#46524e' })
      )
      marker.position.copy(eyePoint(probe))
      worldPeople.add(marker)
    }
    skeletonsRef.current = { world, cut: inCutPlane }
  }, [section, frame.detections])

  const selected = section?.selected ?? null
  const extremes = useMemo(
    () => (section ? yawExtremes(section.yaw_sweep) : null),
    [section]
  )
  const probe = section?.probes.find((p) => p.index === selected?.index)
  const wall = tick.facade.find((entry) => entry.orientation === orientation)
  const local = wall?.zones?.find(
    (entry) => entry.zone === (detection?.zone ?? zone)
  )
  const currentAngle = local?.angle ?? wall?.angle ?? tick.angle_final
  const preview =
    controlled && selected && section
      ? csiFacadePreview({
          angle: currentAngle,
          ev: selected.eye_lux,
          et: selected.task_lux,
          cap: section.ev_cap_lux,
          etLow: tick.daylight?.et_band_low_lux,
          etHigh: tick.daylight?.et_band_high_lux,
          posture: detection?.posture ?? null,
          safe: (local?.mode ?? wall?.mode ?? tick.mode) === 'SAFE',
        })
      : null

  return (
    <section
      className='floor-comfort rounded-2xl border border-white/10 bg-[#14251f] p-4 text-white'
      aria-label='CSI comfort response'
      data-compact={compact}
    >
      <header className='mb-3 flex flex-wrap items-baseline justify-between gap-2'>
        <div>
          <h3 className='text-sm font-semibold text-white'>
            {compact
              ? 'CSI → comfort → façade'
              : 'Sense people. Predict comfort. Adapt the façade.'}
          </h3>
          <p className='text-xs text-white/50'>
            {orientation} wall, band {band + 1}
            {probe ? ` · zone ${probe.zone}` : ''}
            {!compact && (
              <>
                {' '}
                · {section?.bounces ?? 4} diffuse bounces ·{' '}
                {flux.beam.toFixed(0)} W/m² beam + {flux.diffuse.toFixed(0)}{' '}
                W/m² diffuse at the glazing
              </>
            )}
          </p>
        </div>
        <span className='rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200'>
          Modelled · not measured
        </span>
      </header>

      <div
        className='csi-activity'
        role='group'
        aria-label='Simulated CSI activity'
      >
        {(['auto', 'working', 'window', 'walking', 'empty'] as const).map(
          (id, index) => (
            <button
              key={id}
              type='button'
              aria-pressed={activity === id}
              onClick={() => {
                setActivity(id)
                setFollowCsi(true)
              }}
            >
              {
                [
                  'Auto CSI',
                  'Working at desk',
                  'Facing window',
                  'Walking past',
                  'Empty room',
                ][index]
              }
            </button>
          )
        )}
      </div>
      {compact && (
        <p className='mb-3 text-[11px] text-white/65'>
          Scripted WiFi detections ·{' '}
          {detection
            ? `${detection.posture} · facing ${detection.facingDeg.toFixed(0)}°`
            : 'no occupant detected'}
          . The same floor remains in view.
        </p>
      )}
      <div className='csi-response-grid'>
        {!compact && <CsiCard frame={frame} detection={detection} />}
        <div className='csi-decision'>
          <p className='text-[10px] font-semibold uppercase tracking-widest text-[#a9d8bf]'>
            02 · Predict Ev / Et
          </p>
          <p className='mt-1 text-[11px] text-white/60'>
            CSI position + facing direction → daylight model
          </p>
          <div className='csi-light-readings'>
            <div>
              <span>Ev · eye comfort</span>
              <strong>
                {selected ? selected.eye_lux.toFixed(0) : '—'} <small>lx</small>
              </strong>
              <small>Cap {section?.ev_cap_lux ?? 1000} lx</small>
            </div>
            <div>
              <span>Et · desk light</span>
              <strong>
                {selected ? selected.task_lux.toFixed(0) : '—'}{' '}
                <small>lx</small>
              </strong>
              <small>
                Useful {tick.daylight?.et_band_low_lux ?? 300}–
                {tick.daylight?.et_band_high_lux ?? 500} lx
              </small>
            </div>
          </div>
          <div className='mt-4 border-t border-white/10 pt-3'>
            <p className='text-[10px] font-semibold uppercase tracking-widest text-[#a9d8bf]'>
              03 · Adapt the façade
            </p>
            <div className='flex items-center gap-4'>
              <svg
                viewBox='0 0 156 110'
                className='h-28 w-36 shrink-0'
                role='img'
                aria-label={`Façade preview at ${(preview?.angle ?? currentAngle).toFixed(0)} degrees`}
              >
                <rect
                  x='5'
                  y='7'
                  width='145'
                  height='96'
                  rx='8'
                  fill='#203c31'
                  stroke='#4f7563'
                />
                {[0, 1, 2, 3, 4].map((i) => (
                  <g key={i} transform={`translate(${24 + i * 27} 55)`}>
                    <rect
                      className='csi-blade'
                      x='-5'
                      y='-39'
                      width='10'
                      height='78'
                      rx='3'
                      fill='#a5d6bc'
                      style={{
                        transform: `rotate(${preview?.angle ?? currentAngle}deg)`,
                      }}
                    />
                  </g>
                ))}
              </svg>
              <div>
                <p className='text-2xl font-semibold'>
                  {currentAngle.toFixed(0)}°{' '}
                  <span className='text-white/35'>→</span>{' '}
                  {preview?.angle.toFixed(0) ?? '—'}°
                </p>
                <p className='mt-1 text-[10px] text-white/55'>
                  Applied → policy preview
                </p>
              </div>
            </div>
            <p className='text-xs leading-relaxed text-white/85'>
              {preview?.reason ??
                (controlled
                  ? 'Waiting for daylight predictions.'
                  : 'This building has no external façade controller.')}
            </p>
            {preview && (
              <p className='mt-2 text-[11px] text-[#a9d8bf]'>
                Estimated after: Ev {preview.ev.toFixed(0)} lx · Et{' '}
                {preview.et.toFixed(0)} lx
                <br />
                {Math.abs(preview.solarChange).toFixed(0)}%{' '}
                {preview.solarChange >= 0 ? 'less' : 'more'} solar transmission
              </p>
            )}
            <p className='mt-3 text-[10px] leading-relaxed text-white/50'>
              Illustrative control preview · approximate light response. The
              simulation&rsquo;s applied angle remains visible for comparison.
            </p>
          </div>
        </div>
      </div>

      {!compact && (
        <>
          <h4 className='mb-2 mt-5 text-xs font-semibold text-white/70'>
            Inspect the daylight model · room & occupant section
          </h4>

          <div
            ref={mountRef}
            className='h-[380px] w-full overflow-hidden rounded-xl bg-[#0d1412]'
          />

          <div className='mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/45'>
            <span>
              Left: room in 3D, drag to orbit and right-drag to pan. Right:
              section at the occupant, glazing on the left.
            </span>
            <span className='text-[#e8b86a]'>— direct beam</span>
            <span className='text-[#8fd4bb]'>
              — eye plane {probe ? probe.height_m.toFixed(2) : '1.20'} m
            </span>
            <span className='text-[#6484a0]'>
              — work plane {(section?.room.desk_height ?? 0.75).toFixed(2)} m
            </span>
          </div>

          <div className='mt-3 flex flex-wrap gap-2'>
            {FIELDS.map((option) => (
              <button
                key={option.id}
                type='button'
                title={option.hint}
                onClick={() => setField(option.id)}
                className={`rounded-lg px-3 py-1 text-xs transition ${
                  field === option.id
                    ? 'bg-mint/20 text-mint'
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className='mt-4 grid gap-4 lg:grid-cols-2'>
            <div className='rounded-xl border border-white/10 bg-black/20 p-3'>
              <div className='flex items-center justify-between'>
                <h4 className='text-xs font-semibold uppercase tracking-wide text-white/60'>
                  Head yaw
                </h4>
                <label className='flex items-center gap-2 text-xs text-white/60'>
                  <input
                    type='checkbox'
                    checked={followCsi}
                    onChange={(event) => setFollowCsi(event.target.checked)}
                  />
                  follow CSI
                </label>
              </div>
              <input
                type='range'
                min={0}
                max={359}
                value={yawDeg}
                disabled={followCsi}
                onChange={(event) => setManualYaw(Number(event.target.value))}
                className='mt-3 w-full accent-mint disabled:opacity-40'
              />
              <p className='mt-1 text-xs text-white/50'>
                {yawDeg}° from the glazing
                {followCsi ? ' · driven by the CSI stand-in' : ''}
              </p>
              {section && extremes ? (
                <YawSweep
                  sweep={section.yaw_sweep}
                  current={yawDeg}
                  comfort={section.ev_comfort_lux}
                  cap={section.ev_cap_lux}
                />
              ) : null}
              {extremes ? (
                <p className='mt-2 text-xs text-white/60'>
                  Same seat, same louvre, same sun:{' '}
                  <span className='text-white'>
                    {extremes.best.eye_lux.toFixed(0)} lx
                  </span>{' '}
                  at {extremes.best.view_deg}° down to{' '}
                  <span className='text-white'>
                    {extremes.worst.eye_lux.toFixed(0)} lx
                  </span>{' '}
                  at {extremes.worst.view_deg}° —{' '}
                  <span className='text-mint'>
                    {Number.isFinite(extremes.ratio)
                      ? `${extremes.ratio.toFixed(1)}×`
                      : '∞'}
                  </span>{' '}
                  on head angle alone.
                </p>
              ) : null}
            </div>

            <div className='rounded-xl border border-white/10 bg-black/20 p-3'>
              <h4 className='text-xs font-semibold uppercase tracking-wide text-white/60'>
                Eye illuminance now
              </h4>
              {selected ? (
                <>
                  <p className='mt-2 text-2xl font-semibold text-white'>
                    {selected.eye_lux.toFixed(0)}{' '}
                    <span className='text-sm font-normal text-white/50'>
                      lx Ev
                    </span>
                    {selected.over_cap ? (
                      <span className='ml-2 rounded bg-amber-400/20 px-2 py-0.5 text-xs text-amber-200'>
                        over {section!.ev_cap_lux.toFixed(0)} lx cap
                      </span>
                    ) : null}
                  </p>
                  <dl className='mt-3 space-y-1 text-xs text-white/60'>
                    <Row
                      label='Direct sun into the eye'
                      value={`${selected.eye_direct_lux.toFixed(0)} lx`}
                    />
                    <Row
                      label='Interreflected off surfaces'
                      value={`${selected.eye_interreflected_lux.toFixed(0)} lx`}
                    />
                    <Row
                      label='Task plane Et'
                      value={`${selected.task_lux.toFixed(0)} lx`}
                    />
                  </dl>
                  {section ? <TopSurfaces section={section} /> : null}
                </>
              ) : (
                <p className='mt-2 text-xs text-white/50'>
                  {error ?? 'No occupant selected on this band.'}
                </p>
              )}
            </div>
          </div>

          {section ? (
            <p className='mt-3 text-[11px] leading-relaxed text-white/40'>
              {section.provenance}
            </p>
          ) : null}
        </>
      )}
      {error ? <p className='mt-2 text-xs text-amber-300'>{error}</p> : null}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex justify-between gap-4'>
      <dt>{label}</dt>
      <dd className='text-white/80'>{value}</dd>
    </div>
  )
}

/** The handful of surfaces actually carrying this occupant's light. */
function TopSurfaces({ section }: { section: SectionResponse }) {
  const room = {
    width: section.room.width,
    height: section.room.height,
    depth: section.room.depth,
  }
  const top = topContributors(section.patches, 4)
  if (!top.length) return null
  const total = section.selected?.eye_interreflected_lux || 1
  return (
    <div className='mt-3 border-t border-white/10 pt-2'>
      <p className='text-[11px] uppercase tracking-wide text-white/40'>
        Biggest bounce sources
      </p>
      <ul className='mt-1 space-y-1 text-xs text-white/60'>
        {top.map((patch, i) => (
          <li key={i} className='flex items-center gap-2'>
            <span
              className='inline-block h-2 w-2 rounded-sm'
              style={{
                background: `#${luxColor(patch.contribution_lux, section.ev_cap_lux / 8).getHexString()}`,
              }}
            />
            <span className='flex-1'>
              {faceLabel(patch.normal, patch.centre, room)} at{' '}
              {patch.centre[2].toFixed(1)} m deep
            </span>
            <span className='text-white/80'>
              {((patch.contribution_lux / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function faceLabel(
  normal: [number, number, number],
  centre: [number, number, number],
  room: { height: number; depth: number }
) {
  if (Math.abs(normal[1]) > 0.5)
    return centre[1] < room.height / 2 ? 'Floor' : 'Ceiling'
  if (Math.abs(normal[2]) > 0.5)
    return centre[2] < room.depth / 2 ? 'Glazing' : 'Back wall'
  return 'Side wall'
}

function YawSweep({
  sweep,
  current,
  comfort,
  cap,
}: {
  sweep: SectionResponse['yaw_sweep']
  current: number
  comfort: number
  cap: number
}) {
  if (sweep.length < 2) return null
  const peak = Math.max(cap, ...sweep.map((s) => s.eye_lux))
  const x = (deg: number) => (deg / 360) * 100
  const y = (lux: number) => 100 - (lux / peak) * 100
  const path = sweep
    .map((s, i) => `${i ? 'L' : 'M'}${x(s.view_deg)},${y(s.eye_lux)}`)
    .join(' ')
  return (
    <svg
      viewBox='0 0 100 100'
      preserveAspectRatio='none'
      className='mt-3 h-24 w-full'
    >
      <line
        x1={0}
        x2={100}
        y1={y(cap)}
        y2={y(cap)}
        stroke='#e8b86a'
        strokeWidth={0.6}
        strokeDasharray='2 2'
      />
      <line
        x1={0}
        x2={100}
        y1={y(comfort)}
        y2={y(comfort)}
        stroke='#6484a0'
        strokeWidth={0.6}
        strokeDasharray='2 2'
      />
      <path
        d={path}
        fill='none'
        stroke='#8fd4bb'
        strokeWidth={1.4}
        vectorEffect='non-scaling-stroke'
      />
      <line
        x1={x(current)}
        x2={x(current)}
        y1={0}
        y2={100}
        stroke='#f4f7f5'
        strokeWidth={0.6}
      />
    </svg>
  )
}

/**
 * What each posture means for this panel. Seated occupants are the ones Ev is about
 * and the ones CSI reads worst, which is the honest tension worth showing rather than
 * a single undifferentiated head count.
 */
const POSTURE_CARDS: Record<
  Posture,
  { label: string; colour: string; note: string }
> = {
  seated: {
    label: 'Seated',
    colour: '#8fd4bb',
    note: 'Ev is decided here · hardest to detect, breathing only',
  },
  standing: {
    label: 'Standing',
    colour: '#6484a0',
    note: 'Eye height moves up · brief exposure',
  },
  walking: {
    label: 'Walking',
    colour: '#e8b86a',
    note: 'Easiest to detect · glare too short to act on',
  },
}

function CsiCard({
  frame,
  detection,
}: {
  frame: CsiFrame
  detection: ReturnType<typeof primaryDetection>
}) {
  const groups = groupByPosture(frame)
  return (
    <div className='rounded-xl border border-white/10 bg-black/15 p-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h4 className='text-xs font-semibold uppercase tracking-wide text-amber-200'>
          01 · WiFi CSI · simulated
        </h4>
        <span className='text-[11px] text-amber-200/70'>
          node {frame.node} · {frame.subcarriers} subcarriers ·{' '}
          {frame.framesPerSecond} fps · {frame.rssiDbm} dBm
        </span>
      </div>
      <p className='mt-1 text-[11px] leading-relaxed text-amber-100/70'>
        {frame.detections.length} occupants ·{' '}
        {detection
          ? `${detection.posture} · facing ${detection.facingDeg.toFixed(0)}°`
          : 'room vacant'}
        . Scripted radio detections drive the modelled eye-light calculation.
      </p>
      <div className='mt-3'>
        <CsiPoseView
          detections={frame.detections}
          selected={detection?.probeIndex ?? null}
        />
        <p className='mt-1 text-[10px] leading-snug text-white/40'>
          WiFi confidence field → reconstructed pose. Larger fields indicate
          greater uncertainty.
        </p>
      </div>
      <details className='mt-3'>
        <summary className='cursor-pointer text-[11px] text-white/60'>
          Posture confidence & detections
        </summary>
        <div className='mt-2 grid gap-2 sm:grid-cols-3'>
          {groups.map((group) => (
            <PostureCard
              key={group.posture}
              group={group}
              selected={detection?.probeIndex ?? null}
            />
          ))}
        </div>
      </details>
    </div>
  )
}

function PostureCard({
  group,
  selected,
}: {
  group: PostureGroup
  selected: number | null
}) {
  const card = POSTURE_CARDS[group.posture]
  const empty = group.detections.length === 0
  const shown = group.detections.slice(0, 4)
  return (
    <div
      className='rounded-lg border border-white/10 bg-black/30 p-2'
      style={{ borderLeft: `3px solid ${empty ? '#3d4643' : card.colour}` }}
    >
      <div className='flex items-baseline justify-between gap-2'>
        <span
          className='text-[11px] font-semibold uppercase tracking-wide'
          style={{ color: empty ? '#6d7a75' : card.colour }}
        >
          {card.label}
        </span>
        <span
          className={`text-2xl font-semibold ${empty ? 'text-white/25' : 'text-white'}`}
        >
          {group.detections.length}
        </span>
      </div>
      <p className='mt-0.5 text-[10px] leading-snug text-white/40'>
        {card.note}
      </p>
      {empty ? (
        <p className='mt-2 text-[11px] text-white/30'>none on this band</p>
      ) : (
        <>
          <p className='mt-1 text-[10px] text-white/45'>
            CSI confidence {(group.meanConfidence * 100).toFixed(0)}% mean
          </p>
          <ul className='mt-1.5 space-y-0.5 text-[11px]'>
            {shown.map((d) => (
              <li
                key={d.probeIndex}
                className={`flex items-center justify-between gap-2 rounded px-1.5 py-0.5 ${
                  d.probeIndex === selected
                    ? 'bg-white/15 text-white'
                    : 'bg-white/5 text-white/60'
                }`}
              >
                <span>
                  {d.zone}
                  {d.probeIndex === selected ? ' · cut here' : ''}
                </span>
                <span className='text-white/45'>
                  {d.facingDeg.toFixed(0)}°
                  {d.breathingBpm ? ` · ${d.breathingBpm} bpm` : ''}
                </span>
              </li>
            ))}
          </ul>
          {group.detections.length > shown.length ? (
            <p className='mt-1 text-[10px] text-white/35'>
              +{group.detections.length - shown.length} more
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
