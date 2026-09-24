"""Live bridge between the ESP32 louvre rig and the digital twin.

Each tick the ESP32 posts four BH1750 readings and receives four louvre angles plus
each servo's calibration. Angles come from the backend's per-panel lux-band step
("auto"), the twin's zone angles pushed by the dashboard ("twin"), or fixed holds set
on the calibration page ("calibrate"). hardware/README.md documents the rig.
"""

import hmac
import json
import logging
import os
from pathlib import Path
from threading import Lock
from time import monotonic
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import DEFAULTS

router = APIRouter(prefix="/api/v1/hardware", tags=["hardware"])
logger = logging.getLogger("neuroskin.hardware")

PanelId = Literal["bh1", "bh2", "bh3", "bh4"]
# "wind" is the agent room's retreat: zone angles decided against the gust, held
# on the rig while the channel says the facade is under load.
ControlMode = Literal["auto", "twin", "calibrate", "wind"]
CommandMode = Literal["auto", "twin", "calibrate", "wind", "fault"]
# BH1/BH2 are the top row, BH3/BH4 the bottom row, seen from outside.
# ponytail: the rig stands in for one fixed 2x2 block of the west wall; edit to move it.
PANEL_ZONES: dict[str, str] = {"bh1": "W13", "bh2": "W14", "bh3": "W9", "bh4": "W10"}
# brain.lux_penalty's zero-penalty comfort band; commissioning values for the rig, not measured.
LUX_LOW = 300.0
LUX_HIGH = 700.0
STEP_DEG = 5.0
# A closed dashboard or calibration page must not freeze the rig on stale holds.
HOLD_TTL_S = 30.0
OFFLINE_AFTER_S = 3.0
LOOPBACK = {"127.0.0.1", "::1"}
# ponytail: one JSON file owned by this process; move to shared storage if several backends
# ever drive the same rig.
CALIBRATION_PATH = Path(__file__).resolve().parents[1] / "data" / "hardware_calibration.json"

# Physical louvre travel: 0° is perpendicular to the facade (the start position), 90° is
# parallel to it, and 180° is perpendicular again with the blade flipped.
ANGLE_MAX = 180.0
# Auto lux control shades on the 0–90° half: 0° open, 90° closed.
SHADE_MAX = 90.0
# The twin's louvres only travel 0–60°, so mirrored 1:1 the rig used a third of its shading
# half (and, over a real day, mostly under 10°: barely visible). Scale the twin's full range
# onto the rig's: the twin's fully shaded 60° becomes the rig's fully closed 90°.
# ponytail: linear. Raise this for a more theatrical demo; the clamp below saturates at closed
# rather than letting a bigger angle swing past 90° and reopen the louvre.
TWIN_GAIN = SHADE_MAX / DEFAULTS.angle_max
Angle = Annotated[float, Field(ge=0, le=ANGLE_MAX, allow_inf_nan=False)]
ServoDegrees = Annotated[float, Field(ge=0, le=180, allow_inf_nan=False)]
CsiAmplitude = Annotated[float, Field(ge=0, le=256, allow_inf_nan=False)]
CSI_BASELINE_WINDOWS = 30
CSI_MOTION_MULTIPLIER = 3.0
CSI_MIN_SIGMA = 0.2
CSI_MIN_FPS = 20


