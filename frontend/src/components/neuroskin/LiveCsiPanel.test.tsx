import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { HardwareStatus, LiveCsiReading } from '@/lib/api-client'
import { LiveCsiPanel } from './LiveCsiPanel'
import { createLiveCsiRoom } from './LiveCsiRoom'

const reading: LiveCsiReading = {
  enabled: true,
  uptime_ms: 20_000,
  window_ms: 500,
  frames: 25,
  ap: 'AA:BB:CC:DD:EE:FF',
  channel: 6,
  amplitude: 10,
  sigma: 2,
  rssi: -48,
  amplitudes: [8, 12, 9, 11],
  servos_moving: false,
  sample_id: 1000,
  frames_per_second: 50,
  state: 'motion',
  calibration_windows: 30,
  calibration_required: 30,
  baseline_sigma: 0.5,
  threshold: 1.5,
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('shows measured CSI, recalibrates, and removes live claims when packets or the board disappear', async () => {
  vi.useFakeTimers()
  let status = {
    online: true,
    last_seen_s: 0.1,
    panels: {},
    csi: null,
  } as unknown as HardwareStatus
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/csi/calibrate')) {
      status = {
        ...status,
        csi: {
          ...reading,
          state: 'calibrating',
          calibration_windows: 0,
          threshold: null,
        },
      }
    }
    return { ok: true, json: async () => status }
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<LiveCsiPanel />)
  await act(async () => {})
  expect(screen.getByText('CSI firmware needed')).toBeVisible()
  expect(screen.queryByText('LIVE MEASUREMENTS')).not.toBeInTheDocument()
  expect(
    screen.getByRole('img', { name: /Illustrative 3D room/ })
  ).toHaveAccessibleName(/No live CSI/)
  expect(screen.getByText(/3D room requires WebGL/)).toBeVisible()

  status = { ...status, csi: reading }
  await act(() => vi.advanceTimersByTimeAsync(500))
  expect(screen.getByRole('status')).toHaveTextContent('Signal motion detected')
  expect(screen.getByText('LIVE MEASUREMENTS')).toBeVisible()
  expect(screen.getByText('-48 dBm')).toBeVisible()
  expect(
    screen.getByRole('img', { name: /Illustrative 3D room/ })
  ).toHaveAccessibleName(/Measured signal motion/)
  expect(screen.getByText('1.33× motion threshold')).toBeVisible()
  expect(
    screen.getByRole('img', {
      name: 'Latest measured CSI amplitude across 4 bins',
    })
  ).toBeVisible()

  fireEvent.click(
    screen.getByRole('button', { name: 'Recalibrate empty room' })
  )
  await act(async () => {})
  expect(screen.getByRole('status')).toHaveTextContent('Calibrating empty room')
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0')
  expect(screen.queryByText('1.33× motion threshold')).not.toBeInTheDocument()
  expect(
    fetchMock.mock.calls.some(([url]) => url.endsWith('/csi/calibrate'))
  ).toBe(true)
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/control'))).toBe(
    false
  )

  status = {
    ...status,
    csi: {
      ...reading,
      sample_id: 1001,
      frames: 0,
      frames_per_second: 0,
      amplitude: null,
      sigma: null,
      rssi: null,
      amplitudes: [],
      state: 'no_signal',
    },
  }
  await act(() => vi.advanceTimersByTimeAsync(500))
  expect(screen.getByRole('status')).toHaveTextContent('No CSI packets')
  expect(screen.queryByText('LIVE MEASUREMENTS')).not.toBeInTheDocument()
  expect(screen.getByText('No current CSI packet')).toBeVisible()
  expect(
    screen.getByRole('img', { name: /Illustrative 3D room/ })
  ).toHaveAccessibleName(/signal waves are hidden/)

  status = { ...status, online: false, last_seen_s: 4, csi: reading }
  await act(() => vi.advanceTimersByTimeAsync(500))
  expect(screen.getByRole('status')).toHaveTextContent('offline')
  expect(screen.queryByText('Signal motion detected')).not.toBeInTheDocument()
  expect(screen.queryByText('-48 dBm')).not.toBeInTheDocument()
  expect(
    screen.getByRole('img', { name: /Illustrative 3D room/ })
  ).toHaveAccessibleName(/No live CSI/)
  expect(
    screen.getByRole('button', { name: 'Recalibrate empty room' })
  ).toBeDisabled()
})

it('drives the whole room from measured variation and clears activity during invalid windows', () => {
  const room = createLiveCsiRoom()
  const activity = room.scene.getObjectByName('room-activity') as THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshBasicMaterial
  >
  const waves = room.scene.getObjectByName('signal-waves') as THREE.Group
  try {
    expect(activity.visible).toBe(false)
    expect(waves.visible).toBe(false)
    room.update(reading, 0)
    expect(activity.visible).toBe(true)
    expect(activity.material.color.getHexString()).toBe('ffb65b')
    expect(waves.visible).toBe(true)
    const motionOpacity = activity.material.opacity
    const firstSize = waves.children[0].scale.x
    room.update(reading, 1)
    expect(waves.children[0].scale.x).toBeGreaterThan(firstSize)
    const pausedSize = waves.children[0].scale.x
    room.update({ ...reading, state: 'quiet', sigma: 0.3 }, 1)
    expect(waves.children[0].scale.x).toBe(pausedSize)
    expect(activity.material.color.getHexString()).toBe('5de6df')
    expect(activity.material.opacity).toBeLessThan(motionOpacity)

    for (const state of ['calibrating', 'low_rate', 'servos_moving'] as const) {
      room.update({ ...reading, state }, 1)
      expect(activity.visible).toBe(false)
      expect(waves.visible).toBe(true) // packets still arrive; no motion decision
    }
    for (const sample of [
      null,
      { ...reading, state: 'offline' as const },
      { ...reading, enabled: false },
      { ...reading, frames: 0 },
    ]) {
      room.update(sample, 2)
      expect(activity.visible).toBe(false)
      expect(waves.visible).toBe(false)
    }
  } finally {
    room.dispose()
  }
})
