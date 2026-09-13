'use client'

import type { SimulationRunResponse } from '@/lib/types'
import { timeLabel } from './DashboardCards'

interface ProvenanceStripProps {
  metadata: SimulationRunResponse['metadata']
  visionAgeSeconds: number | null
}

const sourceLabels = {
  synthetic: 'Synthetic',
  met_anchored: 'MET anchored',
  open_meteo: 'Open-Meteo',
}

export function ProvenanceStrip({
  metadata,
  visionAgeSeconds,
}: ProvenanceStripProps) {
  const weather = metadata.weather_context
  const fallback = weather?.status === 'fallback'
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
        {weather
          ? `${fallback ? 'Fallback · ' : ''}${weather.provider}${weather.dataset ? ` · ${weather.dataset}` : ''}`
          : sourceLabels[metadata.environment_source]}
      </span>
      {weather && (
        <span>
          {fallback ? 'Attempted' : 'Fetched'}{' '}
          {timeLabel(weather.fetched_at, metadata.timezone)} (
          {metadata.timezone})
        </span>
      )}
      {weather?.fallback_reason && (
        <span className='font-semibold text-amber-800'>
          {weather.fallback_reason}
        </span>
      )}
      <span className='rounded bg-secondary px-2 py-1 font-semibold'>
        {metadata.load_unit}
      </span>
      {metadata.synthetic && (
        <span>Synthetic inputs · seed {metadata.seed}</span>
      )}
      {visionAgeSeconds !== null && (
        <span
          className={
            visionAgeSeconds > 60 ? 'font-semibold text-amber-700' : ''
          }
        >
          sky sample {Math.floor(visionAgeSeconds)}s ago
        </span>
      )}
      <p className='w-full leading-4'>{metadata.data_notice}</p>
    </section>
  )
}
