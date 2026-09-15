'use client'

import type { ControllerWeights, TickPayload, ZoneHeat } from '@/lib/types'
import { DEFAULT_WEIGHTS, weightLabels } from './ControllerPanel'

interface CostBreakdownPanelProps {
  tick: TickPayload
  weights: ControllerWeights
  zone?: ZoneHeat
}

export function CostBreakdownPanel({
  tick,
  weights,
  zone,
}: CostBreakdownPanelProps) {
  const costs = zone ? zone.cost_breakdown : tick.cost_breakdown
  if (!costs)
    return (
      <section className='console-card' aria-label='Cost breakdown'>
        <p className='console-card-title'>{zone?.zone} objective</p>
        <p className='mt-2 text-xs text-muted-foreground'>
          Local objective unavailable in this run.
        </p>
      </section>
    )
  const target = zone ? zone.angle_target : tick.angle_target
  const final = zone ? zone.angle : tick.angle_final
  const total = Object.values(costs).reduce((sum, value) => sum + value, 0)
  const weightTotal = Object.values(weights).reduce(
    (sum, value) => sum + value,
    0
  )
  return (
    <section className='console-card' aria-label='Cost breakdown'>
      <p className='console-card-title'>Cost breakdown</p>
      <p className='mt-1 text-xs text-muted-foreground'>
        {zone ? `${zone.zone} local objective` : 'Primary controller objective'}{' '}
        · lower is better · dimensionless
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
              width: `${total > 0 ? (costs[key] / total) * 100 : 0}%`,
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
              {costs[key].toFixed(3)}{' '}
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
        Target {target?.toFixed(1) ?? '—'}° → final {final.toFixed(1)}° · Δ{' '}
        {target === undefined ? '—' : (final - target).toFixed(1)}°
      </p>
    </section>
  )
}
