'use client'

import { useEffect, useState } from 'react'
import { getHealth, type HealthResponse } from '@/lib/api-client'

interface FeedsPanelProps {
  visionAgeSeconds: number | null
}

const FEEDS = [
  ['roboflow', 'Roboflow'],
  ['open_meteo', 'Open-Meteo'],
  ['met_malaysia', 'MET Malaysia'],
] as const

export function FeedsPanel({ visionAgeSeconds }: FeedsPanelProps) {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [now, setNow] = useState(0)
  useEffect(() => {
    let controller: AbortController | null = null
    const refresh = async () => {
      controller?.abort()
      const pending = new AbortController()
      controller = pending
      const timeout = setTimeout(() => pending.abort(), 5000)
      try {
        const result = await getHealth(pending.signal)
        if (!pending.signal.aborted) setHealth(result)
      } catch {
        setHealth(null)
      } finally {
        clearTimeout(timeout)
        setNow(Date.now())
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30000)
    return () => {
      controller?.abort()
      clearInterval(timer)
    }
  }, [])

  return (
    <section className='console-card' aria-label='Upstream feeds'>
      <p className='console-card-title'>Upstream feeds</p>
      <p className='mt-1 text-[10px] text-muted-foreground'>
        Last observed in this server process; unknown until used. Refreshes
        every 30s.
      </p>
      <dl className='mt-3 space-y-3 text-xs'>
        {FEEDS.map(([id, label]) => {
          const feed = health?.dependencies?.[id]
          const success = feed?.last_success_at
          const age = success
            ? Math.max(0, Math.floor((now - Date.parse(success)) / 1000))
            : null
          return (
            <div key={id}>
              <dt className='font-semibold'>{label}</dt>
              <dd className='mt-1 text-muted-foreground'>
                {feed?.configured === false
                  ? 'not configured'
                  : (feed?.last_status ?? 'unknown')}{' '}
                · last success {age === null ? 'unknown' : `${age}s ago`}
                {success && (
                  <time className='block text-[10px]' dateTime={success}>
                    {success}
                  </time>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
      <p
        className={`mt-3 text-xs ${visionAgeSeconds !== null && visionAgeSeconds > 60 ? 'text-amber-700' : 'text-muted-foreground'}`}
      >
        Vision sample:{' '}
        {visionAgeSeconds === null
          ? 'unknown'
          : `${Math.floor(visionAgeSeconds)}s ago`}
      </p>
    </section>
  )
}
