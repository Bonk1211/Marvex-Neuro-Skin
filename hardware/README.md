# ESP32 hardware bridge

Status: ESP32 bridge implemented: firmware `hardware/esp32/neuroskin_bridge`,
backend `/api/v1/hardware/*`, dashboard *Live hardware* card. No anemometer is wired.

## Cloud vision and indoor presentation

The dashboard now loops the supplied sky video in a CCTV-style view and runs
real cloud segmentation on a configurable schedule (15 seconds by default).
Fresh results update the simulation brain at the selected simulation time,
using full-frame cloud mask area as a demo sky estimate. The overlay shows the
current MYT date/time. See the root README for setup and fallback behavior.
Physical louvres are driven by the ESP32 bridge below; cloud vision stays
simulation-only.

For hardware, add one shared sky-facing camera (Pi-compatible CSI or USB; model
and mounting still to be selected). Send its JPEG frames to the existing
`POST /api/v1/vision/clouds` inference endpoint. The frame source changes from
recorded video to camera capture; the cloud workflow stays the same. Validate
the live camera separately for exposure, field of view, glare and nighttime use.

Run capture/inference outside the fast lux/wind loop, initially sampling every
five seconds with at most one request in flight. Track capture time separately
from inference completion; reject observations beyond a calibrated maximum age.
Use vision as supplementary sky context alongside the weather API and four
independent BH1750 readings. Network, camera or inference failure means vision
is unavailable; continue local lux control and wind safety. Never substitute
zero cloud for failure, infer cloud cover from confidence, or treat an empty
detection as proof of a clear sky. Establish a validated sky mask and coverage
calibration before using segmentation area in the irradiance cross-check.

Presentation checks: use cloudy and clear-sky clips; confirm polygon alignment
with the displayed snapshot/timestamp; pause, seek and replace footage; disconnect
internet and confirm an explicit error rather than a fresh result. Separately
verify that camera/inference outages cannot block hardware control when built.

## What the rig does

A 2×2 grid of louvre panels, each with one SG90 servo and one BH1750 light
sensor, stands in for one 2×2 block of the digital twin's west wall. Every
500 ms the ESP32 posts the four lux readings to the FastAPI backend over WiFi
and receives four louvre angles. The dashboard picks where those angles come
from:

- **Auto (default):** each panel steps 5° toward shading above 700 lux, 5°
  toward open below 300 lux, and holds inside the band. This runs with the
  dashboard closed.
- **Mirror twin:** the dashboard pushes the twin's angles for the four mapped
  zones at the selected simulation time, so scrubbing the timeline moves the rig.

Louvre angles run 0–180°: **0° is perpendicular to the building** (the start
position), **90° is parallel to it** (most shading), and **180° is perpendicular
again with the blade flipped**. Auto lux control shades within 0–90°; calibration
holds use the full range. The twin uses the same convention over 0–60°, so
mirrored angles pass through unchanged. SG90s
give no position feedback, so every angle shown is **commanded, not measured**.

## Wiring

```text
ESP32 3.3V ───────────── Breadboard + rail
                         ├── BH1 VCC
                         ├── BH2 VCC
                         ├── BH3 VCC
                         └── BH4 VCC

ESP32 GND ────────────── Breadboard - rail
                         ├── BH1 GND
                         ├── BH2 GND
                         ├── BH3 GND
                         └── BH4 GND

GPIO21 ───── breadboard row
              ├── BH1 SDA
              └── PCA9685 SDA

GPIO22 ───── breadboard row
              ├── BH1 SCL
              └── PCA9685 SCL

GPIO25 ───── BH2 SDA   (software I²C bus 3)

GPIO26 ───── BH2 SCL   (software I²C bus 3)

GPIO32 ───── breadboard row
              ├── BH3 SDA
              └── BH4 SDA

GPIO33 ───── breadboard row
              ├── BH3 SCL
              └── BH4 SCL
```

