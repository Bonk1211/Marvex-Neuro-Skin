# Raspberry Pi hardware validation plan

Status: planning only; hardware code and live API endpoints are not implemented.

## Cloud vision and indoor presentation

The dashboard now loops the supplied sky video in a CCTV-style view and runs
real cloud segmentation on a configurable schedule (15 seconds by default).
Fresh results update the simulation brain at the selected simulation time,
using full-frame cloud mask area as a demo sky estimate. The overlay shows the
current MYT date/time. See the root README for setup and fallback behavior.
The demo does not control physical servos; the hardware integration below is
still a plan.

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

## Objective

Demonstrate a 2×2 grid of four independently controlled NeuroSkin louvre panels
on one building side. Each panel has one SG90 and one BH1750: four servos and
four light sensors total. Decisions run on the backend hosted on the same
Raspberry Pi. Expose live status through Cloudflare Tunnel. One shared anemometer
provides the wind safety input for all four panels.

The benefit is local control without an internet round trip, not zero latency.
Sensor acquisition, local communication, computation and mechanical travel still
take time. Automatic operation must continue with the frontend closed or the
internet disconnected.

## Hardware scope

| Component | Purpose | Decision |
| --- | --- | --- |
| Raspberry Pi computer running Raspberry Pi OS | Host FastAPI, hardware process and Cloudflare Tunnel | Required; confirm model and suitable Pi power supply |
| 4 × BH1750 breakout modules | Measure illuminance in lux independently per panel | The only light sensor type; one behind each panel |
| 1 × TCA9548A I²C multiplexer breakout | Separate four sensors with identical I²C addresses | Added; use channels 0–3 |
| 1 × anemometer | Measure shared wind for a safety override | Retained; exact model, output and power requirements pending |
| 1 × PCA9685 breakout module | Generate four servo PWM signals from I²C commands | Retained; use channels 0–3 |
| 4 × SG90 positional servos | Move four lightweight panels independently | Verify positional versions and calibrate each linkage's usable travel |
| Servo power supply | Supply four servos without browning out the Pi | Size for combined peak/stall demand, including simultaneous safety movement; verify wiring and board current capacity |
| Wires, connectors and louvre mount/linkage | Electrical and mechanical assembly | Required |
| GL5528 LDR and divider resistor | Previous analog light input | Removed |
| ADS1115 | Previous LDR ADC | Removed from light sensing; reconsider only if the anemometer requires analog conversion |

BH1750 provides digital readings and needs no LDR voltage divider. An anemometer
with a pulse output may connect through suitable GPIO conditioning; an analog
model needs an ADC and any required input conditioning; RS485 needs a transceiver.
Do not finalise wind wiring before obtaining its exact datasheet.

Use 3.3 V-compatible I²C logic/pull-ups for the Pi. Confirm breakout-specific
power requirements. Connect common grounds and connect the servo supply to the
PCA9685 servo power input, separately from its logic supply. Do not power the
servo from a GPIO or the Pi's 3.3 V rail. Verify wiring before applying power.

## Panel mapping and I²C connections

View the physical grid from outside the building:

```text
+-----------------+-----------------+
| top_left        | top_right       |
| BH1750 + SG90   | BH1750 + SG90   |
+-----------------+-----------------+
| bottom_left     | bottom_right    |
| BH1750 + SG90   | BH1750 + SG90   |
+-----------------+-----------------+
```

| Panel ID | TCA9548A sensor channel | PCA9685 servo channel |
| --- | --- | --- |
| `top_left` | 0 | 0 |
| `top_right` | 1 | 1 |
| `bottom_left` | 2 | 2 |
| `bottom_right` | 3 | 3 |

