'use client'

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { EventAnnotation, ScenarioName, TickPayload } from '@/lib/types'

interface SimulationChartsProps {
  scenario: ScenarioName
  ticks: TickPayload[]
  annotations: EventAnnotation[]
  /** Tick the timeline sits on. Drawn as a playhead across every chart. */
  cursor?: number
  /** While the clock runs, the curves are drawn only as far as the playhead. */
  revealing?: boolean
}

/** The playhead travels with the clock, so it is not one of the run's events. */
const PLAYHEAD = 'playhead'

/**
 * The day's rows, with everything past the playhead blanked while the clock is
 * running. The slots stay, so the axis holds still and the curves draw
 * themselves left to right instead of the whole chart rescaling every tick.
 * Recharts skips null points, which is what leaves the right-hand side empty.
 */
export function revealUpTo(
  ticks: TickPayload[],
  cursor: number | undefined,
  revealing: boolean
) {
  return ticks.map((tick, index) => {
    const row = { ...tick, time: timeLabel(tick.timestamp) }
    if (!revealing || cursor === undefined || index <= cursor) return row
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) =>
        typeof value === 'number' ? [key, null] : [key, value]
      )
      // Only the numbers change; the cast keeps the row's declared shape.
    ) as unknown as typeof row
  })
}

const COLORS = {
  mint: '#5ee0b5',
  cyan: '#65b9e8',
  amber: '#f3b85a',
  rose: '#fb7185',
  muted: '#8b9b96',
  grid: 'rgba(255,255,255,0.08)',
}