| Panel id | Sensor | I²C bus | SDA / SCL | BH1750 address | ADDR pin | PCA9685 channel | Twin zone |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bh1` | BH1750 #1 | `TwoWire(0)` | GPIO21 / GPIO22 | `0x23` | GND | 4 | `W13` (top-left) |
| `bh2` | BH1750 #2 | software (bit-banged) | GPIO25 / GPIO26 | `0x23` | GND | 5 | `W14` (top-right) |
| `bh3` | BH1750 #3 | `TwoWire(1)` | GPIO32 / GPIO33 | `0x23` | GND | 6 | `W9` (bottom-left) |
| `bh4` | BH1750 #4 | `TwoWire(1)` | GPIO32 / GPIO33 | `0x5C` | 3.3 V | 7 | `W10` (bottom-right) |

- BH1750 supports only `0x23` and `0x5C`. BUS1 carries BH1 (`0x23`) and the
  PCA9685; BUS2 carries BH3 (`0x23`) and BH4 (`0x5C`, ADDR tied to 3.3 V). The
  ESP32 has only two hardware I²C controllers, so BH2 (`0x23`) gets its own
  bit-banged bus 3 on GPIO25/26. Hardware buses run at 50 kHz for breadboard wiring.
- Bus 3 relies on the BH1750 module's own SDA/SCL pull-ups; the firmware adds the
  ESP32's weak internal pull-ups so an unplugged BH2 reads as a fault, not a
  floating line. It is master-only with no clock stretching, which BH1750 never uses.
- PCA9685 sits at `0x40` on BUS1. Connect its VCC to 3.3 V (logic).
- Power the servos through the PCA9685 V+ terminal from a **separate 5 V supply**
  (at least 2 A for four SG90s) with its GND common to the ESP32. Never power
  servos from ESP32 pins; simultaneous movement otherwise resets the ESP32 or
  corrupts I²C.
- Pulse values come from the verified circuit test: 205–410 PCA9685 ticks at
  50 Hz for servo 0°–180° (≈1000–2000 µs). Only 45°–135° was exercised.
- Keep the circuit test sketch for commissioning (I²C scan, servo sweep). The
  bridge firmware deliberately does not sweep servos at boot.

## Twin mapping

Twin zone ids are the wall letter plus `row × 4 + column + 1`, rows counted from
the bottom and columns from the left as seen from outside. The top row is 13–16
and the second row 9–12, so BH1/BH2 (top row) map to `W13 W14` and BH3/BH4 to
`W9 W10`. **The physical position of each sensor is an assumption:** cover each
BH1750 in turn and confirm the matching dashboard card responds. Edit
`PANEL_ZONES` in `backend/app/hardware.py` (and the `PANELS` channels in the
firmware) if they differ.

## Flash the firmware

1. Install libraries in the Arduino IDE Library Manager: **BH1750** (Christopher
   Laws), **Adafruit PWM Servo Driver Library** and **ArduinoJson** (v7).
   Or with the IDE's bundled CLI:
   ```bash
   "/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" lib install ArduinoJson
   ```
2. Copy `secrets.h.example` to `secrets.h` (gitignored) next to the sketch and
   fill in WiFi network, backend URL and token.
   The ESP32 joins 2.4 GHz WPA2-Personal networks only; campus WPA2-Enterprise
   networks will not work, so use a phone hotspot.
3. Open `hardware/esp32/neuroskin_bridge/neuroskin_bridge.ino`, select your ESP32
   board (verified to compile on esp32 core 3.3.11, generic *ESP32 Dev Module*)
   and upload.
4. Open Serial Monitor at 115200 baud. Expect `bh1 0x23: OK`, `bh2 0x23: OK`
   (software bus), `bh3 0x23: OK`, `bh4 0x5C: OK` and no `PCA9685 FAILED`.

## Run the bridge

1. Generate a token and add it to `backend/.env` (the same value goes in
   `secrets.h`):
   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(24))"
   # backend/.env
   HARDWARE_TOKEN=<token>
   ```
2. Start the backend reachable from the LAN: `make backend HOST=0.0.0.0`
   (or `make dev HOST=0.0.0.0`). Allow the macOS firewall prompt.
3. Find the laptop IP with `ipconfig getifaddr en0` and use it in
   `BACKEND_TICK_URL`.
4. Open the dashboard on the same laptop. The right rail shows *Live hardware ·
   ESP32*, reading "waiting for ESP32" until the first tick arrives.

`HOST=0.0.0.0` exposes every API route to the local network, and the token
travels over plain HTTP. Use a trusted network or hotspot. Run the bridge with
`make`, not Docker compose: `/control` accepts only requests from this machine,
and Docker's port mapping hides the browser's loopback address.

## Contract

