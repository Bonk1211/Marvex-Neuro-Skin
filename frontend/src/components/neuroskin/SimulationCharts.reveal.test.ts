import { describe, expect, it } from 'vitest'
import { revealUpTo } from './SimulationCharts'
import type { TickPayload } from '@/lib/types'

const tick = (hour: number, ghi: number) =>
  ({
    timestamp: `2026-03-21T${String(hour).padStart(2, '0')}:00:00+08:00`,
    ghi,
    angle_final: 30,
    mode: 'NORMAL',
    sensor_trusted: true,
  }) as unknown as TickPayload

const day = [tick(9, 300), tick(12, 900), tick(17, 200)]

describe('chart playhead', () => {
  it('blanks the numbers past the cursor while the clock runs', () => {
    const rows = revealUpTo(day, 1, true)

    expect(rows).toHaveLength(day.length)
    expect(rows[1].ghi).toBe(900)
    expect(rows[2].ghi).toBeNull()
    // The slot and its label survive, so the axis does not move.
    expect(rows[2].time).toBeTruthy()
    expect(rows[2].mode).toBe('NORMAL')
  })

  it('shows the whole day when the clock is paused', () => {
    expect(revealUpTo(day, 1, false).map((row) => row.ghi)).toEqual([
      300, 900, 200,
    ])
  })

  it('shows the whole day when there is no cursor', () => {
    expect(revealUpTo(day, undefined, true).map((row) => row.ghi)).toEqual([
      300, 900, 200,
    ])
  })
})