BH1750 supports only two addresses, `0x23` and `0x5C`, so four sensors cannot all
share one unsegmented I²C bus. Use one TCA9548A with each BH1750 at `0x23` on a
separate downstream channel; select only one sensor channel at a time. Connect
the PCA9685 to the Pi's upstream I²C bus alongside the multiplexer. Verify actual
board addresses before use. See the [BH1750 address documentation](https://learn.adafruit.com/adafruit-bh1750-ambient-light-sensor?view=all)
and [multiplexer guide](https://learn.adafruit.com/adafruit-tca9548a-1-to-8-i2c-multiplexer-breakout?view=all).

Label sensor and servo cables with the panel IDs. Mount each sensor behind its
own panel with consistent orientation and use partitions if needed to reduce
light spill between panels. Independent control does not guarantee different
angles: equal readings may correctly produce equal commands.

## Architecture and folder ownership

```text
4 × BH1750 --> TCA9548A     shared anemometer
                    \       /
                     Pi I/O
        |
        v
hardware process on Pi -- localhost HTTP --> FastAPI on the same Pi
        ^                                    |
        +--------- returned decision --------+
        |
        v
     PCA9685 channels 0–3 --> 4 × SG90 --> 4 panels --> local lux feedback

Remote frontend <--> Cloudflare Tunnel <--> FastAPI live status API
```

Keep Pi-specific I/O in a top-level `hardware/` folder. Keep the live decision
policy and API in `backend/`; display measured status in `frontend/`.

Proposed files to create when implementing:

```text
hardware/
  README.md             # This plan, later expanded with verified setup steps
  main.py               # Read sensors, exchange localhost messages, drive servo
  requirements.txt      # Pi driver dependencies only
backend/app/
  hardware.py           # Live routes, validated data models and small lux policy
```

Register the live routes in the existing `backend/app/main.py`. Use existing
FastAPI/Pydantic and logging patterns. Start with one hardware process owning all
I²C/PWM writes and one backend worker owning live state. No MQTT broker, database
or separate microcontroller is needed for this demonstrator. Add a bounded
timeout to every local API call; do not let a failed call block fallback handling.

The existing `/api/v1/simulations/run` endpoint generates a simulated day. It is
not a live control endpoint. `backend/app/domain/controller.py:run_tick` expects
environment/irradiance inputs and uses simulation tick timing; do not feed it lux
as W/m² or replay its outputs as physical servo commands.

## Local control and API plan

1. Start the hardware process in a calibrated safe state. Require valid readings
   and a healthy backend before enabling automatic light control.
2. Read each BH1750 through its mux channel and read shared wind. Record per-panel
   validity and acquisition timestamps plus a batch sequence. Use a monotonic
   clock for timeouts and elapsed durations; sensor reads are not simultaneous.
3. Send one batch to proposed `POST /api/v1/hardware/tick` over localhost: a
   `panels` mapping keyed by the four panel IDs, plus shared wind and its freshness.
   Include explicit invalid status for failed reads rather than omitting a panel.
4. The backend validates the batch and returns the matching sequence, command ID
   and four panel decisions, each with bounded target angle, mode and reason.
   Reject unknown/missing panel IDs; never map commands by array order alone.
5. The hardware process validates the response, rejects expired/mismatched
   commands, applies each panel's calibrated travel limits and writes its mapped
   PCA9685 channel. A response must cover all four known IDs before applying it.
6. Send a command acknowledgement to proposed
   `POST /api/v1/hardware/ack`, reporting successful PWM write or an error per
   panel. Sequential writes are not atomic; report partial success accurately.
7. The frontend polls proposed `GET /api/v1/hardware/status`, initially once per
   second. Label this view as live hardware and show stale/unavailable status.

Start with a configurable 500 ms control interval, subject to the BH1750 mode and
anemometer measurement window. This is a starting setting, not a verified latency
claim. Budget for all four sensor reads and servo writes; use continuous sensor
measurement where supported and measure the full cycle duration. Wind pulse
counting may need to accumulate across several control cycles.

Status should expose a 2×2 panel mapping with each panel's measured lux, sample age,
target angle, last successfully commanded angle, acknowledgement, mode, reason
and errors, plus shared wind speed/freshness. The SG90 provides no external position measurement: call the angle
"commanded", not "measured". Missing/stale wind must never become zero wind.

For the first demo, apply the same small lux policy separately to each panel,
retaining independent angle, recovery and movement-timing state. Do not average
the four lux readings into one facade-wide light command.
Use a configurable lux band with hysteresis: incrementally
open below the lower boundary, close above the upper boundary, and hold inside
the band. Calibrate which servo direction opens the actual linkage. Allow sensor
and mechanical settling between movements, bound the movement rate using actual
elapsed time, and avoid repeatedly commanding negligible changes.

Wind above the configured threshold overrides light control and selects the
mechanically validated safe position for all four panels. Require a lower release threshold and a
stable recovery period to avoid oscillating around the wind threshold. Treat
stale/failed BH1750 readings as a fault for the affected panel; healthy panels
continue independently when the bus remains usable. Shared wind failure, a bus
failure or a local API timeout faults all four panels: the hardware process
attempts their configured safe positions while power and I²C remain usable.
Do not allow normal light control to overwrite an active fault.

Keep calibration settings for lux thresholds, wind conversion/thresholds, sample
freshness, API timeout, recovery delay, servo pulse endpoints, angle limits,
direction, safe angle and movement rate. Store servo calibration and any lux-band
overrides per panel; keep wind settings shared. Reject invalid configuration and
duplicate sensor/servo channel assignments at startup.

## Hosting and tunnel

- Run the backend, hardware process and `cloudflared` as supervised services on
  the Pi, with restart handling and logs. Start the backend before hardware, but
  still handle backend outages during operation.
- Bind the backend to loopback and point the tunnel to its local port. Configure
  the frontend to use the public HTTPS API hostname.
- Permit the actual frontend origin in backend CORS; the current application
  allows only localhost origins. CORS is not authentication.
- Authenticate remote access. Keep tick/ack routes accessible only to the local
  hardware process, using a local credential and excluding them from public
  tunnel routing. Do not embed that credential in frontend code.
- Start with remote monitoring only. If manual remote movement is later added,
  require authorization, bounded commands and expiry; local safety takes priority.
- Keep full-day simulation jobs out of the active demo workload until load tests
  show they do not compromise local response time.

Tunnel loss should affect remote visibility only. Backend or hardware-process
failure is a different fault. Linux and this prototype do not provide hard
real-time guarantees; a crashed process or power loss cannot be assumed to park
the servo. Automatic parking without power needs additional mechanical or backup
power provisions and is outside this initial proof.

## Implementation sequence

1. **Confirm and assemble:** identify Pi/breakout/anemometer models; verify voltage
   compatibility; build the lightweight linkage; document wiring and calibration.
2. **Check devices locally:** read real lux, check wind conversion and move the
   four unloaded servos within conservative limits before attaching linkages.
   Verify each sensor/servo mapping individually, then test simultaneous movement
   for supply dips, Pi resets and I²C errors.
3. **Connect backend control:** implement the local tick/ack/status contract and
   lux policy, then connect the hardware process and fault handling.
4. **Connect the frontend:** add a live hardware view and authenticated tunnel
   access, clearly separating live measurements from simulation results.
5. **Capture validation:** run the checks below and retain logs plus a short video
   in a dated validation record. Record failures as well as successes.

## Validation and acceptance

| Check | Required evidence |
| --- | --- |
| Light sensing | Shade/illuminate each BH1750 in turn; the matching panel's real lux and timestamp appear in backend and the 2×2 frontend view |
| Independent control | Illuminate one panel while other readings stay stable; only its mapped servo responds to that light change; repeat for all four |
| Physical response | Cross both lux boundaries; backend decisions and command IDs correspond to visible opening/closing |
| Feedback | With lamp position fixed, louvre movement changes the lux behind it; control settles or reports an unreachable band at its travel limit |
| Wind override | Apply airflow; shared wind triggers all four safe angles, without power brownouts, and recovery does not chatter |
| Network independence | Close the frontend and disconnect internet; repeat local light/wind tests successfully |
| Sensor/API failure | Disconnect one BH1750: its panel faults while healthy panels continue if the bus works; stop backend or fail shared wind: all panels attempt fallback within the configured timeout |
| Restart | Restart services; reject stale commands and require healthy readings before automatic operation resumes |
| Access control | Unauthenticated remote requests and public tick/ack submissions are rejected |
| Latency | Record sample-ready → decision → PWM-write durations on the Pi, including median, p95 and maximum; measure physical travel separately by video |

Capture at least 30 light-triggered transitions per panel for the latency report,
including mixed four-panel activity. Record per-panel latency and complete batch
duration so sequential reads do not hide a slow last channel. Also note
the sampling interval: sample-ready timing excludes the wait until the next
sample and the sensor's acquisition time. Repeat timing under expected dashboard
traffic. Select the acceptance target before measurement and report the actual
result; do not claim zero latency.

During implementation, add one focused backend test module covering lux-band
behaviour, panel isolation/mapping, shared wind priority, invalid/stale data and
per-panel command limits, using existing
pytest support. Exercise physical fallback and timing on the Pi; software tests
alone cannot establish those results.

## What this demonstration establishes

The scope is measured light/wind → local backend decision → physical movement,
with remote monitoring and independence from internet availability.

Each BH1750 measures illuminance, not solar irradiance or heat flow. Four sensors
in different zones are not redundant references for one another. This setup cannot
independently validate the simulated irradiance lie detector, detect every
plausible stuck reading, establish cooling-energy savings, or prove full-scale
facade reliability. No rain or temperature measurement is included. Keep those
claims and any modelled inputs explicitly separate from the hardware results.

## Reference documentation

- [BH1750 guide](https://learn.adafruit.com/adafruit-bh1750-ambient-light-sensor?view=all)
- [TCA9548A multiplexer guide](https://learn.adafruit.com/adafruit-tca9548a-1-to-8-i2c-multiplexer-breakout?view=all)
- [PCA9685 with Raspberry Pi/Python](https://learn.adafruit.com/16-channel-pwm-servo-driver/python-circuitpython)
- [PCA9685 wiring and servo power](https://learn.adafruit.com/16-channel-pwm-servo-driver/hooking-it-up)
- [Raspberry Pi hardware documentation](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html)
- [Cloudflare Tunnel documentation](https://developers.cloudflare.com/tunnel/)

Resolve the exact anemometer and purchased module specifications before turning
this plan into a pin-by-pin wiring guide.
