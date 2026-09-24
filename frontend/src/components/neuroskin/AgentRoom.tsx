'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  MapPin,
  Paperclip,
  Pause,
  Play,
  Send,
  Users,
} from 'lucide-react'
import { setHardwareControl } from '@/lib/api-client'
import type { TickPayload, ZoneHeat } from '@/lib/types'
import { floorGroupLabel } from './floorWorkspaces'
import {
  cardinal,
  criticalPressure,
  CRITICAL_WIND,
  windRoster,
  type ZoneLoad,
} from './windRoom'
/** How long an agent shows its working before it starts writing. */
const THINK_MS = 900
/** How long a finished message sits before the next agent speaks. */
const PAUSE_MS = 1100
const STREAM_MS = 16
const CHARS_PER_TICK = 4
/** The rig's four panels, bh1-bh4. Mirrors PANEL_ZONES in backend/app/hardware.py. */
const RIG_START_ANGLES: Record<string, number> = {
  W13: 15,
  W14: 30,
  W9: 45,
  W10: 60,
}
const RIG_ZONES = Object.keys(RIG_START_ANGLES)
/** The backend drops a hold after 30 s, so refresh it while the channel is open. */
const RIG_KEEPALIVE_MS = 20_000

export interface Site {
  latitude: number
  longitude: number
  name: string
}

// ponytail: illustrative envelopes over the real zone topology, not a message bus.
// Replace this sequence with agent events when the backend publishes them.
export function agentMessage(
  sequence: number,
  zones: ZoneHeat[],
  focus?: string | null
) {
  const start = Math.max(
    0,
    zones.findIndex((zone) => zone.zone === focus)
  )
  const zone = zones[(start + Math.floor(sequence / 5) * 5) % zones.length]
  if (!zone) return null
  const floor = `floor-${zone.row}`
  const rows = [...new Set(zones.map((entry) => entry.row))].sort()
  const peer = `floor-${rows[(rows.indexOf(zone.row) + 1) % rows.length]}`
  const reading = zone.sensors?.illuminance ?? zone.lux
  return [
    {
      from: zone.zone,
      to: floor,
      kind: 'SENSE',
      text: `${zone.zone}: **${reading.toFixed(0)} lx**. ${zone.sensor_trusted === false ? 'Reading flagged for review.' : 'Local reading available.'}`,
    },
    {
      from: floor,
      to: peer,
      kind: 'COORDINATE',
      text: 'Compare neighbouring exposure before changing the façade.',
    },
    {
      from: floor,
      to: 'main',
      kind: 'PROPOSE',
      text: `${zone.zone}: request **${(zone.angle_target ?? zone.angle).toFixed(0)}°**. Balance daylight, heat and movement.`,
    },
    {
      from: 'main',
      to: floor,
      kind: 'ORCHESTRATE',
      text:
        zone.mode === 'SAFE'
          ? 'Safety hold takes priority. Keep the safe position.'
          : 'Coordinate the local target with the building comfort and movement limits.',
    },
    {
      from: floor,
      to: zone.zone,
      kind: 'ACT',
      text: `${zone.zone}: **${zone.angle.toFixed(0)}°** · **${zone.mode}**. Report the next sensor reading.`,
    },
  ][sequence % 5]
}

interface Member {
  id: string
  name: string
  /** Short label for the avatar bubble. */
  initials: string
  role: string
  /** Zone to inspect when the member is picked; null selects the orchestrator. */
  zone: string | null
}

interface Message {
  speaker: string
  kind: string
  /** `**bold**` marks the number or verdict the reader should catch. */
  text: string
  /** The member that joins the channel on this message. */
  joins?: string
  /** What the agent works through before it answers. */
  thinking?: string[]
  /** An outside call the agent made, shown the way a tool call reads. */
  tool?: { call: string; result: string; ok: boolean; pending?: boolean }
  /** Draws the site map, oriented to the wind. */
  map?: boolean
  /** The reading the agent posts with its message, shown as a file card. */
  attachment?: { name: string; meta: string }
  reactions?: { emoji: string; count: number }[]
}

