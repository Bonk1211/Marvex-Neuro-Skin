from datetime import date as Date
from datetime import datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

from app.config import DEFAULTS

ScenarioName = Literal["overview", "lie_detector", "co_optimization", "budget_failsafe"]
CloudProfile = Literal["clear", "scattered", "overcast"]
EnvironmentSource = Literal["synthetic", "met_anchored", "open_meteo"]
FacadeOrientation = Literal["north", "east", "south", "west"]
ZoneId = Annotated[str, Field(pattern=r"^[NESW](?:[1-9]|1[0-6])$")]


class ZoneSensorOverride(BaseModel):
    tick_index: int = Field(ge=0, le=143, strict=True)
    irradiance: float = Field(ge=0, le=1600, allow_inf_nan=False)
    illuminance: float = Field(ge=0, le=10000, allow_inf_nan=False)


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
    tick_index: int = Field(ge=0, le=143, strict=True)
    captured_at: AwareDatetime
    cloud_cover: float = Field(ge=0, le=1, allow_inf_nan=False)


class SimulationRunRequest(BaseModel):
    scenario: ScenarioName = "overview"
    date: Date = Date(2026, 3, 21)
    seed: int = Field(42, ge=0, le=2_147_483_647)
    environment_source: EnvironmentSource = "synthetic"
    cloud_profile: CloudProfile = "scattered"
    vision_observation: VisionObservation | None = None
    occupancy_scale: float = Field(1.0, ge=0, le=1.5)
    wind_override: float | None = Field(None, ge=0, le=40)
    power_ok: bool = True
    weights: WeightInput = Field(default_factory=WeightInput)
    zone_sensor_overrides: dict[ZoneId, ZoneSensorOverride] = Field(
        default_factory=dict, max_length=64
    )
    # Calibrate against the installed glazing, actuator and occupant assessment.
    glazing_shgc: float = Field(DEFAULTS.glazing_shgc, ge=0, le=1, allow_inf_nan=False)
    glare_limit_w_m2: float = Field(
        DEFAULTS.glare_limit_w_m2, ge=0, le=2000, allow_inf_nan=False
    )
    actuator_speed_deg_per_min: float = Field(
        DEFAULTS.actuator_speed_deg_per_min, ge=0.1, le=12, allow_inf_nan=False
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


class ComfortStatePayload(BaseModel):
    daylight_status: Literal["low", "useful", "high"]
    transmitted: float
    solar_heat_gain: float
    direct_sun: float
    glare_risk: bool
    glare_limit_w_m2: float
    glazing_shgc: float


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


class TickPayload(BaseModel):
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


class SimulationRunResponse(BaseModel):
    scenario: ScenarioName
    title: str
    metadata: SimulationMetadata
    summary: dict[str, float | int | str | bool]
    ticks: list[TickPayload]
    comparison: list[ComparisonMetric]
    annotations: list[EventAnnotation]


# --------------------------------------------------------------------------
# Predictive radiant-slab charging (application 7.1)
# --------------------------------------------------------------------------


class SlabModelInput(BaseModel):
    """The slab as assumed before anything is fitted. Every field a knob."""

    thickness_m: float = Field(0.20, gt=0.01, le=1.0)
    density: float = Field(2300.0, gt=100, le=5000)
    specific_heat: float = Field(880.0, gt=100, le=5000)
    # Slab-to-zone surface coupling, W/m²K, radiant and convective together.
    surface_ua: float = Field(8.0, gt=0, le=40)
    # Most the plant can push into the slab, W/m² of floor. A slab this heavy
    # needs roughly this much for eight hours to move five degrees.
    charge_power: float = Field(70.0, gt=0, le=250)
    min_slab_temp: float = Field(19.0, ge=10, le=24)
    zone_setpoint: float = Field(24.0, ge=18, le=30)
    # Loss from the charged slab to everything that is not the conditioned
    # space — structure, ground, outside air. What makes an overcharged slab
    # cost money rather than simply carry its cold forward.
    loss_ua: float = Field(1.5, ge=0, le=20)
    # Air-side trim capacity left for whatever the slab does not absorb. Small
    # on purpose: a radiant-led building is sized around the slab doing the work.
    day_capacity: float = Field(55.0, gt=0, le=250)
    # Transmitted facade gain that lands as floor cooling load: facade area per
    # m² of perimeter floor, times glazing fraction, times the glass SHGC. The
    # louvres are already in the transmitted figure this multiplies.
    solar_to_floor: float = Field(0.10, gt=0, le=3.0)
    floor_area_m2: float = Field(12000.0, gt=0, le=1_000_000)


class SlabObservationInput(BaseModel):
    """One logged hour of slab behaviour, for identifying the mass response."""

    hour: int = Field(ge=0, le=23)
    slab_temp: float = Field(ge=0, le=60)
    zone_temp: float = Field(ge=0, le=60)
    charge_w: float = Field(ge=0, le=500)


class BaselineNightInput(BaseModel):
    """One logged night of the incumbent schedule, for the baseline audit."""

    date: Date
    charge_kwh: float = Field(ge=0)
    next_day_cooling_kwh: float = Field(ge=0)


class SlabPlanRequest(BaseModel):
    # The day to be cooled. Defaults to tomorrow, which is the whole point.
    date: Date | None = None
    seed: int = Field(42, ge=0, le=2_147_483_647)
    environment_source: EnvironmentSource = "open_meteo"
    cloud_profile: CloudProfile = "scattered"
    latitude: float = Field(DEFAULTS.latitude, ge=-90, le=90)
    longitude: float = Field(DEFAULTS.longitude, ge=-180, le=180)
    timezone: str = Field(DEFAULTS.timezone, min_length=1, max_length=64)
    location_name: str = Field(DEFAULTS.location_name, min_length=1, max_length=120)
    facade_orientation: FacadeOrientation = DEFAULTS.facade_orientation  # type: ignore[assignment]
    facade_tilt: float = Field(DEFAULTS.facade_tilt, ge=0, le=180)
    roof_pitch: float = Field(DEFAULTS.roof_pitch, ge=0, le=60)
    model: SlabModelInput = Field(default_factory=SlabModelInput)
    history: list[SlabObservationInput] = Field(default_factory=list, max_length=8760)
    baseline_nights: list[BaselineNightInput] = Field(
        default_factory=list, max_length=1000
    )

    @field_validator("timezone")
    @classmethod
    def known_slab_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (KeyError, ValueError) as exc:
            raise ValueError(f"Unknown IANA timezone: {value}") from exc
        return value


class SlabResponseFit(BaseModel):
    """What the least-squares fit made of the building's mass."""

    source: Literal["measured", "synthetic", "default"]
    samples: int
    capacity_wh_per_m2k: float
    surface_ua: float
    time_constant_h: float
    r_squared: float
    note: str


class BaselineAuditPayload(BaseModel):
    """Whether the incumbent schedule is a clock or already a controller."""

    verdict: Literal[
        "not_supplied",
        "insufficient_data",
        "fixed_schedule",
        "partially_compensated",
        "load_compensated",
    ]
    nights: int
    charge_variation: float | None = None
    correlation: float | None = None
    claim_allowed: bool
    note: str


class SlabZonePlan(BaseModel):
    """One of the sixteen zones, and the charge its own tomorrow needs."""

    zone: str
    row: int
    column: int
    forecast_gain_wh: float
    charge_target_wh: float
    delivered_wh: float
    baseline_delivered_wh: float
    charge_hours: list[int]
    min_slab_temp: float
    predictive_kwh: float
    baseline_kwh: float
    unmet_hours: int
    baseline_unmet_hours: int
    # Hours pinned on the dew-point-limited floor, where commanded charge was
    # refused because the slab could not go colder without sweating.
    floor_hours: int
    baseline_floor_hours: int


class SlabHourPayload(BaseModel):
    """One hour of the plan, from 22:00 the night before to 21:00 the next day."""

    slot: int
    hour: int
    label: str
    outdoor_temp: float
    dew_point: float
    occupancy: float
    cop: float
    cooling_demand_w: float
    predictive_charge_w: float
    baseline_charge_w: float
    predictive_slab_temp: float
    baseline_slab_temp: float
    predictive_trim_w: float
    baseline_trim_w: float


class SlabSummary(BaseModel):
    predictive_kwh: float
    baseline_kwh: float
    saving_kwh: float
    saving_percent: float
    predictive_charge_wh_m2: float
    baseline_charge_wh_m2: float
    predictive_peak_w_m2: float
    baseline_peak_w_m2: float
    # Zone-hours, summed across all sixteen zones.
    predictive_unmet_hours: int
    baseline_unmet_hours: int
    predictive_floor_hours: int
    baseline_floor_hours: int
    # Commanded charge the slab refused, and charge that leaked away unused.
    predictive_rejected_wh_m2: float
    baseline_rejected_wh_m2: float
    predictive_standby_loss_wh_m2: float
    baseline_standby_loss_wh_m2: float
    slab_floor_temp: float
    zones: int
    floor_area_m2: float


class SlabPlanMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location: str
    latitude: float
    longitude: float
    timezone: str
    facade_orientation: FacadeOrientation
    environment_source: EnvironmentSource
    forecast_status: str
    forecast_provider: str
    forecast_dataset: str | None = None
    forecast_fallback: str | None = None
    data_notice: str
    capacity_wh_per_m2k: float
    time_constant_h: float
    charge_power_w_m2: float
    synthetic: bool


class SlabPlanResponse(BaseModel):
    date: Date
    title: str
    # Constraint O1: predictive charging presumes a thermal-mass building.
    applicable: bool
    applicability_note: str
    metadata: SlabPlanMetadata
    model_fit: SlabResponseFit
    baseline_audit: BaselineAuditPayload
    summary: SlabSummary
    hours: list[SlabHourPayload]
    zones: list[SlabZonePlan]
    measurement_protocol: list[str]
