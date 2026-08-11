'use client'

import {
  CloudSun,
  Gauge,
  RotateCcw,
  SlidersHorizontal,
  Zap,
} from 'lucide-react'
import type {
  CloudProfile,
  ControllerWeights,
  SimulationRunRequest,
} from '@/lib/types'

interface SimulationControlsProps {
  value: SimulationRunRequest
  loading: boolean
  onChange: (value: SimulationRunRequest) => void
  onRun: () => void
  onReset: () => void
}

const cloudProfiles: Array<{ value: CloudProfile; label: string }> = [
  { value: 'clear', label: 'Clear' },
  { value: 'scattered', label: 'Scattered' },
  { value: 'overcast', label: 'Overcast' },
]

const weightLabels: Array<{ key: keyof ControllerWeights; label: string }> = [
  { key: 'thermal', label: 'Thermal' },
  { key: 'lux', label: 'Daylight' },
  { key: 'movement', label: 'Movement' },
  { key: 'risk', label: 'Risk' },
]

export function SimulationControls({
  value,
  loading,
  onChange,
  onRun,
  onReset,
}: SimulationControlsProps) {
  const setWeight = (key: keyof ControllerWeights, next: number) => {
    onChange({ ...value, weights: { ...value.weights, [key]: next } })
  }

  return (
    <section className='control-panel' aria-label='Simulation controls'>
      <div className='flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4'>
        <div className='flex items-center gap-2'>
          <SlidersHorizontal className='h-4 w-4 text-mint' />
          <h2 className='text-sm font-semibold text-white'>
            Simulation controls
          </h2>
        </div>
        <button
          className='icon-button'
          onClick={onReset}
          type='button'
          aria-label='Reset controls'
        >
          <RotateCcw className='h-4 w-4' />
        </button>
      </div>

      <div className='space-y-6 p-5'>
        <div className='space-y-6' data-tour='environment-inputs'>
          <label className='control-label' data-tour='control-date'>
            <span>Date</span>
            <input
              className='control-input mt-2'
              type='date'
              value={value.date}
              onChange={(event) =>
                onChange({ ...value, date: event.target.value })
              }
            />
          </label>

          <div data-tour='control-cloud'>
            <div className='control-label mb-2 flex items-center gap-2'>
              <CloudSun className='h-4 w-4 text-mint' />
              Cloud profile
            </div>
            <div className='grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1'>
              {cloudProfiles.map((profile) => (
                <button
                  key={profile.value}
                  className={
                    value.cloud_profile === profile.value
                      ? 'segment-active'
                      : 'segment'
                  }
                  type='button'
                  onClick={() =>
                    onChange({ ...value, cloud_profile: profile.value })
                  }
                >
                  {profile.label}
                </button>
              ))}
            </div>
          </div>

          <div data-tour='control-occupancy'>
            <RangeControl
              icon={<Gauge className='h-4 w-4 text-mint' />}
              label='Occupancy'
              value={value.occupancy_scale}
              min={0}
              max={1.5}
              step={0.1}
              suffix='×'
              onChange={(next) => onChange({ ...value, occupancy_scale: next })}
            />
          </div>

          <div data-tour='control-wind'>
            <RangeControl
              icon={<Zap className='h-4 w-4 text-mint' />}
              label='Wind override'
              value={value.wind_override ?? 3}
              min={0}
              max={20}
              step={0.5}
              suffix=' m/s'
              onChange={(next) => onChange({ ...value, wind_override: next })}
            />
          </div>

          <label
            className='flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white'
            data-tour='control-power'
          >
            <span>
              <span className='block font-medium'>Facade power</span>
              <span className='text-xs text-white/50'>
                Toggle the global safety input
              </span>
            </span>
            <input
              className='power-toggle'
              type='checkbox'
              checked={value.power_ok}
              onChange={(event) =>
                onChange({ ...value, power_ok: event.target.checked })
              }
            />
          </label>
        </div>

        <div data-tour='controller-weights'>
          <p className='control-label mb-3'>Controller priorities</p>
          <div className='space-y-3'>
            {weightLabels.map(({ key, label }) => (
              <RangeControl
                key={key}
                compact
                label={label}
                value={value.weights[key]}
                min={0}
                max={1}
                step={0.05}
                onChange={(next) => setWeight(key, next)}
              />
            ))}
          </div>
          <p className='mt-2 text-[11px] leading-relaxed text-white/40'>
            Weights are normalized by the controller before every run.
          </p>
        </div>

        <div className='space-y-4' data-tour='run-workflow'>
          <label className='control-label'>
            <span>Deterministic seed</span>
            <input
              className='control-input mt-2'
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
            className='run-button'
            onClick={onRun}
            disabled={loading}
            type='button'
          >
            <span className={loading ? 'status-pulse' : 'run-dot'} />
            {loading ? 'Simulating day…' : 'Run simulation'}
          </button>
        </div>
      </div>
    </section>
  )
}

interface RangeControlProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  icon?: React.ReactNode
  compact?: boolean
  onChange: (value: number) => void
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  icon,
  compact,
  onChange,
}: RangeControlProps) {
  return (
    <label className='block'>
      <span className='control-label flex items-center justify-between gap-3'>
        <span className='flex items-center gap-2'>
          {icon}
          {label}
        </span>
        <span className='font-mono text-xs text-mint'>
          {value.toFixed(compact ? 2 : 1)}
          {suffix}
        </span>
      </span>
      <input
        className='range-input mt-2'
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
