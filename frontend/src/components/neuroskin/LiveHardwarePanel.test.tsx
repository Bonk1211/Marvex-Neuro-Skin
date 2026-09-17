import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TickPayload } from '@/lib/types'
import { LiveHardwarePanel, twinAngles } from './LiveHardwarePanel'

const panel = (zone: string, overrides = {}) => ({
  zone,
  lux: 512,
  commanded_angle: 30,
  target_angle: 30,
  mode: 'auto',
  reason: 'holding',
  ...overrides,
})
const STATUS = {
  online: true,
  last_seen_s: 0.4,
  seq: 9,
  mode: 'auto',
  lux_band: [300, 700],
  panels: {
    bh1: panel('W13'),
    bh2: panel('W14'),
    bh3: panel('W9'),
    bh4: panel('W10', { lux: null, mode: 'fault' }),
  },
}
const TICK = {
  facade: [
    {
      orientation: 'west',
      zones: [
        { zone: 'W9', angle: 36 },
        { zone: 'W10', angle: 48 },
        { zone: 'W13', angle: 12 },
        { zone: 'W14', angle: 24 },
      ],
    },
  ],
} as unknown as TickPayload

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('live hardware bridge', () => {
  it('shows live readings and pushes the twin angles for the mapped zones', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () =>
        init?.method === 'POST' ? { ...STATUS, mode: 'twin' } : STATUS,
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<LiveHardwarePanel tick={TICK} />)

    expect(await screen.findByText('online · 0.4s')).toBeVisible()
    expect(screen.getByText('sensor fault · target 30.0°')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Mirror twin' }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')
      ).toBe(true)
    )
    const [url, init] = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'POST'
    )!
    expect(url).toContain('/api/v1/hardware/control')
    expect(JSON.parse(init!.body as string)).toEqual({
      mode: 'twin',
      angles: { W13: 12, W14: 24, W9: 36, W10: 48 },
    })
  })

  it('cannot mirror without twin zone angles and reports an unreachable backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<LiveHardwarePanel tick={null} />)
    expect(await screen.findByText('backend unreachable')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Mirror twin' })).toBeDisabled()
    expect(twinAngles(TICK, ['W13', 'W1'])).toBeNull()
  })

  it('treats a body without panels as unreachable instead of crashing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ticks: [] }) })
    )
    render(<LiveHardwarePanel tick={TICK} />)
    expect(await screen.findByText('backend unreachable')).toBeVisible()
  })
})
