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
  daylight_model_enabled?: boolean
  vision_observation?: {
    tick_index: number
    captured_at: string
    cloud_cover: number
  } | null
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
  roof_pitch: number
  glare_limit_w_m2?: number
  glazing_shgc?: number
  actuator_speed_deg_per_min?: number
  zone_sensor_overrides?: Record<
    string,
    { tick_index: number; irradiance: number; illuminance: number }
  >
}

export type CostBreakdown = ControllerWeights

export interface RoofSegment {
  quadrant: FacadeOrientation
  azimuth: number
  tilt: number
  incident: number
  sky_diffuse: number
  ground_diffuse: number
  sol_air_temp: number
}

export interface ZoneHeat {
  /** Row from the bottom of the wall, 0-based. */
  row: number
  /** Column from the wall's left edge seen from outside, 0-based. */
  column: number
  /** Zone id, e.g. W7 — matches the label the 3D view draws. */
  zone: string
  incident: number
  transmitted: number
  diffuse_incident?: number
  diffuse_transmitted?: number
  /** Share of the row the roof overhang has not shaded yet. */
  sunlit_fraction: number
  sol_air_temp: number
  /** This zone's own louvre controller. */
  angle: number
  mode: string
  moved: boolean
  lux: number
  load_relative: number
  sensors?: {
    sensor_id: string
    irradiance: number
    illuminance: number
    source: 'simulated' | 'override'
  }
  angle_target?: number
  reason?: string
  sensor_trusted?: boolean
  conditions?: ComfortStatePayload
  control_input?: {
    irradiance: number
    open_lux: number
    irradiance_source: 'sensor' | 'model'
    daylight_source: 'sensor' | 'model'
  }
  cost_breakdown?: CostBreakdown
}

export interface DaylightProbePayload {
  index: number
  kind: 'seat' | 'desk'
  task_illuminance: number | null
  eye_illuminance: number | null
}

export interface ComfortStatePayload {
  daylight_status: 'low' | 'useful' | 'high'
  transmitted: number
  solar_heat_gain: number
  direct_sun: number
  glare_risk: boolean
  glare_limit_w_m2: number
  glazing_shgc: number
  task_illuminance?: number | null
  eye_illuminance?: number | null
  daylight_probes?: DaylightProbePayload[] | null
}

export interface DaylightStatusPayload {
  model: string
  night: boolean
  occupied: boolean
  ev_cap_lux: number
  et_band_low_lux: number
  et_band_high_lux: number
}

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
  /** Angle between the sun and this wall's outward normal, in degrees. */
  aoi?: number
  /** False once the sun is behind the leaning plane: the wall shades itself. */
  sunlit?: boolean
  zones?: ZoneHeat[]
}

export interface TickPayload {
  daylight?: DaylightStatusPayload | null
  environment_cloud?: number | null
  cloud_source?: 'environment' | 'vision'
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
  roof: RoofSegment[]
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

/* Predictive radiant-slab charging — application 7.1. */

export interface SlabModelInput {
  thickness_m: number
  density: number
  specific_heat: number
  surface_ua: number
  charge_power: number
  min_slab_temp: number
  zone_setpoint: number
  loss_ua: number
  day_capacity: number
  solar_to_floor: number
  floor_area_m2: number
}

export interface BaselineNight {
  date: string
  charge_kwh: number
  next_day_cooling_kwh: number
}

export interface SlabObservation {
  hour: number
  slab_temp: number
  zone_temp: number
  charge_w: number
}

export interface SlabPlanRequest {
  date: string | null
  seed: number
  environment_source: EnvironmentSource
  cloud_profile: CloudProfile
  latitude: number
  longitude: number
  timezone: string
  location_name: string
  facade_orientation: FacadeOrientation
  facade_tilt: number
  roof_pitch: number
  model: SlabModelInput
  history: SlabObservation[]
  baseline_nights: BaselineNight[]
}

export type BaselineVerdict =
  | 'not_supplied'
  | 'insufficient_data'
  | 'fixed_schedule'
  | 'partially_compensated'
  | 'load_compensated'

export interface BaselineAudit {
  verdict: BaselineVerdict
  nights: number
  charge_variation: number | null
  correlation: number | null
  claim_allowed: boolean
  note: string
}

export interface SlabResponseFit {
  source: 'measured' | 'synthetic' | 'default'
  samples: number
  capacity_wh_per_m2k: number
  surface_ua: number
  time_constant_h: number
  r_squared: number
  note: string
}

export interface SlabZonePlan {
  zone: string
  /** Row from the bottom of the wall, 0-based — the same grid as the facade zones. */
  row: number
  column: number
  forecast_gain_wh: number
  charge_target_wh: number
  delivered_wh: number
  baseline_delivered_wh: number
  charge_hours: number[]
  min_slab_temp: number
  predictive_kwh: number
  baseline_kwh: number
  unmet_hours: number
  baseline_unmet_hours: number
  floor_hours: number
  baseline_floor_hours: number
}

export interface SlabHour {
  slot: number
  hour: number
  label: string
  outdoor_temp: number
  dew_point: number
  occupancy: number
  cop: number
  cooling_demand_w: number
  predictive_charge_w: number
  baseline_charge_w: number
  predictive_slab_temp: number
  baseline_slab_temp: number
  predictive_trim_w: number
  baseline_trim_w: number
}

export interface SlabSummary {
  predictive_kwh: number
  baseline_kwh: number
  saving_kwh: number
  saving_percent: number
  predictive_charge_wh_m2: number
  baseline_charge_wh_m2: number
  predictive_peak_w_m2: number
  baseline_peak_w_m2: number
  predictive_unmet_hours: number
  baseline_unmet_hours: number
  predictive_floor_hours: number
  baseline_floor_hours: number
  predictive_rejected_wh_m2: number
  baseline_rejected_wh_m2: number
  predictive_standby_loss_wh_m2: number
  baseline_standby_loss_wh_m2: number
  slab_floor_temp: number
  zones: number
  floor_area_m2: number
}

export interface SlabPlanResponse {
  date: string
  title: string
  /** Constraint O1: predictive charging presumes a thermal-mass building. */
  applicable: boolean
  applicability_note: string
  metadata: {
    location: string
    latitude: number
    longitude: number
    timezone: string
    facade_orientation: FacadeOrientation
    environment_source: EnvironmentSource
    forecast_status: string
    forecast_provider: string
    forecast_dataset: string | null
    forecast_fallback: string | null
    data_notice: string
    capacity_wh_per_m2k: number
    time_constant_h: number
    charge_power_w_m2: number
    synthetic: boolean
  }
  model_fit: SlabResponseFit
  baseline_audit: BaselineAudit
  summary: SlabSummary
  hours: SlabHour[]
  zones: SlabZonePlan[]
  measurement_protocol: string[]
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
    roof_pitch: number
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
