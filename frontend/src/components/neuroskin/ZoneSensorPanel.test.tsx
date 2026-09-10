import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FacadeHeat } from '@/lib/types'
import { ZoneSensorPanel } from './ZoneSensorPanel'

const wall: FacadeHeat = {
  orientation: 'west',
  azimuth: 270,
  incident: 400,
  transmitted: 300,
  sky_diffuse: 100,
  ground_diffuse: 20,
  sol_air_temp: 36,
  angle: 20,
  mode: 'HOLD',
  moved: false,
  lux: 500,
  load_relative: 0.4,
  reason: 'Wall summary',
  primary: true,
  zones: Array.from({ length: 16 }, (_, index) => ({
    row: Math.floor(index / 4),
    column: index % 4,
    zone: `W${index + 1}`,
    incident: 400,
    transmitted: 300,
    sunlit_fraction: 1,
    sol_air_temp: 36,
    angle: index * 3,
    angle_target: index * 3,
    mode: 'HOLD',
    moved: false,
    lux: 500,
    load_relative: 0.4,
    reason: 'This zone holds its own target.',
    sensor_trusted: true,
    sensors: {
      sensor_id: `sensor-W${index + 1}`,
      irradiance: 400,
      illuminance: 500,
      source: 'simulated',
    },
  })),
}

