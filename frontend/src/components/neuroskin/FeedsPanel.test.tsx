import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeedsPanel } from './FeedsPanel'

afterEach(() => vi.unstubAllGlobals())

describe('feed observations', () => {
  it('shows an unconfigured feed without presenting an error', async () => {
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
    expect(
      await screen.findByText('not configured · last success unknown')
    ).toBeInTheDocument()
    expect(screen.getByText('2026-09-13T04:04:00Z')).toBeInTheDocument()
    expect(screen.getByText('Vision sample: 95s ago')).toHaveClass(
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
      await within(panel).findAllByText('unknown · last success unknown')
    ).toHaveLength(3)
    expect(screen.getByText('Vision sample: unknown')).toBeInTheDocument()
  })
})
