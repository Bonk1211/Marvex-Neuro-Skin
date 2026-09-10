import type {
  SimulationRunRequest,
  SimulationRunResponse,
  SlabPlanRequest,
  SlabPlanResponse,
} from './types'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface CloudResult {
  cloud_mask?: number[][] | null
  cloud_cover: number | null
  width: number
  height: number
  detections: { confidence: number }[]
  annotated_image?: string | null
}

export function detectClouds(
  image: string,
  width: number,
  height: number,
  signal?: AbortSignal
): Promise<CloudResult> {
  return post(
    '/api/v1/vision/clouds',
    { image, width, height },
    'Cloud vision',
    signal
  )
}

async function post<T>(
  path: string,
  body: unknown,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const detail = typeof payload?.detail === 'string' ? payload.detail : null
    throw new Error(detail || `${label} API returned ${response.status}.`)
  }

  return response.json() as Promise<T>
}

export function runSimulation(
  request: SimulationRunRequest,
  signal?: AbortSignal
): Promise<SimulationRunResponse> {
  return post('/api/v1/simulations/run', request, 'Simulation', signal)
}

export function planSlab(
  request: SlabPlanRequest,
  signal?: AbortSignal
): Promise<SlabPlanResponse> {
  return post('/api/v1/slab/plan', request, 'Slab plan', signal)
}
