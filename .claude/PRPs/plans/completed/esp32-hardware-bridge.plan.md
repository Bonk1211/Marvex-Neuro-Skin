# Plan: ESP32 Hardware Bridge for the Digital Twin

## Summary

Connect the physical 2×2 louvre rig (ESP32, 4 × BH1750 on two I²C buses, PCA9685 driving 4 × SG90)
to the existing NeuroSkin backend and dashboard. The ESP32 posts four lux readings over WiFi every
500 ms and gets back four louvre angles. The backend picks those angles in one of two modes: **auto**,
a per-panel lux-band step on the real readings, or **twin**, the digital twin's angles for four mapped
facade zones, pushed by the dashboard. A small always-mounted dashboard panel shows live lux and
commanded angles and switches the mode.

## User Story

As a **NeuroSkin demo presenter**, I want **the physical louvre rig to either regulate itself from its
own light sensors or mirror the digital twin's zone angles, with live readings shown in the
dashboard**, so that **judges can watch the simulated controller and real hardware act together, and
the rig keeps working when the dashboard is closed**.

## Problem → Solution

**Current:** The ESP32 rig runs a stand-alone circuit test sketch (I²C scan, servo sweep, lux printed
to Serial). `hardware/README.md` describes a Raspberry Pi + TCA9548A design that was never built. The
backend has no live routes; the twin only simulates. The PRD lists live sensors and actuator control as
non-goals.

**Desired:** A production ESP32 sketch talks to three new routes, `POST /api/v1/hardware/tick`,
`GET /api/v1/hardware/status` and `POST /api/v1/hardware/control`, in one new module,
`backend/app/hardware.py`. The dashboard shows the live 2×2 rig and can mirror the twin. When the
backend goes silent, the firmware moves to a safe angle on its own. The docs describe the ESP32 build
that actually exists.

## Metadata

- **Complexity**: Large (cross-cutting: firmware + backend + frontend + docs, one new external integration)
- **Source PRD**: N/A (free-form request). **Contradicts `docs/neuroskin_software_prd.md` §4.3 non-goals**; see Task 11 and Risks.
- **PRD Phase**: N/A
- **Estimated Files**: 15 (6 create, 9 update)

## Decisions already made (do not re-litigate)

| Decision | Choice | Source |
|---|---|---|
| Who decides servo angles | Both, switchable: `auto` (lux policy, default) / `twin` (dashboard pushes twin angles) | User answer |
| Transport | WiFi HTTP, ESP32 is the client, synchronous request/response per tick | User answer |
| Pins, buses, addresses, PCA9685 address, servo channels, pulse ticks | Copied from the user's verified circuit test sketch | User sketch |
| Acknowledgement | No `/ack` route: the firmware reports `commanded_angle` (what it actually wrote) in the next tick | Ponytail: synchronous HTTP makes a separate ack redundant |
| Wind safety | Not built: no anemometer is wired | Wiring diagram |

---

## Hardware facts (from user wiring + circuit test sketch)

| Panel id | Sensor | I²C bus (ESP32 `TwoWire`) | SDA/SCL | BH1750 addr | ADDR pin | PCA9685 ch | Twin zone (assumed) |
|---|---|---|---|---|---|---|---|
| `bh1` | BH1750 #1 | `I2C_BUS1 = TwoWire(0)` | GPIO21 / GPIO22 | `0x23` | GND | 4 | `W13` (top-left) |
| `bh2` | BH1750 #2 | `I2C_BUS1` | GPIO21 / GPIO22 | `0x5C` | 3.3 V | 5 | `W14` (top-right) |
| `bh3` | BH1750 #3 | `I2C_BUS2 = TwoWire(1)` | GPIO32 / GPIO33 | `0x23` | GND | 6 | `W9` (bottom-left) |
| `bh4` | BH1750 #4 | `I2C_BUS2` | GPIO32 / GPIO33 | `0x5C` | 3.3 V | 7 | `W10` (bottom-right) |

- PCA9685 at `0x40` on BUS1. Both buses at 100 kHz.
- Servo pulse: `SERVO_MIN 205` / `SERVO_MAX 410` PCA9685 ticks at 50 Hz for servo 0°–180° (≈1000–2000 µs),
  with the default 25 MHz oscillator. The sketch only tested servo angles 45°–135°.
- Sensor #N is paired with servo N (`servoChannels[i]` in the test sketch).
- `readLightLevel()` < 0 means a read error (test sketch convention).
- Twin zone ids: `f"{orientation[0].upper()}{row * columns + column + 1}"`, with rows counted from the
  bottom and columns from the left as seen from outside, in a 4×4 grid (`backend/app/domain/facade.py:275`).
  Top row = 13–16, second row = 9–12. So a 2×2 block with BUS1 as the top row maps to `W13 W14 / W9 W10`.
  **The physical position of each sensor is an assumption**; confirm it during validation and edit `PANEL_ZONES`.
- Twin louvre angle range is 0–60° (`DEFAULTS.angle_min/angle_max`). 0 = flat/retracted
  (`safety.retract_flat`); a higher angle means more shading.
- Toolchain on this machine: Arduino IDE 2 with bundled `arduino-cli`, ESP32 core **3.3.11**. Libraries
  `BH1750` (claws) and `Adafruit_PWM_Servo_Driver_Library` are installed. **`ArduinoJson` is NOT installed.**

---

## UX Design

### Before
```
Dashboard right rail                 Physical rig
┌──────────────────────────┐        ┌──────────────────────────┐
│ SimulationControls       │        │ ESP32 circuit test:      │
│ (simulation only; no     │   ✗    │ sweeps servos at boot,   │
│  hardware anywhere)      │        │ prints lux to Serial     │
└──────────────────────────┘        └──────────────────────────┘
```

### After
```
Dashboard right rail (every lens)
┌──────────────────────────────────────────────┐
│ SimulationControls                           │
├──────────────────────────────────────────────┤
│ Live hardware · ESP32        online · 0.4s   │
│ [Auto (lux)] [Mirror twin]                   │
│ ┌─────────────────────┬─────────────────────┐│
│ │ BH1 → W13     35.0° │ BH2 → W14     25.0° ││
│ │ 912 lux · tgt 40.0° │ 140 lux · tgt 20.0° ││
│ ├─────────────────────┼─────────────────────┤│
│ │ BH3 → W9      30.0° │ BH4 → W10     30.0° ││
│ │ 512 lux · tgt 30.0° │ sensor fault        ││
│ └─────────────────────┴─────────────────────┘│
│ Measured lux; angles are commanded, not      │
│ measured.                                    │
└──────────────────────────────────────────────┘
        ▲ GET /status every 1 s
        │ POST /control (mode switch; twin angles every 5 s + on tick change)
   FastAPI ◀── POST /tick every 500 ms (lux + commanded angles) ── ESP32
           ──▶ 4 target angles ─────────────────────────────────▶ PCA9685 → SG90
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Dashboard right rail | Simulation controls only | + Live hardware card in every lens | Mounted beside `SimulationControls`, so twin mirroring survives lens changes |
| "Mirror twin" button | n/a | Pushes the selected tick's angles for W13/W14/W9/W10 | Disabled when the tick has no zone data (uncontrolled variant, no run yet) |
| Timeline scrub while mirroring | n/a | Servos follow the selected tick | Push on every angle change + every 5 s keep-alive |
| Close dashboard while mirroring | n/a | Backend reverts to auto 30 s later | `TWIN_TTL_S` |
| Backend stopped | n/a | ESP32 moves louvres to `SAFE_ANGLE_DEG` after 3 s | Firmware-local, no backend needed |
| Sensor unplugged | n/a | That panel shows "sensor fault" and holds its angle; others continue | Sensor restarted automatically when it returns |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `backend/app/vision.py` | 1-35, 141-177 | Router module shape, env-secret 503 guard, Pydantic bounds |
| P0 | `backend/app/feed_health.py` | all (42) | Process-local state + `Lock` + ponytail comment, the pattern for live state |
| P0 | `backend/app/schemas.py` | 1-36 | `ZoneId` type, `Field` bounds with `allow_inf_nan=False`, `field_validator` using `info.data` |
| P0 | `backend/app/main.py` | 1-40 | Router registration, CORS config |
| P0 | `frontend/src/components/neuroskin/FeedsPanel.tsx` | 1-60 | Polling effect with AbortController + timeout |
| P0 | `frontend/src/lib/api-client.ts` | all | `get`/`post` helpers, co-located response types |
| P1 | `backend/app/logging_config.py` | 1-35 | `LOG_FIELDS` allowlist: unknown `extra` keys are silently dropped |
| P1 | `backend/tests/test_vision.py` | 1-20 | TestClient + `monkeypatch.setenv/delenv` |
| P1 | `backend/tests/test_api.py` | 22-40 | `monkeypatch.setattr(module, "_state", ...)` state reset |
| P1 | `frontend/src/components/neuroskin/FeedsPanel.test.tsx` | 1-60 | `vi.stubGlobal('fetch', ...)` test style |
| P1 | `frontend/src/components/neuroskin/ZoneSensorPanel.tsx` | 44-80 | Card / toggle-button class names and aria style |
| P1 | `frontend/src/components/neuroskin/NeuroSkinDashboard.tsx` | 180, 406-407, 1117-1140 | `isControlled`, `selectedTick`, right-rail mount point |
| P2 | `hardware/README.md` | all | Doc to rewrite; keep its validation discipline |
| P2 | `backend/app/domain/brain.py` | 29-35 | Source of the 300–700 lux comfort band |
| P2 | `Makefile` | 1-20 | `backend` target to extend with `HOST` |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| BH1750 (claws) | `github.com/claws/BH1750/src/BH1750.h` | `bool begin(Mode mode = CONTINUOUS_HIGH_RES_MODE, byte addr = 0x23, TwoWire* i2c = nullptr)`; `float readLightLevel()` (negative on error) |
| Adafruit PWM Servo Driver | `Adafruit_PWMServoDriver.h` | `Adafruit_PWMServoDriver(const uint8_t addr, TwoWire& i2c)`; `bool begin(uint8_t prescale = 0)`; `setOscillatorFrequency(uint32_t)`; `setPWMFreq(float)`; `FREQUENCY_OSCILLATOR 25000000` |
| ESP32 HTTPClient (core 3.x) | `arduino-esp32/libraries/HTTPClient/src/HTTPClient.h` | `bool begin(String url)`; `setConnectTimeout(int32_t ms)`; `setTimeout(uint16_t ms)`; `addHeader(name, value)`; `int POST(String)`; `String getString()`; `end()`; negative return codes are client errors (`HTTPClient::errorToString(code)`) |
| ArduinoJson v7 | arduinojson.org/v7 | `JsonDocument doc;` `doc["a"].to<JsonObject>()`; `serializeJson(doc, String)`; `deserializeJson(doc, String)` returns `DeserializationError` (truthy on failure); `v.is<float>()` is true for any number; assign `nullptr` for JSON null |

```
KEY_INSIGHT: setPWMFreq() computes the prescale from the stored oscillator frequency.
APPLIES_TO: firmware setup()
GOTCHA: call setOscillatorFrequency() AFTER begin() (begin resets it) and BEFORE setPWMFreq(50).

