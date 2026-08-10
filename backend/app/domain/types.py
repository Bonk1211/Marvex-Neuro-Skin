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
