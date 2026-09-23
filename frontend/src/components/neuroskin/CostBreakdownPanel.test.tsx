import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RecoveryEpisode, TickPayload, ZoneHeat } from '@/lib/types'
import { CostBreakdownPanel } from './CostBreakdownPanel'
import { BrainFlow } from './BrainFlow'

const tick: TickPayload = {
  timestamp: '2026-03-21T12:00:00+08:00',
  ghi: 800,
  expected_ghi: 810,
  solar_azimuth: 264,
  solar_elevation: 68,
  measured_irradiance: 800,
  cloud: 0.1,
  outdoor_temp: 31,
  occupancy: 0.8,
  wind: 3,
  rain: false,
  load_relative: 0.42,
  naive_load_relative: 0.5,
  latent_load: 0.23,
  lux: 520,
  naive_lux: 280,
  angle_target: 35,
  angle_final: 35,
  naive_angle: 60,
  mode: 'NORMAL',
  moved: true,
  sensor_trusted: true,
  reason: 'Sensor reading is consistent. The movement clears the budget.',
  cost_breakdown: { thermal: 0.2, lux: 0, movement: 0.08, risk: 0.01 },
  facade: [
    {
      orientation: 'north',
      azimuth: 0,
      incident: 120,
      transmitted: 120,
      sky_diffuse: 90,
      ground_diffuse: 30,
      sol_air_temp: 35.2,
      angle: 0,
      mode: 'HOLD',
      moved: false,
      lux: 204,
      load_relative: 0.4,
      reason: 'The current angle remains the lowest-cost allowable position.',
      primary: false,
    },
    {
      orientation: 'east',
      azimuth: 90,
      incident: 180,
      transmitted: 180,
      sky_diffuse: 110,
      ground_diffuse: 30,
      sol_air_temp: 37.4,
      angle: 0,
      mode: 'HOLD',
      moved: false,
      lux: 306,
      load_relative: 0.44,
      reason: 'The current angle remains the lowest-cost allowable position.',
      primary: false,
    },
    {
      orientation: 'south',
      azimuth: 180,
      incident: 210,
      transmitted: 210,
      sky_diffuse: 120,
      ground_diffuse: 30,
      sol_air_temp: 38.1,
      angle: 0,
      mode: 'HOLD',
      moved: false,
      lux: 357,
      load_relative: 0.46,
      reason: 'The current angle remains the lowest-cost allowable position.',
      primary: false,
    },
    {
      orientation: 'west',
      azimuth: 270,
      incident: 640,
      transmitted: 356,
      sky_diffuse: 140,
      ground_diffuse: 30,
      sol_air_temp: 42.6,
      angle: 55,
      mode: 'NORMAL',
      moved: true,
      lux: 470,
      load_relative: 0.35,
      reason: 'The expected benefit clears the movement budget.',
      primary: true,
    },
  ],
  roof: [
    {
      quadrant: 'north',
      azimuth: 0,
      tilt: 10,
      incident: 863,
      sky_diffuse: 150,
      ground_diffuse: 8,
      sol_air_temp: 61.4,
    },
    {
      quadrant: 'east',
      azimuth: 90,
      tilt: 10,
      incident: 909,
      sky_diffuse: 152,
      ground_diffuse: 8,
      sol_air_temp: 63.1,
    },
    {
      quadrant: 'south',
      azimuth: 180,
      tilt: 10,
      incident: 874,
      sky_diffuse: 150,
      ground_diffuse: 8,
      sol_air_temp: 61.8,
    },
    {
      quadrant: 'west',
      azimuth: 270,
      tilt: 10,
      incident: 828,
      sky_diffuse: 148,
      ground_diffuse: 8,
      sol_air_temp: 60.1,
    },
  ],
}

