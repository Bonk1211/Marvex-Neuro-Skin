'use client'

import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { ComparisonMetric } from '@/lib/types'

export const timeLabel = (timestamp: string, timeZone = 'Asia/Kuala_Lumpur') =>
  new Intl.DateTimeFormat('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(timestamp))

/** Bounded value as a 270-degree arc. Unbounded counts pass a rough fraction. */
export function GaugeCard({
  icon: Icon,
  label,
  display,
  detail,
  fraction,
}: {
  icon: React.ElementType
  label: string
  display: string
  detail: string
  fraction: number
}) {
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const sweep = 0.75
  const filled = Math.min(1, Math.max(0, fraction)) * sweep

  return (
    <article className='gauge-card'>
      <div className='relative'>
        <svg viewBox='0 0 64 64' className='h-16 w-16 -rotate-[135deg]'>
          <circle
            cx='32'
            cy='32'
            r={radius}
            fill='none'
            strokeWidth='6'
            strokeLinecap='round'
            className='stroke-secondary'
            strokeDasharray={`${circumference * sweep} ${circumference}`}
          />
          <circle
            cx='32'
            cy='32'
            r={radius}
            fill='none'
            strokeWidth='6'
            strokeLinecap='round'
            className='stroke-primary'
            strokeDasharray={`${circumference * filled} ${circumference}`}
          />
        </svg>
        <span className='absolute inset-0 grid place-items-center'>
          <Icon className='h-4 w-4 text-primary' />
        </span>
      </div>
      <p className='mt-1 font-display text-base font-semibold tracking-tight'>
        {display}
      </p>
      <p className='text-[9px] font-semibold uppercase tracking-wider text-muted-foreground'>
        {label}
      </p>
      <p className='mt-0.5 text-[9px] text-muted-foreground'>{detail}</p>
    </article>
  )
}

/** "70%" but "1 moves" — only a bare symbol sits tight against its number. */
export const formatMetric = (value: number, unit: string) =>
  unit.length <= 1 ? `${value}${unit}` : `${value} ${unit}`

export function ImpactStrip({ metrics }: { metrics: ComparisonMetric[] }) {
  return (
    <section
      className='console-card'
      aria-label='Impact versus binary controller'
      data-tour='comparison'
    >
      <div className='flex items-center justify-between'>
        <p className='console-card-title'>Impact</p>
        <p className='text-[9px] text-muted-foreground'>vs binary controller</p>
      </div>
      <div className='mt-2 grid gap-1.5'>
        {metrics.map((metric) => {
          const improved = metric.higher_is_better
            ? metric.ours > metric.naive
            : metric.ours < metric.naive
          return (
            <div
              className='border-t border-border/50 pt-1.5 first:border-0 first:pt-0'
              key={metric.metric}
            >
              <div className='flex items-center justify-between gap-2'>
                <p className='truncate text-[10px] font-semibold text-muted-foreground'>
                  {metric.label}
                </p>
                {improved && <span className='winner-badge'>Better</span>}
              </div>
              <div className='mt-0.5 flex flex-wrap items-baseline gap-x-2'>
                <span className='font-mono text-sm font-semibold'>
                  {formatMetric(metric.ours, metric.unit)}
                </span>
                <span className='text-[9px] text-muted-foreground'>
                  binary {formatMetric(metric.naive, metric.unit)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function StatusBadge({ mode }: { mode: string }) {
  return (
    <span
      className={
        mode === 'SAFE'
          ? 'safe-badge'
          : mode === 'HOLD'
            ? 'hold-badge'
            : 'normal-badge'
      }
    >
      {mode}
    </span>
  )
}

export function LoadingState() {
  return (
    <div className='absolute inset-0 flex flex-col items-center justify-center text-center'>
      <LoaderCircle className='h-7 w-7 animate-spin text-primary' />
      <h2 className='mt-3 font-display text-lg font-semibold'>
        Running simulation
      </h2>
      <p className='mt-1 text-xs text-muted-foreground'>144 decision ticks</p>
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className='absolute inset-0 flex flex-col items-center justify-center p-10 text-center'>
      <div className='rounded-full bg-red-50 p-3 text-red-600'>
        <AlertTriangle className='h-6 w-6' />
      </div>
      <h2 className='mt-4 font-display text-xl font-semibold'>
        Simulation unavailable
      </h2>
      <p className='mt-2 max-w-lg text-sm text-muted-foreground'>{message}</p>
      <button className='retry-button mt-5' onClick={onRetry} type='button'>
        Try again
      </button>
    </div>
  )
}
