import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TickPayload } from '@/lib/types'
import { setHardwareControl } from '@/lib/api-client'
import { AgentRoom } from './AgentRoom'

vi.mock('@/lib/api-client', () => ({
  setHardwareControl: vi.fn().mockResolvedValue({
    online: true,
    panels: {
      bh1: { zone: 'W13', commanded_angle: 15 },
      bh2: { zone: 'W14', commanded_angle: 30 },
      bh3: { zone: 'W9', commanded_angle: 45 },
      bh4: { zone: 'W10', commanded_angle: 60 },
    },
  }),
}))
const pushed = vi.mocked(setHardwareControl)

const AZIMUTH: Record<string, number> = {
  north: 0,
  east: 90,
  south: 180,
  west: 270,
}

const SITE = {
  latitude: 2.922,
  longitude: 101.6885,
  name: 'ST Diamond Building',
}

function tick(wind: number, mode: string): TickPayload {
  return {
    timestamp: '2026-03-21T13:40:00+08:00',
    wind,
    wind_direction: 292,
    mode,
    angle_final: mode === 'SAFE' ? 0 : 24,
    facade: ['north', 'east', 'south', 'west'].map((orientation) => ({
      orientation,
      azimuth: AZIMUTH[orientation],
      zones: Array.from({ length: 16 }, (_, index) => ({
        row: Math.floor(index / 4),
        column: index % 4,
        zone: `${orientation[0].toUpperCase()}${index + 1}`,
        angle: mode === 'SAFE' ? 0 : 45,
        lux: 420,
        mode,
      })),
    })),
  } as unknown as TickPayload
}

const thread = () => screen.getByLabelText('Channel messages')

/** The room is controlled: its parent opens it when a ticket is accepted. */
const room = (props: Partial<Parameters<typeof AgentRoom>[0]> = {}) => (
  <AgentRoom
    tick={tick(18, 'SAFE')}
    floors={7}
    onSelectZone={() => {}}
    open
    onOpen={() => {}}
    onClose={() => {}}
    {...props}
  />
)

/** Messages stream a character at a time, so run the clock until one lands. */
async function until(text: string, budget = 300_000) {
  for (let spent = 0; spent < budget; spent += 500) {
    if (thread().textContent?.includes(text)) return
    await act(async () => void (await vi.advanceTimersByTimeAsync(500)))
  }
  expect(thread()).toHaveTextContent(text)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  pushed.mockClear()
})