| Route | Caller | Auth | Purpose |
| --- | --- | --- | --- |
| `POST /api/v1/hardware/tick` | ESP32, every 500 ms | `X-Hardware-Token` (401 wrong, 503 unset) | Report four readings, receive four angles plus each servo's calibration |
| `GET /api/v1/hardware/status` | Dashboard and `/hardware`, every 1 s | none | Live 2×2 state, online flag, mode, calibration, held angles |
| `POST /api/v1/hardware/control` | Dashboard and `/hardware` | loopback only (403 otherwise) | Switch `auto` / `twin` / `calibrate`; twin carries four zone angles, calibrate four panel angles |
| `POST /api/v1/hardware/calibration` | `/hardware` | loopback only (403 otherwise) | Save `servo_at_0` / `servo_at_180` for all four panels |

```bash
curl -s -X POST localhost:8000/api/v1/hardware/tick \
  -H 'Content-Type: application/json' -H 'X-Hardware-Token: <token>' \
  -d '{"seq":1,"panels":{"bh1":{"lux":900,"commanded_angle":30},"bh2":{"lux":100,"commanded_angle":30},"bh3":{"lux":500,"commanded_angle":30},"bh4":{"lux":null,"commanded_angle":30}}}'
# {"panels":{"bh1":{"angle":35.0,"mode":"auto","reason":"900 lux above 700; shading."},
#            "bh2":{"angle":25.0,...},"bh3":{"angle":30.0,...},
#            "bh4":{"angle":30.0,"mode":"fault","reason":"Sensor read failed; holding the commanded angle."}}}

curl -s localhost:8000/api/v1/hardware/status

curl -s -X POST localhost:8000/api/v1/hardware/control -H 'Content-Type: application/json' \
  -d '{"mode":"twin","angles":{"W13":10,"W14":20,"W9":40,"W10":60}}'
```

A tick must carry all four panels; `lux: null` reports a failed read. The ESP32
applies a reply only when all four angles are valid numbers in 0–180° and all four
calibrations are in 0–180°.
`commanded_angle` in each tick is the angle the ESP32 actually wrote, so it also
acknowledges the previous reply.

## Behaviour and faults

| Situation | Behaviour |
| --- | --- |
| Lux above 700 / below 300 / inside | Step 5° toward shading / opening / hold, clamped to 0–90° (auto never drives past parallel) |
| Sensor read fails | That panel reports `fault` and holds its angle; the other three continue. The firmware restarts the sensor on the next tick |
| Dashboard closed while mirroring, or calibration page closed mid-session | Backend reverts to auto 30 s after the last push |
| Backend silent for 3 s (stopped, WiFi lost, bad token) | Firmware moves every louvre to `SAFE_ANGLE_DEG` (0°, perpendicular start position) on its own |
| Any new target | Firmware slews at most 10° per tick to spare linkages and the servo supply |
| Backend restart | Bridge state resets to auto; the ESP32 continues from its own commanded angles |

## Calibrate actuators

Open http://localhost:3000/hardware (wrench icon in the dashboard nav, or
*Calibrate →* on the Live hardware card) on the laptop running the backend.

1. **Start calibration.** Every louvre holds its start position (0°) and auto lux
   control pauses.
2. For each panel, nudge **Servo at louvre 0° (perpendicular)** (±1 / ±10) until
   the louvre is perpendicular to the building.
3. Hold **180°** and nudge **Servo at louvre 180° (perpendicular, flipped)** until
   the louvre is perpendicular again on the other side. Hold 90° to check it lies
   parallel to the building.
4. If the louvre turns the wrong way from 0° toward 90°, press **Swap direction**.
5. **Finish** returns to auto. Closing the page also returns to auto after 30 s.