KEY_INSIGHT: ESP32 WiFi modem sleep (default) adds ~100+ ms latency to each request.
APPLIES_TO: firmware setup()
GOTCHA: WiFi.setSleep(false). ESP32 only joins 2.4 GHz WPA2-Personal networks with WiFi.begin(ssid, pass);
        campus WPA2-Enterprise networks will not work, so use a phone hotspot.

KEY_INSIGHT: Pydantic v2 does not run field validators on default values.
APPLIES_TO: ControlRequest.angles
GOTCHA: without validate_default=True, {"mode": "twin"} with no angles passes validation and KeyErrors later.

KEY_INSIGHT: FastAPI solves route dependencies before validating the body model.
APPLIES_TO: /tick auth
GOTCHA: put the token check in dependencies=[Depends(_authorise)] so a wrong token gets 401, not a 422 that reveals the schema.

KEY_INSIGHT: Starlette TestClient (installed: starlette 1.6.0, fastapi 0.141.1, pydantic 2.13.4) reports client host "testclient" by default.
APPLIES_TO: /control loopback-only check in tests
GOTCHA: construct TestClient(app, client=("127.0.0.1", 50000)) for allowed calls.
```

---

## Patterns to Mirror

### NAMING_CONVENTION (router module)
```python
# SOURCE: backend/app/vision.py:1-16
"""Cloud inference for camera frames, including frames from prerecorded demos."""
...
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.feed_health import record_feed

router = APIRouter(prefix="/api/v1/vision", tags=["vision"])
```
Module docstring, stdlib → third-party → `app.` imports (ruff `I`), module-level `router`, `PascalCase`
Pydantic models, `snake_case` route functions, `_private` helpers, UPPER_CASE module constants.

### ERROR_HANDLING (missing secret → 503, never echo secrets)
```python
# SOURCE: backend/app/vision.py:141-145
@router.post("/clouds", response_model=CloudResult)
def detect_clouds(frame: CloudFrame) -> CloudResult:
    key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "Cloud vision needs ROBOFLOW_API_KEY on the backend.")
```

### STATE_PATTERN (process-local, locked)
```python
# SOURCE: backend/app/feed_health.py:9-21
# ponytail: process-local observations reset on restart; share storage if workers need one view.
_observations: dict[str, dict[str, str | None]] = {}
_lock = Lock()


def record_feed(name: str, status: str, fetched_at: datetime | None = None) -> None:
    with _lock:
        previous = _observations.get(name, {})
        ...
        _observations[name] = {"last_status": status, "last_success_at": success}
    logger.info(
        "Feed observed",
        extra={"event": "feed_observed", "environment_source": name, "weather_status": status},
    )
```
Log **after** releasing the lock.

### VALIDATION_PATTERN
```python
# SOURCE: backend/app/schemas.py:14-36
ZoneId = Annotated[str, Field(pattern=r"^[NESW](?:[1-9]|1[0-6])$")]


class ZoneSensorOverride(BaseModel):
    tick_index: int = Field(ge=0, le=143, strict=True)
    irradiance: float = Field(ge=0, le=1600, allow_inf_nan=False)
    illuminance: float = Field(ge=0, le=10000, allow_inf_nan=False)


class WeightInput(BaseModel):
    ...
    @field_validator("risk")
    @classmethod
    def at_least_one_weight(cls, value: float, info):
        values = [value, *[float(v) for v in info.data.values()]]
        if sum(values) <= 0:
            raise ValueError("At least one controller weight must be greater than zero")
        return value
```

### LOGGING_PATTERN
```python
# SOURCE: backend/app/main.py:137-151 (plan_slab_charging)
    logger.info(
        "Slab plan completed",
        extra={
            "event": "slab_plan_completed",
            "request_id": request_id,
            ...
        },
    )
```
```python
# SOURCE: backend/app/logging_config.py:7-32 — every extra key must be listed or JsonFormatter drops it
LOG_FIELDS = (
    "event",
    ...
    # Predictive slab charging.
    "planned_date",
    ...
    "saving_percent",
)
```
Logger names are `neuroskin.<area>`, e.g. `logging.getLogger("neuroskin.feeds")`.

### ROUTER_REGISTRATION
```python
# SOURCE: backend/app/main.py:21, 34
from app.vision import router as vision_router
...
app.include_router(vision_router)
```

### TEST_STRUCTURE (backend)
```python
# SOURCE: backend/tests/test_vision.py:1-20 and backend/tests/test_api.py:22-27
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_cloud_workflow_contract_and_failures(monkeypatch):
    monkeypatch.delenv("ROBOFLOW_API_KEY", raising=False)
    assert client.post("/api/v1/vision/clouds", json=FRAME).status_code == 503
    monkeypatch.setenv("ROBOFLOW_API_KEY", "test-secret")
    ...

def test_health_reports_observations_without_contacting_upstreams(monkeypatch) -> None:
    from app import feed_health

    monkeypatch.setattr(feed_health, "_observations", {})
```

### FRONTEND_POLLING
```tsx
// SOURCE: frontend/src/components/neuroskin/FeedsPanel.tsx:17-40
  useEffect(() => {
    let controller: AbortController | null = null
    const refresh = async () => {
      controller?.abort()
      const pending = new AbortController()
      controller = pending
      const timeout = setTimeout(() => pending.abort(), 5000)
      try {
        const result = await getHealth(pending.signal)
        if (!pending.signal.aborted) setHealth(result)
      } catch {
        setHealth(null)
      } finally {
        clearTimeout(timeout)
        setNow(Date.now())
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30000)
    return () => {
      controller?.abort()
      clearInterval(timer)
    }
  }, [])
```

### FRONTEND_API_CLIENT
```ts
// SOURCE: frontend/src/lib/api-client.ts:41-43, 68-86
export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return get('/api/v1/health', 'Health', signal)
}
...
async function post<T>(path: string, body: unknown, label: string, signal?: AbortSignal): Promise<T> {
  // throws Error(detail || `${label} API returned ${status}.`)
}
```
Response interfaces live in `api-client.ts` next to their functions (`HealthResponse`, `CloudResult`).

### FRONTEND_CARD_STYLE
```tsx
// SOURCE: frontend/src/components/neuroskin/ZoneSensorPanel.tsx:46-78
    <section className='console-card' aria-label={...}>
      <h3 className='console-card-title flex justify-between gap-2'>
      ...
      <div role='group' aria-label={...} className='mt-2 grid grid-cols-4 gap-1'>
          <button type='button' aria-pressed={zone.zone === selectedZone}
            className={`min-w-0 rounded border px-1 py-1.5 text-left font-mono text-[10px] ${zone.zone === selectedZone ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary/60'}`}
