from datetime import date as Date
from datetime import datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import DEFAULTS, MAX_TICK

ScenarioName = Literal[
    "overview", "solar_tracking", "lie_detector", "co_optimization", "budget_failsafe"
]
CloudProfile = Literal["clear", "scattered", "overcast"]
EnvironmentSource = Literal["synthetic", "met_anchored", "open_meteo"]
FacadeOrientation = Literal["north", "east", "south", "west"]
ZoneId = Annotated[str, Field(pattern=r"^[NESW](?:[1-9]|1[0-6])$")]


class ZoneSensorOverride(BaseModel):
    tick_index: int = Field(ge=0, le=MAX_TICK, strict=True)
    irradiance: float = Field(ge=0, le=1600, allow_inf_nan=False)
    illuminance: float = Field(ge=0, le=10000, allow_inf_nan=False)


PerturbationKind = Literal["dead", "stuck", "drift", "fouled", "shadow"]
FaultCorrectionMode = Literal["off", "monitor", "review", "auto"]
# "<zone>:<opened tick>:<hypothesis>", stable when the same request is replayed.
EpisodeId = Annotated[
    str,
    # Tick index is whatever the run produced; MAX_TICK, not this pattern, bounds it.
    Field(pattern=r"^[NESW](?:[1-9]|1[0-6]):\d{1,3}:[a-z_]+$", max_length=48),
]


class ZonePerturbation(BaseModel):
    """Declared test input. Faults corrupt the reading; shadow is a real, unmodelled drop."""

    kind: PerturbationKind
    start_tick: int = Field(ge=0, le=MAX_TICK, strict=True)
    end_tick: int = Field(ge=0, le=MAX_TICK, strict=True)
    severity: float = Field(0.5, gt=0, le=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def ordered_window(self) -> "ZonePerturbation":
        if self.end_tick < self.start_tick:
            raise ValueError("end_tick must not be before start_tick")
        return self


class WeightInput(BaseModel):
    # Match ControllerWeights: the optimiser now receives per-facade POA.
    thermal: float = Field(0.45, ge=0, le=1)
    lux: float = Field(0.45, ge=0, le=1)
    movement: float = Field(0.05, ge=0, le=1)
    risk: float = Field(0.05, ge=0, le=1)

    @field_validator("risk")
    @classmethod
    def at_least_one_weight(cls, value: float, info):
        values = [value, *[float(v) for v in info.data.values()]]
        if sum(values) <= 0:
            raise ValueError("At least one controller weight must be greater than zero")
        return value


class VisionObservation(BaseModel):
    tick_index: int = Field(ge=0, le=MAX_TICK, strict=True)
    captured_at: AwareDatetime
    cloud_cover: float = Field(ge=0, le=1, allow_inf_nan=False)


class SimulationRunRequest(BaseModel):
    daylight_model_enabled: bool = DEFAULTS.daylight_model_enabled
    scenario: ScenarioName = "overview"
    date: Date = Date(2026, 3, 21)
    seed: int = Field(42, ge=0, le=2_147_483_647)
    environment_source: EnvironmentSource = "synthetic"
    cloud_profile: CloudProfile = "scattered"
    vision_observation: VisionObservation | None = None
    occupancy_scale: float = Field(1.0, ge=0, le=1.5)
    wind_override: float | None = Field(None, ge=0, le=40)
    # Bearing the wind blows from, degrees clockwise from north. None keeps the
    # prevailing monsoon bearing (or the measured one, on a real weather feed).
    wind_direction: float | None = Field(None, ge=0, lt=360)
    power_ok: bool = True
    weights: WeightInput = Field(default_factory=WeightInput)
    zone_sensor_overrides: dict[ZoneId, ZoneSensorOverride] = Field(
        default_factory=dict, max_length=64
    )
    zone_perturbations: dict[ZoneId, ZonePerturbation] = Field(default_factory=dict, max_length=64)
    # "off" reproduces the pre-assurance response; "monitor" only adds evidence.
    fault_correction: FaultCorrectionMode = "off"
    # Operator approvals, replayed: an approved episode is isolated when it reopens.
    approved_episodes: list[EpisodeId] = Field(default_factory=list, max_length=64)
    # Calibrate against the installed glazing, actuator and occupant assessment.
    glazing_shgc: float = Field(DEFAULTS.glazing_shgc, ge=0, le=1, allow_inf_nan=False)
    glare_limit_w_m2: float = Field(DEFAULTS.glare_limit_w_m2, ge=0, le=2000, allow_inf_nan=False)
    actuator_speed_deg_per_min: float = Field(
        DEFAULTS.actuator_speed_deg_per_min, ge=0.1, le=60, allow_inf_nan=False
    )
    latitude: float = Field(DEFAULTS.latitude, ge=-90, le=90)
    longitude: float = Field(DEFAULTS.longitude, ge=-180, le=180)
    timezone: str = Field(DEFAULTS.timezone, min_length=1, max_length=64)
    location_name: str = Field(DEFAULTS.location_name, min_length=1, max_length=120)
    facade_orientation: FacadeOrientation = DEFAULTS.facade_orientation  # type: ignore[assignment]
    # 90 is a plain vertical wall; above 90 the facade leans out and self-shades.
    facade_tilt: float = Field(DEFAULTS.facade_tilt, ge=0, le=180)
    # Roof pitch from horizontal. 0 is flat, where every segment reads alike.
    roof_pitch: float = Field(DEFAULTS.roof_pitch, ge=0, le=60)

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value: str) -> str:
        # Reaches an outbound query string, so reject anything not in the IANA database.
        try:
            ZoneInfo(value)
        except (KeyError, ValueError) as exc:
            raise ValueError(f"Unknown IANA timezone: {value}") from exc
        return value


