import type {
  SimulationRunRequest,
  SimulationRunResponse,
  SlabPlanRequest,
  SlabPlanResponse,
} from './types'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface HealthResponse {
  status: string
  service: string
  model: string
  dependencies: Record<
    'roboflow' | 'open_meteo' | 'met_malaysia',
    {
      configured: boolean
      last_status: string
      last_success_at: string | null
    }
  >
}

async function get<T>(
  path: string,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    signal,
    cache: 'no-store',
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const detail = typeof payload?.detail === 'string' ? payload.detail : null
    throw new Error(detail || `${label} API returned ${response.status}.`)
  }
  return response.json() as Promise<T>
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return get('/api/v1/health', 'Health', signal)
}

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

export type HardwarePanelId = 'bh1' | 'bh2' | 'bh3' | 'bh4'

export interface HardwarePanelStatus {
  zone: string
  lux: number | null
  /** Last angle the ESP32 wrote; SG90s give no position feedback. */
  commanded_angle: number | null
  target_angle: number | null
  mode: 'auto' | 'twin' | 'calibrate' | 'fault' | null
  reason: string
}

/**
 * Servo degrees (0–180) at louvre 0° and 180° (both perpendicular to the facade, blade flipped);
 * swapping them reverses direction.
 */
export interface ServoCalibration {
  servo_at_0: number
  servo_at_180: number
}

export interface HardwareStatus {
  online: boolean
  last_seen_s: number | null
  seq: number | null
  mode: 'auto' | 'twin' | 'calibrate'
  lux_band: [number, number]
  panels: Record<HardwarePanelId, HardwarePanelStatus>
  calibration: Record<HardwarePanelId, ServoCalibration>
  /** Louvre angles held in twin or calibrate mode; empty in auto. */
  held: Partial<Record<HardwarePanelId, number>>
}

export type HardwareControl =
  | { mode: 'auto' }
  | { mode: 'twin'; angles: Record<string, number> }
  | { mode: 'calibrate'; angles: Record<HardwarePanelId, number> }

export function getHardwareStatus(
  signal?: AbortSignal
): Promise<HardwareStatus> {
  return get('/api/v1/hardware/status', 'Hardware', signal)
}

export function setHardwareControl(
  control: HardwareControl,
  signal?: AbortSignal
): Promise<HardwareStatus> {
  return post('/api/v1/hardware/control', control, 'Hardware control', signal)
}

export function saveHardwareCalibration(
  panels: Record<HardwarePanelId, ServoCalibration>,
  signal?: AbortSignal
): Promise<HardwareStatus> {
  return post(
    '/api/v1/hardware/calibration',
    { panels },
    'Servo calibration',
    signal
  )
}
