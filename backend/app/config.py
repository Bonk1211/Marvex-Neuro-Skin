from dataclasses import dataclass


@dataclass(frozen=True)
class SimulationDefaults:
    latitude: float = 3.1390
    longitude: float = 101.6869
    timezone: str = "Asia/Kuala_Lumpur"
    tick_minutes: int = 10
    seed: int = 42
    angle_min: float = 0.0
    angle_max: float = 60.0
    angle_step: float = 5.0
    shaded_default: float = 60.0
    retract_flat: float = 0.0
    critical_wind: float = 15.0
    movement_threshold: float = 0.025
    min_elevation: float = 8.0
    expected_irradiance_threshold: float = 250.0
    near_zero_irradiance: float = 25.0
    low_cloud_threshold: float = 0.35
    cloud_attenuation: float = 0.72
    daylight_evaluation_ghi: float = 200.0


DEFAULTS = SimulationDefaults()