class CsiReading(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    uptime_ms: int = Field(ge=0, le=4_294_967_295, strict=True)
    window_ms: int = Field(ge=1, le=60_000, strict=True)
    frames: int = Field(ge=0, le=100_000, strict=True)
    ap: str = Field(pattern=r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")
    channel: int = Field(ge=1, le=14, strict=True)
    amplitude: CsiAmplitude | None
    sigma: CsiAmplitude | None
    rssi: int | None = Field(ge=-128, le=0, strict=True)
    amplitudes: list[CsiAmplitude] = Field(max_length=64)
    servos_moving: bool

    @model_validator(mode="after")
    def consistent_samples(self):
        present = self.amplitude is not None and self.sigma is not None and self.rssi is not None
        if self.frames and (not present or not self.amplitudes or not self.enabled):
            raise ValueError("CSI frames require enabled capture and measured amplitudes/RSSI.")
        if not self.frames and (
            self.amplitude is not None
            or self.sigma is not None
            or self.rssi is not None
            or self.amplitudes
        ):
            raise ValueError(
                "No CSI frames must report missing measurements, not zero or old data."
            )
        return self


class CsiStatus(CsiReading):
    sample_id: float
    frames_per_second: float
    state: Literal[
        "unavailable",
        "no_signal",
        "low_rate",
        "servos_moving",
        "calibrating",
        "motion",
        "quiet",
        "offline",
    ]
    calibration_windows: int
    calibration_required: int = CSI_BASELINE_WINDOWS
    baseline_sigma: float | None
    threshold: float | None


class PanelReading(BaseModel):
    # BH1750 saturates at 65535 counts; null means the sensor read failed.
    lux: float | None = Field(ge=0, le=65_535, allow_inf_nan=False)
    commanded_angle: Angle


class TickRequest(BaseModel):
    seq: int = Field(ge=0, le=4_294_967_295, strict=True)
    # Four Literal keys and exactly four entries: every panel, each once.
    panels: dict[PanelId, PanelReading] = Field(min_length=4, max_length=4)
    csi: CsiReading | None = None


class PanelCommand(BaseModel):
    angle: float
    mode: CommandMode
    reason: str


class ServoCalibration(BaseModel):
    # Servo degrees at louvre 0° and 180° (both perpendicular, blade flipped). Defaults span the
    # SG90's full travel and match the firmware's compiled fallback. Unknown keys are rejected,
    # so an older calibration file falls back to defaults instead of half-loading.
    model_config = ConfigDict(extra="forbid")

    servo_at_0: ServoDegrees = 0.0
    servo_at_180: ServoDegrees = 180.0


# Set on the rig: W13 (bh1) and W10 (bh4) turn the other way from louvre 0°, so their
# servos start at 180° and run toward 0°. W14/W9 use the plain 0° -> 180° travel.
# ponytail: a code default only; the /hardware page can still fine-tune it.
_REVERSED = ServoCalibration(servo_at_0=180.0, servo_at_180=0.0)
PANEL_CALIBRATION_DEFAULTS = {"bh1": _REVERSED, "bh4": _REVERSED}


def _default_calibration() -> dict[str, ServoCalibration]:
    return {
        panel: PANEL_CALIBRATION_DEFAULTS.get(panel, ServoCalibration()) for panel in PANEL_ZONES
    }


class CalibrationRequest(BaseModel):
    panels: dict[PanelId, ServoCalibration] = Field(min_length=4, max_length=4)


class TickResponse(BaseModel):
    panels: dict[PanelId, PanelCommand]
    calibration: dict[PanelId, ServoCalibration]


class ControlRequest(BaseModel):
    mode: ControlMode
    # Timeline updates/keepalives must never undo an explicit source change.
    refresh_only: bool = False
    # twin and wind: angles by mirrored zone; calibrate: angles by panel; auto: none.
    angles: dict[str, Angle] = Field(default_factory=dict, max_length=4, validate_default=True)

    @field_validator("angles")
    @classmethod
    def expected_keys(cls, value: dict[str, float], info):
        mode = info.data.get("mode")
        expected = {
            "twin": set(PANEL_ZONES.values()),
            "wind": set(PANEL_ZONES.values()),
            "calibrate": set(PANEL_ZONES),
        }.get(mode, set())
        if set(value) != expected:
            raise ValueError(
                f"{mode} mode needs angles for exactly: {', '.join(sorted(expected)) or 'none'}"
            )
        return value


class PanelStatus(BaseModel):
    zone: str
    lux: float | None = None
    commanded_angle: float | None = None
    target_angle: float | None = None
    mode: CommandMode | None = None
    reason: str = "No reading received yet."


class HardwareStatus(BaseModel):
    online: bool
    last_seen_s: float | None
    seq: int | None
    mode: ControlMode
    lux_band: tuple[float, float] = (LUX_LOW, LUX_HIGH)
    panels: dict[PanelId, PanelStatus]
    calibration: dict[PanelId, ServoCalibration]
    held: dict[PanelId, float]
    csi: CsiStatus | None = None


def _load_calibration() -> dict[str, ServoCalibration]:
    try:
        panels = json.loads(CALIBRATION_PATH.read_text())
        return CalibrationRequest.model_validate({"panels": panels}).panels
    except FileNotFoundError:
        pass
    except (OSError, ValueError):  # ValidationError and JSONDecodeError are ValueErrors
        logger.warning(
            "Ignoring unreadable servo calibration; using defaults",
            extra={"event": "hardware_calibration_invalid"},
        )
    return _default_calibration()


def _write_calibration(panels: dict[str, ServoCalibration]) -> None:
    CALIBRATION_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = CALIBRATION_PATH.with_suffix(".tmp")
    body = {panel: panels[panel].model_dump() for panel in PANEL_ZONES}
    temporary.write_text(json.dumps(body, indent=2) + "\n")
    temporary.replace(CALIBRATION_PATH)  # atomic: a crash never leaves half a file


def _initial_state() -> dict:
    return {
        "mode": "auto",
        "held": {},
        "held_at": 0.0,
        "seen_at": None,
        "seq": None,
        "panels": {},
        "csi": None,
        "csi_baseline": [],
        "calibration": _load_calibration(),
    }


# ponytail: process-local live state resets on restart (calibration reloads from its file);
# run a single uvicorn worker.
_state = _initial_state()
_lock = Lock()


def lux_step(lux: float | None, current: float) -> PanelCommand:
    """One hysteresis step: shade above the band, open below it, hold inside."""
    if lux is None:
        return PanelCommand(
            angle=current, mode="fault", reason="Sensor read failed; holding the commanded angle."
        )
    # A calibration hold past 90° comes back into the shading half.
    current = min(current, SHADE_MAX)
    if lux > LUX_HIGH:
        return PanelCommand(
            angle=min(SHADE_MAX, current + STEP_DEG),
            mode="auto",
            reason=f"{lux:.0f} lux above {LUX_HIGH:.0f}; shading.",
        )
    if lux < LUX_LOW:
        return PanelCommand(
            angle=max(0.0, current - STEP_DEG),
            mode="auto",
            reason=f"{lux:.0f} lux below {LUX_LOW:.0f}; opening.",
        )
    return PanelCommand(
        angle=current, mode="auto", reason=f"{lux:.0f} lux inside the band; holding."
    )


def _command(mode: str, panel: str, held: dict[str, float], reading: PanelReading) -> PanelCommand:
    if mode == "wind":
        return PanelCommand(
            angle=held[panel],
            mode="wind",
            reason=(
                f"Wind retreat: {PANEL_ZONES[panel]} holds {held[panel]:.0f}° "
                "until the gust is off its panel."
            ),
        )
    if mode == "twin":
        angle = min(SHADE_MAX, held[panel] * TWIN_GAIN)
        return PanelCommand(
            angle=angle,
            mode="twin",
            reason=(
                f"Mirroring twin zone {PANEL_ZONES[panel]}: {held[panel]:.0f}° "
                f"× {TWIN_GAIN:g} = {angle:.0f}°."
            ),
        )
    if mode == "calibrate":
        return PanelCommand(
            angle=held[panel], mode="calibrate", reason=f"Calibration hold at {held[panel]:.0f}°."
        )
    return lux_step(reading.lux, reading.commanded_angle)


def _authorise(x_hardware_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("HARDWARE_TOKEN", "").strip()
    if not expected:
        raise HTTPException(503, "Hardware bridge needs HARDWARE_TOKEN on the backend.")
    if not hmac.compare_digest((x_hardware_token or "").encode(), expected.encode()):
        raise HTTPException(401, "Invalid hardware token.")


def _local_only(request: Request) -> None:
    # Browser pages cannot hold a secret; only a browser on this machine may move the rig.
    if request.client is None or request.client.host not in LOOPBACK:
        raise HTTPException(403, "Hardware control is only accepted from this machine.")


def _update_csi(reading: CsiReading | None, now: float) -> None:
    previous = _state["csi"]
    if reading is None:
        _state.update(csi=None, csi_baseline=[])
        return
    if previous is not None and (
        reading.uptime_ms < previous.uptime_ms
        or (reading.ap, reading.channel) != (previous.ap, previous.channel)
        or now - _state["seen_at"] > OFFLINE_AFTER_S
    ):
        _state["csi_baseline"] = []
    baseline = _state["csi_baseline"]
    fps = reading.frames * 1000 / reading.window_ms
    if not reading.enabled:
        state = "unavailable"
    elif not reading.frames:
        state = "no_signal"
    elif fps < CSI_MIN_FPS or reading.frames < 5:
        state = "low_rate"
    elif reading.servos_moving:
        state = "servos_moving"
    elif len(baseline) < CSI_BASELINE_WINDOWS:
        baseline.append(reading.sigma)
        state = "calibrating"
    else:
        state = "quiet"
    ready = len(baseline) == CSI_BASELINE_WINDOWS
    average = sum(baseline) / len(baseline) if ready else None
    threshold = max(CSI_MIN_SIGMA, average * CSI_MOTION_MULTIPLIER) if ready else None
    # ponytail: signal-motion threshold, not human presence; use a validated model
    # if still-person detection or rejection of non-human motion is required.
    if state in {"quiet", "calibrating"} and ready:
        state = "motion" if reading.sigma > threshold else "quiet"
    _state["csi"] = CsiStatus(
        **reading.model_dump(),
        sample_id=now,
        frames_per_second=round(fps, 1),
        state=state,
        calibration_windows=len(baseline),
        baseline_sigma=average,
        threshold=threshold,
    )


@router.post("/tick", response_model=TickResponse, dependencies=[Depends(_authorise)])
def tick(batch: TickRequest) -> TickResponse:
    now = monotonic()
    with _lock:
        _update_csi(batch.csi, now)
        expired = _state["mode"] != "auto" and now - _state["held_at"] > HOLD_TTL_S
        if expired:
            _state.update(mode="auto", held={})
        commands = {
            panel: _command(_state["mode"], panel, _state["held"], reading)
            for panel, reading in batch.panels.items()
        }
        _state.update(
            seen_at=now,
            seq=batch.seq,
            panels={panel: (batch.panels[panel], commands[panel]) for panel in commands},
        )
        calibration = dict(_state["calibration"])
    if expired:
        logger.warning(
            "Held angles expired; auto lux control resumed",
            extra={"event": "hardware_hold_expired", "hardware_mode": "auto"},
        )
    return TickResponse(panels=commands, calibration=calibration)


@router.get("/status", response_model=HardwareStatus)
def status() -> HardwareStatus:
    now = monotonic()
    with _lock:
        seen = _state["seen_at"]
        age = None if seen is None else round(now - seen, 1)
        panels = {}
        for panel, zone in PANEL_ZONES.items():
            reading, command = _state["panels"].get(panel, (None, None))
            panels[panel] = (
                PanelStatus(zone=zone)
                if reading is None
                else PanelStatus(
                    zone=zone,
                    lux=reading.lux,
                    commanded_angle=reading.commanded_angle,
                    target_angle=command.angle,
                    mode=command.mode,
                    reason=command.reason,
                )
            )
        return HardwareStatus(
            online=age is not None and age <= OFFLINE_AFTER_S,
            last_seen_s=age,
            seq=_state["seq"],
            mode=_state["mode"],
            panels=panels,
            calibration=_state["calibration"],
            held=_state["held"],
            csi=(
                _state["csi"].model_copy(update={"state": "offline"})
                if _state["csi"] is not None and age > OFFLINE_AFTER_S
                else _state["csi"]
            ),
        )


@router.post("/csi/calibrate", response_model=HardwareStatus, dependencies=[Depends(_local_only)])
def calibrate_csi() -> HardwareStatus:
    with _lock:
        _state["csi_baseline"] = []
        if _state["csi"] is not None:
            _state["csi"] = _state["csi"].model_copy(
                update={
                    "state": "calibrating",
                    "calibration_windows": 0,
                    "baseline_sigma": None,
                    "threshold": None,
                }
            )
    return status()


@router.post("/control", response_model=HardwareStatus, dependencies=[Depends(_local_only)])
def control(request: ControlRequest) -> HardwareStatus:
    held = (
        {panel: request.angles[zone] for panel, zone in PANEL_ZONES.items()}
        if request.mode in ("twin", "wind")
        else dict(request.angles)
    )
    with _lock:
        if request.refresh_only and _state["mode"] != request.mode:
            raise HTTPException(409, "Control source changed; select the demo mode again.")
        changed = _state["mode"] != request.mode
        _state.update(mode=request.mode, held=held, held_at=monotonic())
    if changed:
        logger.info(
            "Hardware control mode changed",
            extra={"event": "hardware_mode_changed", "hardware_mode": request.mode},
        )
    return status()


@router.post("/calibration", response_model=HardwareStatus, dependencies=[Depends(_local_only)])
def save_calibration(request: CalibrationRequest) -> HardwareStatus:
    panels = {panel: request.panels[panel] for panel in PANEL_ZONES}
    with _lock:
        try:
            _write_calibration(panels)
        except OSError:
            logger.exception(
                "Servo calibration save failed", extra={"event": "hardware_calibration_failed"}
            )
            raise HTTPException(503, "Could not save servo calibration on the backend.") from None
        _state["calibration"] = panels
    logger.info("Servo calibration saved", extra={"event": "hardware_calibration_saved"})
    return status()
