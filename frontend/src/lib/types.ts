export type ScenarioName =
  | 'overview'
  | 'lie_detector'
  | 'co_optimization'
  | 'budget_failsafe'

export type CloudProfile = 'clear' | 'scattered' | 'overcast'

export interface ControllerWeights {
  thermal: number
  lux: number
  movement: number
  risk: number
}

export interface SimulationRunRequest {
  scenario: ScenarioName
  date: string
  seed: number
  cloud_profile: CloudProfile
  occupancy_scale: number
  wind_override: number | null
  power_ok: boolean
  weights: ControllerWeights
}

export type CostBreakdown = ControllerWeights

export interface TickPayload {
  timestamp: string
  ghi: number
  expected_ghi: number
  measured_irradiance: number
  cloud: number
  outdoor_temp: number
  occupancy: number
  wind: number
  rain: boolean
  load_relative: number
  naive_load_relative: number
  latent_load: number
  lux: number
  naive_lux: number
  angle_target: number
  angle_final: number
  naive_angle: number
  mode: string
  moved: boolean
  sensor_trusted: boolean
  reason: string
  cost_breakdown: CostBreakdown
}

export interface ComparisonMetric {
  metric: string
  label: string
  unit: string
  ours: number
  naive: number
  higher_is_better: boolean
}

export interface EventAnnotation {
  timestamp: string
  kind: string
  title: string
  detail: string
}

export interface SimulationRunResponse {
  scenario: ScenarioName
  title: string
  metadata: {
    location: string
    latitude: number
    longitude: number
    timezone: string
    tick_minutes: number
    seed: number
    synthetic: boolean
    data_notice: string
    load_unit: string
  }
  summary: Record<string, string | number | boolean>
  ticks: TickPayload[]
  comparison: ComparisonMetric[]
  annotations: EventAnnotation[]
}