```
Single quotes in JSX attributes, no semicolons (Prettier config).

### TEST_STRUCTURE (frontend)
```tsx
// SOURCE: frontend/src/components/neuroskin/FeedsPanel.test.tsx:1-15
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeedsPanel } from './FeedsPanel'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('feed observations', () => {
  it('shows an unconfigured feed without presenting an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({...}) }))
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `hardware/esp32/neuroskin_bridge/neuroskin_bridge.ino` | CREATE | Production firmware (folder name must equal sketch name) |
| `hardware/esp32/neuroskin_bridge/secrets.h.example` | CREATE | WiFi / backend URL / token template (no `.h` extension, so the IDE ignores it) |
| `backend/app/hardware.py` | CREATE | Live routes, models, lux policy, process-local state |
| `backend/tests/test_hardware.py` | CREATE | Focused contract + policy tests |
| `frontend/src/components/neuroskin/LiveHardwarePanel.tsx` | CREATE | Live 2×2 status + mode switch + twin push |
| `frontend/src/components/neuroskin/LiveHardwarePanel.test.tsx` | CREATE | Render + mirror push tests |
| `backend/app/main.py` | UPDATE | Register `hardware_router` |
| `backend/app/logging_config.py` | UPDATE | Add `hardware_mode` to `LOG_FIELDS` |
| `backend/.env.example` | UPDATE | Document `HARDWARE_TOKEN` |
| `Makefile` | UPDATE | `HOST ?= 127.0.0.1` so the ESP32 can reach the backend with `HOST=0.0.0.0` |
| `.gitignore` | UPDATE | Ignore `hardware/esp32/**/secrets.h` |
| `frontend/src/lib/api-client.ts` | UPDATE | Hardware types + `getHardwareStatus` / `setHardwareControl` |
| `frontend/src/components/neuroskin/NeuroSkinDashboard.tsx` | UPDATE | Mount `LiveHardwarePanel` in right rail |
| `hardware/README.md` | UPDATE | Replace Pi/TCA9548A plan with the as-built ESP32 bridge |
| `README.md` + `docs/neuroskin_software_prd.md` | UPDATE | Remove "no hardware integration" claim; record the §4.3 exception |

## NOT Building

- **Wind / anemometer safety**: nothing is wired. The twin's wind override stays simulated only.
- **Separate `/ack` route, command ids, seq echo checks**: synchronous HTTP already pairs request and reply; `commanded_angle` in the next tick is the ack.
- **Feeding real lux into the simulation** (`zone_sensor_overrides`): BH1750 lux behind a model louvre is not facade irradiance (`hardware/README.md` warns against lux-as-W/m²).
- **MQTT, WebSocket, OTA updates, mDNS discovery**: backend IP is hard-coded in `secrets.h`.
- **Persistence/history of readings, multi-worker shared state**: single uvicorn worker, state resets on restart.
- **Per-panel lux bands, per-panel servo calibration on the backend**: one shared band; servo calibration lives in firmware.
- **Remote access, Cloudflare tunnel, user auth, HTTPS on the LAN**.
- **Committing the circuit test sketch**: the user keeps it for commissioning (I²C scan, servo sweep).
- **Boot-time servo sweep** in production firmware: it would move louvres unexpectedly on every reset.

---

## Step-by-Step Tasks

### Task 1: Backend live bridge module
- **ACTION**: Create `backend/app/hardware.py`.
- **IMPLEMENT**: Use this module as the reference implementation. Keep names exactly; tests and the frontend depend on them.
```python
"""Live bridge between the ESP32 louvre rig and the digital twin.

Each tick the ESP32 posts four BH1750 readings and receives four louvre angles:
the backend's per-panel lux-band step ("auto") or the twin's zone angles pushed
by the dashboard ("twin"). hardware/README.md documents wiring and calibration.
"""

import hmac
import logging
import os
from threading import Lock
from time import monotonic
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.config import DEFAULTS
from app.schemas import ZoneId

router = APIRouter(prefix="/api/v1/hardware", tags=["hardware"])
logger = logging.getLogger("neuroskin.hardware")

PanelId = Literal["bh1", "bh2", "bh3", "bh4"]
CommandMode = Literal["auto", "twin", "fault"]
# BH1/BH2 share I2C bus 1 (top row), BH3/BH4 bus 2 (bottom row), seen from outside.
# ponytail: the rig stands in for one fixed 2x2 block of the west wall; edit to move it.
PANEL_ZONES: dict[str, str] = {"bh1": "W13", "bh2": "W14", "bh3": "W9", "bh4": "W10"}
# brain.lux_penalty's zero-penalty comfort band; commissioning values for the rig, not measured.
LUX_LOW = 300.0
LUX_HIGH = 700.0
STEP_DEG = 5.0
# A closed dashboard must not freeze the rig on stale twin angles.
TWIN_TTL_S = 30.0
OFFLINE_AFTER_S = 3.0
LOOPBACK = {"127.0.0.1", "::1"}

Angle = Annotated[
    float, Field(ge=DEFAULTS.angle_min, le=DEFAULTS.angle_max, allow_inf_nan=False)
]


class PanelReading(BaseModel):
    # BH1750 saturates at 65535 counts; null means the sensor read failed.
    lux: float | None = Field(ge=0, le=65_535, allow_inf_nan=False)
    commanded_angle: Angle


class TickRequest(BaseModel):
    seq: int = Field(ge=0, le=4_294_967_295, strict=True)
    # Four Literal keys and exactly four entries: every panel, each once.
    panels: dict[PanelId, PanelReading] = Field(min_length=4, max_length=4)


class PanelCommand(BaseModel):
    angle: float
    mode: CommandMode
    reason: str


class TickResponse(BaseModel):
    panels: dict[PanelId, PanelCommand]


class ControlRequest(BaseModel):
    mode: Literal["auto", "twin"]
    angles: dict[ZoneId, Angle] = Field(default_factory=dict, max_length=4, validate_default=True)

    @field_validator("angles")
    @classmethod
    def mapped_zones_only(cls, value: dict[str, float], info):
        mode = info.data.get("mode")
        expected = set(PANEL_ZONES.values()) if mode == "twin" else set()
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
    mode: Literal["auto", "twin"]
    lux_band: tuple[float, float] = (LUX_LOW, LUX_HIGH)
    panels: dict[PanelId, PanelStatus]


def _initial_state() -> dict:
    return {"mode": "auto", "twin": {}, "twin_at": 0.0, "seen_at": None, "seq": None, "panels": {}}


# ponytail: process-local live state resets on restart; run a single uvicorn worker.
_state = _initial_state()
_lock = Lock()


def lux_step(lux: float | None, current: float) -> PanelCommand:
    """One hysteresis step: shade above the band, open below it, hold inside."""
    if lux is None:
        return PanelCommand(
            angle=current, mode="fault", reason="Sensor read failed; holding the commanded angle."
        )
    if lux > LUX_HIGH:
        return PanelCommand(
            angle=min(DEFAULTS.angle_max, current + STEP_DEG),
            mode="auto",
            reason=f"{lux:.0f} lux above {LUX_HIGH:.0f}; shading.",
        )
    if lux < LUX_LOW:
        return PanelCommand(
            angle=max(DEFAULTS.angle_min, current - STEP_DEG),
            mode="auto",
            reason=f"{lux:.0f} lux below {LUX_LOW:.0f}; opening.",
        )
    return PanelCommand(angle=current, mode="auto", reason=f"{lux:.0f} lux inside the band; holding.")


def _authorise(x_hardware_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("HARDWARE_TOKEN", "").strip()
    if not expected:
        raise HTTPException(503, "Hardware bridge needs HARDWARE_TOKEN on the backend.")
    if not hmac.compare_digest((x_hardware_token or "").encode(), expected.encode()):
        raise HTTPException(401, "Invalid hardware token.")


@router.post("/tick", response_model=TickResponse, dependencies=[Depends(_authorise)])
def tick(batch: TickRequest) -> TickResponse:
    now = monotonic()
    with _lock:
        expired = _state["mode"] == "twin" and now - _state["twin_at"] > TWIN_TTL_S
        if expired:
            _state["mode"] = "auto"
        commands = {
            panel: (
                PanelCommand(
                    angle=_state["twin"][panel],
                    mode="twin",
                    reason=f"Mirroring twin zone {PANEL_ZONES[panel]}.",
                )
                if _state["mode"] == "twin"
                else lux_step(reading.lux, reading.commanded_angle)
            )
            for panel, reading in batch.panels.items()
        }
        _state.update(
            seen_at=now,
            seq=batch.seq,
            panels={panel: (batch.panels[panel], commands[panel]) for panel in commands},
        )
    if expired:
        logger.warning(
            "Twin angles expired; auto lux control resumed",
            extra={"event": "hardware_twin_expired", "hardware_mode": "auto"},
        )
    return TickResponse(panels=commands)


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
        )


@router.post("/control", response_model=HardwareStatus)
def control(request: ControlRequest, http_request: Request) -> HardwareStatus:
    # The dashboard cannot hold a secret; only a browser on this machine may move the rig.
    if http_request.client is None or http_request.client.host not in LOOPBACK:
        raise HTTPException(403, "Hardware control is only accepted from this machine.")
    with _lock:
        changed = _state["mode"] != request.mode
        _state["mode"] = request.mode
        if request.mode == "twin":
            _state["twin"] = {panel: request.angles[zone] for panel, zone in PANEL_ZONES.items()}
            _state["twin_at"] = monotonic()
    if changed:
        logger.info(
            "Hardware control mode changed",
            extra={"event": "hardware_mode_changed", "hardware_mode": request.mode},
        )
    return status()
```
- **MIRROR**: NAMING_CONVENTION, ERROR_HANDLING, STATE_PATTERN, VALIDATION_PATTERN, LOGGING_PATTERN.
- **IMPORTS**: shown above; `ZoneId` from `app.schemas`, `DEFAULTS` from `app.config`.
- **GOTCHA**:
  - `status()` takes `_lock`; `control()` must release the lock before calling `status()` (`threading.Lock` is not re-entrant).
  - `validate_default=True` on `angles` is required (see External Documentation).
  - Auth lives in `dependencies=[Depends(_authorise)]` so 401/503 come before body 422.
  - Twin mode ignores sensor faults on purpose: twin angles do not depend on lux. Status still shows `lux: null`.
  - `from time import monotonic` (not `time.monotonic`) so tests can `monkeypatch.setattr(hardware, "monotonic", ...)`.
  - Behind the Docker compose port mapping, the client host is the Docker gateway, so `/control` returns 403. Run the bridge with `make backend`; this is documented in Task 10.
- **VALIDATE**: `cd backend && uv run ruff check app/hardware.py`.

### Task 2: Register router + log field
- **ACTION**: Update `backend/app/main.py` and `backend/app/logging_config.py`.
- **IMPLEMENT**:
  - `main.py`: add `from app.hardware import router as hardware_router` (import sorted before `app.logging_config`), then `app.include_router(hardware_router)` directly above `app.include_router(vision_router)`.
  - `logging_config.py`: append to `LOG_FIELDS` after `"saving_percent",`:
    ```python
        # Live hardware bridge.
        "hardware_mode",
    ```
- **MIRROR**: ROUTER_REGISTRATION, LOGGING_PATTERN.
- **GOTCHA**: CORS needs no change: the ESP32 is not a browser, and the dashboard only sends `Content-Type`. Do not add `X-Hardware-Token` to `allow_headers`, because browsers must never send it.
- **VALIDATE**: `cd backend && uv run python -c "from app.main import app; print([r.path for r in app.routes if 'hardware' in r.path])"` prints the three routes.

### Task 3: Backend tests
- **ACTION**: Create `backend/tests/test_hardware.py`.
- **IMPLEMENT**:
```python
import logging

import pytest
from fastapi.testclient import TestClient

from app import hardware
from app.main import app

client = TestClient(app, client=("127.0.0.1", 50000))
TOKEN = {"X-Hardware-Token": "test-token"}
TWIN = {"W13": 10, "W14": 20, "W9": 40, "W10": 60}


def reading(lux: float | None = 500.0, angle: float = 30.0) -> dict:
    return {"lux": lux, "commanded_angle": angle}


def batch(**panels: dict) -> dict:
    return {"seq": 1, "panels": {panel: reading() for panel in hardware.PANEL_ZONES} | panels}


def tick(body: dict, headers: dict = TOKEN):
    return client.post("/api/v1/hardware/tick", json=body, headers=headers)


@pytest.fixture(autouse=True)
def fresh_bridge(monkeypatch):
    monkeypatch.setenv("HARDWARE_TOKEN", "test-token")
    monkeypatch.setattr(hardware, "_state", hardware._initial_state())
    clock = [1000.0]
    monkeypatch.setattr(hardware, "monotonic", lambda: clock[0])
    return clock


def test_tick_requires_configured_token(monkeypatch) -> None:
    assert tick(batch(), headers={"X-Hardware-Token": "wrong"}).status_code == 401
    assert tick(batch(), headers={}).status_code == 401
    monkeypatch.delenv("HARDWARE_TOKEN")
    assert tick(batch()).status_code == 503


def test_tick_rejects_incomplete_or_out_of_range_batches() -> None:
    missing = batch()
    del missing["panels"]["bh4"]
    assert tick(missing).status_code == 422
    assert tick(batch(bh5=reading())).status_code == 422
    assert tick(batch(bh1=reading(lux=-1))).status_code == 422
    assert tick(batch(bh1=reading(angle=61))).status_code == 422


def test_lux_band_steps_each_panel_independently() -> None:
    panels = tick(
        batch(bh1=reading(900), bh2=reading(100), bh3=reading(500), bh4=reading(None))
    ).json()["panels"]
    assert {panel: command["angle"] for panel, command in panels.items()} == {
        "bh1": 35,
        "bh2": 25,
        "bh3": 30,
        "bh4": 30,
    }
    assert [panels[p]["mode"] for p in ("bh1", "bh2", "bh3", "bh4")] == [
        "auto",
        "auto",
        "auto",
        "fault",
    ]


def test_lux_step_clamps_to_the_twin_angle_range() -> None:
    assert hardware.lux_step(900, 58).angle == 60
    assert hardware.lux_step(100, 2).angle == 0


def test_twin_mode_mirrors_zone_angles_then_expires(fresh_bridge, caplog) -> None:
    with caplog.at_level(logging.INFO, logger="neuroskin.hardware"):
        response = client.post("/api/v1/hardware/control", json={"mode": "twin", "angles": TWIN})
    assert response.json()["mode"] == "twin"
    assert any(record.event == "hardware_mode_changed" for record in caplog.records)
    panels = tick(batch(bh1=reading(900, 0))).json()["panels"]
    assert {p: c["angle"] for p, c in panels.items()} == {"bh1": 10, "bh2": 20, "bh3": 40, "bh4": 60}

    fresh_bridge[0] += hardware.TWIN_TTL_S + 1
    panels = tick(batch(bh1=reading(900, 0))).json()["panels"]
    assert panels["bh1"] == {"angle": 5, "mode": "auto", "reason": "900 lux above 700; shading."}
    assert client.get("/api/v1/hardware/status").json()["mode"] == "auto"


def test_control_validates_twin_angles_and_origin() -> None:
    url = "/api/v1/hardware/control"
    assert client.post(url, json={"mode": "twin"}).status_code == 422
    assert client.post(url, json={"mode": "twin", "angles": {**TWIN, "W13": 61}}).status_code == 422
    partial = {zone: angle for zone, angle in TWIN.items() if zone != "W10"}
    assert client.post(url, json={"mode": "twin", "angles": partial | {"W1": 0}}).status_code == 422
    assert client.post(url, json={"mode": "auto", "angles": TWIN}).status_code == 422
    remote = TestClient(app, client=("192.168.1.20", 50000))
    assert remote.post(url, json={"mode": "auto"}).status_code == 403


def test_status_reports_last_batch_then_goes_offline(fresh_bridge) -> None:
    idle = client.get("/api/v1/hardware/status").json()
    assert idle["online"] is False and idle["last_seen_s"] is None
    assert idle["panels"]["bh1"] == {
        "zone": "W13",
        "lux": None,
        "commanded_angle": None,
        "target_angle": None,
        "mode": None,
        "reason": "No reading received yet.",
    }
    tick(batch(bh1=reading(900, 30)))
    live = client.get("/api/v1/hardware/status").json()
    assert live["online"] is True and live["lux_band"] == [300, 700]
    assert live["panels"]["bh1"] == {
        "zone": "W13",
        "lux": 900,
        "commanded_angle": 30,
        "target_angle": 35,
        "mode": "auto",
        "reason": "900 lux above 700; shading.",
    }
    fresh_bridge[0] += hardware.OFFLINE_AFTER_S + 1
    assert client.get("/api/v1/hardware/status").json()["online"] is False
```
- **MIRROR**: TEST_STRUCTURE (backend).
- **GOTCHA**: The `fresh_bridge` fixture patches `monotonic` for every test, so status ages are deterministic. Keep lines ≤ 100 chars (ruff `E501`); wrap the longest asserts if ruff complains.
- **VALIDATE**: `cd backend && uv run pytest tests/test_hardware.py` → all pass.

### Task 4: Backend run config
- **ACTION**: Update `Makefile`, `backend/.env.example`, `.gitignore`.
- **IMPLEMENT**:
  - `Makefile`, above `backend:`:
    ```make
    # HOST=0.0.0.0 lets the ESP32 reach the API over WiFi; loopback by default.
    HOST ?= 127.0.0.1

    backend:
    	cd backend && uv run uvicorn app.main:app --reload --host $(HOST) --port 8000 $(if $(wildcard backend/.env),--env-file .env,)
    ```
    (Recipe line uses a TAB.)
  - `backend/.env.example`, append:
    ```
    # Shared secret the ESP32 sends as X-Hardware-Token (hardware/esp32/neuroskin_bridge/secrets.h).
    HARDWARE_TOKEN=
    ```
  - `.gitignore`, append under "Local environment files":
    ```
    hardware/esp32/**/secrets.h
    ```
- **GOTCHA**: Command-line variables propagate to sub-makes, so `make dev HOST=0.0.0.0` works. **Do not print or overwrite `backend/.env`**; it holds `ROBOFLOW_API_KEY`. Tell the user to add `HARDWARE_TOKEN=<random>` themselves (`python3 -c "import secrets; print(secrets.token_urlsafe(24))"`).
- **VALIDATE**: `make -n backend HOST=0.0.0.0` shows `--host 0.0.0.0`; `touch hardware/esp32/neuroskin_bridge/secrets.h && git check-ignore hardware/esp32/neuroskin_bridge/secrets.h` prints the path.

### Task 5: ESP32 firmware
- **ACTION**: Create `hardware/esp32/neuroskin_bridge/neuroskin_bridge.ino` and `secrets.h.example`.
- **IMPLEMENT** `secrets.h.example`:
```cpp
// Copy to secrets.h (gitignored) and fill in. ESP32 joins 2.4 GHz WPA2-Personal only.
#define WIFI_SSID "your-2.4GHz-network"
#define WIFI_PASSWORD "your-password"
// LAN IP of the laptop running `make backend HOST=0.0.0.0` (macOS: ipconfig getifaddr en0).
#define BACKEND_TICK_URL "http://192.168.1.50:8000/api/v1/hardware/tick"
// Must equal HARDWARE_TOKEN in backend/.env.
#define HARDWARE_TOKEN "change-me"
```
- **IMPLEMENT** `neuroskin_bridge.ino`:
```cpp
// NeuroSkin ESP32 bridge: 4 x BH1750 on two I2C buses + PCA9685 servos.
// Posts lux readings to the FastAPI backend each tick and applies the louvre
// angles it returns. Wiring and pulse values match the verified circuit test.

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <BH1750.h>
#include <Adafruit_PWMServoDriver.h>
#include <ArduinoJson.h>
#include "secrets.h"

// ---------------- Wiring (unchanged from the circuit test) ----------------
#define SDA_BUS1 21  // PCA9685 + BH1750 #1 + #2
#define SCL_BUS1 22
#define SDA_BUS2 32  // BH1750 #3 + #4
#define SCL_BUS2 33

TwoWire I2C_BUS1 = TwoWire(0);
TwoWire I2C_BUS2 = TwoWire(1);
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40, I2C_BUS1);

// ---------------- Calibration knobs ----------------
// PCA9685 ticks at 50 Hz for servo 0 and 180 degrees (~1000/2000 us), from the circuit test.
#define SERVO_MIN 205
#define SERVO_MAX 410
// Nominal 25 MHz; real PCA9685 oscillators run a few percent off. Measure a pulse and tune.
#define PCA9685_OSC_HZ 25000000
#define LOUVRE_MAX_DEG 60.0f   // twin angle range 0-60 (backend DEFAULTS.angle_max)
#define SAFE_ANGLE_DEG 0.0f    // backend silent -> retract flat, like safety.retract_flat
#define MAX_STEP_DEG 10.0f     // slew per tick: spares the linkages and the servo supply
#define TICK_MS 500
#define HTTP_TIMEOUT_MS 400
#define BACKEND_TIMEOUT_MS 3000

struct Panel {
  const char *id;    // backend panel id
  TwoWire *bus;
  uint8_t address;   // 0x23 ADDR->GND, 0x5C ADDR->3.3V
  uint8_t channel;   // PCA9685 output
  float servoAt0;    // servo degrees at louvre 0 (flat)
  float servoAt60;   // servo degrees at louvre 60 (shaded); swap the pair to reverse
};

// ponytail: 1:1 louvre-to-servo travel inside the 45-135 range already tested; calibrate per linkage.
const Panel PANELS[4] = {
  {"bh1", &I2C_BUS1, 0x23, 4, 75, 135},
  {"bh2", &I2C_BUS1, 0x5C, 5, 75, 135},
  {"bh3", &I2C_BUS2, 0x23, 6, 75, 135},
  {"bh4", &I2C_BUS2, 0x5C, 7, 75, 135},
};

BH1750 sensors[4];
bool sensorOk[4];
float commanded[4];  // louvre angle last written to the PCA9685
float target[4];     // louvre angle requested by the backend (or safe)
uint32_t seq = 0;
unsigned long lastReplyMs = 0;
bool safeMode = false;

bool startSensor(int i) {
  return sensors[i].begin(BH1750::CONTINUOUS_HIGH_RES_MODE, PANELS[i].address, PANELS[i].bus);
}

// Negative means no reading; a failed sensor is restarted on the next tick.
float readLux(int i) {
  if (!sensorOk[i]) {
    sensorOk[i] = startSensor(i);
    return -1;  // first continuous measurement is not ready yet
  }
  float lux = sensors[i].readLightLevel();
  if (lux < 0) sensorOk[i] = false;
  return lux;
}

void writeLouvre(int i, float louvre) {
  const Panel &p = PANELS[i];
  float servo = p.servoAt0 + (p.servoAt60 - p.servoAt0) * louvre / LOUVRE_MAX_DEG;
  servo = constrain(servo, 0.0f, 180.0f);
  pwm.setPWM(p.channel, 0, SERVO_MIN + (uint16_t)((SERVO_MAX - SERVO_MIN) * servo / 180.0f + 0.5f));
  commanded[i] = louvre;
}

// Sends one batch; applies the reply only if all four angles are valid.
bool postTick(const float lux[4]) {
  JsonDocument request;
  request["seq"] = seq++;
  JsonObject panels = request["panels"].to<JsonObject>();
  for (int i = 0; i < 4; i++) {
    JsonObject panel = panels[PANELS[i].id].to<JsonObject>();
    if (lux[i] >= 0) panel["lux"] = roundf(lux[i] * 10) / 10;
    else panel["lux"] = nullptr;
    panel["commanded_angle"] = roundf(commanded[i] * 10) / 10;
  }
  String body;
  serializeJson(request, body);

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(BACKEND_TICK_URL)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Hardware-Token", HARDWARE_TOKEN);
  int code = http.POST(body);
  String reply = code == 200 ? http.getString() : String();
  http.end();
  if (code != 200) {
    Serial.printf("tick HTTP %d %s\n", code, HTTPClient::errorToString(code).c_str());
    return false;
  }

  JsonDocument response;
  if (deserializeJson(response, reply)) return false;
  float next[4];
  for (int i = 0; i < 4; i++) {
    JsonVariant angle = response["panels"][PANELS[i].id]["angle"];
    if (!angle.is<float>()) return false;
    next[i] = angle.as<float>();
    if (!(next[i] >= 0 && next[i] <= LOUVRE_MAX_DEG)) return false;  // also rejects NaN
  }
  for (int i = 0; i < 4; i++) target[i] = next[i];
  return true;
}

void setup() {
  Serial.begin(115200);
  I2C_BUS1.begin(SDA_BUS1, SCL_BUS1, 100000);
  I2C_BUS2.begin(SDA_BUS2, SCL_BUS2, 100000);

  if (!pwm.begin()) Serial.println("PCA9685 FAILED");
  pwm.setOscillatorFrequency(PCA9685_OSC_HZ);  // after begin, before setPWMFreq
  pwm.setPWMFreq(50);

  for (int i = 0; i < 4; i++) {
    sensorOk[i] = startSensor(i);
    Serial.printf("%s 0x%02X: %s\n", PANELS[i].id, PANELS[i].address, sensorOk[i] ? "OK" : "FAILED");
    target[i] = SAFE_ANGLE_DEG;
    writeLouvre(i, SAFE_ANGLE_DEG);
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // modem sleep adds 100+ ms to every request
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastReplyMs = millis();
}

void loop() {
  unsigned long started = millis();

  float lux[4];
  for (int i = 0; i < 4; i++) lux[i] = readLux(i);

  if (WiFi.status() == WL_CONNECTED && postTick(lux)) {
    lastReplyMs = millis();
    if (safeMode) Serial.println("Backend back: applying its angles");
    safeMode = false;
  } else if (millis() - lastReplyMs > BACKEND_TIMEOUT_MS) {
    if (!safeMode) Serial.println("Backend silent: moving to safe angle");
    safeMode = true;
    for (int i = 0; i < 4; i++) target[i] = SAFE_ANGLE_DEG;
  }

  for (int i = 0; i < 4; i++) {
    float step = constrain(target[i] - commanded[i], -MAX_STEP_DEG, MAX_STEP_DEG);
    if (fabs(step) >= 0.1f) writeLouvre(i, commanded[i] + step);
  }

  unsigned long elapsed = millis() - started;
  if (elapsed < TICK_MS) delay(TICK_MS - elapsed);  // delay yields to the WiFi task
}
```
- **MIRROR**: The user's circuit test sketch (pins, `TwoWire(0/1)`, `begin(..., &bus)`, `lux < 0` error, `setPWM` ticks).
- **GOTCHA**:
  - The sketch folder name must equal the `.ino` name.
  - The response is applied all-or-nothing: a partial reply keeps the previous targets.
  - `commanded_angle` is rounded to 0.1 so floating-point error never exceeds the backend's `le=60`.
  - On the tick when a sensor restarts, `readLux` reports no reading, because the first continuous measurement takes ~120–180 ms.
  - HTTP failure blocks for at most ~800 ms (connect + read timeouts). That is acceptable, because the safe fallback uses elapsed time, not a tick count.
  - Plain HTTP means the token can be sniffed on the LAN. It only gates `/tick`; see Risks.
- **VALIDATE**:
  ```bash
  ACLI="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
  "$ACLI" lib install ArduinoJson
  cp -n hardware/esp32/neuroskin_bridge/secrets.h.example hardware/esp32/neuroskin_bridge/secrets.h
  "$ACLI" compile --fqbn esp32:esp32:esp32 hardware/esp32/neuroskin_bridge
  ```
  EXPECT: compile succeeds. (Default arduino-cli dirs on macOS, `~/Library/Arduino15` and `~/Documents/Arduino`, match the IDE's. If the user's board is not a generic ESP32 dev module, swap the FQBN.)

### Task 6: Frontend API client
- **ACTION**: Update `frontend/src/lib/api-client.ts`.
- **IMPLEMENT**: append after `planSlab`:
```ts
export type HardwarePanelId = 'bh1' | 'bh2' | 'bh3' | 'bh4'

export interface HardwarePanelStatus {
  zone: string
  lux: number | null
  /** Last angle the ESP32 wrote; SG90s give no position feedback. */
  commanded_angle: number | null
  target_angle: number | null
  mode: 'auto' | 'twin' | 'fault' | null
  reason: string
}

export interface HardwareStatus {
  online: boolean
  last_seen_s: number | null
  seq: number | null
  mode: 'auto' | 'twin'
  lux_band: [number, number]
  panels: Record<HardwarePanelId, HardwarePanelStatus>
}

export type HardwareControl =
  | { mode: 'auto' }
  | { mode: 'twin'; angles: Record<string, number> }

export function getHardwareStatus(signal?: AbortSignal): Promise<HardwareStatus> {
  return get('/api/v1/hardware/status', 'Hardware', signal)
}

export function setHardwareControl(
  control: HardwareControl,
  signal?: AbortSignal
): Promise<HardwareStatus> {
  return post('/api/v1/hardware/control', control, 'Hardware control', signal)
}
```
- **MIRROR**: FRONTEND_API_CLIENT.
- **GOTCHA**: `post` is a hoisted function declaration, so calling it from functions defined later in the file is fine.
- **VALIDATE**: `cd frontend && npx tsc --noEmit`.

### Task 7: LiveHardwarePanel component
- **ACTION**: Create `frontend/src/components/neuroskin/LiveHardwarePanel.tsx`.
- **IMPLEMENT**:
```tsx
'use client'

import { useEffect, useState } from 'react'
import {
  getHardwareStatus,
  setHardwareControl,
  type HardwareControl,
  type HardwarePanelId,
  type HardwareStatus,
} from '@/lib/api-client'
import type { TickPayload } from '@/lib/types'

// Physical 2×2 seen from outside: top row on I²C bus 1, bottom row on bus 2.
const PANELS: HardwarePanelId[] = ['bh1', 'bh2', 'bh3', 'bh4']

/** The twin's angle for every zone the rig mirrors, or null if any is missing. */
export function twinAngles(
  tick: TickPayload | null,
  zones: string[]
): Record<string, number> | null {
  const angles = new Map(
    (tick?.facade ?? [])
      .flatMap((wall) => wall.zones ?? [])
      .map((zone) => [zone.zone, zone.angle])
  )
  if (!zones.length || zones.some((zone) => !angles.has(zone))) return null
  return Object.fromEntries(zones.map((zone) => [zone, angles.get(zone) as number]))
}

function sendControl(
  control: HardwareControl,
  onStatus: (status: HardwareStatus) => void,
  onError: (message: string | null) => void
) {
  return setHardwareControl(control)
    .then((status) => {
      onStatus(status)
      onError(null)
    })
    .catch((caught: unknown) =>
      onError(caught instanceof Error ? caught.message : 'Hardware control failed.')
    )
}

export function LiveHardwarePanel({ tick }: { tick: TickPayload | null }) {
  const [status, setStatus] = useState<HardwareStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Same abort/timeout polling as FeedsPanel, at the 1 s live cadence.
    let controller: AbortController | null = null
    const refresh = async () => {
      controller?.abort()
      const pending = new AbortController()
      controller = pending
      const timeout = setTimeout(() => pending.abort(), 900)
      try {
        const result = await getHardwareStatus(pending.signal)
        if (!pending.signal.aborted) setStatus(result)
      } catch {
        setStatus(null)
      } finally {
        clearTimeout(timeout)
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 1000)
    return () => {
      controller?.abort()
      clearInterval(timer)
    }
  }, [])

  const zones = status ? PANELS.map((panel) => status.panels[panel].zone) : []
  const mirror = twinAngles(tick, zones)
  const mirrorKey = mirror ? JSON.stringify(mirror) : null
  const mode = status?.mode

  // The backend reverts to auto 30 s after the last push; refresh well inside that.
  useEffect(() => {
    if (mode !== 'twin' || !mirrorKey) return
    const angles = JSON.parse(mirrorKey) as Record<string, number>
    const push = () => void sendControl({ mode: 'twin', angles }, setStatus, setError)
    push()
    const timer = setInterval(push, 5000)
    return () => clearInterval(timer)
  }, [mode, mirrorKey])

  const toggle = (active: boolean) =>
    `rounded border px-2 py-1 text-[10px] font-semibold disabled:opacity-50 ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary/60'}`
  const connection = !status
    ? 'backend unreachable'
    : status.online
      ? `online · ${status.last_seen_s}s`
      : status.last_seen_s === null
        ? 'waiting for ESP32'
        : `offline · ${status.last_seen_s}s ago`

  return (
    <section className='console-card' aria-label='Live hardware'>
      <h3 className='console-card-title flex justify-between gap-2'>
        <span>Live hardware · ESP32</span>
        <span className={status?.online ? 'text-emerald-700' : 'text-amber-700'}>
          {connection}
        </span>
      </h3>
      <div role='group' aria-label='Servo control source' className='mt-2 flex gap-1'>
        <button
          type='button'
          aria-pressed={mode === 'auto'}
          disabled={!status}
          className={toggle(mode === 'auto')}
          onClick={() => void sendControl({ mode: 'auto' }, setStatus, setError)}
        >
          Auto (lux)
        </button>
        <button
          type='button'
          aria-pressed={mode === 'twin'}
          disabled={!status || !mirror}
          title={mirror ? undefined : 'Run a controlled simulation: the twin has no angles for the mapped zones.'}
          className={toggle(mode === 'twin')}
          onClick={() => mirror && void sendControl({ mode: 'twin', angles: mirror }, setStatus, setError)}
        >
          Mirror twin
        </button>
      </div>
      <div role='group' aria-label='Physical 2 by 2 rig' className='mt-2 grid grid-cols-2 gap-1'>
        {PANELS.map((panel) => {
          const state = status?.panels[panel]
          return (
            <div
              key={panel}
              title={state?.reason}
              className='min-w-0 rounded border border-border px-1 py-1.5 font-mono text-[10px]'
            >
              <span className='flex justify-between gap-1 font-semibold'>
                <span>{panel.toUpperCase()} → {state?.zone ?? '—'}</span>
                <span>{state?.commanded_angle != null ? `${state.commanded_angle.toFixed(1)}°` : '—'}</span>
              </span>
              <span className='mt-0.5 block truncate text-[9px] text-muted-foreground'>
                {state?.mode === 'fault'
                  ? 'sensor fault'
                  : state?.lux != null
                    ? `${state.lux.toFixed(0)} lux`
                    : 'no reading'}
                {state?.target_angle != null ? ` · target ${state.target_angle.toFixed(1)}°` : ''}
              </span>
            </div>
          )
        })}
      </div>
      {error && (
        <p role='alert' className='mt-2 text-[10px] text-rose-700'>
          {error}
        </p>
      )}
      <p className='mt-2 text-[10px] text-muted-foreground'>
        Measured lux; angles are commanded, not measured.
      </p>
    </section>
  )
}
```
- **MIRROR**: FRONTEND_POLLING, FRONTEND_CARD_STYLE.
- **GOTCHA**:
  - `sendControl` is module-level and React state setters are stable, so the effect deps `[mode, mirrorKey]` satisfy `react-hooks/exhaustive-deps`.
  - `mirrorKey` (a string) keeps the effect from re-running on every 1 s poll, because `mirror` is a new object each render.
  - Run `npx prettier --write` on the new files; the long JSX lines above will be rewrapped.
- **VALIDATE**: `cd frontend && npx tsc --noEmit && npm run lint`.

### Task 8: Mount in dashboard
- **ACTION**: Update `frontend/src/components/neuroskin/NeuroSkinDashboard.tsx`.
- **IMPLEMENT**:
  - Import next to the other panel imports (~line 54): `import { LiveHardwarePanel } from './LiveHardwarePanel'`.
  - Directly after the `<SimulationControls ... />` element that closes at ~line 1137, add:
    ```tsx
                <LiveHardwarePanel
                  tick={isControlled ? (selectedTick ?? null) : null}
                />
    ```
- **MIRROR**: Existing right-rail siblings.
- **GOTCHA**: It must sit **outside** any `lens === ...` conditional, so twin mirroring keeps running while the user browses the Floor/Brains lenses. Pass `null` for uncontrolled variants because their zone angles are not controller output.
- **VALIDATE**: `cd frontend && npx tsc --noEmit`; `npx vitest run src/components/neuroskin/NeuroSkinDashboard.test.tsx` still passes (its fetch stub may need to tolerate the extra `/hardware/status` GET; if a test asserts exact fetch call counts, filter calls by URL rather than removing the panel).

### Task 9: Frontend test
- **ACTION**: Create `frontend/src/components/neuroskin/LiveHardwarePanel.test.tsx`.
- **IMPLEMENT**:
```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TickPayload } from '@/lib/types'
import { LiveHardwarePanel, twinAngles } from './LiveHardwarePanel'

const panel = (zone: string, overrides = {}) => ({
  zone,
  lux: 512,
  commanded_angle: 30,
  target_angle: 30,
  mode: 'auto',
  reason: 'holding',
  ...overrides,
})
const STATUS = {
  online: true,
  last_seen_s: 0.4,
  seq: 9,
  mode: 'auto',
  lux_band: [300, 700],
  panels: {
    bh1: panel('W13'),
    bh2: panel('W14'),
    bh3: panel('W9'),
    bh4: panel('W10', { lux: null, mode: 'fault' }),
  },
}
const TICK = {
  facade: [
    {
      orientation: 'west',
      zones: [
        { zone: 'W9', angle: 36 },
        { zone: 'W10', angle: 48 },
        { zone: 'W13', angle: 12 },
        { zone: 'W14', angle: 24 },
      ],
    },
  ],
} as unknown as TickPayload

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('live hardware bridge', () => {
  it('shows live readings and pushes the twin angles for the mapped zones', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () =>
        init?.method === 'POST' ? { ...STATUS, mode: 'twin' } : STATUS,
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<LiveHardwarePanel tick={TICK} />)

    expect(await screen.findByText('online · 0.4s')).toBeVisible()
    expect(screen.getByText('sensor fault · target 30.0°')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Mirror twin' }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')
      ).toBe(true)
    )
    const [url, init] = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'POST'
    )!
    expect(url).toContain('/api/v1/hardware/control')
    expect(JSON.parse(init!.body as string)).toEqual({
      mode: 'twin',
      angles: { W13: 12, W14: 24, W9: 36, W10: 48 },
    })
  })

  it('cannot mirror without twin zone angles and reports an unreachable backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<LiveHardwarePanel tick={null} />)
    expect(await screen.findByText('backend unreachable')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Mirror twin' })).toBeDisabled()
    expect(twinAngles(TICK, ['W13', 'W1'])).toBeNull()
  })
})
```
- **MIRROR**: TEST_STRUCTURE (frontend).
- **GOTCHA**: The panel starts a 1 s interval, but RTL auto-unmounts after each test, which clears it. Don't use fake timers. The fault card text renders as two adjacent text nodes; if `getByText('sensor fault · target 30.0°')` fails to match, assert with a function matcher on the element's `textContent`.
- **VALIDATE**: `cd frontend && npx vitest run src/components/neuroskin/LiveHardwarePanel.test.tsx`.

### Task 10: Rewrite `hardware/README.md` for the as-built ESP32 bridge
- **ACTION**: Update `hardware/README.md`.
- **IMPLEMENT**:
  1. Title → `# ESP32 hardware bridge`. Status line → "ESP32 bridge implemented: firmware `hardware/esp32/neuroskin_bridge`, backend `/api/v1/hardware/*`, dashboard *Live hardware* card. No anemometer is wired."
  2. Keep **Cloud vision and indoor presentation** unchanged, except replace "The demo does not control physical servos; the hardware integration below is still a plan." with "Physical louvres are driven by the ESP32 bridge below; cloud vision stays simulation-only."
  3. **Replace** these sections: *Objective*, *Hardware scope*, *Panel mapping and I²C connections*, *Architecture and folder ownership*, *Local control and API plan*, *Hosting and tunnel*, *Implementation sequence*. New sections:
     - **Wiring**: the user's wiring tree verbatim, plus the "Hardware facts" table from this plan. Add the notes: BH2/BH4 ADDR → 3.3 V; PCA9685 VCC → 3.3 V logic; servo power into PCA9685 V+ from a separate 5 V supply (≥ 2 A for four SG90s) with GND common to the ESP32; never power servos from ESP32 pins.
     - **Twin mapping**: `bh1→W13, bh2→W14, bh3→W9, bh4→W10`, with the zone numbering rule; edit `PANEL_ZONES` if the physical positions differ.
     - **Flash the firmware**: install ArduinoJson (plus BH1750 and Adafruit PWM Servo Driver), copy `secrets.h.example` → `secrets.h`, select the ESP32 board, upload, open Serial Monitor at 115200 and expect four `OK` lines.
     - **Run the bridge**: add `HARDWARE_TOKEN` to `backend/.env`, then `make backend HOST=0.0.0.0` (or `make dev HOST=0.0.0.0`); find the IP with `ipconfig getifaddr en0`; allow the macOS firewall prompt; use a trusted network or phone hotspot. Run via `make`, not Docker compose (`/control` is loopback-only).
     - **Contract**: a table of the three routes with request/response examples (the curl bodies from Validation).
     - **Behaviour and faults**: auto band 300–700 lux, 5°/tick; twin expires after 30 s; sensor fault holds that panel; backend silent for 3 s → firmware `SAFE_ANGLE_DEG`; slew ≤ 10°/tick.
     - **Calibration knobs**: the firmware `#define`s and `Panel` servo pair; the backend constants in `app/hardware.py`.
  4. Keep **Validation and acceptance**, but edit rows: *Wind override* → "Not applicable: no anemometer"; *Network independence* → "Close dashboard: auto continues; stop backend: louvres reach safe angle ≤ 3 s + travel"; *Access control* → "`/tick` without token → 401; `/control` from another LAN host → 403"; *Latency* → "ESP32 tick round-trip (Serial timestamps) plus travel by video". Remove Pi/tunnel wording from the other rows.
  5. Keep **What this demonstration establishes** (drop "remote monitoring"). Replace the Raspberry Pi/Cloudflare references with: the ESP32 Arduino core docs, the ArduinoJson docs, the BH1750 library repo, and the Adafruit PCA9685 guide (keep).
