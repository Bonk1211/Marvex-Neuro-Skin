'use client'

import type { SimulationRunResponse } from '@/lib/types'
import { timeLabel } from './DashboardCards'

interface ProvenanceStripProps {
  metadata: SimulationRunResponse['metadata']
  visionAgeSeconds: number | null
}

const sourceLabels = {
  synthetic: 'Synthetic weather',
  met_anchored: 'MET anchored',
  open_meteo: 'Open-Meteo',
}

export function ProvenanceStrip({
  metadata,
  visionAgeSeconds,
}: ProvenanceStripProps) {
  const weather = metadata.weather_context
  const fallback = weather?.status === 'fallback'
  const visionAge =
    visionAgeSeconds !== null &&
    Number.isFinite(visionAgeSeconds) &&
    visionAgeSeconds >= 0
      ? visionAgeSeconds
      : null
  return (
    <section
      aria-label='Data provenance'
      className={`console-card provenance-strip ${fallback ? 'border-amber-400 bg-amber-50' : ''}`}
    >
      <span className='flex items-center gap-2 font-semibold'>
        <span
          aria-hidden='true'
          className={`provenance-dot ${fallback ? 'provenance-dot-warn' : weather ? 'bg-emerald-500' : 'bg-slate-400'}`}
        />
        {fallback
          ? 'Synthetic weather · fallback'
          : weather
            ? `${weather.provider}${weather.dataset ? ` · ${weather.dataset}` : ''}`
            : sourceLabels[metadata.environment_source]}
      </span>
      {weather && !fallback && (
        <span className='text-muted-foreground'>
          {metadata.environment_source === 'met_anchored'
            ? 'Provider-anchored simulation'
            : 'Provider weather'}
        </span>
      )}
      <span className='rounded bg-secondary px-2 py-1 font-medium'>
        Sensors · simulated
      </span>
      <span className='text-muted-foreground'>{metadata.load_unit}</span>
      <span
        className={
          visionAge !== null && visionAge > 60
            ? 'font-semibold text-amber-700'
            : 'text-muted-foreground'
        }
      >
        {visionAge === null
          ? 'Sky sample unavailable'
          : `Sky sample ${visionAge > 60 ? 'stale · ' : '· '}${Math.floor(visionAge)}s ago`}
      </span>
      <details className='ml-auto min-w-0 text-muted-foreground'>
        <summary className='cursor-pointer rounded font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'>
          Run evidence
        </summary>
        <div className='mt-2 space-y-1.5 leading-4'>
          {weather && (
            <p>
              {fallback
                ? `Attempted ${weather.provider}${weather.dataset ? ` · ${weather.dataset}` : ''} at`
                : 'Fetched'}{' '}
              {timeLabel(weather.fetched_at, metadata.timezone)} (
              {metadata.timezone})
              <time className='block' dateTime={weather.fetched_at}>
                {weather.fetched_at}
              </time>
            </p>
          )}
          {weather?.fallback_reason && (
            <p className='font-semibold text-amber-800'>
              {weather.fallback_reason}
            </p>
          )}
          {metadata.synthetic && <p>Synthetic inputs · seed {metadata.seed}</p>}
          <p>{metadata.data_notice}</p>
        </div>
      </details>
    </section>
  )
}
