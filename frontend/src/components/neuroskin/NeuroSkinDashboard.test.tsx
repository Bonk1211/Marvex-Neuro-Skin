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

// Live hardware polls its own endpoint (tested in LiveHardwarePanel.test.tsx);
// keep it out of these simulation fetch-call assertions.
vi.mock('./LiveHardwarePanel', () => ({ LiveHardwarePanel: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(
      React.useSyncExternalStore(
        (notify) => {
          window.addEventListener('popstate', notify)
          return () => window.removeEventListener('popstate', notify)
        },
        () => window.location.search
      )
    ),
}))
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    scroll,
    ...props
  }: React.ComponentProps<'a'> & { scroll?: boolean }) => (
    <a
      {...props}
      data-scroll={String(scroll)}
      href={href}
      onClick={(event) => {
        event.preventDefault()
        window.history.pushState(null, '', href)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }}
    >
      {children}
    </a>
  ),
}))

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
    window.history.replaceState(null, '', '/dashboard')
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
    expect(screen.getByText(response.metadata.data_notice)).toBeInTheDocument()
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

  it('keeps scenario comparisons together and clears cached charts when applied inputs change', async () => {
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
    const panel = screen.getByRole('region', { name: 'Scenario comparisons' })
    expect(panel).toHaveTextContent('0 readings rejected as impossible')
    expect(panel).toHaveTextContent('Lux compliance: 90% vs 60% naive')
    expect(panel).toHaveTextContent('1 louvre movements across the day')

    fireEvent.click(screen.getByRole('link', { name: 'Brains' }))
    // And so do all three sets of charts, rather than one area swapping.
    expect(
      screen.getByRole('region', { name: 'Test 1 charts' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Test 2 charts' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Test 3 charts' })
    ).toBeInTheDocument()
    // Tier 1's sensor cross-check and Tier 3's safety chart coexist.
    expect(screen.getByText('Sensor cross-check')).toBeInTheDocument()
    expect(screen.getByText('Safety response')).toBeInTheDocument()
    expect(screen.getByText('Daylight compliance')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('slider', { name: 'Wind override' }), {
      target: { value: '8' },
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Apply settings and re-run' })
      ).toBeEnabled()
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply settings and re-run' })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6))
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Test 1 charts' })
      ).not.toBeInTheDocument()
    )
    for (const name of ['Test 2 charts', 'Test 3 charts'])
      expect(screen.queryByRole('region', { name })).not.toBeInTheDocument()
    expect(
      JSON.parse(String(fetchMock.mock.calls[5][1].body)).wind_override
    ).toBe(8)
    fireEvent.click(screen.getByRole('link', { name: 'Building' }))
    expect(screen.queryByText('4/4 complete')).not.toBeInTheDocument()
  }, 15000)

  it('shows the MET provider and full notice in every lens', async () => {
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

    expect(
      await screen.findByText('MET Malaysia via data.gov.my')
    ).toBeInTheDocument()
    expect(screen.getByText(anchored.metadata.data_notice)).toBeInTheDocument()
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
      await screen.findByLabelText('Test 3 explanation')
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
      await screen.findByLabelText('Test 1 explanation')
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
    await screen.findByText('Mean load')
    fireEvent.click(screen.getByRole('link', { name: 'Floor' }))
    await screen.findByRole('region', { name: 'west zone sensors' })
    const timeline = screen.getByRole('slider', { name: 'Simulation timeline' })
    fireEvent.change(timeline, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /^Zone W2,/ }))
    expect(screen.getByText('20.0° angle')).toBeInTheDocument()

    const building = screen.getByRole('combobox', {
      name: 'Monitored building',
    })
    fireEvent.click(screen.getByRole('link', { name: 'Building' }))
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
    fireEvent.click(screen.getByRole('link', { name: 'Floor' }))
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
    expect(
      screen.queryByRole('region', { name: 'Surface readings' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Zone W2,/ })).toHaveTextContent(
      '300 W/m²'
    )
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
    fireEvent.click(screen.getByRole('link', { name: 'Building' }))
    expect(screen.getByText('Mean load')).toBeInTheDocument()
    expect(
      screen.getByRole('complementary', {
        name: 'Controller settings and formulas',
      })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Floor' }))
    expect(screen.getByLabelText('Sensor irradiance')).not.toBeVisible()
    fireEvent.click(screen.getByText('Inject sensor reading'))
    expect(screen.getByLabelText('Sensor irradiance')).toHaveValue(300)
    expect(screen.getByLabelText('Sensor irradiance')).toBeVisible()
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
    fireEvent.click(screen.getByRole('link', { name: 'Building' }))
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Inspect surface' }),
      { target: { value: 'roof:west' } }
    )
    const roofComparison = screen.getByRole('region', {
      name: 'Building irradiance comparison',
    })
    expect(roofComparison).toHaveTextContent('West roof')
    expect(
      within(roofComparison).getByText('Controlled').nextElementSibling
    ).toHaveTextContent('828 W/m²')
    expect(
      within(roofComparison).getByText('No external facade').nextElementSibling
    ).toHaveTextContent('828 W/m²')
    expect(roofComparison).toHaveTextContent('Same roof · unchanged exposure')
    const roofReading = roofComparison.textContent
    for (const variant of ['baseline', 'controlled']) {
      fireEvent.change(building, { target: { value: variant } })
      expect(roofComparison).toHaveTextContent(roofReading!)
      expect(screen.getByText('828 W/m² on roof')).toBeVisible()
      expect(screen.getByText('60.1 °C surface')).toBeVisible()
      expect(timeline).toHaveValue('1')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    }
  })

  it('keeps objective weights attached to the applied run until edited settings are applied', async () => {
    render(<NeuroSkinDashboard />)
    await screen.findByText('Mean load')
    fireEvent.change(screen.getByRole('slider', { name: 'Thermal load' }), {
      target: { value: '0' },
    })
    fireEvent.click(screen.getByRole('link', { name: 'Brains' }))
    expect(
      within(
        screen.getByRole('region', { name: 'Cost breakdown' })
      ).getAllByText('· weight 45%')
    ).toHaveLength(2)
    fireEvent.click(screen.getByRole('link', { name: 'Building' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply settings and re-run' })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await screen.findByRole('button', { name: 'Apply settings and re-run' })
    fireEvent.click(screen.getByRole('link', { name: 'Brains' }))
    expect(
      within(screen.getByRole('region', { name: 'Cost breakdown' })).getByText(
        '· weight 0%'
      )
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Floor' }))
    fireEvent.click(screen.getByRole('link', { name: 'Brains' }))
    expect(
      within(screen.getByRole('region', { name: 'Cost breakdown' })).getByText(
        '· weight 0%'
      )
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('opens deep links and falls back to Building for unknown lenses', async () => {
    window.history.replaceState(null, '', '/dashboard?view=brains')
    render(<NeuroSkinDashboard />)
    await screen.findByRole('region', { name: 'Cost breakdown' })
    expect(screen.queryByText('Mean load')).not.toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Data provenance' })
    ).toHaveTextContent(response.metadata.data_notice)
    fireEvent.click(screen.getByRole('link', { name: 'Building' }))
    expect(screen.getByText('Mean load')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Floor' }))
    expect(
      screen.getByText('Zone grid unavailable for this side')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Floor plan' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    fireEvent.popState(window, { state: null })
    // An arbitrary external URL value never becomes a lens.
    window.history.replaceState(null, '', '/dashboard?view=nonsense')
    fireEvent.popState(window)
    expect(screen.getByText('Mean load')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps an in-flight tier run and the stage mounted while navigating lenses', async () => {
    let finish: ((value: unknown) => void) | undefined
    render(<NeuroSkinDashboard />)
    await screen.findByText('Mean load')
    const stage = screen.getByRole('region', { name: 'Building model' })
    const building = screen.getByRole('combobox', {
      name: 'Monitored building',
    })
    const video = screen.getByLabelText('Sky video feed')
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))
    const signal = fetchMock.mock.calls[1][1].signal as AbortSignal
    fireEvent.click(screen.getByRole('link', { name: 'Floor' }))
    expect(signal.aborted).toBe(false)
    expect(screen.getByRole('region', { name: 'Building model' })).toBe(stage)
    expect(screen.getByRole('combobox', { name: 'Monitored building' })).toBe(
      building
    )
    finish?.({ ok: true, json: async () => response })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5), {
      timeout: 6000,
    })
    fireEvent.click(screen.getByRole('link', { name: 'Building' }))
    await screen.findByText('4/4 complete')
    expect(screen.getByLabelText('Sky video feed')).toBe(video)
    fireEvent.click(screen.getByRole('link', { name: 'Brains' }))
    expect(
      screen.getByRole('region', { name: 'Test 3 charts' })
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(5)
  }, 15000)

  it('shares zone and time between Floor and Brains and restores the primary facade', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...response,
        ticks: [0, 1].map((tickIndex) => ({
          ...response.ticks[0],
          timestamp: `2026-03-21T${12 + tickIndex}:00:00+08:00`,
          daylight: {
            model: 'Extra Trees',
            night: false,
            occupied: true,
            ev_cap_lux: 1000,
            et_band_low_lux: 300,
            et_band_high_lux: 500,
          },
          facade: response.ticks[0].facade.map((wall) => ({
            ...wall,
            zones: Array.from({ length: 16 }, (_, index) => ({
              row: Math.floor(index / 4),
              column: index % 4,
              zone: `${wall.orientation[0].toUpperCase()}${index + 1}`,
              incident: wall.orientation === 'west' ? 300 : 400,
              transmitted: wall.orientation === 'west' ? 150 : 200,
              sunlit_fraction: 1,
              sol_air_temp: 34,
              angle: 20,
              angle_target: 25,
              mode: 'HOLD',
              moved: false,
              lux: 400,
              load_relative: 0.4,
              sensor_trusted: true,
              conditions: {
                daylight_status: 'useful',
                glare_risk: index === 4,
                transmitted: 150,
                solar_heat_gain: 60,
                direct_sun: 30,
                glare_limit_w_m2: 25,
                glazing_shgc: 0.4,
                daylight_probes: [
                  {
                    kind: 'seat',
                    index,
                    task_illuminance:
                      Math.floor(index / 4) === 1
                        ? wall.orientation === 'west'
                          ? 400
                          : 500
                        : 900,
                    eye_illuminance:
                      Math.floor(index / 4) === 1
                        ? wall.orientation === 'west'
                          ? 1200
                          : 800
                        : 2000,
                  },
                ],
              },
            })),
          })),
        })),
      }),
    })
    render(<NeuroSkinDashboard />)
    await screen.findByText('Mean load')
    const timeline = screen.getByRole('slider', { name: 'Simulation timeline' })
    fireEvent.change(timeline, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('link', { name: 'Floor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Floors 3–4' }))
    expect(screen.getByText('west · Floors 3–4')).toBeVisible()
    expect(
      screen.queryByRole('list', { name: 'Side zones' })
    ).not.toBeInTheDocument()
    let matrix = screen.getByRole('group', {
      name: 'west 4 by 4 sensor matrix',
    })
    expect(within(matrix).getAllByRole('button')).toHaveLength(16)
    let sides = screen.getByRole('group', { name: 'Floor plan side' })
    expect(within(sides).getAllByRole('button')).toHaveLength(4)
    const north = within(sides).getByRole('button', {
      name: 'north floor plan',
    })
    expect(north).toHaveTextContent('4/4 zones · 8 people · mock')
    expect(north).toHaveTextContent('Et 500 · Ev 800 lux')
    const west = within(sides).getByRole('button', { name: 'west floor plan' })
    expect(west).toHaveTextContent('4/4 zones · 7 people · mock')
    expect(west).toHaveTextContent('Et 400 · Ev 1200 lux')
    expect(screen.getByLabelText('Mock occupants')).toHaveTextContent(
      '7 people · 2 walking · 5 seated'
    )
    expect(
      screen.getByText('4 of 4 seats over the 1000 lux eye-illuminance cap')
    ).toBeVisible()
    fireEvent.click(north)
    expect(screen.getByText('north · Floors 3–4')).toBeVisible()
    expect(north).toHaveAttribute('aria-pressed', 'true')
    matrix = screen.getByRole('group', { name: 'north 4 by 4 sensor matrix' })
    expect(within(matrix).getAllByRole('button')).toHaveLength(16)
    expect(
      within(matrix).queryByRole('button', { name: /^Zone W5,/ })
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Mock occupants')).toHaveTextContent(
      '8 people · 2 walking · 6 seated'
    )
    expect(
      screen.getByText('0 of 4 seats over the 1000 lux eye-illuminance cap')
    ).toBeVisible()
    fireEvent.click(within(matrix).getByRole('button', { name: /^Zone N5,/ }))
    fireEvent.click(screen.getByRole('link', { name: 'Brains' }))
    expect(
      screen.getByRole('combobox', { name: 'Brain controller' })
    ).toHaveValue('N5')
    expect(screen.getByText('N5 · local controller')).toBeVisible()
    expect(timeline).toHaveValue('0')
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Brain controller' }),
      { target: { value: 'E6' } }
    )
    expect(screen.getByText('east facade · E6')).toBeVisible()
    fireEvent.click(screen.getByRole('link', { name: 'Floor' }))
    expect(
      screen.getByRole('button', { name: 'east floor plan' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^Zone E6,/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Floors 3–4' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(timeline).toHaveValue('0')
    fireEvent.click(screen.getByRole('link', { name: 'Brains' }))
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Brain controller' }),
      { target: { value: '' } }
    )
    expect(screen.getByText('Primary west controller')).toBeVisible()
    expect(screen.getByText('west facade', { selector: 'span' })).toBeVisible()
    expect(
      screen.getByRole('combobox', { name: 'Brain controller' })
    ).toHaveValue('')
    fireEvent.click(screen.getByRole('link', { name: 'Floor' }))
    matrix = screen.getByRole('group', { name: 'west 4 by 4 sensor matrix' })
    expect(
      within(matrix)
        .getAllByRole('button')
        .every((button) => button.getAttribute('aria-pressed') === 'false')
    ).toBe(true)
    fireEvent.click(within(matrix).getByRole('button', { name: /^Zone W5,/ }))
    expect(screen.getByRole('button', { name: /^Zone W5,/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    fireEvent.click(screen.getByText('Simulated daylight & heat'))
    expect(screen.getByText('Above limit')).toBeVisible()
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Monitored building' }),
      { target: { value: 'baseline' } }
    )
    matrix = screen.getByRole('group', { name: 'west 4 by 4 surface matrix' })
    expect(
      within(matrix).getByRole('button', { name: /^Zone W5,/ })
    ).toHaveTextContent('300 W/m²')
    expect(screen.getByText('300.0 W/m²')).toBeVisible()
    expect(
      screen.queryByLabelText('Daylight at occupied seats')
    ).not.toBeInTheDocument()
    sides = screen.getByRole('group', { name: 'Floor plan side' })
    expect(sides).not.toHaveTextContent('Et ')
    fireEvent.click(screen.getByRole('button', { name: 'Show all levels' }))
    expect(
      within(sides).getByRole('button', { name: 'west floor plan' })
    ).toHaveTextContent('16/16 zones')
    expect(
      screen.getByRole('button', { name: 'Show all levels' })
    ).toHaveAttribute('aria-pressed', 'true')
    for (const label of ['Floors 1–2', 'Floors 3–4', 'Floors 5–6', 'Floor 7'])
      expect(screen.getByRole('button', { name: label })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
    expect(timeline).toHaveValue('0')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('runs local checks from Brains and replays approvals and fault windows', async () => {
    window.history.replaceState(null, '', '/dashboard?view=brains')
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
        irradiance: index === 1 ? 0 : 300,
        illuminance: 400,
        source: 'simulated',
      },
      assurance:
        index === 1
          ? {
              verdict: 'fault',
              hypothesis: 'dead',
              score: 1,
              peer_deviation: -1,
              lux_deviation: 0,
              reason: 'W2 reads 0.00x its model.',
              episode_id: 'W2:1:dead',
            }
          : {
              verdict: 'consistent',
              hypothesis: null,
              score: 0,
              peer_deviation: 0,
              lux_deviation: 0,
              reason: 'Consistent.',
            },
    }))
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...response,
        ticks: [0, 1].map(() => ({
          ...response.ticks[0],
          facade: response.ticks[0].facade.map((wall) =>
            wall.orientation === 'west' ? { ...wall, zones } : wall
          ),
        })),
        episodes: [
          {
            episode_id: 'W2:1:dead',
            zone: 'W2',
            hypothesis: 'dead',
            score: 1,
            status: 'awaiting_approval',
            opened_tick: 1,
            mitigated_tick: null,
            closed_tick: null,
            snapshot_angle: null,
            valid_ticks: 0,
            e_corrected: 0,
            e_uncorrected: 0,
            maintenance_flag: false,
            events: [
              { tick_index: 1, stage: 'detect', detail: 'W2 reads 0.00x.' },
              {
                tick_index: 1,
                stage: 'authorise',
                detail: 'Needs operator approval before anything changes.',
              },
            ],
          },
        ],
      }),
    })
    render(<NeuroSkinDashboard />)
    const controller = await screen.findByRole('combobox', {
      name: 'Brain controller',
    })
    const body = (call: number) =>
      JSON.parse(String(fetchMock.mock.calls[call][1].body))
    expect(body(0).fault_correction).toBe('review')
    const timeline = screen.getByRole('slider', { name: 'Simulation timeline' })
    fireEvent.change(timeline, { target: { value: '1' } })
    fireEvent.change(controller, { target: { value: 'W2' } })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Approve and replay' })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(body(1).approved_episodes).toEqual(['W2:1:dead'])
    expect(body(1).fault_correction).toBe('review')
    await waitFor(() => expect(timeline).toHaveValue('1'))

    fireEvent.click(screen.getByRole('link', { name: 'Floor' }))
    fireEvent.click(await screen.findByText('Inject fault window'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Fault window' }), {
      target: { value: 'stuck' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Inject 2 h from this time' })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(body(2).zone_perturbations).toEqual({
      W2: { kind: 'stuck', start_tick: 1, end_tick: 1 },
    })
    expect(body(2).approved_episodes).toEqual([])
    expect(body(2).fault_correction).toBe('review')
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
