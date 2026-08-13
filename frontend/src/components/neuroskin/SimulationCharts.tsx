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
}: SimulationChartsProps) {
  const chartData = ticks.map((tick) => ({
    ...tick,
    time: timeLabel(tick.timestamp),
  }))
  const referenceTimes = annotations.map((event) => ({
    ...event,
    time: timeLabel(event.timestamp),
  }))

  if (scenario === 'lie_detector') {
    return (
      <div className='grid gap-4'>
        <ChartCard
          title='Sensor cross-check'
          caption='Expected vs measured · W/m²'
        >
          <BaseChart data={chartData} annotations={referenceTimes}>
            <Line
              type='monotone'
              dataKey='expected_ghi'
              name='Almanac expected'
              stroke={COLORS.cyan}
              dot={false}
              strokeWidth={2}
            />
            <Line
              type='monotone'
              dataKey='measured_irradiance'
              name='Sensor measured'
              stroke={COLORS.amber}
              dot={false}
              strokeWidth={2}
            />
          </BaseChart>
        </ChartCard>
        <ChartCard
          title='Facade response'
          caption='NeuroSkin vs baseline · degrees'
        >
          <BaseChart
            data={chartData}
            annotations={referenceTimes}
            domain={[0, 60]}
            unit='°'
          >
            <Line
              type='stepAfter'
              dataKey='angle_final'
              name='NeuroSkin'
              stroke={COLORS.mint}
              dot={false}
              strokeWidth={2.5}
            />
            <Line
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
        <ChartCard title='Safety response' caption='Target vs final · degrees'>
          <BaseChart
            data={chartData}
            annotations={referenceTimes}
            domain={[0, 60]}
            unit='°'
          >
            <Line
              type='stepAfter'
              dataKey='angle_target'
              name='Brain target'
              stroke={COLORS.cyan}
              dot={false}
              strokeDasharray='4 4'
            />
            <Line
              type='stepAfter'
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
              type='monotone'
              dataKey='load_relative'
              name='Total relative load'
              stroke={COLORS.amber}
              dot={false}
              strokeWidth={2}
            />
            <Line
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
        caption='NeuroSkin vs baseline · relative index'
      >
        <BaseChart data={chartData} domain={[0, 1.2]}>
          <Line
            type='monotone'
            dataKey='load_relative'
            name='NeuroSkin'
            stroke={COLORS.mint}
            dot={false}
            strokeWidth={2.5}
          />
          <Line
            type='monotone'
            dataKey='naive_load_relative'
            name='Naive'
            stroke={COLORS.amber}
            dot={false}
            strokeDasharray='5 5'
          />
          <Line
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
            : 'NeuroSkin vs baseline · degrees'
        }
      >
        {scenario === 'co_optimization' ? (
          <BaseChart data={chartData} domain={[0, 1100]} unit=' lux'>
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
              type='monotone'
              dataKey='lux'
              name='NeuroSkin lux'
              stroke={COLORS.cyan}
              dot={false}
              strokeWidth={2.5}
            />
            <Line
              type='monotone'
              dataKey='naive_lux'
              name='Naive lux'
              stroke={COLORS.amber}
              dot={false}
              strokeDasharray='5 5'
            />
          </BaseChart>
        ) : (
          <BaseChart data={chartData} domain={[0, 60]} unit='°'>
            <Line
              type='stepAfter'
              dataKey='angle_final'
              name='NeuroSkin'
              stroke={COLORS.mint}
              dot={false}
              strokeWidth={2.5}
            />
            <Line
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
          contentStyle={{
            background: '#10231f',
            border: '1px solid rgba(255,255,255,.12)',
            borderRadius: 12,
            color: '#fff',
          }}
          labelStyle={{ color: '#b8c8c3', marginBottom: 6 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: COLORS.muted }} />
        {annotations.map((annotation) => (
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
        ))}
        {children}
      </LineChart>
    </ResponsiveContainer>
  )
}