Each change is saved to `backend/data/hardware_calibration.json` (reloaded on
restart) and reaches the ESP32 in the next tick reply. The ESP32 keeps its
compiled `servoAt0`/`servoAt180` (servo 0°/180°, the SG90's full travel) only
until the first backend reply after boot. A calibration file saved under an older
0–60° or 0–90° format is ignored and replaced by these defaults. The `SERVO_MIN`/`SERVO_MAX`
pulse span is nominal: an SG90 often turns roughly 90–120° across 1000–2000 µs,
which is why each endpoint is calibrated on the rig.

## Calibration knobs

Firmware (`neuroskin_bridge.ino`):

| Knob | Default | Tune when |
| --- | --- | --- |
| `servoAt0` / `servoAt180` per panel | 0° / 180° (W13 `bh1` and W10 `bh4`: 180° / 0°) | Boot defaults only; calibrate on `/hardware` instead. W13 and W10 turn the other way from louvre 0°, set on the rig. The backend's `PANEL_CALIBRATION_DEFAULTS` holds the same reversals |
| `SERVO_MIN` / `SERVO_MAX` | 205 / 410 ticks | Servo endpoints differ |
| `PCA9685_OSC_HZ` | 25 000 000 | A measured pulse width is off (PCA9685 oscillators run a few percent fast) |
| `SAFE_ANGLE_DEG` | 0° | A different position is mechanically safer |
| `MAX_STEP_DEG` | 10° per tick | Supply dips or linkages bind |
| `TICK_MS`, `HTTP_TIMEOUT_MS`, `BACKEND_TIMEOUT_MS` | 500 / 400 / 3000 ms | Network is slower; logs too noisy |

Backend (`backend/app/hardware.py`): `LUX_LOW`/`LUX_HIGH` (300/700, the twin's
comfort band), `STEP_DEG` (5°), `HOLD_TTL_S` (30 s), `OFFLINE_AFTER_S` (3 s) and
`PANEL_ZONES`. Widen the band or reduce the step if a panel chatters at the band
edges under a strong lamp.

## Validation and acceptance

| Check | Required evidence |
| --- | --- |
| Light sensing | Shade/illuminate each BH1750 in turn; the matching panel's real lux appears in `/status` and the dashboard 2×2 card |
| Independent control | Illuminate one panel while other readings stay stable; only its mapped servo responds to that light change; repeat for all four |
| Physical response | Cross both lux boundaries; backend reasons correspond to visible opening/closing |
| Feedback | With lamp position fixed, louvre movement changes the lux behind it; control settles or holds at its travel limit |
| Twin mirroring | Scrub the timeline in *Mirror twin*; servos follow the W13/W14/W9/W10 angles shown in the Floor lens zone matrix |
| Wind override | Not applicable: no anemometer is wired |
| Network independence | Close the dashboard: auto control continues; stop the backend: louvres reach the safe angle within 3 s plus travel time |
| Sensor/API failure | Disconnect one BH1750: its panel faults while healthy panels continue; reconnect it: readings resume |
| Restart | Reset the ESP32 or restart the backend: louvres start at the safe angle and resume without stale commands |
| Access control | `/tick` without the token → 401; `/control` from another LAN host → 403 |
| Latency | ESP32 tick round trip from Serial timestamps (median, p95, maximum); physical travel measured separately by video |

Capture at least 30 light-triggered transitions per panel for the latency report,
including mixed four-panel activity. Record per-panel latency and complete batch
duration so sequential reads do not hide a slow last channel. Also note
the sampling interval: sample-ready timing excludes the wait until the next
sample and the sensor's acquisition time. Repeat timing under expected dashboard
traffic. Select the acceptance target before measurement and report the actual
result; do not claim zero latency.

`backend/tests/test_hardware.py` covers lux-band behaviour, panel isolation and
mapping, twin expiry, invalid data and access control;
`frontend/src/components/neuroskin/LiveHardwarePanel.test.tsx` covers the card
and twin push. Exercise physical fallback and timing on the rig; software tests
alone cannot establish those results.

## What this demonstration establishes

The scope is measured light → backend decision on the local network → physical
movement, plus mirroring of the twin's zone angles, with automatic fallback when
the backend is unreachable.

Each BH1750 measures illuminance, not solar irradiance or heat flow. Four sensors
in different zones are not redundant references for one another. This setup cannot
independently validate the simulated irradiance lie detector, detect every
plausible stuck reading, establish cooling-energy savings, or prove full-scale
facade reliability. No wind, rain or temperature measurement is included. Keep
those claims and any modelled inputs explicitly separate from the hardware results.

## Reference documentation

- [ESP32 Arduino core documentation](https://docs.espressif.com/projects/arduino-esp32/en/latest/)
- [ArduinoJson v7 documentation](https://arduinojson.org/v7/)
- [BH1750 Arduino library](https://github.com/claws/BH1750)
- [BH1750 guide](https://learn.adafruit.com/adafruit-bh1750-ambient-light-sensor?view=all)
- [Adafruit PWM Servo Driver library](https://github.com/adafruit/Adafruit-PWM-Servo-Driver-Library)
- [PCA9685 wiring and servo power](https://learn.adafruit.com/16-channel-pwm-servo-driver/hooking-it-up)