const CHAIR: Member = {
  id: 'main',
  name: 'Main orchestrator',
  initials: 'MO',
  role: 'Chair · comfort, energy, safety',
  zone: null,
}
const RIG: Member = {
  id: 'rig',
  name: 'Facade actuator',
  initials: 'RIG',
  role: 'ESP32 bridge · panels bh1-bh4',
  zone: null,
}
const WEATHER: Member = {
  id: 'weather',
  name: 'Weather agent',
  initials: 'WX',
  role: 'Open-Meteo · live site feed',
  zone: null,
}

interface Reading {
  wind: number
  bearing: number
  temp: number
  at: string
}
type Feed =
  | { status: 'idle' | 'loading' }
  | { status: 'ok'; data: Reading }
  | { status: 'error'; error: string }

/** Current conditions over the building, straight from the public Open-Meteo API. */
function useWeather(site: Site | undefined, active: boolean): Feed {
  const [feed, setFeed] = useState<Feed>({ status: 'idle' })
  useEffect(() => {
    if (!active || !site || feed.status !== 'idle') return
    const controller = new AbortController()
    setFeed({ status: 'loading' })
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${site.latitude}` +
      `&longitude=${site.longitude}&current=temperature_2m,wind_speed_10m,` +
      `wind_direction_10m&wind_speed_unit=ms&timezone=auto`
    fetch(url, { signal: controller.signal })
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(`HTTP ${response.status}`))
      )
      .then((body) => {
        const current = body?.current
        if (!current) throw new Error('no current block in the response')
        setFeed({
          status: 'ok',
          data: {
            wind: Number(current.wind_speed_10m),
            bearing: Number(current.wind_direction_10m),
            temp: Number(current.temperature_2m),
            at: String(current.time),
          },
        })
      })
      .catch((error: Error) => {
        if (error.name === 'AbortError') return
        setFeed({ status: 'error', error: error.message })
      })
    return () => controller.abort()
  }, [active, site, feed.status])
  return feed
}

/** What one panel has to travel to reach the angle the room agreed. */
interface RigMove {
  zone: string
  from: number
  to: number
}
type Rig =
  | { status: 'idle' | 'pushing' }
  | { status: 'ok'; online: boolean; moves: RigMove[] }
  | { status: 'error'; error: string }
  | { status: 'skipped' }

/**
 * Stages varied demo angles while the agents discuss, then holds their retreat
 * when the actuator speaks. Refresh either pose inside the backend's 30 s TTL.
 */
function useRig(roster: ZoneLoad[], active: boolean, retreat: boolean): Rig {
  const [rig, setRig] = useState<Rig>({ status: 'idle' })
  const angles = useMemo(
    () =>
      Object.fromEntries(
        roster.map((load) => [
          load.zone,
          retreat ? load.proposed : RIG_START_ANGLES[load.zone],
        ])
      ),
    [roster, retreat]
  )
  const covered = RIG_ZONES.every((zone) => zone in angles)
  useEffect(() => {
    if (!active) return setRig({ status: 'idle' })
    // The rig is one fixed 2 x 2 block of the west wall; another wall's bays
    // have no panel to move, and the backend would reject the angles anyway.
    if (!covered) return setRig({ status: 'skipped' })
    let cancelled = false
    const push = (refresh: boolean) =>
      setHardwareControl({ mode: 'wind', angles, refresh_only: refresh })
        .then((status) => {
          // commanded_angle in the reply is where the panels stood when the hold
          // landed, so it is the travel this retreat actually asks of the rig.
          const moves = Object.values(status.panels)
            .filter((panel) => panel.zone in angles)
            .map((panel) => ({
              zone: panel.zone,
              from: panel.commanded_angle ?? 0,
              to: angles[panel.zone],
            }))
          // Keep the original travel on record; a keepalive sees the arrived pose.
          if (!cancelled)
            setRig((previous) => ({
              status: 'ok',
              online: status.online,
              moves:
                refresh && previous.status === 'ok' ? previous.moves : moves,
            }))
        })
        .catch((error: Error) => {
          if (!cancelled) setRig({ status: 'error', error: error.message })
        })
    setRig({ status: 'pushing' })
    void push(false)
    const timer = setInterval(() => void push(true), RIG_KEEPALIVE_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [active, covered, angles])
  return rig
}

/**
 * A wind thread. The bays under load join the channel one at a time, each
 * reading its own pressure off the bearing and its place on the wall, and posts
 * how far it wants to retreat. The chair closes on what the safety rule did.
 */
function windThread(
  tick: TickPayload,
  roster: ZoneLoad[],
  feed: Feed,
  rig: Rig,
  site?: Site
) {
  const bearing = tick.wind_direction ?? 0
  const wall = roster[0].orientation
  const safe = tick.mode === 'SAFE'
  const staged = RIG_ZONES.every((zone) =>
    roster.some((load) => load.zone === zone)
  )
  const limit = criticalPressure(CRITICAL_WIND).toFixed(0)
  const members: Member[] = [
    CHAIR,
    ...(site ? [WEATHER] : []),
    RIG,
    ...roster.map((load) => ({
      id: load.zone,
      name: `${load.zone} zone agent`,
      initials: load.zone,
      role: `${load.orientation} facade · ${load.height} m up · ${load.pressure} Pa`,
      zone: load.zone,
    })),
  ]
  const live = feed.status === 'ok' ? feed.data : undefined
  const weatherMessage: Message = {
    speaker: 'weather',
    joins: 'weather',
    kind: 'TOOL CALL',
    thinking: [
      `Calling the public feed at ${site?.latitude.toFixed(3)}, ${site?.longitude.toFixed(3)}`,
      'Reading current wind speed and bearing',
      'Comparing the measured bearing with the drill bearing',
    ],
    tool: {
      call: `GET api.open-meteo.com/v1/forecast · current wind · ${site?.latitude.toFixed(3)}, ${site?.longitude.toFixed(3)}`,
      result: live
        ? `${live.wind.toFixed(1)} m/s from ${live.bearing.toFixed(0)}° ${cardinal(live.bearing)} · ${live.temp.toFixed(1)} °C · ${live.at}`
        : feed.status === 'error'
          ? `Feed unavailable — ${feed.error}`
          : 'Waiting for the feed…',
      ok: feed.status === 'ok',
      pending: feed.status === 'loading' || feed.status === 'idle',
    },
    map: true,
    text: live
      ? `Live feed over ${site?.name ?? 'the site'} reads **${live.wind.toFixed(1)} m/s from ${live.bearing.toFixed(0)}° ${cardinal(live.bearing)}**, ` +
        `**${live.temp.toFixed(1)} °C**. This drill runs the simulated day at **${tick.wind.toFixed(1)} m/s from ${bearing.toFixed(0)}° ${cardinal(bearing)}**, ` +
        'so the pressures below are the drill, not the sky outside right now.'
      : feed.status === 'error'
        ? `The live feed did not answer, so nothing here is measured weather. The drill still runs at **${tick.wind.toFixed(1)} m/s from ${bearing.toFixed(0)}° ${cardinal(bearing)}**.`
        : 'Reaching for the live feed over the building…',
  }
  const messages: Message[] = [
    {
      speaker: 'main',
      kind: 'CONVENE',
      thinking: [
        'Scanning all four walls for wind load',
        'Ranking every bay by the pressure on its own panel',
        `Opening a channel for the ${roster.length} worst`,
      ],
      text:
        (staged
          ? `**Demo setup:** starting panels **${RIG_ZONES.map((zone) => `${zone} ${RIG_START_ANGLES[zone]}°`).join(', ')}**. ` +
            'They hold these different angles during the discussion, then retreat together at the end. '
          : '') +
        `**${tick.wind.toFixed(1)} m/s** from **${bearing.toFixed(0)}° (${cardinal(bearing)})**. ` +
        `The **${wall} facade** stands **${roster[0].incidence}° off head-on**, so it is taking the load. ` +
        `Pulling in the **${roster.length} bays** under the most pressure.`,
      attachment: {
        name: `wind-brief-${bearing.toFixed(0)}deg.json`,
        meta: `${tick.wind.toFixed(1)} m/s · ${cardinal(bearing)} · ${wall} windward`,
      },
    },
    ...(site ? [weatherMessage] : []),
    ...roster.map((load, index) => ({
      speaker: load.zone,
      joins: load.zone,
      kind: 'REPORT',
      thinking: [
        `Reading my own panel at ${load.height} m`,
        `Projecting ${bearing.toFixed(0)}° onto my wall normal`,
        `Solving my hold angle against the ${limit} Pa limit`,
      ],
      text:
        `**${load.height} m** up, **${load.incidence}° off my normal**, **${load.speed} m/s** at my height: ` +
        `**${load.pressure} Pa** pressing on my panel. That caps me at **${load.hold.toFixed(0)}° of blade**. ` +
        (load.angle > load.hold + 0.5
          ? `I am at ${load.angle.toFixed(0)}° and want to **retreat to ${load.proposed.toFixed(0)}°**.`
          : `I am already at **${load.angle.toFixed(0)}°**, inside that, and holding.`),
      attachment: {
        name: `${load.zone}-load.json`,
        meta: `${load.pressure} Pa · ${load.speed} m/s · holds ${load.hold.toFixed(0)}°`,
      },
      reactions: index ? [{ emoji: '🛡️', count: index }] : undefined,
    })),
    {
      speaker: roster[roster.length - 1].zone,
      kind: 'AGREE',
      thinking: ['Comparing my pressure with the bays down the wall'],
      text:
        'Agreed across the room: the **upwind bays** carry the corner load and give up their shading first. ' +
        'The downwind bays keep their daylight angle unless the bearing swings.',
      reactions: [{ emoji: '👍', count: roster.length }],
    },
    {
      speaker: 'main',
      kind: 'RULING',
      thinking: [
        `Checking the ${CRITICAL_WIND} m/s safety rule`,
        'Comparing the proposals with the angle the controller applied',
      ],
      text: safe
        ? `**Safety rule confirmed** at ${CRITICAL_WIND} m/s: every zone must retract flat to **0°** ` +
          'and hold there. The actuator will apply the retreat now.'
        : `Wind is still **under the ${CRITICAL_WIND} m/s safety limit**, so the retreat runs as the wind cost term, ` +
          `not as a safety hold. Applied **${tick.angle_final.toFixed(0)}°** on the primary wall.`,
      reactions: [{ emoji: safe ? '🛡️' : '✅', count: roster.length }],
    },
    {
      speaker: 'rig',
      joins: 'rig',
      kind: 'ACTUATE',
      thinking: [
        'Mapping the agreed angles onto panels bh1-bh4',
        'Holding them on the bridge as control mode wind',
      ],
      tool: {
        call:
          'POST /api/v1/hardware/control · mode=wind · ' +
          roster
            .map((load) => `${load.zone} ${load.proposed.toFixed(0)}°`)
            .join(', '),
        result:
          rig.status === 'ok'
            ? rig.online
              ? `Held on the bridge · ${rig.moves.map((move) => `${move.zone} ${move.from.toFixed(0)}° → ${move.to.toFixed(0)}°`).join(', ')}`
              : 'Held on the bridge · no rig answering right now'
            : rig.status === 'error'
              ? `Bridge refused the hold — ${rig.error}`
              : rig.status === 'skipped'
                ? `Loaded bays are not the rig's ${RIG_ZONES.join(', ')} — nothing pushed`
                : 'Pushing the retreat to the bridge…',
        ok: rig.status === 'ok',
        pending: rig.status === 'pushing' || rig.status === 'idle',
      },
      text:
        rig.status === 'ok'
          ? `The retreat is on the rig: panels **bh1-bh4** hold ` +
            `${roster.map((load) => `**${load.zone} ${load.proposed.toFixed(0)}°**`).join(', ')}` +
            (!rig.online
              ? ', to be applied as soon as the bridge reports in. '
              : rig.moves.every((move) => Math.abs(move.from - move.to) < 0.5)
                ? '. The bridge already reports the retreat angles. '
                : `. The blades are travelling **${rig.moves.map((move) => `${move.zone} ${move.from.toFixed(0)}° → ${move.to.toFixed(0)}°`).join(', ')}**. `) +
            '**The facade has retreated. Nothing left to decide** until the wind changes, so the channel closes here.'
          : rig.status === 'skipped'
            ? `The bays under load are not the four this rig carries (${RIG_ZONES.join(', ')}), so no panel was moved. ` +
              '**The retreat stands in simulation only.** The channel closes here.'
            : rig.status === 'error'
              ? '**No rig took the retreat**, so it stands in simulation only. The channel closes here.'
              : 'Pushing the agreed angles to the bridge…',
      reactions:
        rig.status === 'ok'
          ? [{ emoji: '✅', count: roster.length }]
          : undefined,
    },
  ]
  return { members, messages }
}