describe('AgentRoom', () => {
  it('stays quiet until its parent opens the channel', () => {
    vi.useFakeTimers()
    const onOpen = vi.fn()
    render(room({ tick: tick(3, 'NORMAL'), open: false, onOpen }))

    // Nothing has been said, and time passing does not start the conversation.
    expect(screen.queryByLabelText('Channel messages')).not.toBeInTheDocument()
    expect(screen.getByText(/No one is in the channel/)).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(9000))
    expect(screen.queryByLabelText('Channel messages')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /routine stand-up/ }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('shows its working, then streams each loaded bay into the channel', async () => {
    vi.useFakeTimers()
    render(room())

    // The chair shows its working before a word of the answer is written.
    expect(screen.getByLabelText('Working')).toHaveTextContent(
      'Scanning all four walls for wind load'
    )
    expect(thread()).not.toHaveTextContent('Pulling in the 4 bays')
    await until('Pulling in the 4 bays')

    for (const zone of ['W13', 'W14', 'W9', 'W10']) {
      await until(`${zone} zone agent joined #wind-response`)
      await until('Pa pressing on my panel')
      await until(`${zone}-load.json`)
    }
    await until('Safety rule confirmed')
    // Every message stays on the thread, the way a chat keeps its history.
    expect(thread()).toHaveTextContent('W13 zone agent joined')
  })

  it('stages different angles, retreats only at the finale, and stages again on replay', async () => {
    vi.useFakeTimers()
    render(room())

    const start = { W13: 15, W14: 30, W9: 45, W10: 60 }
    const flat = { W13: 0, W14: 0, W9: 0, W10: 0 }
    expect(pushed).toHaveBeenCalledWith({
      mode: 'wind',
      angles: start,
      refresh_only: false,
    })

    await until('Safety rule confirmed')
    expect(
      pushed.mock.calls.every(
        ([control]) =>
          'angles' in control &&
          JSON.stringify(control.angles) === JSON.stringify(start)
      )
    ).toBe(true)
    expect(thread()).toHaveTextContent('W13 15°, W14 30°, W9 45°, W10 60°')

    await until('The retreat is on the rig')
    expect(pushed).toHaveBeenCalledWith({
      mode: 'wind',
      angles: flat,
      refresh_only: false,
    })
    await until('W13 15° → 0°')
    await until('W10 60° → 0°')
    await until('Conversation closed · the facade has retreated')
    const transcript = thread().textContent

    // A keepalive reports the arrived pose but must preserve the original travel.
    pushed.mockResolvedValueOnce({
      online: true,
      panels: Object.fromEntries(
        Object.keys(start).map((zone, i) => [
          `bh${i + 1}`,
          { zone, commanded_angle: 0 },
        ])
      ),
    } as Awaited<ReturnType<typeof setHardwareControl>>)
    await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)))
    expect(thread().textContent).toBe(transcript)
    expect(pushed).toHaveBeenLastCalledWith({
      mode: 'wind',
      angles: flat,
      refresh_only: true,
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Replay the conversation' })
    )
    expect(pushed).toHaveBeenLastCalledWith({
      mode: 'wind',
      angles: start,
      refresh_only: false,
    })
    await until('Conversation closed · the facade has retreated')
    expect(
      pushed.mock.calls.filter(
        ([control]) =>
          'angles' in control &&
          !control.refresh_only &&
          Object.values(control.angles).every((angle) => angle === 0)
      )
    ).toHaveLength(2)
  })

  it('waits for the gust before starting the demo and keeps other walls off the rig', async () => {
    vi.useFakeTimers()
    const calm = tick(3, 'NORMAL')
    const { rerender } = render(room({ tick: calm, waiting: true }))
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)))
    expect(pushed).not.toHaveBeenCalled()

    rerender(room())
    expect(screen.getByLabelText('Working')).toHaveTextContent(
      'Scanning all four walls'
    )
    expect(pushed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        angles: { W13: 15, W14: 30, W9: 45, W10: 60 },
      })
    )

    pushed.mockClear()
    rerender(room({ tick: { ...tick(18, 'SAFE'), wind_direction: 112 } }))
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)))
    expect(pushed).not.toHaveBeenCalled()
  })

  it('reads the live weather feed and maps the site before the bays report', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        current: {
          time: '2026-09-24T10:45',
          temperature_2m: 31.2,
          wind_speed_10m: 3.4,
          wind_direction_10m: 250,
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(room({ site: SITE }))

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://api.open-meteo.com/v1/forecast?latitude=2.922'
      ),
      expect.anything()
    )
    await until('3.4 m/s from 250° WSW')
    // The measured sky and the drill are told apart, not blended.
    await until('18.0 m/s from 292° WNW')
    // The tool card and the map land once the agent has finished writing.
    await until('GET api.open-meteo.com/v1/forecast')
    expect(screen.getByTitle('Map of ST Diamond Building')).toBeInTheDocument()
    expect(screen.getByLabelText('Tool call')).toHaveTextContent(
      '31.2 °C · 2026-09-24T10:45'
    )
    await until('Safety rule confirmed')
    expect(pushed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        angles: { W13: 15, W14: 30, W9: 45, W10: 60 },
      })
    )
    await until('Conversation closed · the facade has retreated')
    expect(pushed).toHaveBeenCalledWith({
      mode: 'wind',
      angles: { W13: 0, W14: 0, W9: 0, W10: 0 },
      refresh_only: false,
    })
  })

  it('posts an operator note into the thread without sending it anywhere', async () => {
    vi.useFakeTimers()
    render(room())

    fireEvent.change(screen.getByLabelText('Message #wind-response'), {
      target: { value: 'Hold the west wall flat until the squall passes.' },
    })
    fireEvent.click(screen.getByLabelText('Post note'))
    await act(async () => {})
    expect(thread()).toHaveTextContent('Operator (you)')
  })

  it('runs the routine stand-up channel when no wind is pressing on the facade', () => {
    vi.useFakeTimers()
    render(room({ tick: tick(3, 'NORMAL') }))

    expect(screen.getByText('#daylight-standup')).toBeInTheDocument()
    expect(screen.queryByText('#wind-response')).not.toBeInTheDocument()
  })
})
