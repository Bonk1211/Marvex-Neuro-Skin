export type ScenarioName =
  | 'overview'
  | 'lie_detector'
  | 'co_optimization'
  | 'budget_failsafe'

export type CloudProfile = 'clear' | 'scattered' | 'overcast'
export type EnvironmentSource = 'synthetic' | 'met_anchored' | 'open_meteo'
export type FacadeOrientation = 'north' | 'east' | 'south' | 'west'

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
  environment_source: EnvironmentSource
  cloud_profile: CloudProfile
  occupancy_scale: number
  wind_override: number | null
  power_ok: boolean
  weights: ControllerWeights
  latitude: number
  longitude: number
  timezone: string
  location_name: string
  facade_orientation: FacadeOrientation
  facade_tilt: number
}

export type CostBreakdown = ControllerWeights

export interface FacadeHeat {
  orientation: FacadeOrientation
  azimuth: number
  incident: number
  transmitted: number
  sky_diffuse: number
  ground_diffuse: number
  sol_air_temp: number
  angle: number
  mode: string
  moved: boolean
  lux: number
  load_relative: number
  reason: string
  primary: boolean
}

export interface TickPayload {
  timestamp: string
  ghi: number
  expected_ghi: number
  solar_azimuth: number
  solar_elevation: number
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
  facade: FacadeHeat[]
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

export interface WeatherWarningPayload {
  title: string
  heading: string
  text: string
  instruction: string
  valid_from: string | null
  valid_to: string | null
}

export interface WeatherContextPayload {
  status: 'applied' | 'fallback'
  provider: string
  source_url: string
  fetched_at: string
  location_id: string
  location_name: string
  dataset: string | null
  forecast_date: string | null
  min_temp: number | null
  max_temp: number | null
  morning_forecast: string | null
  afternoon_forecast: string | null
  night_forecast: string | null
  summary_forecast: string | null
  summary_when: string | null
  warnings: WeatherWarningPayload[]
  fallback_reason: string | null
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
    environment_source: EnvironmentSource
    facade_orientation: FacadeOrientation
    facade_tilt: number
    floors: number
    synthetic: boolean
    data_notice: string
    load_unit: string
    weather_context: WeatherContextPayload | null
  }
  summary: Record<string, string | number | boolean>
  ticks: TickPayload[]
  comparison: ComparisonMetric[]
  annotations: EventAnnotation[]
}