describe('controller objective', () => {
  it('keeps local evidence separate from the primary result and unavailable legacy fields', () => {
    const zone: ZoneHeat = {
      ...tick.facade[3],
      zone: 'W2',
      row: 0,
      column: 1,
      sunlit_fraction: 1,
      angle: 18,
      angle_target: 30,
      sensor_trusted: false,
      sensors: {
        sensor_id: 'W2',
        irradiance: 1700,
        illuminance: 1200,
        source: 'override',
      },
      control_input: {
        irradiance: 600,
        open_lux: 1000,
        irradiance_source: 'model',
        daylight_source: 'model',
      },
      cost_breakdown: { thermal: 0.7, lux: 0.1, movement: 0, risk: 0 },
      reason: 'Local out-of-range input rejected.',
    }
    const input = {
      ...tick,
      cloud: 0.6,
      environment_cloud: 0.1,
      cloud_source: 'vision' as const,
    }
    const weights = { thermal: 0.45, lux: 0.45, movement: 0.05, risk: 0.05 }
    const onSelectZone = vi.fn()
    const { rerender } = render(
      <>
        <BrainFlow
          tick={input}
          selectedZone={zone}
          onSelectZone={onSelectZone}
        />
        <CostBreakdownPanel tick={input} weights={weights} zone={zone} />
      </>
    )
    const trust = screen.getByRole('region', { name: 'Sensor trust decision' })
    expect(within(trust).getByText('Rejected')).toBeInTheDocument()
    expect(within(trust).getByText('1700 W/m²')).toBeInTheDocument()
    expect(within(trust).getByText('600 W/m²')).toBeInTheDocument()
    expect(within(trust).getByText(/60% cloud/)).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Objective contributions, total 0.800' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: /Requested 30.0 degrees, achieved 18.0 degrees/,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Target 30.0° → final 18.0° · Δ -12.0°')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Planned fault recovery' })
    ).toHaveTextContent('design only')
    const legacy = {
      ...zone,
      control_input: undefined,
      cost_breakdown: undefined,
      angle_target: undefined,
    }
    rerender(
      <>
        <BrainFlow
          tick={input}
          selectedZone={legacy}
          onSelectZone={onSelectZone}
        />
        <CostBreakdownPanel tick={input} weights={weights} zone={legacy} />
      </>
    )
    expect(
      screen.getByText('Local objective unavailable in this run.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: /Requested unavailable degrees/ })
    ).toBeInTheDocument()
    expect(within(trust).getByText('— W/m²')).toBeInTheDocument()
    rerender(<BrainFlow tick={input} onSelectZone={onSelectZone} />)
    expect(
      screen.getByText(
        /Across west zone probes, each at its own achieved angle/
      )
    ).toBeInTheDocument()
    expect(within(trust).getByText('Accepted')).toBeInTheDocument()
    expect(within(trust).getByText('Solar/cloud reference')).toBeInTheDocument()
  })
  it('shows the selected tick contributions, normalized weights and target-to-final delta', () => {
    const weights = { thermal: 0.9, lux: 0.9, movement: 0.1, risk: 0.1 }
    const { rerender } = render(
      <CostBreakdownPanel
        tick={{
          ...tick,
          cost_breakdown: { thermal: 0.3, lux: 0.1, movement: 0, risk: 0 },
        }}
        weights={weights}
      />
    )
    const panel = screen.getByRole('region', { name: 'Cost breakdown' })
    for (const label of [
      'Thermal load',
      'Daylight comfort',
      'Movement',
      'Wind risk',
    ])
      expect(within(panel).getByText(label)).toBeInTheDocument()
    expect(within(panel).getAllByText('· weight 45%')).toHaveLength(2)
    expect(within(panel).getAllByText('· weight 5%')).toHaveLength(2)
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Objective contributions, total 0.400'
    )
    expect(
      parseFloat(
        (screen.getByRole('img').firstElementChild as HTMLElement).style.width
      )
    ).toBeCloseTo(75)
    rerender(
      <CostBreakdownPanel
        tick={{ ...tick, angle_target: 30, angle_final: 18 }}
        weights={weights}
      />
    )
    expect(
      screen.getByText('Target 30.0° → final 18.0° · Δ -12.0°')
    ).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Objective contributions, total 0.290'
    )
  })
  it('renders an empty objective safely and uses default priorities when all weights are zero', () => {
    const zeros = { thermal: 0, lux: 0, movement: 0, risk: 0 }
    const { container } = render(
      <CostBreakdownPanel
        tick={{ ...tick, cost_breakdown: zeros }}
        weights={zeros}
      />
    )
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
    for (const bar of screen.getByRole('img').children)
      expect((bar as HTMLElement).style.width).toBe('0%')
    expect(screen.getAllByText('· weight 45%')).toHaveLength(2)
  })
})

