from datetime import date as Date
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ScenarioName = Literal["overview", "lie_detector", "co_optimization", "budget_failsafe"]
CloudProfile = Literal["clear", "scattered", "overcast"]


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
    cloud_profile: CloudProfile = "scattered"
    occupancy_scale: float = Field(1.0, ge=0, le=1.5)
    wind_override: float | None = Field(None, ge=0, le=40)
    power_ok: bool = True
    weights: WeightInput = Field(default_factory=WeightInput)


class CostBreakdown(BaseModel):
    thermal: float = 0
    lux: float = 0
    movement: float = 0
    risk: float = 0


class TickPayload(BaseModel):
    timestamp: datetime
    ghi: float
    expected_ghi: float
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


class SimulationMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location: str
    latitude: float
    longitude: float
    timezone: str
    tick_minutes: int
    seed: int
    synthetic: bool
    data_notice: str
    load_unit: str


class SimulationRunResponse(BaseModel):
    scenario: ScenarioName
    title: str
    metadata: SimulationMetadata
    summary: dict[str, float | int | str | bool]
    ticks: list[TickPayload]
    comparison: list[ComparisonMetric]
    annotations: list[EventAnnotation]
