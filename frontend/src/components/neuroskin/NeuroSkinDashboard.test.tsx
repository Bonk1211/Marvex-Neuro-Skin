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
    synthetic: true,
    data_notice:
      'Modelled Kuala Lumpur tropical day; all environmental and sensor data are synthetic.',
    load_unit: 'relative cooling-load index',
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

  it('renders API output, the synthetic notice, and the explanation panel', async () => {
    render(<NeuroSkinDashboard />)
    expect(
      await screen.findByText('NeuroSkin representative tropical day')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/all environmental and sensor data are synthetic/i)
    ).toBeInTheDocument()
    expect(screen.getByText('Decision explanation')).toBeInTheDocument()
    expect(screen.getAllByText(/relative load/i).length).toBeGreaterThan(0)
    expect(
      screen.getByText(/no HVAC energy conversion is claimed/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/kWh/i)).not.toBeInTheDocument()
  })

  it('shows an accessible loading state while the simulation is pending', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    render(<NeuroSkinDashboard />)
    expect(screen.getByText('Modelling the tropical day')).toBeInTheDocument()
  })

  it('shows API detail and offers a retry after a request failure', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'Simulation engine warming up.' }),
    })
    render(<NeuroSkinDashboard />)
    expect(await screen.findByText('Simulation API unavailable')).toBeInTheDocument()
    expect(screen.getByText(/Simulation engine warming up/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('serializes the selected scenario when changing tabs', async () => {
    render(<NeuroSkinDashboard />)
    await screen.findByText('NeuroSkin representative tropical day')
    fireEvent.click(screen.getByRole('button', { name: 'Lie Detector' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const options = fetchMock.mock.calls[1][1] as RequestInit
    expect(JSON.parse(String(options.body))).toMatchObject({
      scenario: 'lie_detector',
      seed: 42,
    })
  })

  it('opens the guided judge tour and navigates to the lie-detector proof', async () => {
    render(<NeuroSkinDashboard />)
    await screen.findByText('NeuroSkin representative tropical day')
    fireEvent.click(screen.getByRole('button', { name: 'Guided tour' }))
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next tour step' }))
    expect(await screen.findByText('Step 2 of 6')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const options = fetchMock.mock.calls[1][1] as RequestInit
    expect(JSON.parse(String(options.body))).toMatchObject({
      scenario: 'lie_detector',
    })
  })
})