- **GOTCHA**: The existing doc's rule that SG90 angles are "commanded, not measured" stays. Don't claim latency numbers.
- **VALIDATE**: `grep -n -i "raspberry\|TCA9548A\|cloudflare" hardware/README.md` returns nothing.

### Task 11: Root README + PRD scope note
- **ACTION**: Update `README.md` and `docs/neuroskin_software_prd.md`.
- **IMPLEMENT**:
  - `README.md` line ~129: replace "No learned model, training pipeline, database, authentication, or hardware integration is included." with "No learned model, training pipeline, database, or authentication is included. An optional ESP32 bridge (`hardware/README.md`) drives a physical 2×2 louvre rig from live lux or from the twin."
  - `docs/neuroskin_software_prd.md` §4.3: directly after the non-goals bullet list (before the existing AFC blockquote at ~line 131), add:
    > The ESP32 hardware bridge (`hardware/README.md`) is an explicit, demo-scale exception to the first bullet: four BH1750 readings and four servo commands over local WiFi, with no field-validation, safety-certification or energy claims.
- **GOTCHA**: `docs/neuroskin_software_prd.md` has **uncommitted user edits** (`git status`). Make a surgical `Edit` only; don't reformat or rewrite surrounding text.
- **VALIDATE**: `git diff docs/neuroskin_software_prd.md` shows the added blockquote alongside the user's pre-existing edits and nothing else new.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| token required | wrong / missing header; env unset | 401 / 401 / 503 | ✓ |
| incomplete batch | 3 panels; `bh5`; lux −1; angle 61 | 422 each | ✓ |
| independent lux step | bh1 900, bh2 100, bh3 500, bh4 null at 30° | 35 / 25 / 30 / 30 (fault) | ✓ |
| clamp | `lux_step(900, 58)`, `lux_step(100, 2)` | 60, 0 | ✓ |
| twin mirror + expiry | control twin → tick; clock +31 s → tick | twin angles; then auto 5°, status auto, log event | ✓ |
| control validation | twin w/o angles; angle 61; wrong zone; auto+angles; LAN client | 422 ×4, 403 | ✓ |
| status lifecycle | before tick; after tick; clock +4 s | offline/None; online + panel data; offline | ✓ |
| panel renders + pushes | status stub, tick with W9/10/13/14 | "online · 0.4s", "sensor fault …", POST body angles | |
| no twin / backend down | fetch rejects, tick null | "backend unreachable", Mirror disabled, `twinAngles` null on missing zone | ✓ |

