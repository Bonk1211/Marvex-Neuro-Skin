import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SimulationRunResponse, WeatherContextPayload } from '@/lib/types'
import { ProvenanceStrip } from './ProvenanceStrip'

const metadata: SimulationRunResponse['metadata'] = {
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
}
const weather: WeatherContextPayload = {
  status: 'applied',
  provider: 'Open-Meteo',
  dataset: 'forecast',
  source_url: 'https://api.open-meteo.com/v1/forecast',
  fetched_at: '2026-09-13T04:04:00Z',
  location_id: 'site',
  location_name: 'Diamond Building',
  forecast_date: '2026-09-13',
  min_temp: null,
  max_temp: null,
  morning_forecast: null,
  afternoon_forecast: null,
  night_forecast: null,
  summary_forecast: null,
  summary_when: null,
  warnings: [],
  fallback_reason: null,
}

describe('run provenance', () => {
  it('names an applied provider, dataset and fetch time in the run timezone', () => {
    render(
      <ProvenanceStrip
        metadata={{
          ...metadata,
          environment_source: 'open_meteo',
          weather_context: weather,
        }}
        visionAgeSeconds={null}
      />
    )
    expect(screen.getByText('Open-Meteo · forecast')).toBeInTheDocument()
    expect(
      screen.getByText('Fetched 12:04 (Asia/Kuala_Lumpur)')
    ).toBeInTheDocument()
    expect(screen.getByText(metadata.load_unit)).toBeInTheDocument()
    expect(screen.getByText(metadata.data_notice)).toBeInTheDocument()
  })
  it('makes fallback amber and preserves the complete notice and reason', () => {
    const notice =
      'Open-Meteo data was requested but unavailable; the run fell back to a fully synthetic tropical day.'
    const { container } = render(
      <ProvenanceStrip
        metadata={{
          ...metadata,
          data_notice: notice,
          weather_context: {
            ...weather,
            status: 'fallback',
            fallback_reason: 'timeout',
          },
        }}
        visionAgeSeconds={95}
      />
    )
    expect(
      screen.getByText('Fallback · Open-Meteo · forecast')
    ).toBeInTheDocument()
    expect(screen.getByText('timeout')).toBeInTheDocument()
    expect(screen.getByText(notice)).toBeInTheDocument()
    expect(container.querySelector('.provenance-dot-warn')).toBeInTheDocument()
    expect(screen.getByText('sky sample 95s ago')).toHaveClass('text-amber-700')
  })
  it('discloses a pure synthetic run and seed without inventing a fetch time', () => {
    render(<ProvenanceStrip metadata={metadata} visionAgeSeconds={null} />)
    expect(screen.getByText('Synthetic')).toBeInTheDocument()
    expect(screen.getByText('Synthetic inputs · seed 42')).toBeInTheDocument()
    expect(screen.getByText(metadata.data_notice)).toBeInTheDocument()
    expect(
      screen.queryByText(/Fetched|Attempted|Open-Meteo/)
    ).not.toBeInTheDocument()
  })
})