class CostBreakdown(BaseModel):
    thermal: float = 0
    lux: float = 0
    movement: float = 0
    risk: float = 0


class ZoneSensorsPayload(BaseModel):
    sensor_id: str
    irradiance: float
    illuminance: float
    source: Literal["simulated", "override"]


class ControlInputPayload(BaseModel):
    irradiance: float
    open_lux: float
    irradiance_source: Literal["sensor", "model"]
    daylight_source: Literal["sensor", "model"]


class ZoneAssurancePayload(BaseModel):
    """Local plausibility evidence for this zone's sensor; the score routes, it is not accuracy."""

    verdict: Literal["consistent", "legitimate_condition", "suspect", "fault", "insufficient"]
    hypothesis: Literal["dead", "stuck", "drift_or_fouling", "local_shadow", "ambiguous"] | None
    score: float
    peer_deviation: float | None
    lux_deviation: float | None
    reason: str
    episode_id: str | None = Field(None, exclude_if=lambda v: v is None)


class ZoneHeatPayload(BaseModel):
    """One cell of one wall's 4 x 4 zone grid, with its own controller's state."""

    row: int
    column: int
    zone: str
    incident: float
    transmitted: float
    sunlit_fraction: float
    sol_air_temp: float
    angle: float
    mode: str
    moved: bool
    lux: float
    load_relative: float
    sensors: ZoneSensorsPayload
    angle_target: float
    reason: str
    sensor_trusted: bool
    conditions: "ComfortStatePayload"
    diffuse_incident: float
    diffuse_transmitted: float
    control_input: ControlInputPayload
    cost_breakdown: CostBreakdown
    assurance: ZoneAssurancePayload | None = Field(None, exclude_if=lambda v: v is None)


class DaylightProbePayload(BaseModel):
    index: int
    kind: Literal["seat", "desk"]
    task_illuminance: float | None
    eye_illuminance: float | None


class ComfortStatePayload(BaseModel):
    daylight_status: Literal["low", "useful", "high"]
    transmitted: float
    solar_heat_gain: float
    direct_sun: float
    glare_risk: bool
    glare_limit_w_m2: float
    glazing_shgc: float
    task_illuminance: float | None = Field(None, exclude_if=lambda v: v is None)
    eye_illuminance: float | None = Field(None, exclude_if=lambda v: v is None)
    daylight_probes: list[DaylightProbePayload] | None = Field(None, exclude_if=lambda v: v is None)


class FacadeHeatPayload(BaseModel):
    """One wall of the building at one tick, for the 3D heat map."""

    orientation: FacadeOrientation
    azimuth: float
    incident: float
    transmitted: float
    sky_diffuse: float
    ground_diffuse: float
    sol_air_temp: float
    angle: float
    mode: str
    moved: bool
    lux: float
    load_relative: float
    reason: str
    primary: bool
    # Angle of incidence, and whether the sun is still on this side of the
    # leaning plane at all. Past 90 degrees the facade is shading itself.
    aoi: float = 180.0
    sunlit: bool = False
    zones: list[ZoneHeatPayload] = Field(default_factory=list)


