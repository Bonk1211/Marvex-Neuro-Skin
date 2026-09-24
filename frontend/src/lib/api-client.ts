import type { SimulationRunRequest, SimulationRunResponse } from './types'

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

export type HardwarePanelId = 'bh1' | 'bh2' | 'bh3' | 'bh4'

export interface HardwarePanelStatus {
  zone: string
  lux: number | null
  /** Last angle the ESP32 wrote; SG90s give no position feedback. */
  commanded_angle: number | null
  target_angle: number | null
  mode: 'auto' | 'twin' | 'calibrate' | 'wind' | 'fault' | null
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

export interface LiveCsiReading {
  enabled: boolean
  uptime_ms: number
  window_ms: number
  frames: number
  ap: string
  channel: number
  amplitude: number | null
  sigma: number | null
  rssi: number | null
  amplitudes: number[]
  servos_moving: boolean
  sample_id: number
  frames_per_second: number
  state:
    | 'unavailable'
    | 'no_signal'
    | 'low_rate'
    | 'servos_moving'
    | 'calibrating'
    | 'motion'
    | 'quiet'
    | 'offline'
  calibration_windows: number
  calibration_required: number
  baseline_sigma: number | null
  threshold: number | null
}

export interface HardwareStatus {
  online: boolean
  last_seen_s: number | null
  seq: number | null
  mode: 'auto' | 'twin' | 'calibrate' | 'wind'
  lux_band: [number, number]
  panels: Record<HardwarePanelId, HardwarePanelStatus>
  calibration: Record<HardwarePanelId, ServoCalibration>
  /** Louvre angles held in twin, wind or calibrate mode; empty in auto. */
  held: Partial<Record<HardwarePanelId, number>>
  csi?: LiveCsiReading | null
}

export function calibrateCsi(): Promise<HardwareStatus> {
  return post('/api/v1/hardware/csi/calibrate', {}, 'CSI calibration')
}

export type HardwareControl =
  | { mode: 'auto' }
  | { mode: 'twin'; angles: Record<string, number>; refresh_only?: boolean }
  /** The agent room's retreat, by zone, held while the gust lasts. */
  | { mode: 'wind'; angles: Record<string, number>; refresh_only?: boolean }
  | {
      mode: 'calibrate'
      angles: Record<HardwarePanelId, number>
      refresh_only?: boolean
    }

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

export type FacadeOrientation = 'north' | 'east' | 'south' | 'west'
export type DocumentKind = 'structure' | 'location' | 'hvac' | 'other'
/** Where a twin input came from. Every input is usable at `default`. */
export type OnboardingSource = 'default' | 'manager' | 'document'

export interface BuildingProfile {
  location: {
    name: string
    latitude: number
    longitude: number
    timezone: string
  }
  structure: {
    floors: number
    floor_height_m: number
    facade_orientation: FacadeOrientation
    facade_tilt: number
    roof_pitch: number
    roof_overhang_m: number
    zone_rows: number
    zone_columns: number
  }
  hvac: {
    system: 'central_chiller' | 'district_cooling' | 'vrf' | 'split'
    cooling_setpoint_c: number
    cop: number
    plant_capacity_kw: number
    operating_start_hour: number
    operating_end_hour: number
    bms_protocol: 'none' | 'bacnet' | 'modbus' | 'mqtt'
  }
  updated_at: string | null
}

export interface OnboardingDocument {
  id: string
  name: string
  kind: DocumentKind
  note: string
  size_bytes: number
  uploaded_at: string
}

export interface ReadinessRow {
  id: string
  label: string
  source: OnboardingSource
  ready: boolean
  detail: string
  documents: number
}

export interface OnboardingState {
  profile: BuildingProfile
  documents: OnboardingDocument[]
  readiness: ReadinessRow[]
  defaults: BuildingProfile
  blocking_items: number
  site_visits_required: number
  extra_hardware_required: boolean
}

export function getOnboarding(signal?: AbortSignal): Promise<OnboardingState> {
  return get('/api/v1/onboarding', 'Onboarding', signal)
}

export function saveBuildingProfile(
  profile: BuildingProfile,
  signal?: AbortSignal
): Promise<OnboardingState> {
  return post('/api/v1/onboarding/profile', profile, 'Building profile', signal)
}

export function uploadOnboardingDocument(
  document: {
    name: string
    kind: DocumentKind
    content: string
    note?: string
  },
  signal?: AbortSignal
): Promise<OnboardingState> {
  return post('/api/v1/onboarding/documents', document, 'Document', signal)
}

export function resetOnboarding(
  signal?: AbortSignal
): Promise<OnboardingState> {
  return post('/api/v1/onboarding/reset', {}, 'Onboarding reset', signal)
}

export async function deleteOnboardingDocument(
  id: string,
  signal?: AbortSignal
): Promise<OnboardingState> {
  const response = await fetch(`${API_URL}/api/v1/onboarding/documents/${id}`, {
    method: 'DELETE',
    signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const detail = typeof payload?.detail === 'string' ? payload.detail : null
    throw new Error(detail || `Document API returned ${response.status}.`)
  }
  return response.json() as Promise<OnboardingState>
}

// ---------------- Daylight section ----------------
// The solved radiosity field behind a floor's Et/Ev, for the cross-section view.
// Flux is what already passed the louvres, matching the oracle's own inputs.

export interface SectionRequest {
  orientation: FacadeOrientation
  band: number
  beam_flux: number
  diffuse_flux: number
  solar_elevation: number
  solar_azimuth: number
  probe_index?: number | null
  view_deg?: number | null
  /** Scope the default occupant to one facade zone; falls back to the whole band. */
  zone?: string | null
}

export interface SectionPatch {
  centre: [number, number, number]
  normal: [number, number, number]
  area: number
  reflectance: number
  direct_lux: number
  radiosity_lux: number
  contribution_lux: number
}

export interface SectionProbe {
  index: number
  kind: 'seat' | 'desk'
  x: number
  z: number
  height_m: number
  view_deg: number | null
  zone: string
  task_lux: number
  eye_lux: number
}

export interface SectionSelection {
  index: number
  view_deg: number | null
  task_lux: number
  eye_lux: number
  eye_direct_lux: number
  eye_interreflected_lux: number
  over_cap: boolean
}

export interface SectionResponse {
  room: Record<string, number>
  sun: [number, number, number]
  normal_beam_w_m2: number
  patch_divisions: number
  bounces: number
  ev_comfort_lux: number
  ev_cap_lux: number
  patches: SectionPatch[]
  probes: SectionProbe[]
  selected: SectionSelection | null
  yaw_sweep: { view_deg: number; eye_lux: number }[]
  provenance: string
}

export function getDaylightSection(
  request: SectionRequest,
  signal?: AbortSignal
): Promise<SectionResponse> {
  return post('/api/v1/daylight/section', request, 'Daylight section', signal)
}
