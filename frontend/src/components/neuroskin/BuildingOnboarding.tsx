'use client'

import { useRouter } from 'next/navigation'
import {
  Bot,
  Building2,
  Check,
  FileText,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import {
  getOnboarding,
  uploadOnboardingDocument,
  type DocumentKind,
  type OnboardingState,
} from '@/lib/api-client'

/** The three drops, in order, each mapped to the readiness row it settles. */
const STEPS: {
  kind: DocumentKind
  row: string
  ask: string
  hint: string
  sample: string
}[] = [
  {
    kind: 'structure',
    row: 'geometry',
    ask: 'Start with the building design — a facade study, as-built drawings, elevations or floor plans.',
    hint: 'Building design',
    sample: 'st-diamond-axonometric.jpg',
  },
  {
    kind: 'location',
    row: 'site',
    ask: 'Now the site: a site plan, land survey, or any document carrying the address.',
    hint: 'Building location',
    sample: 'site-plan.pdf',
  },
  {
    kind: 'hvac',
    row: 'hvac',
    ask: 'Last one — HVAC. A chiller schedule, BMS point list or maintenance report.',
    hint: 'HVAC details',
    sample: 'chiller-schedule.csv',
  },
]

// Honest labels: the document is stored against the building, not text-extracted.
// The demo uploads the three above; the elevations PDF is there to drag in by hand.
const SAMPLE_FILES = [
  ...STEPS.map((step) => step.sample),
  'facade-elevations.pdf',
]

const PARSE_STEPS = [
  'Uploading the document',
  'Filing it against your building',
  'Confirming the twin inputs',
]

const OPENING =
  'Hi — I am the NeuroSkin commissioning agent. Choose Demo setup to walk through the sample building design, site and HVAC documents, or attach your own. I will assemble the geometry, then open your engineering console.'

interface Message {
  id: number
  from: 'bot' | 'you'
  text: string
  /** Object URL for a dropped image, so a design sketch shows in the thread. */
  preview?: string
}

function previewOf(file: File): string | undefined {
  if (!file.type.startsWith('image/')) return undefined
  try {
    return URL.createObjectURL(file)
  } catch {
    return undefined // no object URLs here; the filename alone carries the message
  }
}

/** Motion is decoration here; a reader who opted out gets the same flow instantly. */
function stillnessPreferred(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const wait = (ms: number) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, stillnessPreferred() ? 0 : ms)
  )

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    // Result is a data URL; the payload after the comma is the base64 body.
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.readAsDataURL(file)
  })
}

