'use client'

import {
  Building2,
  CalendarDays,
  CloudSun,
  Compass,
  Gauge,
  MapPin,
  RotateCcw,
  ShieldCheck,
  Wind,
} from 'lucide-react'
import type {
  CloudProfile,
  EnvironmentSource,
  FacadeOrientation,
  SimulationRunRequest,
} from '@/lib/types'
import type { BuildingVariant } from './buildingComparison'
import { cardinal, DEFAULT_BEARING } from './windRoom'

interface SimulationControlsProps {
  value: SimulationRunRequest
  onChange: (value: SimulationRunRequest) => void
  onReset: () => void
  buildingVariant?: BuildingVariant
}

const cloudProfiles: Array<{ value: CloudProfile; label: string }> = [
  { value: 'clear', label: 'Clear' },
  { value: 'scattered', label: 'Scattered' },
  { value: 'overcast', label: 'Overcast' },
]

const environmentSources: Array<{
  value: EnvironmentSource
  label: string
  hint: string
}> = [
  { value: 'synthetic', label: 'Synthetic', hint: 'Seeded clear-sky model' },
  {
    value: 'met_anchored',
    label: 'MET-anchored',
    hint: 'Official Kuala Lumpur daily forecast shapes the synthetic day',
  },
  {
    value: 'open_meteo',
    label: 'Open-Meteo',
    hint: 'Modelled hourly irradiance, temperature, cloud, wind and rain',
  },
]

const orientations: FacadeOrientation[] = ['north', 'east', 'south', 'west']

// pvlib surface tilt. 115 is the Diamond Building's facades leaning out 25
// degrees, which is the passive shading the design is known for; 90 is the
// plain vertical wall it is measured against.
const facadeTilts: Array<{ value: number; label: string; hint: string }> = [
  {
    value: 115,
    label: 'Tilted 25°',
    hint: 'As built: the overhang self-shades the north and south facades',
  },
  {
    value: 90,
    label: 'Upright',
    hint: 'Counterfactual: a plain vertical wall, for comparison',
  },
]

// ponytail: a short preset list beats a geocoder. The API takes any lat/lon,
// so a custom site is one curl away when someone actually needs it.
const sites: Array<{
  name: string
  latitude: number
  longitude: number
  timezone: string
}> = [
  {
    name: 'ST Diamond Building, Putrajaya',
    latitude: 2.922,
    longitude: 101.6885,
    timezone: 'Asia/Kuala_Lumpur',
  },
  {
    name: 'Kuala Lumpur, Malaysia',
    latitude: 3.139,
    longitude: 101.6869,
    timezone: 'Asia/Kuala_Lumpur',
  },
  {
    name: 'Singapore',
    latitude: 1.3521,
    longitude: 103.8198,
    timezone: 'Asia/Singapore',
  },
  {
    name: 'Dubai, UAE',
    latitude: 25.2048,
    longitude: 55.2708,
    timezone: 'Asia/Dubai',
  },
  {
    name: 'Phoenix, USA',
    latitude: 33.4484,
    longitude: -112.074,
    timezone: 'America/Phoenix',
  },
  {
    name: 'Sydney, Australia',
    latitude: -33.8688,
    longitude: 151.2093,
    timezone: 'Australia/Sydney',
  },
  {
    name: 'London, UK',
    latitude: 51.5072,
    longitude: -0.1276,
    timezone: 'Europe/London',
  },
]

const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

