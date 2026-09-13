import { readFileSync } from 'node:fs'
import evidence from '@/lib/daylight-blindness-results.json'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type {
  DaylightProbePayload,
  DaylightStatusPayload,
  TickPayload,
} from '@/lib/types'
import { createBandPlan } from './bandPlan'
import { DaylightReadout, GlareBlindnessPanel } from './DaylightPanel'
import { FloorPanel } from './FloorPanel'

const status: DaylightStatusPayload = {
  model: 'extra trees',
  night: false,
  occupied: true,
  ev_cap_lux: 1000,
  et_band_low_lux: 300,
  et_band_high_lux: 500,
}
const probe: DaylightProbePayload = {
  index: 0,
  kind: 'seat',
  eye_illuminance: 1840,
  task_illuminance: 412,
}

describe('occupant-plane daylight', () => {
  it('flags actual lux, hides missing probes and distinguishes night from zero', () => {
    const { rerender } = render(
      <DaylightReadout probes={[probe]} status={status} />
    )
    expect(
      screen.getByText('1 of 1 seats over the 1000 lux eye-illuminance cap')
    ).toBeInTheDocument()
    expect(screen.getByText(/Ev 1840.0 lux · over cap/)).toBeInTheDocument()
    rerender(
      <DaylightReadout
        probes={[{ ...probe, eye_illuminance: null }]}
        status={status}
      />
    )
    expect(screen.queryByText(/seat 1 · Ev/)).not.toBeInTheDocument()
    rerender(
      <DaylightReadout
        probes={[{ ...probe, eye_illuminance: null }]}
        status={{ ...status, night: true }}
      />
    )
    expect(
      screen.getByText(/seats grey; illuminance unavailable/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/0.0 lux/)).not.toBeInTheDocument()
    rerender(
      <FloorPanel
        tick={{ facade: [] } as unknown as TickPayload}
        floors={7}
        focusedBand={null}
        orientation='west'
        onSideChange={() => {}}
        onBandChange={() => {}}
        selectedZone={null}
        onSelectZone={() => {}}
        controlled
      />
    )
    expect(screen.getByText('Daylight model not loaded for this run.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Daylight at occupied seats')).not.toBeInTheDocument()
  })

  it('registers the real meshes including rotated desk chairs and restores their materials', () => {
    const plan = createBandPlan(new Map(), 2)
    expect(plan.group.name).toBe(
      'Illustrative office interior — not measured drawings'
    )
    for (const level of plan.levels) {
      expect(level.probes.some((p) => p.kind === 'seat')).toBe(true)
      expect(
        level.probes.every(
          (p) =>
            Number.isFinite(p.rotation) &&
            Math.abs(p.x) < 3.2 &&
            Math.abs(p.z) < 3.2
        )
      ).toBe(true)
      expect(new Set(level.probes.map((p) => p.index)).size).toBe(
        level.probes.length
      )
    }
    const boardroom = plan.levels.find(
      (l) => l.orientation === 'north' && l.band === 0
    )!
    const desk = boardroom.probes.find((p) => p.kind === 'desk')!
    expect(desk.x).toBeCloseTo(
      -1.56 + Math.cos(-0.15) * -0.49 + Math.sin(-0.15) * -0.24
    )
    const chair = boardroom.probes.find((p) => p.index === desk.index + 1)!
    expect(chair.kind).toBe('seat')
    expect(chair.x - desk.x).toBeCloseTo(Math.sin(desk.rotation) * 0.47)
    expect(chair.z - desk.z).toBeCloseTo(Math.cos(desk.rotation) * 0.47)
    const mesh = boardroom.probes[0].mesh
    const original = mesh.material
    const tick = {
      daylight: status,
      facade: [
        {
          orientation: 'north',
          zones: [{ row: 0, conditions: { daylight_probes: [probe] } }],
        },
      ],
    } as TickPayload
    plan.update(0, 'north', new Set(), false, true, tick)
    expect(mesh.material).not.toBe(original)
    expect((mesh.material as THREE.MeshStandardMaterial).color.getStyle()).toBe(
      'rgb(171,43,43)'
    )
    const night = { ...tick, daylight: { ...status, night: true } }
    plan.update(0, 'north', new Set(), false, true, night)
    expect(
      (mesh.material as THREE.MeshStandardMaterial).color.getHexString()
    ).toBe('a8b0ad')
    plan.update(0, 'north', new Set(), false, true)
    expect(mesh.material).toBe(original)
    plan.dispose()
  })

  it('renders the oracle evidence with its fixed experiment scope', () => {
    expect(evidence).toEqual(
      JSON.parse(
        readFileSync('../docs/appendix/daylight-blindness-results.json', 'utf8')
      )
    )
    render(<GlareBlindnessPanel />)
    expect(screen.getByText('95.04%')).toBeInTheDocument()
    expect(screen.getByText('94.15%')).toBeInTheDocument()
    expect(screen.getByText(/12 seeded days/)).toBeInTheDocument()
    expect(
      screen.getByText(/independent of the current timeline/)
    ).toBeInTheDocument()
  })
})