class RoofSegmentPayload(BaseModel):
    """One pitched roof face, for the segmented roof heat map."""

    quadrant: FacadeOrientation
    azimuth: float
    tilt: float
    incident: float
    sky_diffuse: float
    ground_diffuse: float
    sol_air_temp: float


class DaylightStatusPayload(BaseModel):
    model: str = "extra trees · modelled"
    night: bool
    ev_cap_lux: float = DEFAULTS.ev_cap_lux
    et_band_low_lux: float = DEFAULTS.et_band_low_lux
    et_band_high_lux: float = DEFAULTS.et_band_high_lux
    occupied: bool


class TickPayload(BaseModel):
    daylight: DaylightStatusPayload | None = Field(None, exclude_if=lambda v: v is None)
    environment_cloud: float | None = None
    cloud_source: Literal["environment", "vision"] = "environment"
    timestamp: datetime
    ghi: float
    expected_ghi: float
    solar_azimuth: float
    solar_elevation: float
    measured_irradiance: float
    cloud: float
    outdoor_temp: float
    occupancy: float
    wind: float
    wind_direction: float = 0.0
    rain: bool
    load_relative: float
    naive_load_relative: float
    latent_load: float
    lux: float
    naive_lux: float
    angle_target: float
    angle_final: float
    naive_angle: float
    mode: str
    moved: bool
    sensor_trusted: bool
    reason: str
    cost_breakdown: CostBreakdown
    facade: list[FacadeHeatPayload] = Field(default_factory=list)
    roof: list[RoofSegmentPayload] = Field(default_factory=list)


class ComparisonMetric(BaseModel):
    metric: str
    label: str
    unit: str
    ours: float
    naive: float
    higher_is_better: bool


class EventAnnotation(BaseModel):
    timestamp: datetime
    kind: str
    title: str
    detail: str


class WeatherWarningPayload(BaseModel):
    title: str
    heading: str
    text: str
    instruction: str
    valid_from: str | None = None
    valid_to: str | None = None


class WeatherContextPayload(BaseModel):
    status: Literal["applied", "fallback"]
    provider: str
    source_url: str
    fetched_at: datetime
    location_id: str
    location_name: str
    dataset: str | None = None
    forecast_date: Date | None = None
    min_temp: float | None = None
    max_temp: float | None = None
    morning_forecast: str | None = None
    afternoon_forecast: str | None = None
    night_forecast: str | None = None
    summary_forecast: str | None = None
    summary_when: str | None = None
    warnings: list[WeatherWarningPayload] = Field(default_factory=list)
    fallback_reason: str | None = None


class SimulationMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location: str
    latitude: float
    longitude: float
    timezone: str
    tick_minutes: int
    seed: int
    environment_source: EnvironmentSource
    facade_orientation: FacadeOrientation
    facade_tilt: float
    roof_pitch: float
    floors: int
    synthetic: bool
    data_notice: str
    load_unit: str
    weather_context: WeatherContextPayload | None = None


class EpisodeEventPayload(BaseModel):
    tick_index: int
    stage: Literal[
        "detect",
        "authorise",
        "snapshot",
        "mitigate",
        "verify",
        "retain",
        "roll_back",
        "escalate",
        "restore",
        "close",
    ]
    detail: str


class RecoveryEpisodePayload(BaseModel):
    """One zone's simulated fault episode. Objectives are relative indices, never energy."""

    episode_id: str
    zone: str
    hypothesis: str
    score: float
    status: Literal[
        "monitoring",
        "awaiting_approval",
        "mitigating",
        "retained",
        "rolled_back",
        "escalated",
        "closed",
    ]
    opened_tick: int
    mitigated_tick: int | None
    closed_tick: int | None
    snapshot_angle: float | None
    valid_ticks: int
    e_corrected: float
    e_uncorrected: float
    maintenance_flag: bool
    events: list[EpisodeEventPayload]


class SimulationRunResponse(BaseModel):
    scenario: ScenarioName
    title: str
    metadata: SimulationMetadata
    summary: dict[str, float | int | str | bool]
    ticks: list[TickPayload]
    comparison: list[ComparisonMetric]
    annotations: list[EventAnnotation]
    episodes: list[RecoveryEpisodePayload] = Field(default_factory=list, exclude_if=lambda v: not v)