describe('zone sensor panel', () => {
  it('shows incident surface irradiance without controlled readings or editing in the baseline view', () => {
    const onSelectZone = vi.fn()
    const onOverride = vi.fn()
    const onClearOverride = vi.fn()
    const props = {
      wall: {
        ...wall,
        zones: wall.zones!.map((zone) => ({
          ...zone,
          incident: 343.2,
          transmitted: 111.1,
          sunlit_fraction: 0.625,
          conditions: {
            daylight_status: 'useful' as const,
            transmitted: 111.1,
            solar_heat_gain: 44.4,
            direct_sun: 12.3,
            glare_risk: false,
            glare_limit_w_m2: 25,
            glazing_shgc: 0.4,
          },
        })),
      },
      selectedZone: 'W7',
      onSelectZone,
      onOverride,
      onClearOverride,
      overriddenZoneIds: ['W7'],
      loading: false,
    }
    const { rerender } = render(
      <ZoneSensorPanel {...props} buildingVariant='baseline' />
    )
    const panel = screen.getByRole('region', { name: 'west surface zones' })
    const matrix = within(panel).getByRole('group', {
      name: 'west 4 by 4 surface matrix',
    })
    expect(within(matrix).getAllByRole('button')).toHaveLength(16)
    const selected = within(matrix).getByRole('button', {
      name: 'Zone W7, 343 watts per square metre',
    })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    expect(selected).toHaveTextContent('343 W/m²')
    expect(within(panel).getByText('343.2 W/m²')).toBeInTheDocument()
    expect(within(panel).getByText('63%')).toBeInTheDocument()
    expect(within(panel).getByText(/No external louvres/)).toBeInTheDocument()
    expect(panel).not.toHaveTextContent('18.0°')
    expect(panel).not.toHaveTextContent('111.1')
    expect(panel).not.toHaveTextContent('500')
    expect(panel).not.toHaveTextContent('Indoor daylight')
    expect(panel).not.toHaveTextContent('Estimated solar heat gain')
    expect(panel).not.toHaveTextContent('Direct-sun screening')
    expect(panel).not.toHaveTextContent('sensor-W7')
    expect(panel).not.toHaveTextContent('This zone holds its own target.')
    expect(within(panel).queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(within(panel).queryByText('Clear override')).not.toBeInTheDocument()
    expect(
      within(panel).queryByText('Apply only this sensor')
    ).not.toBeInTheDocument()
    fireEvent.click(within(matrix).getByRole('button', { name: /^Zone W8,/ }))
    expect(onSelectZone).toHaveBeenCalledWith('W8')
    expect(onOverride).not.toHaveBeenCalled()
    expect(onClearOverride).not.toHaveBeenCalled()

    // A variant switch does not reset the parent-owned zone selection.
    rerender(<ZoneSensorPanel {...props} />)
    expect(screen.getByRole('button', { name: /^Zone W7,/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByLabelText('Sensor irradiance')).toHaveValue(400)
    expect(screen.getByText('Clear override')).toBeInTheDocument()
  })

  it('reports achieved daylight, heat and direct-sun screening with fractional actuator positions', () => {
    const selected = {
      ...wall.zones![6],
      angle: 18.34,
      angle_target: 27.86,
      lux: 745,
      conditions: {
        daylight_status: 'high' as const,
        transmitted: 108.1,
        solar_heat_gain: 43.24,
        direct_sun: 26.27,
        glare_risk: true,
        glare_limit_w_m2: 25,
        glazing_shgc: 0.4,
      },
    }
    const props = {
      wall: {
        ...wall,
        zones: wall.zones!.map((zone) =>
          zone.zone === 'W7' ? selected : zone
        ),
      },
      selectedZone: 'W7',
      onSelectZone: vi.fn(),
      onOverride: vi.fn(),
      onClearOverride: vi.fn(),
      overriddenZoneIds: [],
      loading: false,
    }
    const { rerender } = render(<ZoneSensorPanel {...props} />)
    expect(
      screen.getByRole('button', { name: /^Zone W7, 18.3 degrees/ })
    ).toBeInTheDocument()
    expect(screen.getByText(/Final position 18.3°/)).toHaveTextContent(
      'target 27.9°'
    )
    expect(screen.getByText('745.0 lx · high')).toBeInTheDocument()
    expect(screen.getByText('108.1 W/m²')).toBeInTheDocument()
    expect(screen.getByText('43.2 W/m² glazing')).toBeInTheDocument()
    expect(screen.getByText('26.3 W/m²')).toBeInTheDocument()
    expect(screen.getByText('Above limit')).toBeInTheDocument()
    expect(screen.getByText(/Useful daylight: 300–700 lx/)).toHaveTextContent(
      'screening limit 25.0 W/m² · SHGC 0.40'
    )
    rerender(
      <ZoneSensorPanel
        {...props}
        wall={{
          ...wall,
          zones: [
            {
              ...selected,
              lux: 500,
              conditions: {
                ...selected.conditions,
                daylight_status: 'useful',
                direct_sun: 0,
                glare_risk: false,
              },
            },
          ],
        }}
      />
    )
    expect(screen.getByText('500.0 lx · useful')).toBeInTheDocument()
    expect(screen.getByText('Within limit')).toBeInTheDocument()
  })

  it('draws the upper row first and selects a zone without editing another channel', () => {
    const onSelectZone = vi.fn()
    render(
      <ZoneSensorPanel
        wall={wall}
        selectedZone={null}
        onSelectZone={onSelectZone}
        onOverride={vi.fn()}
        onClearOverride={vi.fn()}
        overriddenZoneIds={[]}
        loading={false}
      />
    )
    const matrix = screen.getByRole('group', {
      name: 'west 4 by 4 sensor matrix',
    })
    const buttons = within(matrix).getAllByRole('button')
    expect(buttons).toHaveLength(16)
    expect(
      buttons.map(
        (button) => button.getAttribute('aria-label')?.match(/W\d+/)?.[0]
      )
    ).toEqual([
      'W13',
      'W14',
      'W15',
      'W16',
      'W9',
      'W10',
      'W11',
      'W12',
      'W5',
      'W6',
      'W7',
      'W8',
      'W1',
      'W2',
      'W3',
      'W4',
    ])
    expect(screen.queryByLabelText('Sensor irradiance')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Zone W7,/ }))
    expect(onSelectZone).toHaveBeenCalledTimes(1)
    expect(onSelectZone).toHaveBeenCalledWith('W7')
    expect(wall.zones?.[0].zone).toBe('W1')
  })

  it('submits only the selected sensor, keeps a draft across ticks, and clears only its override', () => {
    const onOverride = vi.fn()
    const onClearOverride = vi.fn()
    const props = {
      wall,
      selectedZone: 'W7',
      onSelectZone: vi.fn(),
      onOverride,
      onClearOverride,
      overriddenZoneIds: ['W7', 'W8'],
      loading: false,
    }
    const { rerender } = render(<ZoneSensorPanel {...props} />)
    expect(screen.getByText('sensor-W7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Zone W7,/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    fireEvent.change(screen.getByLabelText('Sensor irradiance'), {
      target: { value: '900' },
    })
    fireEvent.change(screen.getByLabelText('Sensor illuminance'), {
      target: { value: '1500' },
    })
    rerender(
      <ZoneSensorPanel
        {...props}
        wall={{
          ...wall,
          zones: wall.zones?.map((zone) => ({
            ...zone,
            sensors: { ...zone.sensors!, irradiance: 450 },
          })),
        }}
      />
    )
    expect(screen.getByLabelText('Sensor irradiance')).toHaveValue(900)
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply only this sensor' })
    )
    expect(onOverride).toHaveBeenCalledTimes(1)
    expect(onOverride).toHaveBeenCalledWith('W7', {
      irradiance: 900,
      illuminance: 1500,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear override' }))
    expect(onClearOverride).toHaveBeenCalledTimes(1)
    expect(onClearOverride).toHaveBeenCalledWith('W7')
  })

  it('uses native limits to reject invalid readings and resets the form when a different zone is selected', () => {
    const onOverride = vi.fn()
    const props = {
      wall,
      selectedZone: 'W7',
      onSelectZone: vi.fn(),
      onOverride,
      onClearOverride: vi.fn(),
      overriddenZoneIds: [],
      loading: false,
    }
    const { rerender } = render(<ZoneSensorPanel {...props} />)
    fireEvent.change(screen.getByLabelText('Sensor irradiance'), {
      target: { value: '1601' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply only this sensor' })
    )
    expect(onOverride).not.toHaveBeenCalled()
    rerender(<ZoneSensorPanel {...props} selectedZone='W8' />)
    expect(screen.getByLabelText('Sensor irradiance')).toHaveValue(400)
    fireEvent.change(screen.getByLabelText('Sensor illuminance'), {
      target: { value: '-1' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply only this sensor' })
    )
    expect(onOverride).not.toHaveBeenCalled()
  })
})
