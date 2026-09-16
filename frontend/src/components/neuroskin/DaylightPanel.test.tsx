import { readFileSync } from 'node:fs'
import evidence from '@/lib/daylight-blindness-results.json'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type {
  DaylightProbePayload,
  DaylightStatusPayload,
  TickPayload,
} from '@/lib/types'
import { createBandPlan } from './bandPlan'
import {
  DaylightReadout,
  GlareBlindnessPanel,
  daylightColor,
  daylightSummary,
} from './DaylightPanel'
import { FloorPanel } from './FloorPanel'
import { mockOccupancy, walkingPosition } from './floorOccupants'

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
  it('matches mock people to each side/floor count, seats them on probes and freezes repeated animation times', () => {
    const plan = createBandPlan(new Map(), 2)
    const ids = plan.levels.flatMap((level) =>
      level.people.map((person) => person.id)
    )
    expect(new Set(ids).size).toBe(ids.length)
    for (const side of ['north', 'east', 'south', 'west'] as const) {
      plan.update(null, side, new Set())
      plan.updatePeople(10, 0.8)
      for (const level of plan.levels) {
        const visible = level.people.filter((person) => person.group.visible)
        const counts = mockOccupancy(0.8, side, level.band)
        expect(visible).toHaveLength(
          level.orientation === side ? counts.total : 0
        )
        if (level.orientation !== side) continue
        expect(
          visible.filter((person) => person.group.userData.state === 'walking')
        ).toHaveLength(counts.walking)
        for (const person of visible.filter(
          (person) => person.group.userData.state === 'seated'
        )) {
          expect(person.group.position.x).toBe(person.seat.x)
          expect(person.group.position.z).toBe(person.seat.z)
          expect(person.group.rotation.y).toBe(person.seat.rotation)
        }
        const walker = visible[0]
        const position = walker.group.position.clone()
        plan.updatePeople(10, 0.8)
        expect(walker.group.position.equals(position)).toBe(true)
        plan.updatePeople(10.1, 0.8)
        expect(walker.group.position.distanceTo(position)).toBeCloseTo(0.022)
        plan.updatePeople(10, 0.8)
      }
    }
    plan.update(null, 'west', new Set())
    plan.updatePeople(20, 0.8, true, false, 1)
    expect(
      plan.levels
        .flatMap((level) => level.people)
        .filter((person) => person.group.visible)
        .every(
          (person) => person.group.userData.band === 1 && !person.marker.visible
        )
    ).toBe(true)
    for (const occupancy of [0, -1, Number.NaN]) {
      plan.updatePeople(20, occupancy)
      expect(
        plan.levels.some((level) =>
          level.people.some((person) => person.group.visible)
        )
      ).toBe(false)
    }
    for (let time = 0; time < 120; time += 0.5) {
      const point = walkingPosition(time, 0, 'north', 0)
      expect(Math.abs(point.x)).toBeLessThan(1.1)
      expect(Math.abs(point.z)).toBeLessThan(1.3)
      expect(Math.abs(point.x) > 0.85 || point.z > 1).toBe(true)
    }
    render(
      <FloorPanel
        tick={{ occupancy: 0.8, facade: [] } as unknown as TickPayload}
        floors={7}
        focusedBand={1}
        orientation='west'
        onSideChange={() => {}}
        onBandChange={() => {}}
        selectedZone={null}
        onSelectZone={() => {}}
        controlled
      />
    )
    const counts = mockOccupancy(0.8, 'west', 1)
    expect(screen.getByLabelText('Mock occupants')).toHaveTextContent(
      `${counts.total} people · ${counts.walking} walking · ${counts.seated} seated`
    )
    plan.dispose()
  })
  it('flags actual lux, hides missing probes and distinguishes night from zero', () => {
    expect(
      daylightSummary(
        [probe, { ...probe, task_illuminance: 0, eye_illuminance: null }],
        status
      )
    ).toEqual({ et: 206, ev: 1840 })
    expect(daylightSummary([probe], { ...status, night: true })).toEqual({
      et: null,
      ev: null,
    })
    expect(daylightSummary([probe])).toEqual({ et: null, ev: null })
    const { rerender } = render(
      <DaylightReadout probes={[probe]} status={status} />
    )
    expect(
      screen.getByText('1 of 1 seats over the 1000 lux eye-illuminance cap')
    ).toBeInTheDocument()
    expect(screen.getByText('Observe-only')).toBeVisible()
    expect(screen.getByText(/Ev 1840.0 lux · over cap/)).not.toBeVisible()
    fireEvent.click(screen.getByText('Seat and desk readings'))
    expect(screen.getByText(/Ev 1840.0 lux · over cap/)).toBeVisible()
    rerender(
      <DaylightReadout
        probes={[{ ...probe, eye_illuminance: null }]}
        status={status}
      />
    )
    expect(screen.queryByText(/seat 1 · Ev/)).not.toBeInTheDocument()
    expect(screen.getByText('Seat predictions unavailable')).toBeVisible()
    const invalid = { ...probe, task_illuminance: NaN, eye_illuminance: -1 }
    expect(daylightSummary([invalid], status)).toEqual({ et: null, ev: null })
    expect(daylightColor(invalid, status)).toBeNull()
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
    expect(
      screen.getByText('Daylight model not loaded for this run.')
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText('Daylight at occupied seats')
    ).not.toBeInTheDocument()
  })

  it('keeps side and floor summaries without a duplicate zone picker or expanded caveats', () => {
    const onSideChange = vi.fn()
    const onBandChange = vi.fn()
    const tick = {
      occupancy: 0.5,
      daylight: status,
      facade: [
        {
          orientation: 'west',
          zones: [
            {
              row: 1,
              column: 0,
              zone: 'W5',
              conditions: { daylight_probes: [probe] },
            },
          ],
        },
      ],
    } as unknown as TickPayload
    const props = {
      tick,
      floors: 7,
      focusedBand: 1,
      orientation: 'west' as const,
      onSideChange,
      onBandChange,
    }
    const { rerender } = render(<FloorPanel {...props} controlled />)
    const sides = screen.getByRole('group', { name: 'Floor plan side' })
    const west = within(sides).getByRole('button', { name: 'west floor plan' })
    expect(west).toHaveAttribute('aria-pressed', 'true')
    expect(west).toHaveTextContent('1/4 zones')
    expect(west).toHaveTextContent('Et 412 · Ev 1840 lux')
    expect(
      screen.queryByRole('list', { name: 'Side zones' })
    ).not.toBeInTheDocument()
    fireEvent.click(
      within(sides).getByRole('button', { name: 'north floor plan' })
    )
    expect(onSideChange).toHaveBeenCalledWith('north')
    fireEvent.click(screen.getByRole('button', { name: 'Floors 5–6' }))
    expect(onBandChange).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'Show all levels' }))
    expect(onBandChange).toHaveBeenCalledWith(null)
    expect(
      screen.getByText(/Rooms and HVAC are illustrative/)
    ).not.toBeVisible()
    fireEvent.click(screen.getByText('Scene & model assumptions'))
    expect(screen.getByText(/Rooms and HVAC are illustrative/)).toBeVisible()
    rerender(<FloorPanel {...props} controlled={false} />)
    expect(
      screen.queryByLabelText('Daylight at occupied seats')
    ).not.toBeInTheDocument()
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
    plan.update(0, 'north', new Set(), false, true, tick, {
      tick,
      mode: 'et',
      controlled: true,
    })
    expect(boardroom.probes[0].halo.visible).toBe(true)
    expect(boardroom.probes[0].halo.material.color.getHexString()).toBe(
      '43836c'
    )
    expect(
      (mesh.material as THREE.MeshStandardMaterial).color.getHexString()
    ).toBe('43836c')
    expect(boardroom.probes.filter((p) => p.halo.visible)).toHaveLength(1)
    plan.update(0, 'north', new Set(), false, true, tick, {
      tick,
      mode: 'ev',
      controlled: true,
    })
    expect(boardroom.probes[0].halo.material.color.getStyle()).toBe(
      'rgb(171,43,43)'
    )
    const ghost = plan.levels.find(
      (l) => l.orientation === 'north' && l.band === 1
    )!
    expect([...ghost.materials.keys()].every((mesh) => !mesh.castShadow)).toBe(
      true
    )
    expect(
      [...boardroom.materials.keys()].some((mesh) => mesh.castShadow)
    ).toBe(true)
    const night = { ...tick, daylight: { ...status, night: true } }
    plan.update(0, 'north', new Set(), false, true, night)
    expect(boardroom.probes.every((p) => !p.halo.visible)).toBe(true)
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
