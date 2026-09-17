'use client'

import { useEffect, useState } from 'react'
import { getHealth, type HealthResponse } from '@/lib/api-client'

interface FeedsPanelProps {
  visionAgeSeconds: number | null
}

const FEEDS = [
  ['roboflow', 'Roboflow', 'Sky-image model'],
  ['open_meteo', 'Open-Meteo', 'Provider weather'],
  ['met_malaysia', 'MET Malaysia', 'Provider weather'],
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

  const visionAge =
    visionAgeSeconds !== null &&
    Number.isFinite(visionAgeSeconds) &&
    visionAgeSeconds >= 0
      ? visionAgeSeconds
      : null

  return (
    <section className='console-card' aria-label='Upstream feeds'>
      <p className='console-card-title'>Upstream feeds</p>
      <div className='mt-2 divide-y divide-border/60 text-xs'>
        {FEEDS.map(([id, label, kind]) => {
          const feed = health?.dependencies?.[id]
          const success = feed?.last_success_at
          const stamp = success ? Date.parse(success) : NaN
          const age = Number.isFinite(stamp)
            ? Math.max(0, Math.floor((now - stamp) / 1000))
            : null
          const ageLabel =
            age === null
              ? 'unknown'
              : age < 60
                ? `${age}s ago`
                : age < 3600
                  ? `${Math.floor(age / 60)}m ago`
                  : age < 86400
                    ? `${Math.floor(age / 3600)}h ago`
                    : `${Math.floor(age / 86400)}d ago`
          const status =
            feed?.configured === false
              ? 'not configured'
              : (feed?.last_status ?? 'unknown')
          return (
            <details key={id} className='py-2'>
              <summary className='cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'>
                <span className='inline-flex w-[calc(100%-1rem)] items-center justify-between gap-2'>
                  <span className='font-semibold'>{label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status === 'applied' ? 'bg-emerald-50 text-emerald-700' : ['fallback', 'degraded', 'error'].includes(status) ? 'bg-amber-50 text-amber-800' : 'bg-secondary text-muted-foreground'}`}
                  >
                    {status}
                  </span>
                </span>
                <span className='mt-1 block text-[10px] text-muted-foreground'>
                  {kind} · last success {ageLabel}
                </span>
              </summary>
              <p className='mt-2 break-words text-[10px] text-muted-foreground'>
                Last successful response:{' '}
                {success && Number.isFinite(stamp) ? (
                  <time dateTime={success}>{success}</time>
                ) : (
                  'unavailable'
                )}
              </p>
            </details>
          )
        })}
      </div>
      <p
        className={`mt-2 rounded-lg px-2 py-1.5 text-xs ${visionAge !== null && visionAge > 60 ? 'bg-amber-50 text-amber-700' : 'bg-secondary/60 text-muted-foreground'}`}
      >
        {visionAge === null
          ? 'Sky sample unavailable'
          : `Sky sample ${visionAge > 60 ? 'stale · ' : '· '}${Math.floor(visionAge)}s ago`}
      </p>
      <details className='mt-2 text-[10px] leading-4 text-muted-foreground'>
        <summary className='cursor-pointer'>About these observations</summary>
        <p className='mt-1'>
          Last observed in this server process; unknown until used. Refreshes
          every 30s. A successful response does not establish availability for
          this run.
        </p>
        <p className='mt-1'>
          Cloud images estimate sky cover. Sample age alone does not establish
          usable vision. Occupancy remains simulated.
        </p>
      </details>
    </section>
  )
}
