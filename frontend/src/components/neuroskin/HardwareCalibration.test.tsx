import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HardwareCalibration } from './HardwareCalibration'

const DEFAULTS = { servo_at_0: 0, servo_at_180: 180 }
const ZONES = { bh1: 'W13', bh2: 'W14', bh3: 'W9', bh4: 'W10' }

const status = (mode: string, held = {}) => ({
  online: true,
  last_seen_s: 0.3,
  seq: 4,
  mode,
  lux_band: [300, 700],
  panels: Object.fromEntries(
    Object.entries(ZONES).map(([panel, zone]) => [
      panel,
      {
        zone,
        lux: 120,
        commanded_angle: 0,
        target_angle: 0,
        mode,
        reason: 'holding',
      },
    ])
  ),
  calibration: { bh1: DEFAULTS, bh2: DEFAULTS, bh3: DEFAULTS, bh4: DEFAULTS },
  held,
})

function stubBackend(current: object) {
  // Typed so mock.calls exposes (url, init) without unused parameters.
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Partial<Response>>
  >(async () => ({ ok: true, json: async () => current }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const posted = (fetchMock: ReturnType<typeof stubBackend>, path: string) =>
  fetchMock.mock.calls
    .filter(
      ([url, init]) => init?.method === 'POST' && String(url).endsWith(path)
    )
    .map(([, init]) => JSON.parse(String(init!.body)))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('actuator calibration', () => {
  it('starts a session with every louvre at its perpendicular start and locks edits until then', async () => {
    const fetchMock = stubBackend(status('auto'))
    render(<HardwareCalibration />)

    expect(await screen.findByText('online · 0.3s')).toBeVisible()
    expect(
      screen.getByRole('button', {
        name: 'BH1 Servo at louvre 0° (perpendicular) plus 10',
      })
    ).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Start calibration' }))

    await waitFor(() =>
      expect(posted(fetchMock, '/hardware/control')).toEqual([
        { mode: 'calibrate', angles: { bh1: 0, bh2: 0, bh3: 0, bh4: 0 } },
      ])
    )
  })

  it('nudges, swaps and holds one panel without touching the others', async () => {
    const start = { bh1: 0, bh2: 0, bh3: 0, bh4: 0 }
    const fetchMock = stubBackend(status('calibrate', start))
    render(<HardwareCalibration />)
    await screen.findByText('online · 0.3s')

    fireEvent.click(
      screen.getByRole('button', {
        name: 'BH1 Servo at louvre 0° (perpendicular) plus 10',
      })
    )
    fireEvent.click(
      within(screen.getByRole('region', { name: 'BH3 calibration' })).getByRole(
        'button',
        { name: 'Swap direction' }
      )
    )
    fireEvent.click(
      within(screen.getByRole('group', { name: 'BH2 hold angle' })).getByRole(
        'button',
        { name: '180°' }
      )
    )

    await waitFor(() =>
      expect(posted(fetchMock, '/hardware/calibration')).toHaveLength(2)
    )
    const [nudged, swapped] = posted(fetchMock, '/hardware/calibration')
    expect(nudged.panels).toEqual({
      bh1: { servo_at_0: 10, servo_at_180: 180 },
      bh2: DEFAULTS,
      bh3: DEFAULTS,
      bh4: DEFAULTS,
    })
    expect(swapped.panels.bh3).toEqual({ servo_at_0: 180, servo_at_180: 0 })
    await waitFor(() =>
      expect(posted(fetchMock, '/hardware/control')).toContainEqual({
        mode: 'calibrate',
        angles: { ...start, bh2: 180 },
      })
    )
    expect(
      within(screen.getByRole('group', { name: 'BH1 hold angle' })).getByRole(
        'button',
        { name: '0°' }
      )
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
