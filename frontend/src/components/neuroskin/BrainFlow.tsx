'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { setHardwareControl } from '@/lib/api-client'
import type { TickPayload, ZoneHeat } from '@/lib/types'
import { AgentRoom, type Site } from './AgentRoom'
import {
  CALM_WIND,
  CRITICAL_WIND,
  DEFAULT_BEARING,
  DEMO_WIND,
  windRoster,
  windTicket,
  type WindTicket,
} from './windRoom'

/** The alert the safety monitor pushes, outside the channel it can open. */
function TicketAlert({
  ticket,
  open,
  waiting,
  onAccept,
  onDismiss,
}: {
  ticket: WindTicket
  open: boolean
  waiting: boolean
  onAccept: () => void
  onDismiss: () => void
}) {
  if (open)
    return (
      <p className='agent-ticket-pin' aria-label='Ticket on this channel'>
        <AlertTriangle size={13} />
        <span className='agent-ticket-id'>{ticket.id}</span>
        <span className='agent-sev' data-severity={ticket.severity}>
          {ticket.severity}
        </span>
        <span className='agent-ticket-status'>{ticket.status}</span>
      </p>
    )
  return (
    <article className='agent-alert' aria-label='Emergency ticket'>
      <p className='agent-ticket-head'>
        <AlertTriangle size={14} />
        <span className='agent-ticket-id'>{ticket.id}</span>
        <span className='agent-sev' data-severity={ticket.severity}>
          {ticket.severity} · Emergency
        </span>
        <button
          type='button'
          className='agent-alert-close'
          aria-label='Dismiss ticket'
          onClick={onDismiss}
        >
          <X size={14} />
        </button>
      </p>
      <p className='agent-ticket-title'>{ticket.title}</p>
      <p className='agent-ticket-meta'>
        Raised by {ticket.raisedBy} · {ticket.status}
      </p>
      <p className='agent-ticket-summary'>{ticket.summary}</p>
      <div className='agent-idle-actions'>
        <button
          type='button'
          className='agent-demo'
          onClick={onAccept}
          disabled={waiting}
        >
          {waiting
            ? 'Raising the wind…'
            : 'Accept ticket · open #wind-response'}
        </button>
      </div>
    </article>
  )
}

/** The Brains lens: a ticket notification, and the channel it opens. */
export function BrainFlow({
  tick,
  floors = 7,
  selectedZone,
  onSelectZone,
  onSimulateWind,
  site,
}: {
  tick: TickPayload
  floors?: number
  selectedZone?: ZoneHeat
  onSelectZone: (id: string | null) => void
  /** Re-runs the day at this wind speed, on the demo bearing. */
  onSimulateWind?: (wind: number) => void
  /** Where the building stands, for the weather agent and its map. */
  site?: Site
}) {
  const [open, setOpen] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const roster = useMemo(
    () => windRoster(tick, { floors, criticalWind: CRITICAL_WIND }),
    [tick, floors]
  )
  const loaded = roster.length > 0
  const ticket = windTicket(tick, roster, {
    wind: DEMO_WIND,
    bearing: DEFAULT_BEARING,
    criticalWind: CRITICAL_WIND,
  })
  // The gust arrives with the next run. Whatever it brings, stop waiting on it.
  useEffect(() => setWaiting(false), [tick])
  // A dismissed alert stays dismissed until the wind itself changes.
  useEffect(() => setDismissed(false), [loaded])

  return (
    <div
      className='flex h-full min-h-0 flex-col gap-4'
      aria-label='Agent channel'
    >
      <header className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <p className='eyebrow'>Building intelligence</p>
          <h1 className='mt-1 font-display text-2xl font-semibold'>
            Agents working together
          </h1>
        </div>
        <label className='text-xs font-medium'>
          Inspect controller
          <select
            aria-label='Brain controller'
            className='setting-input mt-1 block min-w-48'
            value={selectedZone?.zone ?? ''}
            onChange={(event) => onSelectZone(event.target.value || null)}
          >
            <option value=''>Primary controller</option>
            {tick.facade.map((wall) => (
              <optgroup label={wall.orientation} key={wall.orientation}>
                {wall.zones?.map((entry) => (
                  <option key={entry.zone} value={entry.zone}>
                    {entry.zone} · {entry.angle.toFixed(1)}° · {entry.mode}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </header>
      {(!dismissed || open) && (
        <TicketAlert
          ticket={ticket}
          open={open}
          waiting={waiting}
          onAccept={() => {
            setWaiting(!loaded)
            setOpen(true)
            if (!loaded) onSimulateWind?.(DEMO_WIND)
          }}
          onDismiss={() => setDismissed(true)}
        />
      )}
      <div className='min-h-0 flex-1'>
        <AgentRoom
          tick={tick}
          floors={floors}
          selectedZone={selectedZone?.zone}
          onSelectZone={onSelectZone}
          site={site}
          open={open}
          waiting={waiting}
          onOpen={() => setOpen(true)}
          onClose={() => {
            setOpen(false)
            if (!loaded) return
            onSimulateWind?.(CALM_WIND)
            // Release the rig too, or it holds the retreat until the 30 s TTL.
            void setHardwareControl({ mode: 'auto' }).catch(() => {})
          }}
        />
      </div>
    </div>
  )
}