/** The routine daylight stand-up: the same three agents, no wind on the agenda. */
function routineThread(
  zones: ZoneHeat[],
  floors: number,
  round: number,
  focus?: string | null
) {
  const envelopes = Array.from({ length: 5 }, (_, index) =>
    agentMessage(round * 5 + index, zones, focus)
  )
  if (envelopes.some((envelope) => envelope == null))
    return { members: [] as Member[], messages: [] as Message[] }
  const speakers = envelopes.map((envelope) => envelope!.from)
  const zoneId = speakers[0]
  const zone = zones.find((entry) => entry.zone === zoneId)
  const band = Number(speakers[1].slice(6))
  const members: Member[] = [
    {
      id: zoneId,
      name: `${zoneId} zone agent`,
      initials: zoneId,
      role: zone
        ? `${(zone.sensors?.illuminance ?? zone.lux).toFixed(0)} lx · ${zone.angle.toFixed(0)}° · ${zone.mode}`
        : 'Local controller',
      zone: zoneId,
    },
    {
      id: speakers[1],
      name: floorGroupLabel(band, floors),
      initials: 'FC',
      role: 'Floor coordinator',
      zone: zoneId,
    },
    CHAIR,
  ]
  const joined = new Set<string>()
  const messages: Message[] = envelopes.map((envelope) => {
    const joins = joined.has(envelope!.from) ? undefined : envelope!.from
    joined.add(envelope!.from)
    return {
      speaker: envelope!.from,
      kind: envelope!.kind,
      text: envelope!.text,
      joins,
      attachment:
        envelope!.kind === 'SENSE' && zone
          ? {
              name: `${zoneId}-reading.json`,
              meta: `${(zone.sensors?.illuminance ?? zone.lux).toFixed(0)} lx · ${zone.angle.toFixed(0)}° · ${zone.mode}`,
            }
          : undefined,
    }
  })
  return { members, messages }
}

