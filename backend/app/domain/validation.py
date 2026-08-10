from app.config import DEFAULTS
from app.domain.types import Environment, SolarState


def expected_irradiance(env: Environment, solar: SolarState) -> float:
    return max(0.0, solar.clear_sky_ghi * (1.0 - DEFAULTS.cloud_attenuation * env.cloud))


def validate(env: Environment, solar: SolarState) -> tuple[bool, str]:
    expected = expected_irradiance(env, solar)
    contradiction = (
        solar.elevation > DEFAULTS.min_elevation
        and expected > DEFAULTS.expected_irradiance_threshold
        and env.measured_irradiance < DEFAULTS.near_zero_irradiance
    )
    if contradiction and env.cloud < DEFAULTS.low_cloud_threshold:
        return (
            False,
            "Almanac predicts strong sun while the sensor reads near zero under a clear sky; "
            "ignore the likely dirty or failed pyranometer and use the almanac estimate.",
        )
    if contradiction:
        return (
            True,
            "Low irradiance agrees with heavy cloud despite the sun being above the horizon; "
            "treat this as genuine cloud-gating and safely admit daylight.",
        )
    return True, "Sensor reading is consistent with the solar almanac and cloud state."
