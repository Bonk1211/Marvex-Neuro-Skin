import React from 'react'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NeuroSkinDashboard } from './NeuroSkinDashboard'
import type { SimulationRunResponse, ZoneHeat } from '@/lib/types'

const response: SimulationRunResponse = {
  scenario: 'overview',
  title: 'NeuroSkin representative tropical day',
  metadata: {
    location: 'Kuala Lumpur, Malaysia',
    latitude: 3.139,
    longitude: 101.6869,
    timezone: 'Asia/Kuala_Lumpur',
    tick_minutes: 10,
    seed: 42,
    environment_source: 'synthetic',
    facade_orientation: 'west',
    facade_tilt: 115,
    roof_pitch: 10,
    floors: 7,
    synthetic: true,
    data_notice:
      'Modelled Kuala Lumpur tropical day; all environmental and sensor data are synthetic.',
    load_unit: 'relative cooling-load index',
    weather_context: null,
  },
  summary: {
    ticks: 1,
    movement_count: 1,
    sensor_fault_ticks: 0,
    safe_mode_ticks: 0,
    mean_relative_load: 0.42,
  },
  ticks: [
    {
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
          reason:
            'The current angle remains the lowest-cost allowable position.',
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
          reason:
            'The current angle remains the lowest-cost allowable position.',
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
          reason:
            'The current angle remains the lowest-cost allowable position.',
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
    },
  ],
  comparison: [
    {
      metric: 'lux_compliance',
      label: 'Lux compliance',
      unit: '%',
      ours: 90,
      naive: 60,
      higher_is_better: true,
    },
  ],
  annotations: [],
}

