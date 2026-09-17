import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SimulationRunResponse, WeatherContextPayload } from '@/lib/types'
import { ProvenanceStrip } from './ProvenanceStrip'
import { ModelLimitsPanel } from './ModelLimitsPanel'

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
    expect(screen.getByText('Provider weather')).toBeVisible()
    expect(screen.getByText('Sensors · simulated')).toBeVisible()
    expect(screen.getByText(metadata.load_unit)).toBeInTheDocument()
    expect(screen.getByText(metadata.data_notice)).not.toBeVisible()
    fireEvent.click(screen.getByText('Run evidence'))
    expect(
      screen.getByText(/Fetched 12:04 \(Asia\/Kuala_Lumpur\)/)
    ).toBeVisible()
    expect(screen.getByText(weather.fetched_at)).toHaveAttribute(
      'datetime',
      weather.fetched_at
    )
    expect(screen.getByText(metadata.data_notice)).toBeVisible()
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
    expect(screen.getByText('Synthetic weather · fallback')).toBeVisible()
    expect(screen.getByText('timeout')).not.toBeVisible()
    expect(container.querySelector('.provenance-dot-warn')).toBeInTheDocument()
    expect(screen.getByText('Sky sample stale · 95s ago')).toHaveClass(
      'text-amber-700'
    )
    fireEvent.click(screen.getByText('Run evidence'))
    expect(
      screen.getByText(/Attempted Open-Meteo · forecast at 12:04/)
    ).toBeVisible()
    expect(screen.getByText('timeout')).toBeVisible()
    expect(screen.getByText(notice)).toBeVisible()
  })
  it('discloses a pure synthetic run and seed without inventing a fetch time', () => {
    render(<ProvenanceStrip metadata={metadata} visionAgeSeconds={null} />)
    expect(screen.getByText('Synthetic weather')).toBeVisible()
    expect(screen.getByText('Sky sample unavailable')).toBeVisible()
    fireEvent.click(screen.getByText('Run evidence'))
    expect(screen.getByText('Synthetic inputs · seed 42')).toBeVisible()
    expect(screen.getByText(metadata.data_notice)).toBeVisible()
    expect(
      screen.queryByText(/Fetched|Attempted|Open-Meteo/)
    ).not.toBeInTheDocument()
  })
  it('labels MET anchoring as simulation and preserves exact vision expiry', () => {
    const metMetadata = {
      ...metadata,
      environment_source: 'met_anchored' as const,
      weather_context: { ...weather, provider: 'MET Malaysia', dataset: null },
    }
    const { rerender } = render(
      <ProvenanceStrip metadata={metMetadata} visionAgeSeconds={60} />
    )
    expect(screen.getByText('Provider-anchored simulation')).toBeVisible()
    expect(screen.getByText('Sky sample · 60s ago')).not.toHaveClass(
      'text-amber-700'
    )
    rerender(<ProvenanceStrip metadata={metMetadata} visionAgeSeconds={60.1} />)
    expect(screen.getByText('Sky sample stale · 60s ago')).toHaveClass(
      'text-amber-700'
    )
    rerender(
      <ProvenanceStrip metadata={metMetadata} visionAgeSeconds={Infinity} />
    )
    expect(screen.getByText('Sky sample unavailable')).toBeVisible()
  })
  it('keeps modelling caveats accessible in a collapsed disclosure', () => {
    render(<ModelLimitsPanel metadata={metadata} />)
    const caveat = screen.getByText(/Occupancy is one building-wide value/)
    expect(caveat).not.toBeVisible()
    fireEvent.click(
      screen.getByText('Simulated sensors · illustrative geometry')
    )
    expect(caveat).toBeVisible()
    expect(caveat).toHaveTextContent('not detected by the cloud camera')
    expect(caveat).toHaveTextContent('observe-only')
  })
})
