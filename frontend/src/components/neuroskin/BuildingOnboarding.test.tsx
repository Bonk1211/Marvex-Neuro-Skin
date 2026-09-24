import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuildingOnboarding, GeometryAssembly } from './BuildingOnboarding'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (url: string) => push(url) }),
}))

const STATE = {
  profile: {
    location: {
      name: 'ST Diamond Building, Putrajaya',
      latitude: 2.922,
      longitude: 101.6885,
      timezone: 'Asia/Kuala_Lumpur',
    },
    structure: {
      floors: 7,
      floor_height_m: 3.6,
      facade_orientation: 'west' as const,
      facade_tilt: 115,
      roof_pitch: 10,
      roof_overhang_m: 1.6,
      zone_rows: 4,
      zone_columns: 4,
    },
    hvac: {
      system: 'central_chiller' as const,
      cooling_setpoint_c: 24,
      cop: 3.5,
      plant_capacity_kw: 1200,
      operating_start_hour: 7,
      operating_end_hour: 19,
      bms_protocol: 'none' as const,
    },
    updated_at: null,
  },
  documents: [],
  readiness: [
    {
      id: 'geometry',
      label: 'Geometry',
      source: 'document',
      ready: true,
      detail: '7 floors, 4x4 louvre zones per wall.',
      documents: 1,
    },
    {
      id: 'site',
      label: 'Site',
      source: 'document',
      ready: true,
      detail: 'Putrajaya drives the sun path.',
      documents: 1,
    },
    {
      id: 'hvac',
      label: 'HVAC',
      source: 'document',
      ready: true,
      detail: 'Central chiller, COP 3.5.',
      documents: 1,
    },
  ],
  defaults: {},
  blocking_items: 0,
  site_visits_required: 0,
  extra_hardware_required: false,
}

function stubBackend() {
  // Typed so mock.calls exposes (url, init) without unused parameters.
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Partial<Response>>
  >(async (url: string) =>
    String(url).startsWith('/samples/')
      ? { ok: true, blob: async () => new Blob(['%PDF-1.4 sample']) }
      : { ok: true, json: async () => STATE }
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function drop(name: string) {
  const input = screen.getByLabelText('Attach document')
  const file = new File(['%PDF-1.4 demo'], name, { type: 'application/pdf' })
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  push.mockClear()
  // The flow's waits collapse for a reader who asked for less motion, so the
  // test walks the real path instead of sitting through the animation.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BuildingOnboarding', () => {
  it('assembles the structure, façade, roof and agents before declaring the twin ready', () => {
    const { container, rerender } = render(
      <GeometryAssembly phase={0} profile={STATE.profile} />
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '0'
    )
    expect(container.querySelectorAll('[data-assembly-floor]')).toHaveLength(0)
    rerender(<GeometryAssembly phase={3} profile={STATE.profile} />)
    expect(container.querySelectorAll('[data-assembly-floor]')).toHaveLength(3)
    expect(container.querySelector('[data-assembly-roof]')).toBeNull()
    rerender(<GeometryAssembly phase={8} profile={STATE.profile} />)
    expect(container.querySelectorAll('[data-assembly-facade]')).toHaveLength(7)
    expect(container.querySelector('[data-assembly-roof]')).toBeNull()
    rerender(<GeometryAssembly phase={9} profile={STATE.profile} />)
    expect(container.querySelector('[data-assembly-roof]')).not.toBeNull()
    expect(container.querySelector('[data-assembly-agents]')).toBeNull()
    rerender(<GeometryAssembly phase={11} profile={STATE.profile} />)
    expect(container.querySelector('[data-assembly-agents]')).not.toBeNull()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100'
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Opening your engineering console'
    )
  })

  it('opens by asking for the building structure and claims no site visit', async () => {
    stubBackend()
    render(<BuildingOnboarding />)

    expect(screen.getByText(/Drop building design here/i)).toBeInTheDocument()
    expect(screen.getByText(/Document 1 of 3/)).toBeInTheDocument()
    expect(await screen.findByText(/0 site visits/)).toBeInTheDocument()
  })

  it('files three documents, then opens the twin', async () => {
    const fetchMock = stubBackend()
    render(<BuildingOnboarding />)

    drop('elevations.pdf')
    await screen.findByText(/7 floors, 4x4 louvre zones/)
    expect(screen.getByText(/Document 2 of 3/)).toBeInTheDocument()

    drop('site-plan.pdf')
    await screen.findByText(/Putrajaya drives the sun path/)

    drop('chiller-schedule.pdf')
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))

    const uploads = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/api/v1/onboarding/documents') &&
        init?.method === 'POST'
    )
    expect(
      uploads.map(([, init]) => JSON.parse(String(init?.body)).kind)
    ).toEqual(['structure', 'location', 'hvac'])
  })

  it('files all three sample documents from one click', async () => {
    const fetchMock = stubBackend()
    render(<BuildingOnboarding />)

    fireEvent.click(
      screen.getByRole('button', {
        name: /Demo setup/i,
      })
    )

    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
    const uploads = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/api/v1/onboarding/documents') &&
        init?.method === 'POST'
    )
    expect(
      uploads.map(([, init]) => {
        const body = JSON.parse(String(init?.body))
        return [body.kind, body.name]
      })
    ).toEqual([
      ['structure', 'st-diamond-axonometric.jpg'],
      ['location', 'site-plan.pdf'],
      ['hvac', 'chiller-schedule.csv'],
    ])
  })

  it('reports a failed upload and keeps the same step open', async () => {
    const fetchMock = stubBackend()
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => STATE })
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: 'Document is empty.' }),
    })
    render(<BuildingOnboarding />)

    drop('elevations.pdf')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Document is empty.'
    )
    expect(screen.getByText(/Document 1 of 3/)).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})
