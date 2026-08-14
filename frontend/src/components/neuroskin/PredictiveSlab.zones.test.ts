import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import {
  claimStatus,
  DEFAULT_REQUEST,
  PlanControls,
  sampleNights,
  zoneGrid,
} from './PredictiveSlab'
import type { BaselineAudit, SlabZonePlan } from '@/lib/types'

const zone = (row: number, column: number): SlabZonePlan => ({
  zone: `W${row * 4 + column + 1}`,
  row,
  column,
  forecast_gain_wh: 500,
  charge_target_wh: 300,
  delivered_wh: 300,
  baseline_delivered_wh: 560,
  charge_hours: [0, 1, 2],
  min_slab_temp: 21,
  predictive_kwh: 60,
  baseline_kwh: 75,
  unmet_hours: 0,
  baseline_unmet_hours: 0,
  floor_hours: 0,
  baseline_floor_hours: 2,
})

const audit = (over: Partial<BaselineAudit>): BaselineAudit => ({
  verdict: 'not_supplied',
  nights: 0,
  charge_variation: null,
  correlation: null,
  claim_allowed: false,
  note: '',
  ...over,
})

describe('slab zone grid', () => {
  it('draws the top row of the facade first and the left column first', () => {
    // Deliberately unsorted, the way a JSON payload may arrive.
    const zones = [zone(0, 3), zone(3, 0), zone(0, 0), zone(3, 3)]
    for (let row = 0; row < 4; row += 1)
      for (let column = 0; column < 4; column += 1)
        if (!zones.some((item) => item.row === row && item.column === column))
          zones.push(zone(row, column))

    const grid = zoneGrid(zones)
    expect(grid).toHaveLength(4)
    expect(grid[0][0].row).toBe(3)
    expect(grid[3][0].row).toBe(0)
    expect(grid[0].map((item) => item.column)).toEqual([0, 1, 2, 3])
  })

  it('survives an empty plan', () => {
    expect(zoneGrid([])).toEqual([])
  })
})

describe('baseline claim gate', () => {
  it('only calls the saving claimable once the audit says so', () => {
    expect(claimStatus(audit({})).tone).toBe('warn')
    expect(
      claimStatus(audit({ verdict: 'load_compensated', nights: 14 })).tone
    ).toBe('bad')
    const passed = claimStatus(
      audit({ verdict: 'fixed_schedule', nights: 14, claim_allowed: true })
    )
    expect(passed.tone).toBe('ok')
    expect(passed.headline).toContain('14 nights')
  })
})

describe('sample incumbent logs', () => {
  it('makes a flat log flat and a compensated log track next-day cooling', () => {
    const fixed = sampleNights('fixed').map((night) => night.charge_kwh)
    const spread = (Math.max(...fixed) - Math.min(...fixed)) / fixed[0]
    expect(spread).toBeLessThan(0.05)

    const compensated = sampleNights('compensated')
    const sorted = [...compensated].sort(
      (left, right) => left.next_day_cooling_kwh - right.next_day_cooling_kwh
    )
    expect(sorted[0].charge_kwh).toBeLessThan(
      sorted[sorted.length - 1].charge_kwh
    )
  })
})

describe('slab operator controls', () => {
  it('edits a draft without running until the operator generates a plan', () => {
    const changes: string[] = []
    let runs = 0
    render(
      createElement(PlanControls, {
        value: DEFAULT_REQUEST,
        loading: false,
        onChange: (request) => changes.push(request.date ?? ''),
        onRun: () => (runs += 1),
        onSample: () => undefined,
      })
    )

    fireEvent.change(screen.getByLabelText('Day to charge for'), {
      target: { value: '2026-08-15' },
    })
    expect(changes).toEqual(['2026-08-15'])
    expect(runs).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Generate plan' }))
    expect(runs).toBe(1)
  })
})