/** A note the operator types into the channel. It reaches no controller. */
interface Note {
  text: string
  at: string
}

const BOLD = /(\*\*[^*]+\*\*)/g
/** `**this**` reads as the number to catch, everything else as plain prose. */
function rich(text: string) {
  return text.split(BOLD).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={index} className='agent-hi'>
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  )
}

/** Open street map around the building, with the wind drawn over it. */
function SiteMap({ site, bearing }: { site: Site; bearing: number }) {
  const span = 0.006
  const bbox = [
    site.longitude - span,
    site.latitude - span * 0.6,
    site.longitude + span,
    site.latitude + span * 0.6,
  ]
    .map((value) => value.toFixed(4))
    .join(',')
  return (
    <div className='agent-map'>
      <iframe
        title={`Map of ${site.name}`}
        loading='lazy'
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${site.latitude},${site.longitude}`}
      />
      <svg className='agent-map-wind' viewBox='0 0 120 120' aria-hidden='true'>
        {/* The wind blows towards bearing + 180, which is where the arrow points. */}
        <g transform={`rotate(${bearing + 180} 60 60)`}>
          <line
            x1='60'
            y1='16'
            x2='60'
            y2='92'
            stroke='#d94f2b'
            strokeWidth='4'
          />
          <path d='M60 104 L50 84 L70 84 Z' fill='#d94f2b' />
        </g>
        <circle cx='60' cy='60' r='5' fill='#19976a' stroke='#fff' />
      </svg>
      <p className='agent-map-caption'>
        <MapPin size={12} /> {site.name} · {site.latitude.toFixed(4)},{' '}
        {site.longitude.toFixed(4)} · wind from{' '}
        <strong className='agent-hi'>
          {bearing.toFixed(0)}° {cardinal(bearing)}
        </strong>
      </p>
    </div>
  )
}

export function AgentRoom({
  tick,
  floors,
  selectedZone,
  onSelectZone,
  site,
  open,
  waiting = false,
  onOpen,
  onClose,
}: {
  tick: TickPayload
  floors: number
  selectedZone?: string | null
  onSelectZone: (id: string | null) => void
  /** Where the building stands. Without it the weather agent stays out. */
  site?: Site
  /** True once a ticket has been accepted, or the stand-up opened. */
  open: boolean
  /** The gust has been asked for and the run has not landed yet. */
  waiting?: boolean
  /** Opens the routine stand-up, with no ticket behind it. */
  onOpen: () => void
  /** Leaves the channel, and calms the wind if a gust opened it. */
  onClose: () => void
}) {
  const [step, setStep] = useState(0)
  const [chars, setChars] = useState(0)
  const [thinking, setThinking] = useState(true)
  const [playing, setPlaying] = useState(true)
  const [draft, setDraft] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const thread = useRef<HTMLDivElement>(null)
  // Streaming is decoration; someone who asked for less motion gets it at once.
  const [instant] = useState(
    () =>
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  )

  const feed = useWeather(site, open)
  const zones = useMemo(
    () => tick.facade.flatMap((wall) => wall.zones ?? []),
    [tick]
  )
  const roster = useMemo(() => {
    const loads = windRoster(tick, { floors, criticalWind: CRITICAL_WIND })
    if (!RIG_ZONES.every((zone) => loads.some((load) => load.zone === zone)))
      return loads
    return loads.map((load) => ({
      ...load,
      angle: RIG_START_ANGLES[load.zone],
      proposed:
        tick.mode === 'SAFE'
          ? 0
          : Math.min(RIG_START_ANGLES[load.zone], load.hold),
    }))
  }, [tick, floors])
  // Actuation follows the chair, optional weather, bay reports, agreement and ruling.
  const retreat = step >= 1 + Number(Boolean(site)) + roster.length + 2
  const rig = useRig(roster, open && !waiting, retreat)
  const { members, messages } = useMemo(
    () =>
      roster.length
        ? windThread(tick, roster, feed, rig, site)
        : routineThread(zones, floors, 0, selectedZone),
    [tick, roster, feed, rig, site, zones, floors, selectedZone]
  )
  // The conversation runs once and stops. A facade that has retreated has nothing
  // left to say, and a channel that repeats itself is not a decision any more.
  const posted = Math.min(step, Math.max(0, messages.length - 1))
  const ended = step >= messages.length - 1
  const visible = messages.slice(0, posted + 1)
  const current = visible[visible.length - 1]
  const full = current?.text.length ?? 0
  const shown = instant ? full : Math.min(chars, full)

  useEffect(() => {
    setChars(0)
    setThinking(true)
  }, [step])
  // Show the working first, then write the answer out, then hand over.
  useEffect(() => {
    if (!open || waiting || !playing || !thinking || instant) return
    const timer = setTimeout(() => setThinking(false), THINK_MS)
    return () => clearTimeout(timer)
  }, [open, waiting, playing, thinking, instant, step])
  useEffect(() => {
    if (!open || waiting || !playing || (thinking && !instant)) return
    if (chars < full) {
      const timer = setTimeout(
        () => setChars((value) => value + CHARS_PER_TICK),
        STREAM_MS
      )
      return () => clearTimeout(timer)
    }
    if (ended || rig.status === 'pushing') return
    const timer = setTimeout(() => setStep((value) => value + 1), PAUSE_MS)
    return () => clearTimeout(timer)
  }, [
    open,
    waiting,
    playing,
    thinking,
    instant,
    chars,
    full,
    step,
    ended,
    rig.status,
  ])
  useEffect(() => {
    const element = thread.current
    if (element) element.scrollTop = element.scrollHeight
  }, [visible.length, shown, notes.length])
  if (!messages.length)
    return (
      <p className='console-card text-xs'>
        Zone agents appear when the simulation returns zone readings.
      </p>
    )
  const at = new Date(tick.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  const channel = roster.length ? 'wind-response' : 'daylight-standup'

  if (!open || waiting)
    return (
      <section className='agent-room' aria-label='Building agent channel'>
        <header className='agent-room-head'>
          <div>
            <p className='console-card-title'>#{channel}</p>
            <p className='mt-1 text-[11px] text-muted-foreground'>
              {waiting
                ? 'Waiting for the run the ticket asked for'
                : 'Quiet · no agent has joined'}
            </p>
          </div>
        </header>
        <div className='agent-idle'>
          <p className='agent-idle-text'>
            {waiting
              ? 'Re-running the day on the squall bearing. The loaded bays join as soon as the gust reaches the wall.'
              : 'No one is in the channel. Agents join when a ticket is accepted, or when someone opens the stand-up.'}
          </p>
          {!waiting && (
            <button type='button' className='agent-ghost' onClick={onOpen}>
              Open the routine stand-up
            </button>
          )}
        </div>
      </section>
    )

  const member = (id: string) => members.find((entry) => entry.id === id)
  const present = members.filter(
    (entry) =>
      entry.id === 'main' ||
      visible.some((message) => message.joins === entry.id)
  )
  const streaming = shown < full
  const closed = ended && !streaming && !current?.tool?.pending
  const typing = streaming
    ? undefined
    : posted + 1 < messages.length
      ? member(messages[posted + 1].speaker)?.name
      : undefined

  const post = () => {
    const text = draft.trim()
    if (!text) return
    setNotes([...notes, { text, at }])
    setDraft('')
  }

  return (
    <section className='agent-room' aria-label='Building agent channel'>
      <header className='agent-room-head'>
        <div>
          <p className='console-card-title'>#{channel}</p>
          <p className='mt-1 text-[11px] text-muted-foreground'>
            {members.length} members · {present.length} in the channel
            {roster.length
              ? ` · ${tick.wind.toFixed(1)} m/s from ${(tick.wind_direction ?? 0).toFixed(0)}° ${cardinal(tick.wind_direction ?? 0)}`
              : ' · routine coordination'}
          </p>
        </div>
        <div className='agent-room-actions'>
          <ul className='agent-roster' aria-label='Channel members'>
            {members.map((entry) => (
              <li key={entry.id}>
                <button
                  type='button'
                  className='agent-avatar'
                  data-present={present.includes(entry)}
                  aria-pressed={selectedZone === entry.zone}
                  aria-label={`${entry.name} · ${entry.role}`}
                  title={`${entry.name} · ${entry.role}`}
                  onClick={() => onSelectZone(entry.zone)}
                >
                  {entry.initials}
                </button>
              </li>
            ))}
          </ul>
          <span className='agent-members-chip'>
            <Users size={13} /> {present.length}
          </span>
          <button
            className='agent-play'
            type='button'
            onClick={() => {
              if (closed) return setStep(0)
              setPlaying(!playing)
            }}
            aria-label={
              closed
                ? 'Replay the conversation'
                : playing
                  ? 'Pause the channel'
                  : 'Resume the channel'
            }
          >
            {closed || !playing ? <Play size={14} /> : <Pause size={14} />}
            {closed ? 'Replay' : playing ? 'Pause' : 'Resume'}
          </button>
          <button
            className='agent-play'
            type='button'
            onClick={() => {
              setStep(0)
              setPlaying(true)
              setNotes([])
              onClose()
            }}
          >
            {roster.length ? 'Calm the wind' : 'Close channel'}
          </button>
        </div>
      </header>

      <div
        className='agent-thread'
        ref={thread}
        aria-live='polite'
        aria-label='Channel messages'
      >
        {visible.map((message, index) => {
          const speaker = member(message.speaker)
          const live = index === visible.length - 1
          const working = live && thinking && !instant
          const body = live ? message.text.slice(0, shown) : message.text
          const done = !live || shown >= message.text.length
          return (
            <article
              key={index}
              className='agent-msg'
              data-orchestrator={message.speaker === CHAIR.id}
            >
              {message.joins && (
                <p className='agent-system'>
                  {speaker?.name ?? message.joins} joined #{channel} ·{' '}
                  {speaker?.role}
                </p>
              )}
              <div className='agent-msg-body'>
                <button
                  type='button'
                  className='agent-avatar'
                  data-present={true}
                  aria-label={`Inspect ${speaker?.name ?? message.speaker}`}
                  onClick={() => onSelectZone(speaker?.zone ?? null)}
                >
                  {speaker?.initials ?? '··'}
                </button>
                <div className='agent-msg-main'>
                  <p className='agent-msg-head'>
                    <span className='agent-msg-name'>
                      {speaker?.name ?? message.speaker}
                    </span>
                    <span className='agent-msg-time'>{at}</span>
                    <span className='agent-message-kind'>{message.kind}</span>
                  </p>
                  {message.thinking && (working || !done) && (
                    <div className='agent-think' aria-label='Working'>
                      <p className='agent-think-head'>
                        <Loader2 size={11} /> Thinking
                      </p>
                      <ul>
                        {message.thinking.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!working && (
                    <p className='agent-msg-text'>
                      {rich(body)}
                      {!done && <span className='agent-caret' />}
                    </p>
                  )}
                  {done && message.tool && (
                    <div
                      className='agent-tool'
                      data-ok={message.tool.ok}
                      aria-label='Tool call'
                    >
                      <p className='agent-tool-call'>{message.tool.call}</p>
                      <p className='agent-tool-result'>
                        {message.tool.pending && <Loader2 size={11} />}
                        {message.tool.result}
                      </p>
                    </div>
                  )}
                  {done && message.map && site && (
                    <SiteMap site={site} bearing={tick.wind_direction ?? 0} />
                  )}
                  {done && message.attachment && (
                    <p className='agent-attach'>
                      <Paperclip size={13} />
                      <span>
                        <span className='agent-attach-name'>
                          {message.attachment.name}
                        </span>
                        <span className='agent-attach-meta'>
                          {message.attachment.meta}
                        </span>
                      </span>
                    </p>
                  )}
                  {done && message.reactions && (
                    <p className='agent-reactions'>
                      {message.reactions.map((reaction) => (
                        <span key={reaction.emoji} className='agent-reaction'>
                          {reaction.emoji} {reaction.count}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </div>
            </article>
          )
        })}
        {notes.map((note, index) => (
          <article key={`note-${index}`} className='agent-msg'>
            <div className='agent-msg-body'>
              <span className='agent-avatar' data-present={true}>
                OP
              </span>
              <div className='agent-msg-main'>
                <p className='agent-msg-head'>
                  <span className='agent-msg-name'>Operator (you)</span>
                  <span className='agent-msg-time'>{note.at}</span>
                  <span className='agent-message-kind'>NOTE</span>
                </p>
                <p className='agent-msg-text'>{note.text}</p>
              </div>
            </div>
          </article>
        ))}
        <p className='agent-typing' data-closed={closed}>
          {typing
            ? `${typing} is typing…`
            : closed
              ? `Conversation closed · ${roster.length ? 'the facade has retreated' : 'nothing further to coordinate'}`
              : 'No one is typing'}
        </p>
      </div>

      <form
        className='agent-composer'
        onSubmit={(event) => {
          event.preventDefault()
          post()
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Message #${channel} — kept local, nothing reaches the controller`}
          aria-label={`Message #${channel}`}
        />
        <button type='submit' aria-label='Post note' disabled={!draft.trim()}>
          <Send size={14} />
        </button>
      </form>
    </section>
  )
}
