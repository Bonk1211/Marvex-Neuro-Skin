import { describe, expect, it } from 'vitest'
import type { TickPayload } from '@/lib/types'
import {
  baselineSurfaceTemperature,
  BUILDING_VARIANTS,
  surfaceIrradianceComparison,
} from './buildingComparison'

function fixture(seed = 42): TickPayload {
  return {
    timestamp: '2026-09-06T16:00:00+08:00',
    ghi: 850,
    expected_ghi: 850,
    solar_azimuth: 270,
    solar_elevation: 30,
    measured_irradiance: 850,
    cloud: 0.1,
    outdoor_temp: 31,
    occupancy: 1,
    wind: 3,
    rain: false,
    load_relative: 0.4,
    naive_load_relative: 0.5,
    latent_load: 0.2,
    lux: 450,
    naive_lux: 900,
    angle_target: 35,
    angle_final: 30,
    naive_angle: 60,
    mode: 'NORMAL',
    moved: true,
    sensor_trusted: true,
    reason: '',
    cost_breakdown: { thermal: 0.2, lux: 0, movement: 0.01, risk: 0.01 },
    facade: [
      {
        orientation: 'west',
        azimuth: 270,
        incident: 900,
        transmitted: 600,
        sky_diffuse: 80,
        ground_diffuse: 20,
        sol_air_temp: 50,
        angle: 30,
        mode: 'NORMAL',
        moved: true,
        lux: 450,
        load_relative: 0.4,
        reason: '',
        primary: true,
        zones: Array.from({ length: 16 }, (_, index) => {
          const incident = 200 + ((seed * 13 + index * 17) % 500)
          return {
            row: Math.floor(index / 4),
            column: index % 4,
            zone: `W${index + 1}`,
            incident,
            transmitted: incident * (0.2 + index * 0.01),
            sunlit_fraction: 0.75,
            sol_air_temp: 40,
            angle: 0,
            mode: 'HOLD',
            moved: false,
            lux: 400,
            load_relative: 0.4,
          }
        }),
      },
    ],
    roof: [
      {
        quadrant: 'west',
        azimuth: 270,
        tilt: 10,
        incident: 710,
        sky_diffuse: 80,
        ground_diffuse: 20,
        sol_air_temp: 55,
      },
    ],
  }
}

describe('building comparison', () => {
  it('compares the same seeded zone with hardware removed, independently of actuator or naive state', () => {
    const tick = fixture()
    const untouched = structuredClone(tick)
    const zone = tick.facade[0].zones![1]
    const result = surfaceIrradianceComparison(tick, 'wall:west', 'W2')!
    expect(result.baseline).toBe(zone.incident)
    expect(result.controlled).toBe(zone.transmitted)
    expect(result.baseline).not.toBe(tick.facade[0].incident)
    expect(result.reduction).toBeCloseTo(79)
    expect(result.label).toBe('West · W2')
    expect(tick).toEqual(untouched)
    const alternate = fixture()
    alternate.facade[0].zones![1].angle = 60
    alternate.angle_final = 60
    alternate.naive_angle = 0
    alternate.naive_lux = 0
    expect(surfaceIrradianceComparison(alternate, 'wall:west', 'W2')).toEqual(
      result
    )
    alternate.facade[0].zones![1].transmitted /= 2
    expect(
      surfaceIrradianceComparison(alternate, 'wall:west', 'W2')!.baseline
    ).toBe(result.baseline)
  })

  it('uses an explicitly labelled unweighted zone mean and falls back when no zones exist', () => {
    const tick = fixture(7)
    const zones = tick.facade[0].zones!
    const result = surfaceIrradianceComparison(tick, 'wall:west', null)!
    expect(result.baseline).toBe(
      zones.reduce((sum, zone) => sum + zone.incident, 0) / 16
    )
    expect(result.controlled).toBe(
      zones.reduce((sum, zone) => sum + zone.transmitted, 0) / 16
    )
    expect(result.label).toBe('West · mean of 16 zones')
    tick.facade[0].zones = []
    const fallback = surfaceIrradianceComparison(tick, 'wall:west', null)!
    expect(fallback).toMatchObject({
      baseline: 900,
      controlled: 600,
      label: 'West',
    })
    expect(fallback.reduction).toBeCloseTo(100 / 3)
  })

  it('keeps the roof identical and returns no percentage for zero irradiance', () => {
    const tick = fixture()
    expect(surfaceIrradianceComparison(tick, 'roof:west', 'W2')).toEqual({
      controlled: 710,
      baseline: 710,
      label: 'West roof',
      reduction: 0,
    })
    tick.facade[0].zones!.forEach((zone) => {
      zone.incident = 0
      zone.transmitted = 0
    })
    expect(surfaceIrradianceComparison(tick, 'wall:west', null)).toEqual({
      controlled: 0,
      baseline: 0,
      label: 'West · mean of 16 zones',
      reduction: null,
    })
  })

  it('returns null for missing or invalid readings', () => {
    const tick = fixture()
    expect(surfaceIrradianceComparison(tick, 'wall:north', null)).toBeNull()
    expect(surfaceIrradianceComparison(tick, 'roof:north', null)).toBeNull()
    expect(surfaceIrradianceComparison(tick, 'wall:west', 'W99')).toBeNull()
    tick.facade[0].zones![0].incident = NaN
    expect(surfaceIrradianceComparison(tick, 'wall:west', null)).toBeNull()
  })

  it('preserves building labels and the same sol-air temperature constants', () => {
    expect(BUILDING_VARIANTS.baseline).toBe('Baseline — No External Facade')
    expect(BUILDING_VARIANTS.controlled).toBe('NeuroSkin — Controlled Facade')
    expect(baselineSurfaceTemperature(600, 30, 2)).toBeCloseTo(30 + 360 / 13.3)
    expect(baselineSurfaceTemperature(600, 30, -2)).toBeCloseTo(30 + 360 / 5.7)
    expect(baselineSurfaceTemperature(0, 30, 2)).toBe(30)
  })
})
