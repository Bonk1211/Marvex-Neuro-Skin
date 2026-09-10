from typing import Protocol

import numpy as np

from app.domain.types import Environment, LoadEstimate, SolarState


class LoadPredictor(Protocol):
    def predict(self, env: Environment, solar: SolarState) -> LoadEstimate: ...


class DeterministicLoadPredictor:
    """Physics-inspired proxy used until a learned predictor is supplied."""

    def predict(self, env: Environment, solar: SolarState) -> LoadEstimate:
        sun_factor = np.clip(env.ghi / 1000.0, 0.0, 1.2)
        elevation_factor = np.clip(solar.elevation / 65.0, 0.0, 1.0)
        shadeable = float(
            np.clip(0.08 + 0.55 * sun_factor * (0.55 + 0.45 * elevation_factor), 0, 0.7)
        )
        internal = 0.12 * env.occupancy
        latent = float(
            np.clip(0.16 + 0.13 * env.occupancy + 0.004 * (env.indoor_rh - 55), 0.12, 0.42)
        )
        return LoadEstimate(
            total=shadeable + internal + latent,
            shadeable=max(0.0, shadeable - 0.08),
            latent=latent,
            internal=internal + 0.08,
        )


DEFAULT_PREDICTOR = DeterministicLoadPredictor()


def predict_load(env: Environment, solar: SolarState) -> LoadEstimate:
    return DEFAULT_PREDICTOR.predict(env, solar)


def shade_transmittance(angle: float) -> float:
    """Fraction of solar gain the louvres still let through at this angle."""

    shade_fraction = np.clip(angle / 60.0, 0.0, 1.0)
    return float(1.0 - 0.78 * shade_fraction)


def load_at_angle(load: LoadEstimate, angle: float, *, transmittance: float | None = None) -> float:
    transmission = shade_transmittance(angle) if transmittance is None else transmittance
    return float(load.latent + load.internal + load.shadeable * transmission)