describe('NeuroSkinDashboard', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => response })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('renders direct impact metrics without narrative explanation', async () => {
    render(<NeuroSkinDashboard />)
    expect(await screen.findByText('Mean load')).toBeInTheDocument()
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).weights).toEqual(
      {
        thermal: 0.45,
        lux: 0.45,
        movement: 0.05,
        risk: 0.05,
      }
    )
    expect(screen.getAllByText('0.420').length).toBeGreaterThan(0)
    expect(screen.getByText('Impact')).toBeInTheDocument()
    expect(screen.getByText('Selected tick')).toBeInTheDocument()
    expect(screen.queryByText('Decision explanation')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/all environmental and sensor data are synthetic/i)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/kWh/i)).not.toBeInTheDocument()
  })

  it('keeps each formula attached to its relevant setting', async () => {
    render(<NeuroSkinDashboard />)
    await screen.findByText('Mean load')

    expect(
      screen.getByRole('complementary', { name: 'Environment settings' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('complementary', {
        name: 'Controller settings and formulas',
      })
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Weather' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Demand' })).toBeInTheDocument()
    expect(screen.queryByText('Angle objective')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Show formula for Thermal load cost' })
    ).toBeInTheDocument()
    expect(screen.getByText('CT(θ) = wT × L(θ)')).toBeInTheDocument()
  })

  it('shows an accessible loading state while the simulation is pending', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    render(<NeuroSkinDashboard />)
    expect(screen.getByText('Running simulation')).toBeInTheDocument()
  })

  it('shows API detail and offers a retry after a request failure', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'Simulation engine warming up.' }),
    })
    render(<NeuroSkinDashboard />)
    expect(
      await screen.findByText('Simulation unavailable')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Simulation engine warming up/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Try again' })
    ).toBeInTheDocument()
  })

  it('keeps the three tiers on one page instead of separate scenario views', async () => {
    render(<NeuroSkinDashboard />)
    await screen.findByText('Mean load')

    // No scenario sub-pages to switch between.
    expect(
      screen.queryByRole('button', { name: 'Sensor Trust' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Optimisation' })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))
    await waitFor(
      () => expect(screen.getByText('4/4 complete')).toBeInTheDocument(),
      { timeout: 6000 }
    )

    // Every tier's findings stay on the page together.
    const panel = screen.getByRole('region', { name: 'Three-tier analysis' })
    expect(panel).toHaveTextContent('0 readings rejected as impossible')
    expect(panel).toHaveTextContent('Lux compliance: 90% vs 60% naive')
    expect(panel).toHaveTextContent('1 louvre movements across the day')

    // And so do all three sets of charts, rather than one area swapping.
    expect(
      screen.getByRole('region', { name: 'Tier 1 charts' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Tier 2 charts' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Tier 3 charts' })
    ).toBeInTheDocument()
    // Tier 1's sensor cross-check and Tier 3's safety chart coexist.
    expect(screen.getByText('Sensor cross-check')).toBeInTheDocument()
    expect(screen.getByText('Safety response')).toBeInTheDocument()
    expect(screen.getByText('Daylight compliance')).toBeInTheDocument()
  }, 15000)

  it('shows only the compact MET source status in the operating view', async () => {
    const anchored: SimulationRunResponse = {
      ...response,
      metadata: {
        ...response.metadata,
        environment_source: 'met_anchored',
        data_notice:
          'MET Malaysia daily forecast anchors temperature and period-level sky conditions.',
        weather_context: {
          status: 'applied',
          provider: 'MET Malaysia via data.gov.my',
          source_url: 'https://api.data.gov.my/weather/forecast/',
          fetched_at: '2026-08-11T03:00:00Z',
          dataset: null,
          location_id: 'Tn079',
          location_name: 'Kuala Lumpur',
          forecast_date: '2026-08-11',
          min_temp: 25,
          max_temp: 34,
          morning_forecast: 'Tiada hujan',
          afternoon_forecast: 'Ribut petir di beberapa tempat',
          night_forecast: 'Hujan di satu dua tempat',
          summary_forecast: 'Ribut petir di beberapa tempat',
          summary_when: 'Petang',
          warnings: [
            {
              title: 'Continuous Rain Warning',
              heading: 'Continuous Rain',
              text: 'Heavy rain is expected.',
              instruction: 'Monitor official updates.',
              valid_from: '2026-08-11T12:00:00',
              valid_to: '2026-08-12T06:00:00',
            },
          ],
          fallback_reason: null,
        },
      },
    }
    fetchMock.mockResolvedValue({ ok: true, json: async () => anchored })
    render(<NeuroSkinDashboard />)

    expect(await screen.findByText('MET anchored')).toBeInTheDocument()
    expect(screen.queryByTestId('weather-context')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Continuous Rain Warning/)
    ).not.toBeInTheDocument()
  })

  it('serializes MET-anchored mode from the environment control', async () => {
    render(<NeuroSkinDashboard />)
    await screen.findByText('Mean load')
    fireEvent.click(screen.getByRole('button', { name: 'MET-anchored' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply settings and re-run' })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const options = fetchMock.mock.calls[1][1] as RequestInit
    expect(JSON.parse(String(options.body))).toMatchObject({
      environment_source: 'met_anchored',
    })
  })

  it('runs the three tiers in order and explains each one on the stage', async () => {
    render(<NeuroSkinDashboard />)
    await screen.findByText('Mean load')
    fetchMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))

    // The floating card names the step that is running.
    expect(
      await screen.findByLabelText('Input explanation')
    ).toBeInTheDocument()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4), {
      timeout: 6000,
    })
    const scenarios = fetchMock.mock.calls.map(
      (call) => JSON.parse(String((call[1] as RequestInit).body)).scenario
    )
    expect(scenarios).toEqual([
      'overview',
      'lie_detector',
      'co_optimization',
      'budget_failsafe',
    ])

    await waitFor(() =>
      expect(screen.getByText('4/4 complete')).toBeInTheDocument()
    )
    expect(
      await screen.findByLabelText('Tier 3 explanation')
    ).toBeInTheDocument()
  }, 15000)

  it('shows a finished tier from its stored result instead of re-running it', async () => {
    render(<NeuroSkinDashboard />)
    await screen.findByText('Mean load')
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))
    await waitFor(
      () => expect(screen.getByText('4/4 complete')).toBeInTheDocument(),
      { timeout: 6000 }
    )
    fetchMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Sensor trust/ }))

    expect(
      await screen.findByLabelText('Tier 1 explanation')
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  }, 15000)

  it('walks the sun across the day while the analysis runs', async () => {
    const day: SimulationRunResponse = {
      ...response,
      ticks: [
        response.ticks[0],
        {
          ...response.ticks[0],
          timestamp: '2026-03-21T15:00:00+08:00',
          solar_azimuth: 280,
          solar_elevation: 40,
        },
        {
          ...response.ticks[0],
          timestamp: '2026-03-21T18:00:00+08:00',
          solar_azimuth: 292,
          solar_elevation: 8,
        },
      ],
    }
    fetchMock.mockResolvedValue({ ok: true, json: async () => day })
    render(<NeuroSkinDashboard />)
    await screen.findByText('Mean load')

    // The toolbar reads the sun's real position for the tick on screen.
    const timeline = screen.getByRole('slider', { name: 'Simulation timeline' })
    expect(screen.getByText(/^sun \d+° elev · \d+° az$/)).toBeInTheDocument()
    const started = (timeline as HTMLInputElement).value

    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))
    expect(
      await screen.findByRole('button', { name: 'Pause sun movement' })
    ).toBeInTheDocument()

    // The clock moves the sun on its own once the run starts.
    await waitFor(
      () => expect((timeline as HTMLInputElement).value).not.toEqual(started),
      { timeout: 4000 }
    )

    // And it stops when the analysis finishes.
    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: 'Play sun movement' })
        ).toBeInTheDocument(),
      { timeout: 8000 }
    )
  }, 20000)

  it('advances actuator angles with ordinary sun playback and scrubbing', async () => {
    const ticks = [0, 30.4, 0].map((angle, index) => ({
      ...response.ticks[0],
      timestamp: `2026-03-21T${15 + index}:00:00+08:00`,
      solar_elevation: 50 - index * 15,
      facade: response.ticks[0].facade.map((wall) => ({ ...wall, angle })),
    }))
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ...response, ticks }),
    })
    render(<NeuroSkinDashboard />)
    await screen.findByText('Mean load')
    const timeline = screen.getByRole('slider', { name: 'Simulation timeline' })
    fireEvent.change(timeline, { target: { value: '0' } })
    expect(screen.getByText('0.0° angle')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Play sun movement' }))
    await screen.findByText('30.4° angle')
    fireEvent.click(screen.getByRole('button', { name: 'Pause sun movement' }))
    expect(screen.getByText('sun 35° elev · 264° az')).toBeInTheDocument()

    fireEvent.change(timeline, { target: { value: '2' } })
    expect(screen.getByText('0.0° angle')).toBeInTheDocument()
    expect(screen.getByText('sun 20° elev · 264° az')).toBeInTheDocument()
  })

  it('preserves the selected zone and clock across building variants and edits only that sensor', async () => {
    const zones: ZoneHeat[] = Array.from({ length: 16 }, (_, index) => ({
      zone: `W${index + 1}`,
      row: Math.floor(index / 4),
      column: index % 4,
      incident: 300,
      transmitted: 220,
      sunlit_fraction: 1,
      sol_air_temp: 35,
      angle: 20,
      angle_target: 20,
      mode: 'HOLD',
      moved: false,
      lux: 400,
      load_relative: 0.4,
      reason: 'Local W sensor reading.',
      sensor_trusted: true,
      sensors: {
        sensor_id: `W${index + 1}`,
        irradiance: 300,
        illuminance: 400,
        source: 'simulated',
      },
    }))
    fetchMock.mockImplementation(async (_url, options: RequestInit) => {
      const input = JSON.parse(String(options.body))
      const override = input.zone_sensor_overrides?.W2
      return {
        ok: true,
        json: async () => ({
          ...response,
          ticks: [0, 1, 2].map((index) => ({
            ...response.ticks[0],
            facade: response.ticks[0].facade.map((wall) =>
              wall.orientation === 'west'
                ? {
                    ...wall,
                    zones: zones.map((zone) =>
                      override &&
                      index === override.tick_index &&
                      zone.zone === 'W2'
                        ? {
                            ...zone,
                            angle: 60,
                            angle_target: 60,
                            sensors: {
                              ...zone.sensors,
                              ...override,
                              source: 'override',
                            },
                          }
                        : zone
                    ),
                  }
                : wall
            ),
          })),
        }),
      }
    })
    render(<NeuroSkinDashboard />)
    await screen.findByRole('region', { name: 'west zone sensors' })
    const timeline = screen.getByRole('slider', { name: 'Simulation timeline' })
    fireEvent.change(timeline, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /^Zone W2,/ }))
    expect(screen.getByText('20.0° angle')).toBeInTheDocument()

    const building = screen.getByRole('combobox', {
      name: 'Monitored building',
    })
    const comparison = screen.getByRole('region', {
      name: 'Building irradiance comparison',
    })
    expect(comparison).toHaveTextContent('West · W2')
    expect(
      within(comparison).getByText('Controlled').nextElementSibling
    ).toHaveTextContent('220 W/m²')
    expect(
      within(comparison).getByText('No external facade').nextElementSibling
    ).toHaveTextContent('300 W/m²')
    expect(comparison).toHaveTextContent('26.7% less irradiance with louvres')
    const wallComparison = comparison.textContent

    fireEvent.change(building, { target: { value: 'baseline' } })
    expect(building).toHaveValue('baseline')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(timeline).toHaveValue('1')
    expect(comparison).toHaveTextContent(wallComparison!)
    expect(screen.getByRole('button', { name: /^Zone W2,/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    const surfaceZones = screen.getByRole('region', {
      name: 'west surface zones',
    })
    expect(within(surfaceZones).getByText('300.0 W/m²')).toBeInTheDocument()
    expect(screen.getByText('300 W/m² before glazing')).toBeInTheDocument()
    // 31 + 0.6 × 300 / (5.7 + 3.8 × 3); not controlled transmitted irradiance.
    expect(screen.getByText('41.5 °C surface estimate')).toBeInTheDocument()
    const baselineWallRow = within(
      screen.getByRole('region', { name: 'Surface readings' })
    )
      .getByRole('button', { name: /^west/i })
      .closest('tr')
    expect(baselineWallRow).toHaveTextContent('41.5')
    expect(baselineWallRow).not.toHaveTextContent('53.5')
    expect(
      screen.queryByRole('complementary', {
        name: 'Controller settings and formulas',
      })
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sensor irradiance')).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('Sensor illuminance')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Mean load')).not.toBeInTheDocument()
    expect(screen.queryByText('Impact')).not.toBeInTheDocument()
    expect(screen.queryByText('Movements')).not.toBeInTheDocument()
    expect(screen.queryByText('20.0° angle')).not.toBeInTheDocument()
    expect(screen.queryByText('400 lux')).not.toBeInTheDocument()
    expect(screen.queryByText('0.400 load')).not.toBeInTheDocument()
    expect(screen.queryByText('Facade power')).not.toBeInTheDocument()
    expect(screen.queryByText(/controller active/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/16 independent sensor-controlled zones/)
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/64 independent sensor loops/)
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Each side has 16 surface zones/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: 'Occupancy' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: 'Wind override' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'Show formula for Wind exposure cost',
      })
    ).not.toBeInTheDocument()

    fireEvent.change(building, { target: { value: 'controlled' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(timeline).toHaveValue('1')
    expect(screen.getByRole('button', { name: /^Zone W2,/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByText('20.0° angle')).toBeInTheDocument()
    expect(screen.getByText('Mean load')).toBeInTheDocument()
    expect(
      screen.getByRole('complementary', {
        name: 'Controller settings and formulas',
      })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Sensor irradiance')).toHaveValue(300)
    expect(screen.getByText('Facade power')).toBeInTheDocument()
    expect(screen.getByText('Powered · controller active')).toBeInTheDocument()
    expect(
      screen.getByText(/16 independent sensor-controlled zones/)
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Overcast' }))
    fireEvent.change(screen.getByLabelText('Sensor irradiance'), {
      target: { value: '900' },
    })
    fireEvent.change(screen.getByLabelText('Sensor illuminance'), {
      target: { value: '1200' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply only this sensor' })
    )
    await screen.findByText('60.0° angle')
    const submitted = JSON.parse(String(fetchMock.mock.calls[1][1].body))
    expect(submitted.zone_sensor_overrides).toEqual({
      W2: { tick_index: 1, irradiance: 900, illuminance: 1200 },
    })
    expect(submitted.cloud_profile).toBe('scattered')
    expect(timeline).toHaveValue('1')
    expect(screen.getByRole('button', { name: /^Zone W3,/ })).toHaveTextContent(
      '20.0°'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear override' }))
    await screen.findByText('20.0° angle')
    expect(
      JSON.parse(String(fetchMock.mock.calls[2][1].body)).zone_sensor_overrides
    ).toEqual({})
    expect(timeline).toHaveValue('1')

    fireEvent.click(screen.getByRole('button', { name: /^roof west$/i }))
    expect(comparison).toHaveTextContent('West roof')
    expect(
      within(comparison).getByText('Controlled').nextElementSibling
    ).toHaveTextContent('828 W/m²')
    expect(
      within(comparison).getByText('No external facade').nextElementSibling
    ).toHaveTextContent('828 W/m²')
    expect(comparison).toHaveTextContent('Same roof · unchanged exposure')
    const roofComparison = comparison.textContent
    for (const variant of ['baseline', 'controlled']) {
      fireEvent.change(building, { target: { value: variant } })
      expect(comparison).toHaveTextContent(roofComparison!)
      expect(screen.getByText('828 W/m² on roof')).toBeInTheDocument()
      expect(screen.getByText('60.1 °C surface')).toBeInTheDocument()
      expect(timeline).toHaveValue('1')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    }
  })

  it('links to the project overview and excludes tutorial chrome', async () => {
    render(<NeuroSkinDashboard />)
    await screen.findByText('Mean load')
    expect(
      screen.getByRole('link', { name: 'Project overview' })
    ).toHaveAttribute('href', '/')
    expect(
      screen.queryByRole('button', { name: 'Guided tour' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
