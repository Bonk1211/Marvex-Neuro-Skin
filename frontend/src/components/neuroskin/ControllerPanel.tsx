'use client'

import { BrainCircuit, Play, SlidersHorizontal } from 'lucide-react'
import type { ControllerWeights, SimulationRunRequest } from '@/lib/types'
import { RangeControl } from './SimulationControls'

interface ControllerPanelProps {
  value: SimulationRunRequest
  loading: boolean
  onChange: (value: SimulationRunRequest) => void
  onRun: () => void
}

export const DEFAULT_WEIGHTS: ControllerWeights = {
  thermal: 0.45,
  lux: 0.45,
  movement: 0.05,
  risk: 0.05,
}

export const weightLabels: Array<{
  key: keyof ControllerWeights
  label: string
  symbol: string
  color: string
  formula: {
    title: string
    expression: string
    description: string
  }
}> = [
  {
    key: 'thermal',
    label: 'Thermal load',
    symbol: 'wT',
    color: 'bg-emerald-500',
    formula: {
      title: 'Thermal load cost',
      expression: 'CT(θ) = wT × L(θ)',
      description:
        'Heat cost follows transmitted solar gain × SHGC; internal and latent loads stay unchanged.',
    },
  },
  {
    key: 'lux',
    label: 'Daylight comfort',
    symbol: 'wL',
    color: 'bg-sky-500',
    formula: {
      title: 'Daylight comfort cost',
      expression: 'CL(θ) = wL × P(lux(θ))',
      description: 'The penalty is zero inside the 300–700 lux comfort band.',
    },
  },
  {
    key: 'movement',
    label: 'Movement',
    symbol: 'wM',
    color: 'bg-amber-500',
    formula: {
      title: 'Movement cost',
      expression: 'CM(θ) = wM × ((θ − θprevious) / 60)²',
      description:
        'Squared movement cost favours small adjustments; the speed limit bounds each actuator step.',
    },
  },
  {
    key: 'risk',
    label: 'Wind risk',
    symbol: 'wR',
    color: 'bg-rose-500',
    formula: {
      title: 'Wind risk cost',
      expression: 'CR(θ) = wR × (v / 15)² × θ / 60',
      description: 'Risk increases with wind speed and facade exposure.',
    },
  },
]

export function ControllerPanel({
  value,
  loading,
  onChange,
  onRun,
}: ControllerPanelProps) {
  const weightTotal = Object.values(value.weights).reduce(
    (sum, weight) => sum + weight,
    0
  )
  const normalized = (key: keyof ControllerWeights) =>
    weightTotal > 0 ? value.weights[key] / weightTotal : DEFAULT_WEIGHTS[key]
  const setWeight = (key: keyof ControllerWeights, next: number) => {
    onChange({ ...value, weights: { ...value.weights, [key]: next } })
  }

  return (
    <aside
      className='settings-rail'
      aria-label='Controller settings and formulas'
    >
      <div className='settings-rail-header'>
        <div>
          <p className='rail-kicker'>Decision settings</p>
          <h2 className='rail-title'>Mechatronic brain</h2>
        </div>
        <div className='rounded-full bg-primary/10 p-2 text-primary'>
          <BrainCircuit className='h-4 w-4' />
        </div>
      </div>

      <div className='settings-rail-body'>
        <p className='text-[10px] leading-4 text-muted-foreground'>
          64 independent sensor loops · shared optimisation priorities and
          building-wide safety overrides.
        </p>
        <section className='setting-group' data-tour='controller-weights'>
          <div className='flex items-start gap-3'>
            <div className='setting-group-icon'>
              <SlidersHorizontal className='h-4 w-4' />
            </div>
            <div>
              <p className='text-[9px] font-bold uppercase tracking-[0.16em] text-primary/70'>
                04 · Priorities
              </p>
              <h3 className='mt-0.5 text-sm font-semibold'>Cost weights</h3>
            </div>
          </div>

          <div className='mt-4 space-y-4'>
            {weightLabels.map(({ key, label, symbol, color, formula }) => (
              <div key={key}>
                <RangeControl
                  compact
                  label={label}
                  formula={formula}
                  value={value.weights[key]}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(next) => setWeight(key, next)}
                />
                <div className='mt-1.5 flex items-center justify-between text-[9px] text-muted-foreground'>
                  <span className='flex items-center gap-1.5 font-mono'>
                    <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
                    {symbol}
                  </span>
                  <span>{(normalized(key) * 100).toFixed(0)}% normalized</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          className='setting-group'
          aria-label='Glazing and actuator calibration'
        >
          <h3 className='text-sm font-semibold'>
            Glazing and actuator calibration
          </h3>
          <p className='mt-1 text-[10px] leading-4 text-muted-foreground'>
            Simulation assumptions; calibrate with measured glazing and actuator
            data.
          </p>
          <div className='mt-3 space-y-4'>
            <RangeControl
              label='Direct-sun screening limit'
              value={value.glare_limit_w_m2 ?? 25}
              min={0}
              max={2000}
              step={1}
              suffix=' W/m²'
              onChange={(next) =>
                onChange({ ...value, glare_limit_w_m2: next })
              }
            />
            <RangeControl
              label='Glazing SHGC'
              value={value.glazing_shgc ?? 0.4}
              min={0}
              max={1}
              step={0.01}
              compact
              onChange={(next) => onChange({ ...value, glazing_shgc: next })}
            />
            <RangeControl
              label='Actuator speed limit'
              value={value.actuator_speed_deg_per_min ?? 1.2}
              min={0.1}
              max={12}
              step={0.1}
              suffix=' °/min'
              onChange={(next) =>
                onChange({ ...value, actuator_speed_deg_per_min: next })
              }
            />
          </div>
          <p className='mt-3 text-[9px] leading-4 text-muted-foreground'>
            Direct-sun screening flags exposure above the limit. DGP glare
            assessment requires a separate luminance model. SHGC estimates the
            fraction of solar energy admitted through the glazing.
          </p>
        </section>

        <section className='setting-group' data-tour='run-workflow'>
          <label className='block'>
            <span className='field-label'>Deterministic seed</span>
            <input
              className='setting-input mt-2'
              type='number'
              min={0}
              value={value.seed}
              onChange={(event) =>
                onChange({
                  ...value,
                  seed: Math.max(0, Number(event.target.value)),
                })
              }
            />
          </label>
          <button
            className='run-button-light mt-3'
            onClick={onRun}
            disabled={loading}
            type='button'
          >
            {loading ? (
              <span className='status-pulse' />
            ) : (
              <Play className='h-3.5 w-3.5 fill-current' />
            )}
            {loading ? 'Simulating day…' : 'Apply settings and re-run'}
          </button>
          <p className='mt-2 text-center text-[9px] leading-4 text-muted-foreground'>
            144 decisions · 10-minute intervals · repeatable
          </p>
        </section>
      </div>
    </aside>
  )
}
