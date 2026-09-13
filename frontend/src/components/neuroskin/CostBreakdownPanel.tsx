'use client'

import type { ControllerWeights, TickPayload } from '@/lib/types'
import { DEFAULT_WEIGHTS, weightLabels } from './ControllerPanel'

interface CostBreakdownPanelProps {
  tick: TickPayload
  weights: ControllerWeights
}

export function CostBreakdownPanel({ tick, weights }: CostBreakdownPanelProps) {
  const total = Object.values(tick.cost_breakdown).reduce(
    (sum, value) => sum + value,
    0
  )
  const weightTotal = Object.values(weights).reduce(
    (sum, value) => sum + value,
    0
  )
  return (
    <section className='console-card' aria-label='Cost breakdown'>
      <p className='console-card-title'>Cost breakdown</p>
      <p className='mt-1 text-xs text-muted-foreground'>
        Primary controller objective · lower is better · dimensionless
      </p>
      <div
        className='mt-3 flex h-3 overflow-hidden rounded bg-secondary'
        role='img'
        aria-label={`Objective contributions, total ${total.toFixed(3)}`}
      >
        {weightLabels.map(({ key, color }) => (
          <span
            key={key}
            className={color}
            style={{
              width: `${total > 0 ? (tick.cost_breakdown[key] / total) * 100 : 0}%`,
            }}
          />
        ))}
      </div>
      <dl className='mt-3 space-y-2 text-xs'>
        {weightLabels.map(({ key, label, color }) => (
          <div className='flex items-center justify-between gap-2' key={key}>
            <dt className='flex items-center gap-2'>
              <span className={`h-2 w-2 rounded-full ${color}`} />
              {label}
            </dt>
            <dd className='font-mono'>
              {tick.cost_breakdown[key].toFixed(3)}{' '}
              <span className='text-muted-foreground'>
                · weight{' '}
                {(
                  (weightTotal > 0
                    ? weights[key] / weightTotal
                    : DEFAULT_WEIGHTS[key]) * 100
                ).toFixed(0)}
                %
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className='mt-3 text-xs'>
        Target {tick.angle_target.toFixed(1)}° → final{' '}
        {tick.angle_final.toFixed(1)}° · Δ{' '}
        {(tick.angle_final - tick.angle_target).toFixed(1)}°
      </p>
    </section>
  )
}
