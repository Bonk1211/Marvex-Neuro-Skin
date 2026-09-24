import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TickPayload } from '@/lib/types'
import { LiveHardwarePanel, twinAngles } from './LiveHardwarePanel'
import DemoPage from '@/app/demo/page'

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
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('live hardware bridge', () => {
  it('automatically connects on Simulate glare and keeps the other three captured poses through refresh and reset', async () => {
    vi.useFakeTimers()
    let current = {
      ...STATUS,
      panels: {
        ...STATUS.panels,
        bh2: panel('W14', { commanded_angle: 17 }),
        bh3: panel('W9', { commanded_angle: 41 }),
        bh4: panel('W10', { commanded_angle: 55 }),
      },
    }
    const posts: { mode: string; angles?: Record<string, number> }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          const control = JSON.parse(String(init.body))
          posts.push(control)
          current = { ...current, mode: control.mode }
        }
        return { ok: true, json: async () => current }
      })
    )
    const tickAt = (angle: number, stage: TickPayload['meeting_demo']) => ({
      ...TICK,
      meeting_demo: stage,
      facade: TICK.facade.map((wall) => ({
        ...wall,
        zones: wall.zones?.map((zone) => ({
          ...zone,
          angle: zone.zone === 'W13' ? angle : 0,
        })),
      })),
    })
    const onAngle = vi.fn()
    const { rerender } = render(
      <LiveHardwarePanel
        tick={tickAt(0, 'ready')}
        meetingDemo
        onMeetingAngleChange={onAngle}
      />
    )
    await act(async () => {})
    expect(posts).toHaveLength(0)
    await act(async () => {
      rerender(
        <LiveHardwarePanel
          tick={tickAt(117, 'glare')}
          meetingDemo
          onMeetingAngleChange={onAngle}
        />
      )
    })
    expect(onAngle).toHaveBeenLastCalledWith(30)
    expect(posts.at(-1)?.angles).toEqual({ W13: 180, W14: 17, W9: 41, W10: 55 })
    current = {
      ...current,
      panels: { ...current.panels, bh1: panel('W13', { commanded_angle: 90 }) },
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(onAngle).toHaveBeenLastCalledWith(90)
    current = { ...current, online: false }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(onAngle).toHaveBeenLastCalledWith(null)
    current = { ...current, online: true }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(posts.at(-1)?.angles).toEqual({ W13: 180, W14: 17, W9: 41, W10: 55 })
    await act(async () => {
      rerender(<LiveHardwarePanel tick={tickAt(117, 'balanced')} meetingDemo />)
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(posts.at(-1)?.angles).toEqual({ W13: 180, W14: 17, W9: 41, W10: 55 })
    await act(async () => {
      rerender(<LiveHardwarePanel tick={tickAt(0, 'ready')} meetingDemo />)
    })
    expect(posts.at(-1)?.angles).toEqual({ W13: 0, W14: 17, W9: 41, W10: 55 })
    await act(async () => {
      rerender(<LiveHardwarePanel tick={TICK} />)
    })
    expect(posts.at(-1)).toEqual({ mode: 'auto' })
    const stopped = posts.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(posts).toHaveLength(stopped)
  })

  it('reports a disconnected rig instead of silently running only the animation', async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Partial<Response>>
    >(async () => ({
      ok: true,
      json: async () => ({ ...STATUS, online: false }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <LiveHardwarePanel
        tick={{ ...TICK, meeting_demo: 'glare' }}
        meetingDemo
      />
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Hardware did not connect'
    )
    expect(
      screen.getByRole('button', { name: '1 · Follow meeting demo' })
    ).toHaveAttribute('aria-pressed', 'false')
    expect(fetchMock.mock.calls.every((args) => !args[1]?.method)).toBe(true)
  })

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
    fireEvent.click(
      screen.getByRole('button', { name: '1 · Follow simulation' })
    )

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
    expect(
      screen.getByRole('button', { name: '1 · Follow simulation' })
    ).toBeDisabled()
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

  it('streams the displayed tick, refreshes paused angles, and stops immediately in sensor mode', async () => {
    vi.useFakeTimers()
    let current = { ...STATUS }
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        current = { ...current, mode: JSON.parse(String(init.body)).mode }
      return { ok: true, json: async () => current }
    })
    vi.stubGlobal('fetch', fetchMock)
    const onModeChange = vi.fn()
    const { rerender } = render(
      <LiveHardwarePanel tick={TICK} onModeChange={onModeChange} />
    )
    await act(async () => {})
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: '1 · Follow simulation' })
      )
    })
    expect(onModeChange).toHaveBeenLastCalledWith('twin')

    const nextTick = {
      ...TICK,
      facade: TICK.facade.map((wall) => ({
        ...wall,
        zones: wall.zones?.map((zone) => ({ ...zone, angle: zone.angle + 5 })),
      })),
    }
    const posts = () =>
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'POST')
        .map(([, init]) => JSON.parse(String(init?.body)))
    await act(async () => {
      rerender(
        <LiveHardwarePanel tick={nextTick} onModeChange={onModeChange} />
      )
    })
    expect(posts().at(-1)).toEqual({
      mode: 'twin',
      refresh_only: true,
      angles: { W13: 17, W14: 29, W9: 41, W10: 53 },
    })
    const beforeRefresh = posts().length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(posts()).toHaveLength(beforeRefresh + 1)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '2 · Sensor only' }))
    })
    const afterSwitch = posts().length
    await act(async () => {
      rerender(<LiveHardwarePanel tick={TICK} onModeChange={onModeChange} />)
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(posts()).toHaveLength(afterSwitch)
    expect(posts().at(-1)).toEqual({ mode: 'auto' })
    expect(onModeChange).toHaveBeenLastCalledWith('auto')
  })

  it('opens the standalone sensor demo without fetching a simulation or sending twin angles', async () => {
    let current = {
      ...STATUS,
      mode: 'twin',
      panels: { ...STATUS.panels, bh1: panel('W13', { lux: 900 }) },
    }
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        current = { ...current, mode: JSON.parse(String(init.body)).mode }
      return { ok: true, json: async () => current }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<DemoPage />)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '2 · Sensor only' })
      ).toHaveAttribute('aria-pressed', 'true')
    )
    expect(
      screen.queryByRole('button', { name: '1 · Follow simulation' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Demo 1 · open simulation →' })
    ).toHaveAttribute('href', '/dashboard')
    expect(
      screen.getByRole('region', { name: 'Corner-light demonstration' })
    ).toBeVisible()
    const rig = screen.getByRole('group', { name: 'Physical 2 by 2 rig' })
    expect(within(rig).getByLabelText('BH1 panel')).toHaveClass('bg-amber-50')
    expect(within(rig).getByLabelText('BH2 panel')).not.toHaveClass(
      'bg-amber-50'
    )
    expect(
      fetchMock.mock.calls.every(([url]) => url.includes('/hardware/'))
    ).toBe(true)
    expect(
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'POST')
        .map(([, init]) => JSON.parse(String(init?.body)))
    ).toEqual([{ mode: 'auto' }])
  })

  it('does not take over another page’s running simulation on mount', async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Partial<Response>>
    >(async () => ({
      ok: true,
      json: async () => ({ ...STATUS, mode: 'twin' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<LiveHardwarePanel tick={TICK} />)
    expect(
      await screen.findByText(/Simulation control is active in another view/)
    ).toBeVisible()
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')
    ).toBe(false)
  })
})
