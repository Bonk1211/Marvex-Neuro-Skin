import { expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import type { MeetingDemoResponse } from '@/lib/api-client'
import type { TickPayload } from '@/lib/types'
import { MeetingGlareDemo, meetingDemoTick } from './MeetingGlareDemo'
import { daylightColor } from './DaylightPanel'
import { createBandPlan } from './bandPlan'
import { MEETING_SEATS } from './floorOccupants'

export const DEMO: MeetingDemoResponse = {
  shaded: { angle: 0, beam: 0, diffuse: 9, probes: [] },
  glare: { angle: 0, beam: 60, diffuse: 9, probes: [] },
  balanced: { angle: 117, beam: 6, diffuse: 3, probes: [] },
  solar_azimuth: 270,
  solar_elevation: 20,
  ev_cap_lux: 1000,
  provenance: 'Modelled independent rooms',
}
for (const [name, light] of Object.entries(DEMO)) {
  if (typeof light !== 'object') continue
  light.probes = Array.from({ length: 20 }, (_, index) => ({
    index,
    kind: index === 8 ? 'desk' : 'seat',
    task_illuminance: name === 'glare' ? 2800 : 390,
    eye_illuminance: name === 'glare' ? 7300 : 900,
  }))
}
const TICK = {
  occupancy: 0,
  solar_azimuth: 0,
  solar_elevation: -10,
  facade: [
    {
      orientation: 'west',
      zones: Array.from({ length: 16 }, (_, index) => ({
        zone: `W${index + 1}`,
        row: Math.floor(index / 4),
        column: index % 4,
        angle: 60,
      })),
    },
  ],
} as TickPayload

it('seats the six people, lights only the meeting bay and adjusts exactly W13 without mutating the run', () => {
  const before = meetingDemoTick(TICK, DEMO, 'ready')
  const after = meetingDemoTick(TICK, DEMO, 'balanced')
  const zones = before.facade[0].zones!
  expect(
    zones
      .filter((z) => z.transmitted > z.diffuse_transmitted!)
      .map((z) => z.zone)
  ).toEqual(['W13'])
  expect(
    after.facade[0]
      .zones!.filter((z, i) => z.angle !== zones[i].angle)
      .map((z) => z.zone)
  ).toEqual(['W13'])
  expect(after.facade[0].zones!.filter((z) => z.zone !== 'W13')).toEqual(
    zones.filter((z) => z.zone !== 'W13')
  )
  expect(
    zones
      .find((z) => z.zone === 'W13')!
      .conditions!.daylight_probes!.map((p) => p.index)
  ).toEqual([0, 1, 2, 3])
  expect(
    zones
      .find((z) => z.zone === 'W16')!
      .conditions!.daylight_probes!.map((p) => p.index)
  ).toEqual([12, 13])
  expect(TICK.facade[0].zones!.every((z) => z.angle === 60)).toBe(true)
  const plan = createBandPlan(new Map(), 2)
  plan.update(3, 'west', new Set(), false, true, before, {
    tick: before,
    mode: 'sun',
    controlled: true,
  })
  plan.updatePeople(10, 0, true, true, 3, 'working', true)
  const level = plan.levels.find(
    (level) => level.orientation === 'west' && level.band === 3
  )!
  const people = level.people.filter((person) => person.group.visible)
  expect(people.map((p) => p.group.userData.seatIndex)).toEqual(MEETING_SEATS)
  expect(people.every((p) => p.group.userData.state === 'seated')).toBe(true)
  expect(level.meetingSun.visible).toBe(true)
  const opacity = level.meetingSun.material.opacity
  const windows = level.sunlight.group.children.filter(
    (_, index) => index % 5 === 2
  )
  expect(windows.map((window) => window.visible)).toEqual([
    true,
    false,
    false,
    false,
  ])
  const rays = level.sunlight.group.children[1] as import('three').LineSegments
  const path = rays.geometry.getAttribute('position')
  expect(path.getY(3)).toBeCloseTo(0.4275, 2)
  const entry = path.getY(2)
  const hit = path.getX(3)
  plan.update(3, 'west', new Set(), false, true, after, {
    tick: after,
    mode: 'sun',
    controlled: true,
  })
  expect(level.meetingSun.material.opacity).toBeLessThan(opacity)
  const shadedPath = rays.geometry.getAttribute('position')
  expect(shadedPath.getY(2)).toBeLessThan(entry)
  expect(Math.abs(shadedPath.getX(3) - hit)).toBeGreaterThan(0.1)
  expect(Math.abs(shadedPath.getX(3) - hit)).toBeLessThan(0.3)
  expect(daylightColor(DEMO.glare.probes[0], before.daylight!)).toBe('#c44a36')
  expect(daylightColor(DEMO.balanced.probes[0], after.daylight!)).toBe(
    '#43836c'
  )
  plan.updatePeople(11, 0, true, true, 3, 'auto', false)
  expect(level.people.every((person) => !person.group.visible)).toBe(true)
  plan.dispose()
})

it('shows both groups, the before/after prediction and repeat/reset controls', () => {
  const onStage = vi.fn()
  const { rerender } = render(
    <MeetingGlareDemo
      demo={DEMO}
      stage='ready'
      loading={false}
      error={null}
      onStart={() => {}}
      onStage={onStage}
      onExit={() => {}}
    />
  )
  expect(screen.getByLabelText('Meeting room comfort')).toHaveClass(
    'bg-amber-50'
  )
  expect(screen.getByLabelText('Meeting room comfort')).toHaveTextContent(
    'Ev 7300 lx · Et 2800 lx'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Simulate glare' }))
  expect(onStage).toHaveBeenLastCalledWith('glare')
  rerender(
    <MeetingGlareDemo
      demo={DEMO}
      stage='balanced'
      loading={false}
      error={null}
      onStart={() => {}}
      onStage={onStage}
      onExit={() => {}}
    />
  )
  expect(
    screen.getByText('Comfort restored · 15 other zones hold')
  ).toBeVisible()
  expect(screen.getByLabelText('Meeting room comfort')).toHaveClass(
    'bg-emerald-50'
  )
  expect(screen.getByLabelText('Meeting room comfort')).toHaveTextContent(
    'Ev 900 lx · Et 390 lx'
  )
  expect(screen.getByLabelText('Meeting room comfort')).toHaveTextContent(
    'Hardware 0° → 180°'
  )
  expect(screen.getByLabelText('Meeting room comfort')).toHaveTextContent(
    'Modelled façade 0° → 117°'
  )
  expect(screen.getByText('Seats 13–14 · cloud shade · W16')).toBeVisible()
  expect(screen.getByText(/Before: Ev 7300 lx/)).toBeVisible()
  expect(
    within(screen.getByLabelText('West 4 by 4 zone array')).getAllByText(
      /hold$/
    )
  ).toHaveLength(15)
  fireEvent.click(screen.getByRole('button', { name: 'Reset demo' }))
  expect(onStage).toHaveBeenLastCalledWith('ready')
})

it('smoothly moves the rays and table highlight with reported actuator travel, then holds and resets', () => {
  let now = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  const plan = createBandPlan(new Map(), 2)
  const level = plan.levels.find(
    (level) => level.orientation === 'west' && level.band === 3
  )!
  const rays = level.sunlight.group.children[1] as import('three').LineSegments
  const update = (tick: TickPayload) => {
    now += 16
    plan.update(3, 'west', new Set(), false, true, tick, {
      tick,
      mode: 'sun',
      controlled: true,
    })
    return rays.geometry.getAttribute('position').getX(3)
  }
  try {
    const initial = update(meetingDemoTick(TICK, DEMO, 'ready', 0))
    const half = meetingDemoTick(TICK, DEMO, 'glare', 90)
    const first = update(half)
    const second = update(half)
    expect(first).toBeLessThan(initial)
    expect(second).toBeLessThan(first)
    const patch = level.meetingSun.position.x
    for (let i = 0; i < 100; i++) update(half)
    expect(level.meetingSun.position.x).toBeLessThan(patch)
    const held = update(half)
    for (let i = 0; i < 100; i++) update(half)
    expect(update(half)).toBeCloseTo(held, 5)
    // Stage completion must keep smoothing on subsequent frames with the same tick.
    const final = meetingDemoTick(TICK, DEMO, 'balanced', 180)
    const near = update(final)
    const next = update(final)
    expect(next).not.toBe(near)
    for (let i = 0; i < 100; i++) update(final)
    expect(level.meetingSun.material.opacity).toBeLessThan(0.1)
    expect(update(meetingDemoTick(TICK, DEMO, 'ready', 0))).toBeCloseTo(
      initial,
      5
    )
    expect(level.sunlight.group.children[7].visible).toBe(false)
  } finally {
    plan.dispose()
    clock.mockRestore()
  }
})