### Edge Cases Checklist
- [x] Empty input: missing panels, twin without angles
- [x] Maximum size input: lux ≤ 65 535, angles ≤ 60, `max_length=4`
- [x] Invalid types: `strict=True` seq, NaN/inf rejected (`allow_inf_nan=False`; firmware checks `!(v>=0 && v<=60)`)
- [x] Concurrent access: `Lock` around state (FastAPI sync routes run in a threadpool)
- [x] Network failure: firmware safe angle after 3 s; dashboard "backend unreachable"; twin TTL
- [x] Permission denied: 401/503 token, 403 non-loopback control
- [ ] Physical: brownout, sensor unplug/replug, oscillation (manual, below)

---

## Validation Commands

### Static Analysis
```bash
cd backend && uv run ruff check app tests
cd frontend && npx tsc --noEmit && npm run lint
```
EXPECT: Zero errors

### Unit Tests
```bash
cd backend && uv run pytest tests/test_hardware.py
cd frontend && npx vitest run src/components/neuroskin/LiveHardwarePanel.test.tsx
```
EXPECT: All pass

### Full Test Suite
```bash
make test
```
EXPECT: No regressions (watch `NeuroSkinDashboard.test.tsx` for fetch-stub assumptions)

### Firmware Build
```bash
ACLI="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
"$ACLI" lib install ArduinoJson
cp -n hardware/esp32/neuroskin_bridge/secrets.h.example hardware/esp32/neuroskin_bridge/secrets.h
"$ACLI" compile --fqbn esp32:esp32:esp32 hardware/esp32/neuroskin_bridge
git check-ignore hardware/esp32/neuroskin_bridge/secrets.h
```
EXPECT: Compile OK; `check-ignore` prints the path

