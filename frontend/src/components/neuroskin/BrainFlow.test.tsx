import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TickPayload } from '@/lib/types'
import { BrainFlow } from './BrainFlow'

const AZIMUTH: Record<string, number> = {
  north: 0,
  east: 90,
  south: 180,
  west: 270,
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
      primary: orientation === 'west',
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

afterEach(() => vi.useRealTimers())

describe('BrainFlow ticket notification', () => {
  it('raises the ticket outside the channel, with the channel still empty', () => {
    render(<BrainFlow tick={tick(3, 'NORMAL')} onSelectZone={() => {}} />)

    const alert = screen.getByLabelText('Emergency ticket')
    expect(alert).toHaveTextContent('INC-20260321-1340-W')
    expect(alert).toHaveTextContent('P1 · Emergency')
    expect(alert).toHaveTextContent('Strong wind on the west facade')
    // The chat next to it has not started.
    expect(screen.queryByLabelText('Channel messages')).not.toBeInTheDocument()
    expect(screen.getByText(/No one is in the channel/)).toBeInTheDocument()
  })

  it('accepts the ticket, asks for the gust and pins the ticket to the channel', () => {
    vi.useFakeTimers()
    const onSimulateWind = vi.fn()
    render(
      <BrainFlow
        tick={tick(3, 'NORMAL')}
        onSelectZone={() => {}}
        onSimulateWind={onSimulateWind}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Accept ticket/ }))
    expect(onSimulateWind).toHaveBeenCalledWith(18)
    // The card collapses to a pinned strip once the channel is open.
    expect(screen.queryByLabelText('Emergency ticket')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Ticket on this channel')).toHaveTextContent(
      'INC-20260321-1340-W'
    )
    expect(screen.getByText(/Waiting for the run/)).toBeInTheDocument()
  })

  it('opens the channel straight away when the wind is already on the wall', () => {
    vi.useFakeTimers()
    const onSimulateWind = vi.fn()
    render(
      <BrainFlow
        tick={tick(18, 'SAFE')}
        onSelectZone={() => {}}
        onSimulateWind={onSimulateWind}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Accept ticket/ }))
    expect(onSimulateWind).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Channel messages')).toBeInTheDocument()
  })

  it('dismisses the notification without opening anything', () => {
    render(<BrainFlow tick={tick(3, 'NORMAL')} onSelectZone={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss ticket' }))
    expect(screen.queryByLabelText('Emergency ticket')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Channel messages')).not.toBeInTheDocument()
  })
})
