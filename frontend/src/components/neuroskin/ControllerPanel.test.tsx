import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SimulationRunRequest } from '@/lib/types'
import { ControllerPanel } from './ControllerPanel'

const request: SimulationRunRequest = {
  scenario: 'overview',
  date: '2026-03-21',
  seed: 42,
  environment_source: 'synthetic',
  cloud_profile: 'scattered',
  occupancy_scale: 1,
  wind_override: 3,
  power_ok: true,
  weights: { thermal: 0.45, lux: 0.45, movement: 0.05, risk: 0.05 },
  latitude: 2.922,
  longitude: 101.6885,
  timezone: 'Asia/Kuala_Lumpur',
  location_name: 'ST Diamond Building',
  facade_orientation: 'west',
  facade_tilt: 115,
  roof_pitch: 10,
}

describe('controller calibration', () => {
  it('shows defaults and submits each changed calibration through the existing request callback', () => {
    const onChange = vi.fn()
    const onRun = vi.fn()
    render(
      <ControllerPanel
        value={request}
        loading={false}
        onChange={onChange}
        onRun={onRun}
      />
    )
    const glare = screen.getByRole('slider', {
      name: 'Direct-sun screening limit',
    })
    const glazing = screen.getByRole('slider', { name: 'Glazing SHGC' })
    const speed = screen.getByRole('slider', { name: 'Actuator speed limit' })
    expect(glare).toHaveValue('25')
    expect(glazing).toHaveValue('0.4')
    expect(speed).toHaveValue('1.2')
    expect(glare).toHaveAttribute('max', '2000')
    expect(glazing).toHaveAttribute('max', '1')
    expect(speed).toHaveAttribute('min', '0.1')
    expect(speed).toHaveAttribute('max', '12')
    fireEvent.change(glare, { target: { value: '75' } })
    expect(onChange).toHaveBeenLastCalledWith({
      ...request,
      glare_limit_w_m2: 75,
    })
    fireEvent.change(glazing, { target: { value: '0.55' } })
    expect(onChange).toHaveBeenLastCalledWith({
      ...request,
      glazing_shgc: 0.55,
    })
    fireEvent.change(speed, { target: { value: '2.3' } })
    expect(onChange).toHaveBeenLastCalledWith({
      ...request,
      actuator_speed_deg_per_min: 2.3,
    })
    expect(onRun).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply settings and re-run' })
    )
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('preserves valid zero calibration values', () => {
    render(
      <ControllerPanel
        value={{ ...request, glare_limit_w_m2: 0, glazing_shgc: 0 }}
        loading={false}
        onChange={vi.fn()}
        onRun={vi.fn()}
      />
    )
    expect(
      screen.getByRole('slider', { name: 'Direct-sun screening limit' })
    ).toHaveValue('0')
    expect(screen.getByRole('slider', { name: 'Glazing SHGC' })).toHaveValue(
      '0'
    )
  })
})
