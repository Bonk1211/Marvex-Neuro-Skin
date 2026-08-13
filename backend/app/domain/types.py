from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class Environment:
    t: datetime
    ghi: float
    dni: float
    dhi: float
    diffuse_fraction: float
    cloud: float
    wind: float
    rain: bool
    outdoor_temp: float
    occupancy: float
    measured_irradiance: float
    indoor_lux: float
    indoor_temp: float
    indoor_rh: float


@dataclass(frozen=True)
class Site:
    """Where the facade is. pvlib is location-agnostic, so this is all it takes."""

    name: str
    latitude: float
    longitude: float
    timezone: str


@dataclass(frozen=True)
class ObservedWeather:
    """Hourly measured/forecast weather for one local day. 24 values per channel."""

    ghi: tuple[float, ...]
    dni: tuple[float, ...]
    dhi: tuple[float, ...]
    temperature: tuple[float, ...]
    cloud: tuple[float, ...]
    wind: tuple[float, ...]
    precipitation: tuple[float, ...]


@dataclass(frozen=True)
class WallGain:
    """Unshaded plane-of-array gain on one wall, before its louvres act."""

    orientation: str
    azimuth: float
    incident: float
    sky_diffuse: float
    ground_diffuse: float

    @property
    def direct(self) -> float:
        return max(0.0, self.incident - self.sky_diffuse - self.ground_diffuse)


@dataclass(frozen=True)
class WallState:
    """One wall's control outcome for a tick."""

    angle: float
    mode: str
    moved: bool
    lux: float
    load_relative: float
    reason: str


@dataclass(frozen=True)
class FacadeHeat:
    """What one wall sees, and what its own controller did about it."""

    orientation: str
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


@dataclass(frozen=True)
class EnvironmentAnchor:
    """Official daily context used to shape, never replace, synthetic ticks."""

    min_temp: float
    max_temp: float
    morning_cloud: float
    afternoon_cloud: float
    night_cloud: float
    morning_rain: bool
    afternoon_rain: bool
    night_rain: bool


@dataclass(frozen=True)
class SolarState:
    azimuth: float
    elevation: float
    clear_sky_ghi: float


@dataclass(frozen=True)
class LoadEstimate:
    total: float
    shadeable: float
    latent: float


@dataclass(frozen=True)
class Decision:
    mode: str
    sensor_trusted: bool
    angle_target: float
    angle_final: float
    moved: bool
    reason: str
    cost_breakdown: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class ControllerWeights:
    thermal: float = 0.45
    lux: float = 0.35
    movement: float = 0.15
    risk: float = 0.05

    def normalized(self) -> "ControllerWeights":
        total = self.thermal + self.lux + self.movement + self.risk
        if total <= 0:
            return ControllerWeights()
        return ControllerWeights(
            thermal=self.thermal / total,
            lux=self.lux / total,
            movement=self.movement / total,
            risk=self.risk / total,
        )
