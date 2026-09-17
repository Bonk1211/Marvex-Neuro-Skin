import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeedsPanel } from './FeedsPanel'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('feed observations', () => {
  it('shows an unconfigured feed without presenting an error', async () => {
    vi.setSystemTime(new Date('2026-09-13T04:06:00Z'))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'ok',
          service: 'neuroskin-api',
          model: 'deterministic',
          dependencies: {
            roboflow: {
              configured: false,
              last_status: 'unknown',
              last_success_at: null,
            },
            open_meteo: {
              configured: true,
              last_status: 'applied',
              last_success_at: '2026-09-13T04:04:00Z',
            },
            met_malaysia: {
              configured: true,
              last_status: 'fallback',
              last_success_at: null,
            },
          },
        }),
      })
    )
    render(<FeedsPanel visionAgeSeconds={95} />)
    expect(await screen.findByText('not configured')).toHaveClass(
      'bg-secondary'
    )
    expect(screen.getByText('fallback')).toHaveClass('text-amber-800')
    expect(
      screen.getByText('Provider weather · last success 2m ago')
    ).toBeVisible()
    const timestamp = screen.getByText('2026-09-13T04:04:00Z')
    expect(timestamp).not.toBeVisible()
    fireEvent.click(screen.getByText('Open-Meteo'))
    expect(timestamp).toBeVisible()
    expect(screen.getByText('Sky sample stale · 95s ago')).toHaveClass(
      'text-amber-700'
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('keeps every feed unknown when the health request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    )
    render(<FeedsPanel visionAgeSeconds={null} />)
    const panel = screen.getByRole('region', { name: 'Upstream feeds' })
    expect(
      await within(panel).findAllByText('unknown', { exact: true })
    ).toHaveLength(3)
    expect(screen.getByText('Sky sample unavailable')).toBeVisible()
  })
  it('preserves the precise vision expiry and treats invalid ages as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Offline')))
    const { rerender } = render(<FeedsPanel visionAgeSeconds={60} />)
    expect(screen.getByText('Sky sample · 60s ago')).not.toHaveClass(
      'text-amber-700'
    )
    rerender(<FeedsPanel visionAgeSeconds={60.1} />)
    expect(screen.getByText('Sky sample stale · 60s ago')).toHaveClass(
      'text-amber-700'
    )
    rerender(<FeedsPanel visionAgeSeconds={NaN} />)
    expect(await screen.findByText('Sky sample unavailable')).toBeVisible()
  })
})