const timeLabel = (timestamp: string) =>
  new Intl.DateTimeFormat('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(timestamp))

export function SimulationCharts({
  scenario,
  ticks,
  annotations,
  cursor,
  revealing = false,
}: SimulationChartsProps) {
  const chartData = revealUpTo(ticks, cursor, revealing)
  const referenceTimes = annotations.map((event) => ({
    ...event,
    time: timeLabel(event.timestamp),
  }))
  const head = cursor === undefined ? undefined : ticks[cursor]
  if (head) {
    referenceTimes.push({
      kind: PLAYHEAD,
      timestamp: head.timestamp,
      title: 'Now',
      detail: '',
      time: timeLabel(head.timestamp),
    })
  }

  if (scenario === 'lie_detector') {
    return (
      <div className='grid gap-4'>
        <ChartCard
          title='Sensor cross-check'
          caption='Solar/cloud reference vs simulated sensor · W/m²'
        >
          <BaseChart data={chartData} annotations={referenceTimes}>
            <Line
              isAnimationActive={false}
              type='monotone'
              dataKey='expected_ghi'
              name='Almanac expected'
              stroke={COLORS.cyan}
              dot={false}
              strokeWidth={2}
            />
            <Line
              isAnimationActive={false}
              type='monotone'
              dataKey='measured_irradiance'
              name='Simulated sensor'
              stroke={COLORS.amber}
              dot={false}
              strokeWidth={2}
            />
          </BaseChart>
        </ChartCard>
        <ChartCard
          title='Facade response'
          caption='Simulated position interpolated between samples · degrees'
        >
          <BaseChart
            data={chartData}
            annotations={referenceTimes}
            domain={[0, 60]}
            unit='°'
          >
            <Line
              isAnimationActive={false}
              type='linear'
              dataKey='angle_final'
              name='NeuroSkin'
              stroke={COLORS.mint}
              dot={false}
              strokeWidth={2.5}
            />
            <Line
              isAnimationActive={false}
              type='stepAfter'
              dataKey='naive_angle'
              name='Naive'
              stroke={COLORS.rose}
              dot={false}
              strokeDasharray='5 5'
              strokeWidth={2}
            />
          </BaseChart>
        </ChartCard>
      </div>
    )
  }

  if (scenario === 'budget_failsafe') {
    return (
      <div className='grid gap-4'>
        <ChartCard
          title='Safety response'
          caption='Target vs final · final position interpolated'
        >
          <BaseChart
            data={chartData}
            annotations={referenceTimes}
            domain={[0, 60]}
            unit='°'
          >
            <Line
              isAnimationActive={false}
              type='stepAfter'
              dataKey='angle_target'
              name='Brain target'
              stroke={COLORS.cyan}
              dot={false}
              strokeDasharray='4 4'
            />
            <Line
              isAnimationActive={false}
              type='linear'
              dataKey='angle_final'
              name='Final angle'
              stroke={COLORS.mint}
              dot={false}
              strokeWidth={2.5}
            />
          </BaseChart>
        </ChartCard>
        <ChartCard title='Load floor' caption='Total vs latent load'>
          <BaseChart
            data={chartData}
            annotations={referenceTimes}
            domain={[0, 1.2]}
          >
            <Line
              isAnimationActive={false}
              type='monotone'
              dataKey='load_relative'
              name='Total relative load'
              stroke={COLORS.amber}
              dot={false}
              strokeWidth={2}
            />
            <Line
              isAnimationActive={false}
              type='monotone'
              dataKey='latent_load'
              name='Unshadeable latent floor'
              stroke={COLORS.rose}
              dot={false}
              strokeWidth={2}
            />
          </BaseChart>
        </ChartCard>
      </div>
    )
  }

  return (
    <div className='grid gap-4'>
      <ChartCard
        title={
          scenario === 'co_optimization'
            ? 'Cooling-load comparison'
            : 'Relative cooling load'
        }
        caption='NeuroSkin vs binary controller · relative index'
      >
        <BaseChart
          data={chartData}
          annotations={referenceTimes}
          domain={[0, 1.2]}
        >
          <Line
            isAnimationActive={false}
            type='monotone'
            dataKey='load_relative'
            name='NeuroSkin'
            stroke={COLORS.mint}
            dot={false}
            strokeWidth={2.5}
          />
          <Line
            isAnimationActive={false}
            type='monotone'
            dataKey='naive_load_relative'
            name='Naive'
            stroke={COLORS.amber}
            dot={false}
            strokeDasharray='5 5'
          />
          <Line
            isAnimationActive={false}
            type='monotone'
            dataKey='latent_load'
            name='Latent floor'
            stroke={COLORS.rose}
            dot={false}
          />
        </BaseChart>
      </ChartCard>
      <ChartCard
        title={
          scenario === 'co_optimization'
            ? 'Daylight compliance'
            : 'Facade position'
        }
        caption={
          scenario === 'co_optimization'
            ? 'Target band · 300–700 lux'
            : 'Simulated position interpolated between 10-minute samples · degrees'
        }
      >
        {scenario === 'co_optimization' ? (
          <BaseChart
            data={chartData}
            annotations={referenceTimes}
            domain={[0, 1100]}
            unit=' lux'
          >
            <ReferenceLine
              y={300}
              stroke={COLORS.muted}
              strokeDasharray='3 3'
            />
            <ReferenceLine
              y={700}
              stroke={COLORS.muted}
              strokeDasharray='3 3'
            />
            <Line
              isAnimationActive={false}
              type='monotone'
              dataKey='lux'
              name='NeuroSkin lux'
              stroke={COLORS.cyan}
              dot={false}
              strokeWidth={2.5}
            />
            <Line
              isAnimationActive={false}
              type='monotone'
              dataKey='naive_lux'
              name='Naive lux'
              stroke={COLORS.amber}
              dot={false}
              strokeDasharray='5 5'
            />
          </BaseChart>
        ) : (
          <BaseChart
            data={chartData}
            annotations={referenceTimes}
            domain={[0, 60]}
            unit='°'
          >
            <Line
              isAnimationActive={false}
              type='linear'
              dataKey='angle_final'
              name='NeuroSkin'
              stroke={COLORS.mint}
              dot={false}
              strokeWidth={2.5}
            />
            <Line
              isAnimationActive={false}
              type='stepAfter'
              dataKey='naive_angle'
              name='Naive'
              stroke={COLORS.amber}
              dot={false}
              strokeDasharray='5 5'
            />
          </BaseChart>
        )}
      </ChartCard>
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
          <span className='synthetic-badge'>Synthetic</span>
        </div>
        <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
          {caption}
        </p>
      </figcaption>
      <div className='h-[320px] px-2 pb-3 pt-5'>{children}</div>
    </figure>
  )
}

function BaseChart({
  data,
  annotations = [],
  domain,
  unit,
  children,
}: {
  data: Array<TickPayload & { time: string }>
  annotations?: Array<EventAnnotation & { time: string }>
  domain?: [number, number]
  unit?: string
  children: React.ReactNode
}) {
  return (
    <ResponsiveContainer width='100%' height='100%'>
      <LineChart
        data={data}
        margin={{ top: 6, right: 18, left: -12, bottom: 2 }}
      >
        <CartesianGrid stroke={COLORS.grid} vertical={false} />
        <XAxis
          dataKey='time'
          minTickGap={42}
          tick={{ fill: COLORS.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={domain}
          unit={unit}
          tick={{ fill: COLORS.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={
            unit === '°'
              ? (value) =>
                  typeof value === 'number' ? `${value.toFixed(1)}°` : value
              : undefined
          }
          contentStyle={{
            background: '#10231f',
            border: '1px solid rgba(255,255,255,.12)',
            borderRadius: 12,
            color: '#fff',
          }}
          labelStyle={{ color: '#b8c8c3', marginBottom: 6 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: COLORS.muted }} />
        {annotations.map((annotation) =>
          annotation.kind === PLAYHEAD ? (
            <ReferenceLine
              key={PLAYHEAD}
              x={annotation.time}
              stroke={COLORS.mint}
              strokeWidth={1.5}
              ifOverflow='extendDomain'
            />
          ) : (
            <ReferenceLine
              key={`${annotation.kind}-${annotation.timestamp}`}
              x={annotation.time}
              stroke={
                annotation.kind === 'power_loss' || annotation.kind === 'fault'
                  ? COLORS.rose
                  : COLORS.amber
              }
              strokeDasharray='3 3'
            />
          )
        )}
        {children}
      </LineChart>
    </ResponsiveContainer>
  )
}