export function BuildingOnboarding() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, from: 'bot', text: OPENING },
    { id: 1, from: 'bot', text: STEPS[0].ask },
  ])
  const [index, setIndex] = useState(0)
  const [parsing, setParsing] = useState<{ name: string; step: number } | null>(
    null
  )
  const [built, setBuilt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<OnboardingState | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  // The demo runs the three drops in one go, so the step and the busy flag live
  // in refs: state set inside that loop is a render behind.
  const step = useRef(0)
  const busy = useRef(false)
  const previews = useRef<string[]>([])
  const mounted = useRef(true)
  const done = index >= STEPS.length

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    getOnboarding(controller.signal)
      .then(setState)
      .catch(() => undefined)
    return () => {
      mounted.current = false
      controller.abort()
    }
  }, [])

  useEffect(() => {
    const log = transcript.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages, parsing, built])

  const say = (from: Message['from'], text: string, preview?: string) =>
    setMessages((current) => [
      ...current,
      { id: current.length + 2, from, text, preview },
    ])

  // Object URLs live as long as the thread does; releasing them on any message
  // change would blank a thumbnail that is still on screen.
  useEffect(
    () => () => previews.current.forEach((url) => URL.revokeObjectURL(url)),
    []
  )

  /** One assembly clock drives the scene, stage labels and final navigation. */
  const buildTwin = async (next: OnboardingState) => {
    say('bot', 'That is everything I need. Building your twin…')
    const floors = Math.min(Math.max(next.profile.structure.floors, 1), 14)
    for (let phase = 0; phase <= floors + 4; phase += 1) {
      if (!mounted.current) return
      setBuilt(phase)
      await wait(phase === 0 ? 700 : phase <= floors ? 380 : 1100)
    }
    if (mounted.current) router.push('/dashboard')
  }

  const handleFile = async (file: File | undefined) => {
    const at = step.current
    if (!file || busy.current || at >= STEPS.length) return
    if (file.size > 8_000_000) {
      setError(`${file.name} is over the 8 MB limit.`)
      return
    }
    const current = STEPS[at]
    busy.current = true
    setError(null)
    const preview = previewOf(file)
    if (preview) previews.current.push(preview)
    say('you', file.name, preview)

    try {
      const content = await readAsBase64(file)
      const upload = uploadOnboardingDocument({
        name: file.name,
        kind: current.kind,
        content,
      })
      // The upload flies while the animation plays, so park its rejection here;
      // the await below is what actually reports it.
      upload.catch(() => undefined)
      for (let line = 0; line < PARSE_STEPS.length; line += 1) {
        setParsing({ name: file.name, step: line })
        await wait(700)
      }
      const next = await upload
      setParsing(null)
      setState(next)
      const row = next.readiness.find((item) => item.id === current.row)
      say('bot', `Filed. Twin inputs: ${row?.detail ?? 'unchanged.'}`)
      step.current = at + 1
      setIndex(at + 1)
      busy.current = false
      if (at + 1 < STEPS.length) {
        await wait(400)
        say('bot', STEPS[at + 1].ask)
      } else {
        await wait(400)
        await buildTwin(next)
      }
    } catch (cause) {
      busy.current = false
      setParsing(null)
      setError((cause as Error).message)
      say('bot', 'That upload did not land. Try the same file again.')
    }
  }

  /** One click: fetch the three sample documents and walk the same flow. */
  const runDemo = async () => {
    if (busy.current || done) return
    for (const item of STEPS.slice(step.current)) {
      try {
        const response = await fetch(`/samples/${item.sample}`)
        if (!response.ok) throw new Error(`Missing sample ${item.sample}.`)
        const blob = await response.blob()
        await handleFile(new File([blob], item.sample, { type: blob.type }))
      } catch (cause) {
        setError((cause as Error).message)
        return
      }
    }
  }

  return (
    <main className='flex min-h-screen flex-col bg-secondary/40 px-4 py-6 sm:px-8'>
      <div
        className={`mx-auto flex w-full flex-1 flex-col ${built === null ? 'max-w-2xl' : 'max-w-5xl'}`}
      >
        <header className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <p className='eyebrow flex items-center gap-1.5'>
              <Building2 className='h-3 w-3' /> Building manager
            </p>
            <h1 className='mt-1 font-display text-2xl font-semibold tracking-tight'>
              Onboard your building
            </h1>
          </div>
          <p className='rounded-full border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700'>
            {state?.site_visits_required ?? 0} site visits ·{' '}
            {state?.extra_hardware_required
              ? 'new hardware'
              : 'no new hardware'}
          </p>
        </header>

        {built !== null && state && (
          <GeometryAssembly phase={built} profile={state.profile} />
        )}

        <div
          ref={transcript}
          aria-label='Onboarding conversation'
          aria-live='polite'
          className={
            built === null
              ? 'surface-card mt-4 flex-1 space-y-3 overflow-y-auto p-4'
              : 'hidden'
          }
          role='log'
        >
          {messages.map((message) =>
            message.from === 'bot' ? (
              <div key={message.id} className='flex gap-2'>
                <span className='setting-group-icon shrink-0'>
                  <Bot className='h-4 w-4' />
                </span>
                <p className='max-w-[85%] rounded-2xl rounded-tl-sm bg-background px-3 py-2 text-xs leading-5'>
                  {message.text}
                </p>
              </div>
            ) : (
              <div key={message.id} className='flex justify-end'>
                <div className='max-w-[85%] overflow-hidden rounded-2xl rounded-tr-sm bg-forest'>
                  {message.preview && (
                    // eslint-disable-next-line @next/next/no-img-element -- object URL, not an asset
                    <img
                      alt={`Preview of ${message.text}`}
                      className='max-h-40 w-full bg-white object-contain'
                      src={message.preview}
                    />
                  )}
                  <p className='flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white'>
                    <FileText className='h-3.5 w-3.5 shrink-0 text-mint' />
                    {message.text}
                  </p>
                </div>
              </div>
            )
          )}

          {parsing && (
            <div className='flex gap-2'>
              <span className='setting-group-icon shrink-0'>
                <Bot className='h-4 w-4' />
              </span>
              <ul className='min-w-[15rem] space-y-1.5 rounded-2xl rounded-tl-sm bg-background px-3 py-2'>
                {PARSE_STEPS.map((label, line) => (
                  <li
                    key={label}
                    className={`flex items-center gap-2 text-[11px] transition ${
                      line <= parsing.step
                        ? 'text-foreground'
                        : 'text-muted-foreground/50'
                    }`}
                  >
                    {line < parsing.step ? (
                      <Check className='h-3.5 w-3.5 text-emerald-600' />
                    ) : line === parsing.step ? (
                      <Loader2 className='h-3.5 w-3.5 animate-spin text-primary' />
                    ) : (
                      <span className='h-3.5 w-3.5' />
                    )}
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {error && (
          <p
            role='alert'
            className='mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive'
          >
            {error}
          </p>
        )}

        <div className={built === null ? 'mt-3' : 'hidden'}>
          <button
            type='button'
            disabled={!!parsing || done}
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              void handleFile(event.dataTransfer.files?.[0])
            }}
            className='flex w-full flex-col items-center gap-1 rounded-2xl border border-dashed border-border bg-white/70 px-4 py-6 text-center transition hover:border-primary/40 disabled:opacity-60'
          >
            <Upload className='h-4 w-4 text-primary' />
            <span className='text-xs font-semibold'>
              {done
                ? 'All three filed'
                : `Drop ${STEPS[index].hint.toLowerCase()} here, or click to pick a file`}
            </span>
            <span className='text-[10px] text-muted-foreground'>
              Document {Math.min(index + 1, STEPS.length)} of {STEPS.length} ·
              PDF, image or spreadsheet, up to 8 MB
            </span>
          </button>
          <input
            ref={fileInput}
            type='file'
            className='hidden'
            aria-label='Attach document'
            onChange={(event) => {
              void handleFile(event.target.files?.[0])
              event.target.value = '' // let the same file be re-attached
            }}
          />
          <button
            type='button'
            className='landing-nav-cta mt-2 w-full justify-center disabled:opacity-50'
            disabled={!!parsing || done}
            onClick={() => void runDemo()}
          >
            <Sparkles className='h-3.5 w-3.5' /> Demo setup
          </button>
          <p className='mt-2 text-center text-[10px] text-muted-foreground'>
            Samples:{' '}
            {SAMPLE_FILES.map((name, position) => (
              <span key={name}>
                {position > 0 && ' · '}
                <a
                  className='underline-offset-2 hover:underline'
                  href={`/samples/${name}`}
                  target='_blank'
                  rel='noreferrer'
                >
                  {name}
                </a>
              </span>
            ))}
            <br />
            Axonometric: ST Diamond Building, Greening Asia — Emerging
            Principles for Sustainable Architecture.
          </p>
          <button
            type='button'
            className='mt-2 w-full text-[11px] text-muted-foreground underline-offset-2 hover:underline'
            onClick={() => router.push('/dashboard')}
          >
            Skip — the twin already runs on commissioning defaults
          </button>
        </div>
      </div>
    </main>
  )
}

/** Isometric assembly preview; native SVG keeps it crisp without another WebGL scene. */
export function GeometryAssembly({
  phase,
  profile,
}: {
  phase: number
  profile: OnboardingState['profile']
}) {
  const id = useId().replace(/:/g, '')
  const floors = Math.min(Math.max(profile.structure.floors, 1), 14)
  const floorHeight = Math.min(24, 175 / floors)
  const height = floors * floorHeight
  const lean =
    Math.tan(
      (Math.min(45, Math.max(-15, profile.structure.facade_tilt - 90)) *
        Math.PI) /
        180
    ) * 0.65
  const widthAt = (z: number) => 88 + z * lean
  const point = (x: number, y: number, z = 0) =>
    [430 + (x - y) * 0.92, 370 + (x + y) * 0.36 - z] as const
  const points = (vertices: number[][]) =>
    vertices.map(([x, y, z]) => point(x, y, z).join(',')).join(' ')
  const plate = (width: number, z: number) =>
    points([
      [-width, -width, z],
      [width, -width, z],
      [width, width, z],
      [-width, width, z],
    ])
  const front = (width: number, z: number, thickness: number) =>
    points([
      [-width, width, z],
      [width, width, z],
      [width, width, z - thickness],
      [-width, width, z - thickness],
    ])
  const side = (width: number, z: number, thickness: number) =>
    points([
      [width, -width, z],
      [width, width, z],
      [width, width, z - thickness],
      [width, -width, z - thickness],
    ])
  const delay = (ms: number) =>
    ({ '--assembly-delay': `${ms}ms` }) as CSSProperties
  const facade = phase > floors
  const roof = phase > floors + 1
  const agents = phase > floors + 2
  const ready = phase >= floors + 4
  const progress = Math.round(
    Math.min(1, Math.max(0, phase / (floors + 4))) * 100
  )
  const status = ready
    ? 'Geometry assembled. Opening your engineering console…'
    : agents
      ? 'Connecting floor and zone agents'
      : roof
        ? 'Sealing the roof and central skylight'
        : facade
          ? 'Fitting glass panels and adaptive louvres'
          : phase > 0
            ? `Placing floor ${Math.min(phase, floors)} of ${floors}`
            : 'Anchoring the building footprint'
  const roofWidth = widthAt(height) + 11
  const zoneCount =
    profile.structure.zone_rows * profile.structure.zone_columns * 4
  const steps = [
    { label: 'Structure', at: 1, done: phase >= floors },
    { label: 'Façade', at: floors + 1, done: roof },
    { label: 'Roof', at: floors + 2, done: agents },
    { label: 'Agents', at: floors + 3, done: ready },
  ]
  const orchestration = point(0, 0, height + 68)
  return (
    <section
      className='geometry-assembly'
      aria-label='Building geometry assembly'
      data-phase={phase}
      data-ready={ready}
    >
      <header className='geometry-assembly-heading'>
        <div>
          <p className='geometry-eyebrow'>
            <span /> {ready ? 'Assembly complete' : 'Digital twin assembly'}
          </p>
          <h2>
            {ready
              ? 'Your building is ready.'
              : 'Bringing your building to life.'}
          </h2>
          <p className='geometry-building-name'>{profile.location.name}</p>
        </div>
        <span className='geometry-profile-tag'>
          {floors} floors <span>·</span> {zoneCount} control zones
        </span>
      </header>
      <div className='geometry-assembly-stage'>
        <div className='geometry-stage-coordinate'>
          MODEL / {String(Math.min(phase, floors + 4)).padStart(2, '0')}
          <br />
          <span>
            {profile.location.latitude.toFixed(3)}° N ·{' '}
            {profile.location.longitude.toFixed(3)}° E
          </span>
        </div>
        <svg
          viewBox='0 0 860 510'
          role='img'
          aria-label={`Isometric building assembly: ${Math.min(phase, floors)} of ${floors} floors, ${status.toLowerCase()}`}
        >
          <defs>
            <linearGradient id={`${id}-slab`} x1='0' y1='0' x2='1' y2='1'>
              <stop stopColor='#d6eee4' stopOpacity='.9' />
              <stop offset='1' stopColor='#508b80' stopOpacity='.7' />
            </linearGradient>
            <linearGradient id={`${id}-glass`} x1='0' y1='0' x2='0' y2='1'>
              <stop stopColor='#98e4d1' stopOpacity='.6' />
              <stop offset='1' stopColor='#12536a' stopOpacity='.75' />
            </linearGradient>
            <linearGradient id={`${id}-roof`} x1='0' y1='0' x2='1' y2='1'>
              <stop stopColor='#d3e8df' />
              <stop offset='.55' stopColor='#6caa9c' />
              <stop offset='1' stopColor='#31685e' />
            </linearGradient>
            <radialGradient id={`${id}-halo`}>
              <stop stopColor='#64dfc2' stopOpacity='.2' />
              <stop offset='1' stopColor='#64dfc2' stopOpacity='0' />
            </radialGradient>
            <filter
              id={`${id}-glow`}
              x='-100%'
              y='-100%'
              width='300%'
              height='300%'
            >
              <feGaussianBlur stdDeviation='3' />
            </filter>
          </defs>
          <ellipse
            cx='430'
            cy='373'
            rx='320'
            ry='127'
            fill={`url(#${id}-halo)`}
          />
          <g stroke='#75bda9' strokeWidth='.7' opacity='.12'>
            {Array.from({ length: 13 }, (_, i) => (i - 6) * 36).map((n) => (
              <g key={n}>
                <polyline
                  points={points([
                    [-216, n, -9],
                    [216, n, -9],
                  ])}
                />
                <polyline
                  points={points([
                    [n, -216, -9],
                    [n, 216, -9],
                  ])}
                />
              </g>
            ))}
          </g>
          <ellipse
            className='geometry-orbit-ring'
            cx='430'
            cy='376'
            rx='278'
            ry='102'
            fill='none'
            stroke='#6bd9ba'
            strokeWidth='1'
            strokeDasharray='5 12'
            opacity='.3'
          />
          <g className='geometry-foundation'>
            <polygon
              points={front(108, 0, 8)}
              fill='#194638'
              stroke='#457b6b'
              strokeWidth='.8'
            />
            <polygon
              points={side(108, 0, 8)}
              fill='#103329'
              stroke='#457b6b'
              strokeWidth='.8'
            />
            <polygon
              points={plate(108, 0)}
              fill='#173e33'
              stroke='#80c5ac'
              strokeWidth='1'
            />
            <polygon
              points={plate(94, 0.5)}
              fill='none'
              stroke='#8bddc0'
              strokeWidth='.8'
              strokeDasharray='5 5'
            />
          </g>
          <g
            className='geometry-blueprint'
            fill='none'
            stroke='#8bbeb1'
            strokeWidth='.8'
            strokeDasharray='4 6'
          >
            {[-1, 1].flatMap((x) =>
              [-1, 1].map((y) => (
                <polyline
                  key={`${x}-${y}`}
                  points={points([
                    [x * 88, y * 88, 0],
                    [x * widthAt(height), y * widthAt(height), height],
                  ])}
                />
              ))
            )}
            <polygon points={plate(widthAt(height), height)} />
          </g>
          {Array.from(
            { length: Math.min(Math.max(0, phase), floors) },
            (_, i) => {
              const z = (i + 1) * floorHeight
              const w = widthAt(z)
              return (
                <g
                  className='geometry-floor'
                  data-assembly-floor={i + 1}
                  key={i}
                >
                  <g stroke='#9bd6c0' strokeWidth='1' opacity='.5'>
                    {[-1, 1].flatMap((x) =>
                      [-1, 1].map((y) => (
                        <polyline
                          key={`${x}-${y}`}
                          points={points([
                            [
                              x * widthAt(z - floorHeight),
                              y * widthAt(z - floorHeight),
                              z - floorHeight,
                            ],
                            [x * w, y * w, z],
                          ])}
                        />
                      ))
                    )}
                  </g>
                  <polygon
                    points={front(w, z, 4)}
                    fill='#387766'
                    stroke='#93c5b5'
                    strokeWidth='.65'
                  />
                  <polygon
                    points={side(w, z, 4)}
                    fill='#22584f'
                    stroke='#81b8a8'
                    strokeWidth='.65'
                  />
                  <polygon
                    points={plate(w, z)}
                    fill={`url(#${id}-slab)`}
                    stroke='#b4e1ce'
                    strokeWidth='.85'
                  />
                  <polygon
                    points={plate(20, z + 0.5)}
                    fill='#285548'
                    stroke='#83b9a2'
                    strokeWidth='.7'
                  />
                  <polyline
                    points={points([
                      [-w * 0.65, 0, z + 0.7],
                      [w * 0.65, 0, z + 0.7],
                    ])}
                    stroke='#c5e2d4'
                    strokeOpacity='.3'
                    fill='none'
                  />
                </g>
              )
            }
          )}
          {facade &&
            Array.from({ length: floors }, (_, i) => {
              const low = i * floorHeight + 1,
                high = (i + 1) * floorHeight - 4
              const a = widthAt(low),
                b = widthAt(high)
              return (
                <g
                  key={i}
                  className='geometry-facade'
                  style={delay(i * 65)}
                  data-assembly-facade={i + 1}
                >
                  <polygon
                    points={points([
                      [-a, a, low],
                      [a, a, low],
                      [b, b, high],
                      [-b, b, high],
                    ])}
                    fill={`url(#${id}-glass)`}
                    stroke='#98dbca'
                    strokeWidth='.6'
                  />
                  <polygon
                    points={points([
                      [a, a, low],
                      [a, -a, low],
                      [b, -b, high],
                      [b, b, high],
                    ])}
                    fill={`url(#${id}-glass)`}
                    stroke='#89c8bb'
                    strokeWidth='.6'
                    opacity='.78'
                  />
                  {[-0.5, 0, 0.5].map((ratio) => (
                    <g
                      key={ratio}
                      stroke='#c5eee1'
                      strokeWidth='.6'
                      opacity='.6'
                    >
                      <polyline
                        points={points([
                          [a * ratio, a, low],
                          [b * ratio, b, high],
                        ])}
                      />
                      <polyline
                        points={points([
                          [a, a * ratio, low],
                          [b, b * ratio, high],
                        ])}
                      />
                    </g>
                  ))}
                  <polyline
                    points={points([
                      [-b - 3, b + 3, high - 3],
                      [b + 3, b + 3, high - 3],
                      [b + 3, -b - 3, high - 3],
                    ])}
                    stroke='#d5e3d6'
                    strokeWidth='2.3'
                    fill='none'
                  />
                </g>
              )
            })}
          {roof && (
            <g className='geometry-roof' data-assembly-roof='true'>
              <polygon
                points={front(roofWidth, height + 8, 6)}
                fill='#447967'
                stroke='#b9d8c6'
                strokeWidth='.8'
              />
              <polygon
                points={side(roofWidth, height + 8, 6)}
                fill='#2c5a4e'
                stroke='#a2c6b4'
                strokeWidth='.8'
              />
              <polygon
                points={plate(roofWidth, height + 8)}
                fill={`url(#${id}-roof)`}
                stroke='#c2e4d2'
                strokeWidth='1.1'
              />
              {[-1, 1].flatMap((x) =>
                [-1, 1].map((y) => (
                  <polyline
                    key={`${x}-${y}`}
                    points={points([
                      [x * roofWidth, y * roofWidth, height + 8],
                      [x * 24, y * 24, height + 16],
                    ])}
                    stroke='#ddece1'
                    opacity='.45'
                    strokeWidth='1'
                  />
                ))
              )}
              <polygon
                points={points([
                  [-27, -27, height + 17],
                  [27, -27, height + 17],
                  [0, 0, height + 47],
                ])}
                fill='#a1e8d5'
                fillOpacity='.65'
                stroke='#d0ffea'
              />
              <polygon
                points={points([
                  [27, -27, height + 17],
                  [27, 27, height + 17],
                  [0, 0, height + 47],
                ])}
                fill='#57ad9b'
                stroke='#c5f5e3'
              />
              <polygon
                points={points([
                  [27, 27, height + 17],
                  [-27, 27, height + 17],
                  [0, 0, height + 47],
                ])}
                fill='#a5dfc9'
                stroke='#dafae9'
              />
              <polygon
                points={points([
                  [-27, 27, height + 17],
                  [-27, -27, height + 17],
                  [0, 0, height + 47],
                ])}
                fill='#83c6b5'
                stroke='#c5f5e3'
              />
            </g>
          )}
          {!ready && (
            <g className='geometry-scan'>
              <polygon
                points={plate(widthAt(height) + 16, height * 0.55)}
                fill='#8bffe5'
                fillOpacity='.055'
                stroke='#79f2ca'
                strokeOpacity='.35'
                strokeWidth='1'
              />
            </g>
          )}
          {agents && (
            <g data-assembly-agents='true'>
              {Array.from({ length: floors }, (_, i) => {
                const z = (i + 0.55) * floorHeight,
                  w = widthAt(z)
                return [-1, 1].map((sign) => {
                  const p =
                    sign === -1
                      ? point(-w * 0.4, w + 3, z)
                      : point(w + 3, -w * 0.4, z)
                  return (
                    <g
                      key={`${i}-${sign}`}
                      className='geometry-agent'
                      style={delay(i * 70 + (sign + 1) * 70)}
                    >
                      <path
                        d={`M ${p.join(' ')} Q ${orchestration[0] + sign * 180} ${orchestration[1] + 60} ${orchestration.join(' ')}`}
                        fill='none'
                        stroke='#65d3b6'
                        strokeWidth='.7'
                        strokeDasharray='3 7'
                        opacity='.3'
                      />
                      <circle
                        cx={p[0]}
                        cy={p[1]}
                        r='9'
                        fill='#72ffd0'
                        filter={`url(#${id}-glow)`}
                        opacity='.55'
                      />
                      <circle cx={p[0]} cy={p[1]} r='3' fill='#c7ffdf' />
                      <circle
                        className='geometry-node-pulse'
                        cx={p[0]}
                        cy={p[1]}
                        r='7'
                        fill='none'
                        stroke='#8df4cf'
                      />
                    </g>
                  )
                })
              })}
              <g className='geometry-agent'>
                <circle
                  cx={orchestration[0]}
                  cy={orchestration[1]}
                  r='15'
                  fill='#173f33'
                  stroke='#82e8bb'
                />
                <path
                  d={`M ${orchestration[0] - 5} ${orchestration[1]} l 4 4 l 7 -8`}
                  fill='none'
                  stroke='#caffdf'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </g>
            </g>
          )}
          <g
            fill='#92c4b2'
            fontFamily='ui-monospace, monospace'
            fontSize='9'
            opacity='.65'
          >
            <text x='87' y='436'>
              SITE ORIGIN 00 / 00
            </text>
            <text x='676' y='436'>
              N ↑
            </text>
          </g>
        </svg>
        <div className='geometry-stage-note'>
          <span
            className={ready ? 'geometry-ready-dot' : 'geometry-live-dot'}
          />
          {ready ? 'Twin assembled' : 'Assembling geometry'}
        </div>
      </div>
      <footer className='geometry-assembly-footer'>
        <div className='geometry-status-row'>
          <p role='status'>{status}</p>
          <span>
            {progress}
            <small>%</small>
          </span>
        </div>
        <div
          className='geometry-progress'
          role='progressbar'
          aria-label='Geometry assembly progress'
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <ol className='geometry-stages'>
          {steps.map((step, index) => (
            <li
              key={step.label}
              data-active={phase >= step.at}
              data-done={step.done}
            >
              <span>
                {step.done ? (
                  <Check size={12} />
                ) : (
                  String(index + 1).padStart(2, '0')
                )}
              </span>
              {step.label}
            </li>
          ))}
        </ol>
        <p className='geometry-input-note'>
          Geometry preview from your commissioning profile
        </p>
      </footer>
    </section>
  )
}