### Backend contract without hardware (ESP32 simulator)
```bash
# terminal 1
cd backend && HARDWARE_TOKEN=dev-token uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
# terminal 2
curl -s -X POST localhost:8000/api/v1/hardware/tick \
  -H 'Content-Type: application/json' -H 'X-Hardware-Token: dev-token' \
  -d '{"seq":1,"panels":{"bh1":{"lux":900,"commanded_angle":30},"bh2":{"lux":100,"commanded_angle":30},"bh3":{"lux":500,"commanded_angle":30},"bh4":{"lux":null,"commanded_angle":30}}}'
curl -s localhost:8000/api/v1/hardware/status
curl -s -X POST localhost:8000/api/v1/hardware/control -H 'Content-Type: application/json' \
  -d '{"mode":"twin","angles":{"W13":10,"W14":20,"W9":40,"W10":60}}'
```
EXPECT: tick → 35/25/30/30(fault); status online with the same panel data; control → mode twin

### Browser Validation
```bash
make dev HOST=0.0.0.0
```
EXPECT: Dashboard right rail shows *Live hardware · ESP32*; "waiting for ESP32" before the board connects; "Mirror twin" is disabled until a controlled run has loaded

### Manual Validation (on the rig)
- [ ] Serial Monitor at boot: `bh1 0x23: OK` … `bh4 0x5C: OK`; no `PCA9685 FAILED`
- [ ] All four louvres move to the safe angle at boot; no ESP32 reset (brownout) during simultaneous movement
- [ ] Dashboard shows "online"; cover each BH1750 in turn and confirm the matching card's lux drops (**confirms the `PANEL_ZONES` position assumption**)
- [ ] Auto: shine a lamp above 700 lux on one sensor, and only its servo steps toward shading; lux behind the louvre falls (if it rises, swap that panel's `servoAt0/servoAt60`)
- [ ] Watch for oscillation at the band edges; widen the band or cut `STEP_DEG` if it chatters
- [ ] Mirror twin: scrub the timeline and confirm the servos follow the W13/W14/W9/W10 angles shown in the Floor lens zone matrix
- [ ] Close the dashboard tab while mirroring; within ~30 s the status (from another tab or curl) reports `auto`
- [ ] Stop the backend (Ctrl-C); within ~3 s Serial prints "Backend silent" and the louvres slew to the safe angle; restart the backend and the louvres resume
- [ ] Unplug one BH1750: its card shows "sensor fault" and the other three keep working; replug it and readings resume
- [ ] `curl` `/tick` with a wrong token → 401; `/control` from another LAN machine → 403

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing
- [ ] No type errors
- [ ] No lint errors
- [ ] Matches UX design
- [ ] Firmware compiles; rig manual checks recorded (at least boot, auto, mirror, backend-stop)

## Completion Checklist
- [ ] Code follows discovered patterns (router module, locked process state, 503-on-missing-secret)
- [ ] Error handling matches codebase style (HTTPException with user-actionable message, no secret echo)
- [ ] Logging follows codebase conventions (`neuroskin.hardware`, `event` + `hardware_mode` in `LOG_FIELDS`)
- [ ] Tests follow test patterns (TestClient module-level, monkeypatch env/state)
- [ ] No hardcoded secrets (token in `.env` / gitignored `secrets.h`); calibration values are named knobs
- [ ] Documentation updated (hardware README, root README, PRD note)
- [ ] No unnecessary scope additions (see NOT Building)
- [ ] Self-contained: no questions needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PRD §4.3 lists "live sensors … edge devices, or actuator control" as non-goals | Certain | Medium | Task 11 blockquote scopes an explicit demo exception, like the AFC note |
| Servo supply not shown in wiring: four SG90s (≈650 mA stall each) browning out the ESP32 or corrupting I²C | Medium | High | External 5 V ≥ 2 A on PCA9685 V+, common GND, firmware slew ≤ 10°/tick, boot check under simultaneous movement |
| `HOST=0.0.0.0` exposes **all** API routes (including CPU-heavy simulations) to the LAN; token sent over plain HTTP | Medium | Medium | Trusted network or hotspot only; `/tick` token; `/control` loopback-only; default stays 127.0.0.1 |
| Sensor-to-position assumption wrong, so the twin mirror hits the wrong physical louvre | Medium | Low | Cover-each-sensor check; edit `PANEL_ZONES` / `PANELS[]` channel |
| Lux band oscillation: one 5° step swings lux across 300–700 under a strong lamp | Medium | Low | Knobs `LUX_LOW/HIGH`, `STEP_DEG`, `TICK_MS`; card tooltip shows reason |
| Louvre direction reversed on a linkage (a higher angle lets more light in) | Medium | Medium | Swap `servoAt0/servoAt60` per panel; verified in the auto manual check |
| HTTP middleware logs every tick at INFO (≈ 7 200 lines/h) | High | Low | Accept for demo; raise `TICK_MS` if logs become unusable |
| `--reload` restart resets bridge state to auto; ESP32 briefly goes to safe angle | Low | Low | Expected; documented in the faults section |
| PCA9685 oscillator off by a few % shifts pulse widths | Medium | Low | `PCA9685_OSC_HZ` knob (default 25 MHz keeps the tested behaviour) |
| Campus WiFi is WPA2-Enterprise / 5 GHz only | Medium | Medium | Phone hotspot (2.4 GHz); noted in `secrets.h.example` |
| Board is not a generic ESP32 dev module | Low | Low | Swap FQBN in the compile command |

## Notes
- The user's circuit test sketch is the source of truth for wiring and pulse values. The production sketch deliberately drops its boot-time I²C scan and servo sweep. Keep the test sketch for commissioning.
- Angle semantics follow the twin: 0° = flat/retracted, 60° = most shading. The firmware converts louvre degrees → servo degrees (`servoAt0 + (servoAt60 − servoAt0) · angle / 60`) → PCA9685 ticks (`SERVO_MIN + (SERVO_MAX − SERVO_MIN) · servo / 180`). The default 75°→135° servo travel is 1:1 and inside the tested 45°–135° range.
- The auto policy is stateless on the backend: it steps from the angle the firmware reports writing, so the device holds the physical truth and a backend restart loses nothing important.
- Twin mode mirrors angles only. It does not claim the rig reproduces facade irradiance or twin lux.