describe('fault recovery card', () => {
  const zone: ZoneHeat = {
    ...tick.facade[3],
    zone: 'W6',
    row: 1,
    column: 1,
    sunlit_fraction: 1,
    angle: 18,
    angle_target: 18,
    sensor_trusted: true,
    sensors: {
      sensor_id: 'W6',
      irradiance: 240,
      illuminance: 800,
      source: 'simulated',
    },
    assurance: {
      verdict: 'fault',
      hypothesis: 'drift_or_fouling',
      score: 0.58,
      peer_deviation: -0.4,
      lux_deviation: 0.01,
      reason:
        'W6 reads 0.60x its model while the wall median is 1.00x for 3 tick(s).',
      episode_id: 'W6:80:drift_or_fouling',
    },
  }
  const waiting: RecoveryEpisode = {
    episode_id: 'W6:80:drift_or_fouling',
    zone: 'W6',
    hypothesis: 'drift_or_fouling',
    score: 0.58,
    status: 'awaiting_approval',
    opened_tick: 80,
    mitigated_tick: null,
    closed_tick: null,
    snapshot_angle: null,
    valid_ticks: 0,
    e_corrected: 0,
    e_uncorrected: 0,
    maintenance_flag: false,
    events: [
      { tick_index: 80, stage: 'detect', detail: 'W6 reads 0.60x.' },
      {
        tick_index: 80,
        stage: 'authorise',
        detail: 'Needs operator approval before anything changes.',
      },
    ],
  }

  it('shows peer evidence and offers approval only while an episode waits outside safety', () => {
    const onApprove = vi.fn()
    const props = {
      tick,
      selectedZone: zone,
      onSelectZone: vi.fn(),
      episodes: [waiting],
      onApproveEpisode: onApprove,
    }
    const { rerender } = render(<BrainFlow {...props} tickIndex={82} />)
    const trust = screen.getByRole('region', { name: 'Sensor trust decision' })
    const evidence = within(trust).getByLabelText('Local sensor assurance')
    expect(evidence).toHaveTextContent('Sensor fault · drift or fouling')
    expect(evidence).toHaveTextContent(
      'Score 0.58 · automatic isolation needs ≥ 0.80'
    )
    expect(evidence).toHaveTextContent('Against wall peers -40%')
    const recovery = screen.getByRole('region', { name: 'Fault recovery' })
    expect(recovery).toHaveTextContent('Awaiting approval')
    expect(recovery).toHaveTextContent('Authorise · waiting')
    fireEvent.click(
      within(recovery).getByRole('button', { name: 'Approve and replay' })
    )
    expect(onApprove).toHaveBeenCalledWith('W6:80:drift_or_fouling')

    rerender(<BrainFlow {...props} tickIndex={79} />)
    expect(
      screen.getByText('No episode for this zone at this tick.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve and replay' })).toBe(
      null
    )
    rerender(
      <BrainFlow
        {...props}
        selectedZone={{ ...zone, mode: 'SAFE' }}
        tickIndex={82}
      />
    )
    expect(screen.queryByRole('button', { name: 'Approve and replay' })).toBe(
      null
    )
  })

  it('lights verification outcomes as they happen and never offers approval afterwards', () => {
    const escalated: RecoveryEpisode = {
      ...waiting,
      episode_id: 'W6:80:dead',
      hypothesis: 'dead',
      status: 'escalated',
      mitigated_tick: 80,
      snapshot_angle: 0,
      valid_ticks: 6,
      e_corrected: 2.3704,
      e_uncorrected: 6.0316,
      maintenance_flag: true,
      events: [
        ...waiting.events,
        { tick_index: 80, stage: 'snapshot', detail: 'Recorded.' },
        { tick_index: 80, stage: 'mitigate', detail: 'Isolated.' },
        { tick_index: 99, stage: 'verify', detail: '6 informative ticks.' },
        { tick_index: 99, stage: 'retain', detail: 'Corrected beats.' },
        {
          tick_index: 116,
          stage: 'escalate',
          detail: 'The fault has outlasted the episode limit.',
        },
      ],
    }
    const props = {
      tick,
      selectedZone: zone,
      onSelectZone: vi.fn(),
      episodes: [escalated],
      onApproveEpisode: vi.fn(),
    }
    const { rerender } = render(<BrainFlow {...props} tickIndex={100} />)
    const recovery = screen.getByRole('region', { name: 'Fault recovery' })
    expect(recovery).toHaveTextContent(
      'Corrected 2.370 · uncorrected 6.032 · relative objective over 6 informative ticks'
    )
    expect(recovery).toHaveTextContent('Retain · reached')
    expect(recovery).not.toHaveTextContent('Escalate · reached')
    expect(recovery).not.toHaveTextContent('Maintenance requested')
    rerender(<BrainFlow {...props} tickIndex={120} />)
    expect(recovery).toHaveTextContent('Escalate · reached')
    expect(recovery).toHaveTextContent(
      'Maintenance requested · substitution is not a repair'
    )
    expect(recovery).toHaveTextContent('Escalated · maintenance')
    expect(screen.queryByRole('button', { name: 'Approve and replay' })).toBe(
      null
    )
  })

  it('keeps the workflow as design only until local checks run', () => {
    const onEnable = vi.fn()
    render(
      <BrainFlow
        tick={tick}
        selectedZone={{ ...zone, assurance: undefined }}
        onSelectZone={vi.fn()}
        onEnableAssurance={onEnable}
      />
    )
    expect(
      screen.getByRole('region', { name: 'Planned fault recovery' })
    ).toHaveTextContent('design only')
    fireEvent.click(
      screen.getByRole('button', { name: 'Run local sensor checks' })
    )
    expect(onEnable).toHaveBeenCalledOnce()
  })
})
