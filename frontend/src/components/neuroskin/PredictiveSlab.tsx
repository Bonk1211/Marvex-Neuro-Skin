'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowLeft,
  BatteryCharging,
  CheckCircle2,
  Download,
  Gauge,
  Leaf,
  LoaderCircle,
  Play,
  Ruler,
  ShieldQuestion,
  Snowflake,
  Sun,
} from 'lucide-react'
import { planSlab } from '@/lib/api-client'
import type {
  BaselineAudit,
  BaselineNight,
  CloudProfile,
  SlabHour,
  SlabPlanRequest,
  SlabPlanResponse,
  SlabZonePlan,
} from '@/lib/types'

const COLORS = {
  predictive: '#0f8a63',
  baseline: '#d97706',
  demand: '#2563eb',
  floor: '#e11d48',
  muted: '#64748b',
  grid: 'rgba(15,45,38,.09)',
}

export const DEFAULT_REQUEST: SlabPlanRequest = {
  date: null,
  seed: 42,
  environment_source: 'open_meteo',
  cloud_profile: 'scattered',
  latitude: 2.922,
  longitude: 101.6885,
  timezone: 'Asia/Kuala_Lumpur',
  location_name: 'ST Diamond Building, Putrajaya',
  facade_orientation: 'west',
  facade_tilt: 115,
  roof_pitch: 10,
  model: {
    thickness_m: 0.2,
    density: 2300,
    specific_heat: 880,
    surface_ua: 8,
    charge_power: 70,
    min_slab_temp: 19,
    zone_setpoint: 24,
    loss_ua: 1.5,
    day_capacity: 55,
    solar_to_floor: 0.1,
    floor_area_m2: 12000,
  },
  history: [],
  baseline_nights: [],
}

/**
 * The zone plans as the building stands: the top row first, column 0 on the
 * left, matching the 4 x 4 grid the 3D view and the facade controllers use.
 */
export function zoneGrid(zones: SlabZonePlan[]): SlabZonePlan[][] {
  if (zones.length === 0) return []
  const rows = Math.max(...zones.map((zone) => zone.row)) + 1
  return Array.from({ length: rows }, (_, offset) =>
    zones
      .filter((zone) => zone.row === rows - 1 - offset)
      .sort((left, right) => left.column - right.column)
  )
}

/** How the headline reads once the baseline audit has had its say. */
export function claimStatus(audit: BaselineAudit): {
  tone: 'ok' | 'warn' | 'bad'
  headline: string
} {
  if (audit.claim_allowed) {
    return {
      tone: 'ok',
      headline: `Fixed-timer baseline verified across ${audit.nights} nights`,
    }
  }
  return {
    tone: audit.verdict === 'load_compensated' ? 'bad' : 'warn',
    headline: 'Saving not claimable — baseline unverified',
  }
}

/**
 * Two demonstration logs of the incumbent night charging. One building runs a
 * clock; the other already leans on tomorrow. The audit has to tell them apart
 * before any number on this page may be quoted as a saving.
 */
export function sampleNights(kind: 'fixed' | 'compensated'): BaselineNight[] {
  return Array.from({ length: 14 }, (_, index) => {
    const cooling = 1500 + 130 * ((index * 7) % 11)
    return {
      date: `2026-07-${String(index + 1).padStart(2, '0')}`,
      charge_kwh:
        kind === 'fixed'
          ? 402 + ((index * 3) % 5) - 2
          : 180 + 0.16 * cooling + ((index * 5) % 7),
      next_day_cooling_kwh: cooling,
    }
  })
}

