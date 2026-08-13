from datetime import date as Date
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import DEFAULTS

ScenarioName = Literal["overview", "lie_detector", "co_optimization", "budget_failsafe"]
CloudProfile = Literal["clear", "scattered", "overcast"]
EnvironmentSource = Literal["synthetic", "met_anchored", "open_meteo"]
FacadeOrientation = Literal["north", "east", "south", "west"]


class WeightInput(BaseModel):
    thermal: float = Field(0.45, ge=0, le=1)
    lux: float = Field(0.35, ge=0, le=1)
    movement: float = Field(0.15, ge=0, le=1)
    risk: float = Field(0.05, ge=0, le=1)

    @field_validator("risk")
    @classmethod
    def at_least_one_weight(cls, value: float, info):
        values = [value, *[float(v) for v in info.data.values()]]
        if sum(values) <= 0:
            raise ValueError("At least one controller weight must be greater than zero")
        return value


class SimulationRunRequest(BaseModel):
    scenario: ScenarioName = "overview"
    date: Date = Date(2026, 3, 21)
    seed: int = Field(42, ge=0, le=2_147_483_647)
    environment_source: EnvironmentSource = "synthetic"
    cloud_profile: CloudProfile = "scattered"
    occupancy_scale: float = Field(1.0, ge=0, le=1.5)
    wind_override: float | None = Field(None, ge=0, le=40)
    power_ok: bool = True
    weights: WeightInput = Field(default_factory=WeightInput)
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
