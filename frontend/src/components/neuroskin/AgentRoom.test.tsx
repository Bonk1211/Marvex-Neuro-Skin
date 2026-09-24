import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TickPayload } from '@/lib/types'
import { setHardwareControl } from '@/lib/api-client'
import { AgentRoom } from './AgentRoom'

vi.mock('@/lib/api-client', () => ({
  setHardwareControl: vi.fn().mockResolvedValue({
    online: true,
    panels: {
      bh1: { zone: 'W13', commanded_angle: 45 },
      bh2: { zone: 'W14', commanded_angle: 45 },
      bh3: { zone: 'W9', commanded_angle: 30 },
      bh4: { zone: 'W10', commanded_angle: 0 },
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

  it('holds the retreat on the rig, then closes instead of looping', async () => {
    vi.useFakeTimers()
    render(room())

    // The agreed angles go to the bridge as a wind hold, by zone.
    expect(pushed).toHaveBeenCalledWith({
      mode: 'wind',
      angles: { W13: 0, W14: 0, W9: 0, W10: 0 },
      refresh_only: false,
    })

    await until('The retreat is on the rig')
    // The travel each blade has to make is on the record, so a rig that does not
    // move reads as "already there" rather than as a broken demo.
    await until('W13 45° → 0°')
    await until('Conversation closed · the facade has retreated')
    const transcript = thread().textContent

    // Time keeps passing; the channel does not start over.
    await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)))
    expect(thread().textContent).toBe(transcript)
    expect(
      screen.getByRole('button', { name: 'Replay the conversation' })
    ).toBeInTheDocument()
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
  })

  it('posts an operator note into the thread without sending it anywhere', () => {
    vi.useFakeTimers()
    render(room())

    fireEvent.change(screen.getByLabelText('Message #wind-response'), {
      target: { value: 'Hold the west wall flat until the squall passes.' },
    })
    fireEvent.click(screen.getByLabelText('Post note'))
    expect(thread()).toHaveTextContent('Operator (you)')
  })

  it('runs the routine stand-up channel when no wind is pressing on the facade', () => {
    vi.useFakeTimers()
    render(room({ tick: tick(3, 'NORMAL') }))

    expect(screen.getByText('#daylight-standup')).toBeInTheDocument()
    expect(screen.queryByText('#wind-response')).not.toBeInTheDocument()
  })
})