export function PredictiveSlab() {
  const [request, setRequest] = useState(DEFAULT_REQUEST)
  const [draft, setDraft] = useState(DEFAULT_REQUEST)
  const [data, setData] = useState<SlabPlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedZone, setSelectedZone] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  const execute = useCallback(async (next: SlabPlanRequest) => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setLoading(true)
    setError(null)
    try {
      const response = await planSlab(next, current.signal)
      setRequest(next)
      setData(response)
      setSelectedZone(response.zones[0]?.zone ?? null)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(
        cause instanceof Error ? cause.message : 'The plan could not be loaded.'
      )
    } finally {
      if (!current.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void execute(DEFAULT_REQUEST)
    return () => controller.current?.abort()
  }, [execute])

  const summary = data?.summary
  const activeZone = data?.zones.find((zone) => zone.zone === selectedZone)
  const grid = useMemo(() => (data ? zoneGrid(data.zones) : []), [data])
  const peakZoneCharge = data
    ? Math.max(1, ...data.zones.map((zone) => zone.charge_target_wh))
    : 1
  const chargeScale = Math.max(
    1,
    summary?.baseline_charge_wh_m2 ?? 1,
    summary?.predictive_charge_wh_m2 ?? 1
  )

  const download = () => {
    if (!data) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ request, plan: data }, null, 2)], {
        type: 'application/json',
      })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `slab-plan-${data.date}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className='landing-shell'>
      <header className='landing-nav'>
        <nav className='mx-auto flex max-w-[1240px] items-center justify-between px-5 py-5 lg:px-8'>
          <Link className='flex items-center gap-3' href='/'>
            <span className='brand-mark h-10 w-10 rounded-2xl'>
              <Leaf className='h-5 w-5' />
            </span>
            <span>
              <span className='block font-display text-lg font-semibold tracking-tight text-white'>
                NeuroSkin
              </span>
              <span className='block text-[9px] font-semibold uppercase tracking-[0.22em] text-white/40'>
                Application 7.1
              </span>
            </span>
          </Link>
          <div className='flex items-center gap-5'>
            <Link
              className='hidden text-xs font-medium text-white/55 transition hover:text-white md:block'
              href='/'
            >
              Overview
            </Link>
            <Link className='landing-nav-cta' href='/dashboard'>
              <ArrowLeft className='h-3.5 w-3.5' /> Digital twin
            </Link>
          </div>
        </nav>
      </header>

      <section className='landing-hero'>
        <div className='mx-auto grid max-w-[1240px] items-center gap-8 px-5 pb-10 pt-10 lg:grid-cols-[1fr_0.8fr] lg:px-8 lg:pb-12 lg:pt-12'>
          <div>
            <span className='landing-eyebrow'>
              <span className='status-pulse' /> Slab plant online
            </span>
            <h1 className='mt-5 font-display text-3xl font-semibold leading-[1.08] tracking-tight text-white sm:text-4xl'>
              Night-charge operator
            </h1>
            <p className='mt-3 max-w-xl text-sm leading-relaxed text-white/55'>
              Set tomorrow&apos;s conditions, generate the 16-zone schedule,
              inspect the commands, then export them for the plant controller.
            </p>
            <div className='mt-6 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/50'>
              <span className='rounded-lg bg-white/[0.07] px-3 py-2'>
                Site · ST Diamond
              </span>
              <span className='rounded-lg bg-white/[0.07] px-3 py-2'>
                16 zones
              </span>
              <span className='rounded-lg bg-white/[0.07] px-3 py-2'>
                {data ? `Plan · ${data.date}` : 'Plan · pending'}
              </span>
            </div>
          </div>

          <div className='landing-visual'>
            <div className='landing-visual-top'>
              <span className='text-[10px] font-bold uppercase tracking-[0.2em] text-white/40'>
                Active plan
              </span>
              <span className='rounded-full bg-white/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-mint'>
                {data ? `for ${data.date}` : 'planning'}
              </span>
            </div>
            <div className='my-5 grid gap-3'>
              <ChargeBar
                label='Predictive'
                value={summary?.predictive_charge_wh_m2 ?? 0}
                max={chargeScale}
                accent
              />
              <ChargeBar
                label='Fixed 22:00–06:00 timer'
                value={summary?.baseline_charge_wh_m2 ?? 0}
                max={chargeScale}
              />
            </div>
            <p className='text-[11px] leading-relaxed text-white/45'>
              {loading
                ? 'Computing zone commands…'
                : data
                  ? `${data.metadata.forecast_provider} · ${data.metadata.location}`
                  : 'No plan loaded.'}
            </p>
          </div>
        </div>
      </section>

      <div className='mx-auto max-w-[1240px] px-5 py-8 lg:px-8'>
        <PlanControls
          value={draft}
          loading={loading}
          onChange={setDraft}
          onRun={() => void execute(draft)}
          onSample={(kind) =>
            setDraft({
              ...draft,
              baseline_nights: kind ? sampleNights(kind) : [],
            })
          }
        />

        {error && (
          <div className='event-card mt-6'>
            <span className='event-icon'>
              <AlertTriangle className='h-4 w-4' />
            </span>
            <div>
              <p className='text-sm font-semibold'>Plan unavailable</p>
              <p className='mt-1 text-xs text-muted-foreground'>{error}</p>
            </div>
          </div>
        )}

        {data && summary && (
          <>
            <section className='mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]'>
              <Fact
                label='Tonight charge'
                value={`${summary.predictive_charge_wh_m2} Wh/m²`}
              />
              <Fact
                label='Plant energy'
                value={`${summary.predictive_kwh} kWh`}
              />
              <Fact
                label='Slab floor'
                value={`${summary.slab_floor_temp} °C`}
              />
              <Fact
                label='Unmet load'
                value={`${summary.predictive_unmet_hours} zone-h`}
              />
              <div className='flex gap-2 sm:col-span-2 xl:col-span-1'>
                <a
                  className='flex h-full min-h-14 flex-1 items-center justify-center rounded-xl border border-border bg-white px-4 text-xs font-semibold text-primary transition hover:border-primary/40'
                  href='#zone-commands'
                >
                  Inspect zones
                </a>
                <button
                  aria-label='Export controller schedule'
                  className='grid min-h-14 w-14 place-items-center rounded-xl bg-forest text-white transition hover:bg-forest/90'
                  onClick={download}
                  type='button'
                >
                  <Download className='h-4 w-4' />
                </button>
              </div>
            </section>

            <section className='mt-8 grid gap-5 lg:grid-cols-2'>
              <GateCard
                icon={Ruler}
                kicker='Constraint O1'
                title={
                  data.applicable
                    ? 'Thermal-mass building confirmed'
                    : 'No usable thermal mass'
                }
                tone={data.applicable ? 'ok' : 'bad'}
                body={data.applicability_note}
                facts={[
                  `${data.metadata.capacity_wh_per_m2k} Wh/m²K slab capacity`,
                  `${data.metadata.time_constant_h} h time constant`,
                  `${data.metadata.charge_power_w_m2} W/m² charge power`,
                ]}
              />
              <BaselineCard audit={data.baseline_audit} />
            </section>

            <section className='mt-10'>
              <p className='eyebrow'>The gap</p>
              <h2 className='mt-1 font-display text-2xl font-semibold tracking-tight'>
                Predictive charge versus the fixed timer
              </h2>
              <p className='mt-2 max-w-2xl text-sm text-muted-foreground'>
                {data.baseline_audit.claim_allowed
                  ? 'The incumbent schedule has been shown to be a clock, so this is the comparison that counts.'
                  : 'Modelled for this day only. Until the incumbent schedule is audited as genuinely fixed, every number below is a hypothesis, not a saving.'}
              </p>
              <div className='mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
                <MetricCard
                  icon={Snowflake}
                  label='Night charge'
                  ours={`${summary.predictive_charge_wh_m2} Wh/m²`}
                  base={`${summary.baseline_charge_wh_m2} Wh/m²`}
                  better={
                    summary.predictive_charge_wh_m2 <
                    summary.baseline_charge_wh_m2
                  }
                  claimable={data.baseline_audit.claim_allowed}
                  detail='Delivered into the slab, per m² of floor'
                />
                <MetricCard
                  icon={Gauge}
                  label='Plant electricity'
                  ours={`${summary.predictive_kwh} kWh`}
                  base={`${summary.baseline_kwh} kWh`}
                  better={summary.predictive_kwh < summary.baseline_kwh}
                  claimable={data.baseline_audit.claim_allowed}
                  detail={`${summary.saving_percent}% gap across ${summary.floor_area_m2.toLocaleString()} m²`}
                />
                <MetricCard
                  icon={Sun}
                  label='Comfort misses'
                  ours={`${summary.predictive_unmet_hours} zone-h`}
                  base={`${summary.baseline_unmet_hours} zone-h`}
                  better={
                    summary.predictive_unmet_hours <
                    summary.baseline_unmet_hours
                  }
                  claimable={data.baseline_audit.claim_allowed}
                  detail='Hours the air-side trim could not close the gap'
                />
                <MetricCard
                  icon={BatteryCharging}
                  label='Charge leaked away'
                  ours={`${summary.predictive_standby_loss_wh_m2} Wh/m²`}
                  base={`${summary.baseline_standby_loss_wh_m2} Wh/m²`}
                  better={
                    summary.predictive_standby_loss_wh_m2 <
                    summary.baseline_standby_loss_wh_m2
                  }
                  claimable={data.baseline_audit.claim_allowed}
                  detail='Cold the building never got to use'
                />
              </div>
            </section>

            <section className='mt-10 grid gap-6'>
              <ChartCard
                title='The slab through 24 hours'
                caption='Charged overnight, discharged into the next day. Below the floor line the soffit would sweat, so no controller may go there.'
              >
                <ResponsiveContainer width='100%' height='100%'>
                  <LineChart
                    data={data.hours}
                    margin={{ top: 6, right: 18, left: -14, bottom: 2 }}
                  >
                    <CartesianGrid stroke={COLORS.grid} vertical={false} />
                    <NightBand hours={data.hours} />
                    <XAxis
                      dataKey='label'
                      minTickGap={28}
                      tick={{ fill: COLORS.muted, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      domain={[18, 28]}
                      unit='°C'
                      tick={{ fill: COLORS.muted, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={legendStyle} />
                    <ReferenceLine
                      y={summary.slab_floor_temp}
                      stroke={COLORS.floor}
                      strokeDasharray='4 4'
                    />
                    <Line
                      isAnimationActive={false}
                      type='monotone'
                      dataKey='predictive_slab_temp'
                      name='Predictive slab'
                      stroke={COLORS.predictive}
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      isAnimationActive={false}
                      type='monotone'
                      dataKey='baseline_slab_temp'
                      name='Fixed timer slab'
                      stroke={COLORS.baseline}
                      strokeWidth={2}
                      strokeDasharray='5 5'
                      dot={false}
                    />
                    <Line
                      isAnimationActive={false}
                      type='monotone'
                      dataKey='dew_point'
                      name='Indoor dew point'
                      stroke={COLORS.floor}
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title='Where the plant runs'
                caption='Charge power at night, trim power by day, against the cooling load the forecast says is coming. The timer spends before it knows.'
              >
                <ResponsiveContainer width='100%' height='100%'>
                  <ComposedChart
                    data={data.hours}
                    margin={{ top: 6, right: 18, left: -14, bottom: 2 }}
                  >
                    <CartesianGrid stroke={COLORS.grid} vertical={false} />
                    <NightBand hours={data.hours} />
                    <XAxis
                      dataKey='label'
                      minTickGap={28}
                      tick={{ fill: COLORS.muted, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      unit=' W/m²'
                      tick={{ fill: COLORS.muted, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={legendStyle} />
                    <Area
                      isAnimationActive={false}
                      type='stepAfter'
                      dataKey='baseline_charge_w'
                      name='Timer charge'
                      stroke={COLORS.baseline}
                      fill={COLORS.baseline}
                      fillOpacity={0.12}
                      strokeDasharray='5 5'
                    />
                    <Area
                      isAnimationActive={false}
                      type='stepAfter'
                      dataKey='predictive_charge_w'
                      name='Predictive charge'
                      stroke={COLORS.predictive}
                      fill={COLORS.predictive}
                      fillOpacity={0.2}
                      strokeWidth={2}
                    />
                    <Line
                      isAnimationActive={false}
                      type='monotone'
                      dataKey='cooling_demand_w'
                      name='Forecast cooling load'
                      stroke={COLORS.demand}
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      isAnimationActive={false}
                      type='monotone'
                      dataKey='predictive_trim_w'
                      name='Air-side trim'
                      stroke={COLORS.muted}
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>

            <section
              className='mt-10 grid scroll-mt-6 gap-6 lg:grid-cols-[1.15fr_0.85fr]'
              id='zone-commands'
            >
              <article className='surface-card p-6'>
                <div className='flex items-center justify-between gap-4'>
                  <div>
                    <p className='eyebrow'>Zone command matrix</p>
                    <h3 className='mt-1 font-display text-lg font-semibold'>
                      Inspect tonight&apos;s targets
                    </h3>
                  </div>
                  <span className='synthetic-badge'>{summary.zones} zones</span>
                </div>
                <p className='mt-2 text-xs leading-relaxed text-muted-foreground'>
                  Select a zone to inspect the command that will be exported to
                  the plant controller.
                </p>
                <div className='mt-5 grid gap-1.5'>
                  {grid.map((row, index) => (
                    <div
                      className='grid grid-cols-4 gap-1.5'
                      key={`row-${row[0]?.row ?? index}`}
                    >
                      {row.map((zone) => (
                        <ZoneCell
                          key={zone.zone}
                          zone={zone}
                          peak={peakZoneCharge}
                          selected={zone.zone === activeZone?.zone}
                          onSelect={() => setSelectedZone(zone.zone)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                {activeZone && (
                  <div className='mt-5 rounded-2xl border border-primary/20 bg-emerald-50/50 p-4'>
                    <div className='flex items-center justify-between'>
                      <div>
                        <p className='eyebrow'>Selected · {activeZone.zone}</p>
                        <p className='mt-1 font-display text-xl font-semibold'>
                          {activeZone.charge_target_wh} Wh/m²
                        </p>
                      </div>
                      <span className='winner-badge'>Ready</span>
                    </div>
                    <dl className='mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4'>
                      <Fact
                        label='Charge hours'
                        value={
                          activeZone.charge_hours.length
                            ? activeZone.charge_hours
                                .map(
                                  (hour) =>
                                    `${String(hour).padStart(2, '0')}:00`
                                )
                                .join(', ')
                            : 'Off'
                        }
                      />
                      <Fact
                        label='Delivered'
                        value={`${activeZone.delivered_wh} Wh/m²`}
                      />
                      <Fact
                        label='Slab low'
                        value={`${activeZone.min_slab_temp} °C`}
                      />
                      <Fact
                        label='Plant energy'
                        value={`${activeZone.predictive_kwh} kWh`}
                      />
                    </dl>
                  </div>
                )}
                <button
                  className='mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-forest text-sm font-semibold text-white transition hover:bg-forest/90 disabled:cursor-not-allowed disabled:opacity-50'
                  disabled={loading}
                  onClick={download}
                  type='button'
                >
                  <Download className='h-4 w-4' /> Export controller schedule
                </button>
              </article>

              <div className='grid gap-6'>
                <article className='surface-card p-6'>
                  <p className='eyebrow'>Learned mass response</p>
                  <h3 className='mt-1 font-display text-lg font-semibold'>
                    The building&apos;s own slab, identified
                  </h3>
                  <dl className='mt-4 grid grid-cols-2 gap-3'>
                    <Fact
                      label='Capacity'
                      value={`${data.model_fit.capacity_wh_per_m2k} Wh/m²K`}
                    />
                    <Fact
                      label='Surface UA'
                      value={`${data.model_fit.surface_ua} W/m²K`}
                    />
                    <Fact
                      label='Time constant'
                      value={`${data.model_fit.time_constant_h} h`}
                    />
                    <Fact
                      label='Fit quality'
                      value={`r² ${data.model_fit.r_squared}`}
                    />
                  </dl>
                  <p className='mt-4 text-[11px] leading-relaxed text-muted-foreground'>
                    {data.model_fit.note}
                  </p>
                </article>

                <article className='surface-card p-6'>
                  <p className='eyebrow'>Forecast</p>
                  <h3 className='mt-1 font-display text-lg font-semibold'>
                    {data.metadata.forecast_provider}
                  </h3>
                  <div className='mt-3 flex flex-wrap gap-2'>
                    <span className='proof-chip'>
                      {data.metadata.forecast_status}
                    </span>
                    {data.metadata.forecast_dataset && (
                      <span className='proof-chip'>
                        {data.metadata.forecast_dataset}
                      </span>
                    )}
                    <span className='proof-chip'>{data.metadata.location}</span>
                  </div>
                  {data.metadata.forecast_fallback && (
                    <p className='mt-3 text-[11px] leading-relaxed text-amber-700'>
                      {data.metadata.forecast_fallback}
                    </p>
                  )}
                </article>
              </div>
            </section>

            <section className='surface-card mt-10 p-6'>
              <p className='eyebrow'>Cleanly verifiable</p>
              <h3 className='mt-1 font-display text-lg font-semibold'>
                How to measure the gap for real
              </h3>
              <ol className='mt-4 grid gap-3'>
                {data.measurement_protocol.map((step, index) => (
                  <li className='flex gap-3' key={step}>
                    <span className='grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-primary'>
                      {index + 1}
                    </span>
                    <p className='text-sm leading-relaxed text-muted-foreground'>
                      {step}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}

        {loading && !data && (
          <div className='mt-16 flex flex-col items-center justify-center text-center'>
            <LoaderCircle className='h-7 w-7 animate-spin text-primary' />
            <p className='mt-3 text-sm text-muted-foreground'>
              Forecasting tomorrow and sizing tonight&apos;s charge
            </p>
          </div>
        )}
      </div>
    </main>
  )
}

const tooltipStyle = {
  background: '#ffffff',
  border: '1px solid rgba(15,45,38,.12)',
  borderRadius: 12,
  fontSize: 12,
}
const legendStyle = { fontSize: 11, color: COLORS.muted }

/** Shades the charging night so the day it pays for reads apart from it. */
function NightBand({ hours }: { hours: SlabHour[] }) {
  const night = hours.filter((hour) => hour.baseline_charge_w > 0)
  if (night.length === 0) return null
  return (
    <ReferenceArea
      x1={hours[0].label}
      x2={night[night.length - 1].label}
      fill={COLORS.demand}
      fillOpacity={0.05}
    />
  )
}

function ChargeBar({
  label,
  value,
  max,
  accent = false,
}: {
  label: string
  value: number
  max: number
  accent?: boolean
}) {
  return (
    <div>
      <div className='flex items-baseline justify-between text-[11px]'>
        <span className={accent ? 'font-semibold text-mint' : 'text-white/50'}>
          {label}
        </span>
        <span className='font-mono text-white/70'>{value} Wh/m²</span>
      </div>
      <div className='mt-1.5 h-2 overflow-hidden rounded-full bg-white/10'>
        <div
          className={accent ? 'h-full bg-mint' : 'h-full bg-white/30'}
          style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
        />
      </div>
    </div>
  )
}

function GateCard({
  icon: Icon,
  kicker,
  title,
  body,
  tone,
  facts = [],
}: {
  icon: React.ElementType
  kicker: string
  title: string
  body: string
  tone: 'ok' | 'warn' | 'bad'
  facts?: string[]
}) {
  const skin =
    tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50/40'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50/50'
        : 'border-rose-200 bg-rose-50/40'
  return (
    <article className={`rounded-[1.25rem] border p-6 ${skin}`}>
      <div className='flex items-start gap-3'>
        <span className='landing-proof-icon'>
          <Icon className='h-4 w-4' />
        </span>
        <div className='min-w-0'>
          <p className='text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground'>
            {kicker}
          </p>
          <h3 className='mt-0.5 font-display text-base font-semibold'>
            {title}
          </h3>
        </div>
      </div>
      <p className='mt-3 text-xs leading-relaxed text-muted-foreground'>
        {body}
      </p>
      {facts.length > 0 && (
        <div className='mt-3 flex flex-wrap gap-1.5'>
          {facts.map((fact) => (
            <span className='proof-chip' key={fact}>
              {fact}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

function BaselineCard({ audit }: { audit: BaselineAudit }) {
  const status = claimStatus(audit)
  return (
    <GateCard
      icon={audit.claim_allowed ? CheckCircle2 : ShieldQuestion}
      kicker='Baseline audit'
      title={status.headline}
      tone={status.tone}
      body={audit.note}
      facts={[
        `${audit.nights} nights logged`,
        audit.charge_variation === null
          ? 'charge variation not measurable'
          : `charge varies ${(audit.charge_variation * 100).toFixed(1)}%`,
        audit.correlation === null
          ? 'no correlation yet'
          : `r = ${audit.correlation} against next-day cooling`,
      ]}
    />
  )
}

function MetricCard({
  icon: Icon,
  label,
  ours,
  base,
  better,
  claimable,
  detail,
}: {
  icon: React.ElementType
  label: string
  ours: string
  base: string
  better: boolean
  claimable: boolean
  detail?: string
}) {
  return (
    <article className='metric-card'>
      <div className='relative z-10 flex items-center justify-between'>
        <span className='metric-icon'>
          <Icon className='h-4 w-4' />
        </span>
        {better &&
          (claimable ? (
            <span className='winner-badge'>Better</span>
          ) : (
            <span className='rounded-full bg-secondary px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground'>
              Unverified
            </span>
          ))}
      </div>
      <p className='relative z-10 mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground'>
        {label}
      </p>
      <p className='relative z-10 mt-1 font-display text-xl font-semibold tracking-tight'>
        {ours}
      </p>
      <p className='relative z-10 mt-0.5 text-[11px] text-muted-foreground'>
        timer {base}
      </p>
      {detail && (
        <p className='relative z-10 mt-2 text-[10px] leading-snug text-muted-foreground'>
          {detail}
        </p>
      )}
    </article>
  )
}

function ZoneCell({
  zone,
  peak,
  selected,
  onSelect,
}: {
  zone: SlabZonePlan
  peak: number
  selected: boolean
  onSelect: () => void
}) {
  const share = zone.charge_target_wh / peak
  return (
    <button
      aria-label={`Inspect ${zone.zone}`}
      className={`rounded-xl border p-2 text-center transition hover:-translate-y-0.5 hover:shadow-sm ${selected ? 'border-primary ring-2 ring-primary/20' : 'border-border/60'}`}
      onClick={onSelect}
      style={{ background: `rgba(15,138,99,${0.06 + share * 0.34})` }}
      title={`${zone.zone}: charge ${zone.charge_target_wh} Wh/m² over ${zone.charge_hours.length} h, forecast gain ${zone.forecast_gain_wh} Wh/m², slab low ${zone.min_slab_temp} °C`}
      type='button'
    >
      <p className='font-mono text-[10px] font-semibold'>{zone.zone}</p>
      <p className='mt-0.5 font-display text-sm font-semibold'>
        {Math.round(zone.charge_target_wh)}
      </p>
      <p className='text-[9px] text-muted-foreground'>
        {zone.charge_hours.length} h
      </p>
    </button>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className='tick-stat'>
      <dt className='text-[9px] font-bold uppercase tracking-wider text-muted-foreground'>
        {label}
      </dt>
      <dd className='mt-0.5 font-mono text-sm font-semibold'>{value}</dd>
    </div>
  )
}

function ChartCard({
  title,
  caption,
  children,
}: {
  title: string
  caption: string
  children: React.ReactNode
}) {
  return (
    <figure className='surface-card overflow-hidden'>
      <figcaption className='border-b border-border/70 px-5 py-4'>
        <div className='flex items-center justify-between gap-4'>
          <h3 className='font-display text-base font-semibold'>{title}</h3>
          <span className='synthetic-badge'>Modelled</span>
        </div>
        <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
          {caption}
        </p>
      </figcaption>
      <div className='h-[320px] px-2 pb-3 pt-5'>{children}</div>
    </figure>
  )
}

export function PlanControls({
  value,
  loading,
  onChange,
  onRun,
  onSample,
}: {
  value: SlabPlanRequest
  loading: boolean
  onChange: (next: SlabPlanRequest) => void
  onRun: () => void
  onSample: (kind: 'fixed' | 'compensated' | null) => void
}) {
  const profiles: CloudProfile[] = ['clear', 'scattered', 'overcast']
  const logged = value.baseline_nights.length
  return (
    <section className='surface-card flex flex-wrap items-end gap-5 p-5'>
      <label className='grid gap-1'>
        <span className='field-label'>Day to charge for</span>
        <input
          className='setting-input'
          type='date'
          value={value.date ?? ''}
          onChange={(event) =>
            onChange({ ...value, date: event.target.value || null })
          }
        />
      </label>

      <div className='grid gap-1'>
        <span className='field-label'>Sky</span>
        <div className='setting-segments'>
          {profiles.map((profile) => (
            <button
              className={
                value.cloud_profile === profile
                  ? 'setting-segment-active'
                  : 'setting-segment'
              }
              key={profile}
              onClick={() => onChange({ ...value, cloud_profile: profile })}
              type='button'
            >
              {profile}
            </button>
          ))}
        </div>
      </div>

      <label className='grid gap-1'>
        <span className='field-label'>Slab thickness</span>
        <div className='flex items-center gap-2'>
          <input
            className='setting-range w-32'
            type='range'
            min={0.05}
            max={0.4}
            step={0.01}
            value={value.model.thickness_m}
            onChange={(event) =>
              onChange({
                ...value,
                model: {
                  ...value.model,
                  thickness_m: Number(event.target.value),
                },
              })
            }
          />
          <span className='setting-value'>
            {(value.model.thickness_m * 1000).toFixed(0)} mm
          </span>
        </div>
      </label>

      <div className='grid gap-1'>
        <span className='field-label'>Incumbent schedule log</span>
        <div className='setting-segments'>
          <button
            className={
              logged === 0 ? 'setting-segment-active' : 'setting-segment'
            }
            onClick={() => onSample(null)}
            type='button'
          >
            none
          </button>
          <button
            className='setting-segment'
            onClick={() => onSample('fixed')}
            type='button'
          >
            fixed timer
          </button>
          <button
            className='setting-segment'
            onClick={() => onSample('compensated')}
            type='button'
          >
            compensated
          </button>
        </div>
      </div>

      <button
        className='ml-auto flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70'
        disabled={loading}
        onClick={onRun}
        type='button'
      >
        {loading ? (
          <LoaderCircle className='h-4 w-4 animate-spin' />
        ) : (
          <Play className='h-4 w-4 fill-current' />
        )}
        {loading ? 'Generating plan' : 'Generate plan'}
      </button>
    </section>
  )
}
