import type { SimulationRunRequest, SimulationRunResponse } from './types'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export async function runSimulation(
  request: SimulationRunRequest,
  signal?: AbortSignal
): Promise<SimulationRunResponse> {
  const response = await fetch(`${API_URL}/api/v1/simulations/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail : null
    throw new Error(detail || `Simulation API returned ${response.status}.`)
  }

  return response.json() as Promise<SimulationRunResponse>
}
