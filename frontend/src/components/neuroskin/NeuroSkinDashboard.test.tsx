import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NeuroSkinDashboard } from './NeuroSkinDashboard'
import type { SimulationRunResponse } from '@/lib/types'

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

  it('serializes the selected scenario when changing tabs', async () => {
    render(<NeuroSkinDashboard />)
    await screen.findByText('Mean load')
    fireEvent.click(screen.getByRole('button', { name: 'Sensor Trust' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const options = fetchMock.mock.calls[1][1] as RequestInit
    expect(JSON.parse(String(options.body))).toMatchObject({
      scenario: 'lie_detector',
      seed: 42,
    })
  })

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
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const options = fetchMock.mock.calls[1][1] as RequestInit
    expect(JSON.parse(String(options.body))).toMatchObject({
      environment_source: 'met_anchored',
    })
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