export function SimulationControls({
  value,
  onChange,
  onReset,
  buildingVariant = 'controlled',
}: SimulationControlsProps) {
  const controlled = buildingVariant === 'controlled'
  return (
    <aside className='settings-rail' aria-label='Environment settings'>
      <div className='settings-rail-header'>
        <div>
          <p className='rail-kicker'>Input settings</p>
          <h2 className='rail-title'>Environment</h2>
        </div>
        <button
          className='rail-icon-button'
          onClick={onReset}
          type='button'
          aria-label='Reset controls'
        >
          <RotateCcw className='h-4 w-4' />
        </button>
      </div>

      <div className='settings-rail-body'>
        <label className='flex items-start gap-2 text-xs'>
          <input
            type='checkbox'
            checked={value.daylight_model_enabled ?? false}
            onChange={(event) =>
              onChange({
                ...value,
                daylight_model_enabled: event.target.checked,
              })
            }
          />
          <span>
            Modelled seat daylight
            <span className='block text-[10px] text-muted-foreground'>
              Apply with the next run. Available for the Putrajaya tilted facade
              when models are installed.
            </span>
          </span>
        </label>
        <ControlGroup
          icon={<CloudSun className='h-4 w-4' />}
          number='01'
          title='Weather'
        >
          <div data-tour='environment-inputs'>
            <p className='field-label'>Data source</p>
            <div className='setting-segments mt-2'>
              {environmentSources.map((source) => (
                <button
                  key={source.value}
                  className={
                    value.environment_source === source.value
                      ? 'setting-segment-active'
                      : 'setting-segment'
                  }
                  type='button'
                  title={source.hint}
                  onClick={() =>
                    onChange({
                      ...value,
                      environment_source: source.value,
                      date:
                        source.value === 'met_anchored'
                          ? todayIn('Asia/Kuala_Lumpur')
                          : value.date,
                    })
                  }
                >
                  {source.label}
                </button>
              ))}
            </div>
            <p className='mt-2 text-[10px] text-muted-foreground'>
              {
                environmentSources.find(
                  (source) => source.value === value.environment_source
                )?.hint
              }
            </p>
          </div>

          <label className='block' data-tour='control-date'>
            <span className='field-label flex items-center gap-1.5'>
              <CalendarDays className='h-3.5 w-3.5' /> Date
            </span>
            <input
              className='setting-input mt-2'
              type='date'
              value={value.date}
              onChange={(event) =>
                onChange({ ...value, date: event.target.value })
              }
            />
          </label>

          <div data-tour='control-cloud'>
            <p className='field-label'>Cloud profile</p>
            <div className='setting-segments mt-2 grid-cols-3'>
              {cloudProfiles.map((profile) => (
                <button
                  key={profile.value}
                  className={
                    value.cloud_profile === profile.value
                      ? 'setting-segment-active'
                      : 'setting-segment'
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
        </ControlGroup>

        <ControlGroup
          icon={<MapPin className='h-4 w-4' />}
          number='02'
          title='Site'
        >
          <label className='block' data-tour='control-site'>
            <span className='field-label flex items-center gap-1.5'>
              <MapPin className='h-3.5 w-3.5' /> Location
            </span>
            <select
              className='setting-input mt-2'
              value={value.location_name}
              onChange={(event) => {
                const site = sites.find(
                  (entry) => entry.name === event.target.value
                )
                if (!site) return
                onChange({
                  ...value,
                  location_name: site.name,
                  latitude: site.latitude,
                  longitude: site.longitude,
                  timezone: site.timezone,
                })
              }}
            >
              {sites.map((site) => (
                <option key={site.name} value={site.name}>
                  {site.name}
                </option>
              ))}
            </select>
            <span className='mt-2 block font-mono text-[10px] text-muted-foreground'>
              {value.latitude.toFixed(3)}, {value.longitude.toFixed(3)} ·{' '}
              {value.timezone}
            </span>
          </label>

          <div data-tour='control-orientation'>
            <p className='field-label flex items-center gap-1.5'>
              <Compass className='h-3.5 w-3.5' /> Primary reporting facade
            </p>
            <div className='setting-segments mt-2 grid-cols-4'>
              {orientations.map((orientation) => (
                <button
                  key={orientation}
                  className={
                    value.facade_orientation === orientation
                      ? 'setting-segment-active'
                      : 'setting-segment'
                  }
                  type='button'
                  onClick={() =>
                    onChange({ ...value, facade_orientation: orientation })
                  }
                >
                  {orientation.charAt(0).toUpperCase()}
                </button>
              ))}
            </div>
            <p className='mt-2 text-[10px] text-muted-foreground'>
              {controlled
                ? 'All four sides have 16 independent sensor-controlled zones. This selection only chooses the headline comparison metrics.'
                : 'Each side has 16 surface zones. This reporting selection also applies to the controlled-building comparison.'}
            </p>
          </div>

          <div data-tour='control-tilt'>
            <p className='field-label'>Facade geometry</p>
            <div className='setting-segments mt-2 grid-cols-2'>
              {facadeTilts.map((tilt) => (
                <button
                  key={tilt.value}
                  className={
                    value.facade_tilt === tilt.value
                      ? 'setting-segment-active'
                      : 'setting-segment'
                  }
                  type='button'
                  title={tilt.hint}
                  onClick={() =>
                    onChange({ ...value, facade_tilt: tilt.value })
                  }
                >
                  {tilt.label}
                </button>
              ))}
            </div>
            <p className='mt-2 text-[10px] text-muted-foreground'>
              {
                facadeTilts.find((tilt) => tilt.value === value.facade_tilt)
                  ?.hint
              }
            </p>
          </div>
        </ControlGroup>

        <ControlGroup
          icon={<Building2 className='h-4 w-4' />}
          number='03'
          title='Demand'
        >
          <div data-tour='control-occupancy'>
            <RangeControl
              icon={<Gauge className='h-3.5 w-3.5' />}
              label='Occupancy'
              formula={
                controlled
                  ? {
                      title: 'Occupancy load',
                      expression: 'Linternal = 0.12 × occupancy',
                      description:
                        'Occupancy also increases the latent humidity load.',
                    }
                  : undefined
              }
              value={value.occupancy_scale}
              min={0}
              max={1.5}
              step={0.1}
              suffix='×'
              onChange={(next) => onChange({ ...value, occupancy_scale: next })}
            />
            {!controlled && (
              <p className='mt-2 text-[10px] text-muted-foreground'>
                Occupancy applies to the controlled-building demand comparison;
                baseline comfort is not estimated.
              </p>
            )}
          </div>

          <div data-tour='control-wind'>
            <RangeControl
              icon={<Wind className='h-3.5 w-3.5' />}
              label='Wind override'
              formula={
                controlled
                  ? {
                      title: 'Wind exposure cost',
                      expression: 'R(θ) = (v / 15)² × θ / 60',
                      description:
                        'At 15 m/s, the safety rule bypasses this cost.',
                    }
                  : undefined
              }
              value={value.wind_override ?? 3}
              min={0}
              max={20}
              step={0.5}
              suffix=' m/s'
              onChange={(next) => onChange({ ...value, wind_override: next })}
            />
            <div className='mt-2 flex items-center justify-between text-[10px] text-muted-foreground'>
              <span>Calm</span>
              <span className={controlled ? 'text-amber-700' : ''}>
                {controlled ? '15 m/s safety limit' : 'Shared wind input'}
              </span>
            </div>
            <div className='mt-3'>
              <RangeControl
                icon={<Compass className='h-3.5 w-3.5' />}
                label='Wind bearing'
                formula={
                  controlled
                    ? {
                        title: 'Windward pressure',
                        expression: 'q(z) = 0.613 v(z)² Cp',
                        description:
                          'The wall nearest the bearing takes the load, and its upwind bays take the most of it.',
                      }
                    : undefined
                }
                value={value.wind_direction ?? DEFAULT_BEARING}
                min={0}
                max={355}
                step={5}
                suffix='°'
                onChange={(next) =>
                  onChange({ ...value, wind_direction: next })
                }
              />
              <p className='mt-2 text-[10px] text-muted-foreground'>
                Blowing from {cardinal(value.wind_direction ?? DEFAULT_BEARING)}
                . Leave it near the primary facade&apos;s bearing to load that
                wall.
              </p>
            </div>
          </div>
        </ControlGroup>

        {controlled && (
          <ControlGroup
            icon={<ShieldCheck className='h-4 w-4' />}
            number='04'
            title='Safety'
          >
            <label className='setting-toggle-row' data-tour='control-power'>
              <span>
                <span className='block text-xs font-semibold'>
                  Facade power
                </span>
                <span className='mt-0.5 block text-[10px] text-muted-foreground'>
                  {value.power_ok
                    ? 'Powered · controller active'
                    : 'Off · fail-shaded at 60°'}
                </span>
              </span>
              <input
                className='power-toggle-light'
                type='checkbox'
                checked={value.power_ok}
                onChange={(event) =>
                  onChange({ ...value, power_ok: event.target.checked })
                }
              />
            </label>
          </ControlGroup>
        )}
      </div>
    </aside>
  )
}

function ControlGroup({
  icon,
  number,
  title,
  children,
}: {
  icon: React.ReactNode
  number: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className='setting-group'>
      <div className='flex items-start gap-3'>
        <div className='setting-group-icon'>{icon}</div>
        <div className='min-w-0'>
          <p className='text-[9px] font-bold uppercase tracking-[0.16em] text-primary/70'>
            {number} · Category
          </p>
          <h3 className='mt-0.5 text-sm font-semibold'>{title}</h3>
        </div>
      </div>
      <div className='mt-4 space-y-5'>{children}</div>
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
  formula?: FormulaHintProps
  compact?: boolean
  onChange: (value: number) => void
}

export function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  icon,
  formula,
  compact,
  onChange,
}: RangeControlProps) {
  return (
    <div className='block'>
      <span className='field-label flex items-center justify-between gap-3'>
        <span className='flex items-center gap-1.5'>
          {icon}
          {label}
          {formula && <FormulaHint {...formula} />}
        </span>
        <span className='setting-value'>
          {value.toFixed(compact ? 2 : 1)}
          {suffix}
        </span>
      </span>
      <input
        aria-label={label}
        className='setting-range mt-3'
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

export interface FormulaHintProps {
  title: string
  expression: string
  description: string
}

function FormulaHint({ title, expression, description }: FormulaHintProps) {
  return (
    <span className='formula-hint group/formula'>
      <button
        aria-label={`Show formula for ${title}`}
        className='formula-hint-trigger'
        type='button'
      >
        ƒx
      </button>
      <span className='formula-tooltip' role='tooltip'>
        <span className='formula-tooltip-title'>{title}</span>
        <span className='formula-tooltip-expression'>{expression}</span>
        <span className='formula-tooltip-description'>{description}</span>
      </span>
    </span>
  )
}
