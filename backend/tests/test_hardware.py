import json
import logging

import pytest
from fastapi.testclient import TestClient

from app import hardware
from app.main import app

client = TestClient(app, client=("127.0.0.1", 50000))
remote = TestClient(app, client=("192.168.1.20", 50000))
TOKEN = {"X-Hardware-Token": "test-token"}
TWIN = {"W13": 10, "W14": 20, "W9": 40, "W10": 60}
CALIBRATION = "/api/v1/hardware/calibration"
CONTROL = "/api/v1/hardware/control"


def reading(lux: float | None = 500.0, angle: float = 30.0) -> dict:
    return {"lux": lux, "commanded_angle": angle}


def batch(**panels: dict) -> dict:
    return {"seq": 1, "panels": {panel: reading() for panel in hardware.PANEL_ZONES} | panels}


def tick(body: dict, headers: dict = TOKEN):
    return client.post("/api/v1/hardware/tick", json=body, headers=headers)


def control(body: dict):
    return client.post(CONTROL, json=body)


@pytest.fixture(autouse=True)
def fresh_bridge(monkeypatch, tmp_path):
    monkeypatch.setenv("HARDWARE_TOKEN", "test-token")
    monkeypatch.setattr(hardware, "CALIBRATION_PATH", tmp_path / "hardware_calibration.json")
    monkeypatch.setattr(hardware, "_state", hardware._initial_state())
    clock = [1000.0]
    monkeypatch.setattr(hardware, "monotonic", lambda: clock[0])
    return clock


def test_tick_requires_configured_token(monkeypatch) -> None:
    assert tick(batch(), headers={"X-Hardware-Token": "wrong"}).status_code == 401
    assert tick(batch(), headers={}).status_code == 401
    # Auth runs before body validation, so a stranger never sees the schema errors.
    assert tick({"seq": 1}, headers={}).status_code == 401
    monkeypatch.delenv("HARDWARE_TOKEN")
    assert tick(batch()).status_code == 503


def test_tick_rejects_incomplete_or_out_of_range_batches() -> None:
    missing = batch()
    del missing["panels"]["bh4"]
    assert tick(missing).status_code == 422
    assert tick(batch(bh5=reading())).status_code == 422
    assert tick(batch(bh1=reading(lux=-1))).status_code == 422
    assert tick(batch(bh1=reading(angle=181))).status_code == 422


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


def test_lux_step_shades_only_on_the_0_to_90_half() -> None:
    assert hardware.lux_step(900, 88).angle == 90
    assert hardware.lux_step(100, 2).angle == 0
    # A calibration hold past parallel comes back into the shading half.
    assert hardware.lux_step(900, 135).angle == 90
    assert hardware.lux_step(100, 135).angle == 85
    assert hardware.lux_step(None, 135).angle == 135


def test_twin_mode_mirrors_zone_angles_then_expires(fresh_bridge, caplog) -> None:
    with caplog.at_level(logging.INFO, logger="neuroskin.hardware"):
        response = control({"mode": "twin", "angles": TWIN})
    assert response.json()["mode"] == "twin"
    assert any(record.event == "hardware_mode_changed" for record in caplog.records)
    panels = tick(batch(bh1=reading(900, 0))).json()["panels"]
    angles = {panel: command["angle"] for panel, command in panels.items()}
    # Reflection geometry needs the same physical and displayed blade angle.
    assert angles == {"bh1": 10, "bh2": 20, "bh3": 40, "bh4": 60}

    fresh_bridge[0] += hardware.HOLD_TTL_S + 1
    panels = tick(batch(bh1=reading(900, 0))).json()["panels"]
    assert panels["bh1"] == {"angle": 5, "mode": "auto", "reason": "900 lux above 700; shading."}
    assert client.get("/api/v1/hardware/status").json()["mode"] == "auto"


def test_twin_mode_preserves_the_requested_half_turn(fresh_bridge) -> None:
    control({"mode": "twin", "angles": {**TWIN, "W13": 180}})
    command = tick(batch(bh1=reading(900, 0))).json()["panels"]["bh1"]
    assert command["angle"] == 180
    assert command["mode"] == "twin"
    assert client.get("/api/v1/hardware/status").json()["held"]["bh1"] == 180
    assert "180° → 180°" in command["reason"]


def test_wind_retreat_holds_the_rig_at_the_angles_the_agent_room_agreed() -> None:
    retreat = {"W13": 0, "W14": 0, "W9": 6, "W10": 11}
    assert control({"mode": "wind", "angles": retreat}).json()["mode"] == "wind"

    # A bright panel cannot open a bay the room retreated: the hold outranks lux.
    panels = tick(batch(bh1=reading(900, 45))).json()["panels"]
    assert {panel: command["angle"] for panel, command in panels.items()} == {
        "bh1": 0,
        "bh2": 0,
        "bh3": 6,
        "bh4": 11,
    }
    assert panels["bh1"]["mode"] == "wind"
    assert "W13 holds 0°" in panels["bh1"]["reason"]

    # Calming the wind hands the rig back to its own lux control.
    assert control({"mode": "auto"}).json()["mode"] == "auto"
    assert tick(batch(bh1=reading(900, 45))).json()["panels"]["bh1"]["mode"] == "auto"


def test_sensor_demo_disconnects_twin_and_responds_only_at_the_lit_corner() -> None:
    control({"mode": "twin", "angles": TWIN})
    assert tick(batch()).json()["panels"]["bh1"]["angle"] == TWIN["W13"]
    response = control({"mode": "auto"}).json()
    assert response["mode"] == "auto" and response["held"] == {}

    for corner in hardware.PANEL_ZONES:
        panels = tick(
            batch(
                **{
                    panel: reading(900 if panel == corner else 100, 0)
                    for panel in hardware.PANEL_ZONES
                }
            )
        ).json()["panels"]
        assert {panel: command["angle"] for panel, command in panels.items()} == {
            panel: 5 if panel == corner else 0 for panel in hardware.PANEL_ZONES
        }
        assert all(command["mode"] == "auto" for command in panels.values())

    # The demo can switch back without the bright corner altering the twin commands.
    control({"mode": "twin", "angles": TWIN})
    panels = tick(batch(bh1=reading(900, 0))).json()["panels"]
    assert {panel: command["angle"] for panel, command in panels.items()} == {
        panel: TWIN[zone] for panel, zone in hardware.PANEL_ZONES.items()
    }


@pytest.mark.parametrize("mode", ["twin", "calibrate"])
def test_delayed_keepalive_cannot_reconnect_a_disconnected_control_source(mode) -> None:
    angles = TWIN if mode == "twin" else dict.fromkeys(hardware.PANEL_ZONES, 30)
    command = {"mode": mode, "angles": angles}
    assert control(command).status_code == 200
    assert control(command | {"refresh_only": True}).status_code == 200
    control({"mode": "auto"})
    assert control(command | {"refresh_only": True}).status_code == 409
    live = client.get("/api/v1/hardware/status").json()
    assert live["mode"] == "auto" and live["held"] == {}


def test_calibrate_mode_holds_each_panel_then_expires(fresh_bridge) -> None:
    holds = {"bh1": 0, "bh2": 180, "bh3": 90, "bh4": 45}
    assert control({"mode": "calibrate", "angles": holds}).json()["held"] == holds
    panels = tick(batch(bh2=reading(None))).json()["panels"]
    assert panels["bh2"] == {
        "angle": 180,
        "mode": "calibrate",
        "reason": "Calibration hold at 180°.",
    }
    assert {panel: command["angle"] for panel, command in panels.items()} == holds

    fresh_bridge[0] += hardware.HOLD_TTL_S + 1
    assert tick(batch()).json()["panels"]["bh1"]["mode"] == "auto"
    assert client.get("/api/v1/hardware/status").json()["held"] == {}


def test_control_validates_angles_and_origin() -> None:
    assert control({"mode": "twin"}).status_code == 422
    assert control({"mode": "twin", "angles": {**TWIN, "W13": 181}}).status_code == 422
    partial = {zone: angle for zone, angle in TWIN.items() if zone != "W10"}
    assert control({"mode": "twin", "angles": partial | {"W1": 0}}).status_code == 422
    assert control({"mode": "auto", "angles": TWIN}).status_code == 422
    # Calibration holds are keyed by panel, not zone.
    assert control({"mode": "calibrate", "angles": TWIN}).status_code == 422
    assert remote.post(CONTROL, json={"mode": "auto"}).status_code == 403


def test_calibration_persists_and_rides_every_tick() -> None:
    defaults = tick(batch()).json()["calibration"]
    # Set on the rig: W13 and W10 start at servo 180°; W14 and W9 at servo 0°.
    assert [hardware.PANEL_ZONES[p] for p in ("bh1", "bh4")] == ["W13", "W10"]
    for panel in ("bh1", "bh4"):
        assert defaults[panel] == {"servo_at_0": 180, "servo_at_180": 0}
    for panel in ("bh2", "bh3"):
        assert defaults[panel] == {"servo_at_0": 0, "servo_at_180": 180}
    panels = {panel: {"servo_at_0": 120, "servo_at_180": 30} for panel in hardware.PANEL_ZONES}
    panels["bh3"] = {"servo_at_0": 10.5, "servo_at_180": 104}

    saved = client.post(CALIBRATION, json={"panels": panels})
    assert saved.status_code == 200
    assert saved.json()["calibration"]["bh3"] == {"servo_at_0": 10.5, "servo_at_180": 104}
    assert tick(batch()).json()["calibration"] == panels
    assert json.loads(hardware.CALIBRATION_PATH.read_text()) == panels
    # A backend restart reloads the file.
    assert hardware._initial_state()["calibration"]["bh1"].servo_at_0 == 120


def test_calibration_rejects_bad_input_and_remote_callers() -> None:
    panels = {panel: {"servo_at_0": 0, "servo_at_180": 180} for panel in hardware.PANEL_ZONES}
    too_far = panels | {"bh1": {"servo_at_0": 181, "servo_at_180": 180}}
    assert client.post(CALIBRATION, json={"panels": too_far}).status_code == 422
    old_format = panels | {"bh1": {"servo_at_0": 75, "servo_at_60": 135}}
    assert client.post(CALIBRATION, json={"panels": old_format}).status_code == 422
    assert remote.post(CALIBRATION, json={"panels": panels}).status_code == 403
    del panels["bh4"]
    assert client.post(CALIBRATION, json={"panels": panels}).status_code == 422
    assert not hardware.CALIBRATION_PATH.exists()


def test_unreadable_or_old_calibration_file_falls_back_to_defaults() -> None:
    hardware.CALIBRATION_PATH.write_text("{not json")
    assert hardware._initial_state()["calibration"]["bh3"] == hardware.ServoCalibration()
    # Older 0–60 / 0–90 files must not half-load (keeping servo_at_0, defaulting the far end).
    for far_end in ("servo_at_60", "servo_at_90"):
        old = {panel: {"servo_at_0": 75, far_end: 135} for panel in hardware.PANEL_ZONES}
        hardware.CALIBRATION_PATH.write_text(json.dumps(old))
        defaults = hardware._initial_state()["calibration"]["bh3"]
        assert (defaults.servo_at_0, defaults.servo_at_180) == (0, 180)


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


def test_live_csi_calibration_motion_gaps_and_legacy_firmware(fresh_bridge) -> None:
    sample = {
        "enabled": True,
        "uptime_ms": 500,
        "window_ms": 500,
        "frames": 25,
        "ap": "AA:BB:CC:DD:EE:FF",
        "channel": 6,
        "amplitude": 10.0,
        "sigma": 0.5,
        "rssi": -48,
        "amplitudes": [8, 12, 9, 11],
        "servos_moving": False,
    }

    def send(**changes):
        fresh_bridge[0] += 0.5
        sample["uptime_ms"] += 500
        reply = tick(batch(bh1=reading(900)) | {"csi": sample | changes})
        assert reply.status_code == 200, reply.text
        # CSI never takes over the existing actuator loop.
        assert reply.json()["panels"]["bh1"]["angle"] == 35
        return client.get("/api/v1/hardware/status").json()["csi"]

    assert send(servos_moving=True, sigma=10)["calibration_windows"] == 0
    assert send(frames=2)["state"] == "low_rate"
    for index in range(hardware.CSI_BASELINE_WINDOWS):
        measured = send()
        assert measured["calibration_windows"] == index + 1
    assert measured["state"] == "quiet"
    assert measured["frames_per_second"] == 50
    assert measured["threshold"] == 1.5
    assert measured["amplitudes"] == sample["amplitudes"]
    assert send(sigma=2)["state"] == "motion"
    assert send(sigma=2, servos_moving=True)["state"] == "servos_moving"
    assert (
        send(frames=0, amplitude=None, sigma=None, rssi=None, amplitudes=[])["state"] == "no_signal"
    )
    assert send()["state"] == "quiet"

    fresh_bridge[0] += hardware.OFFLINE_AFTER_S + 1
    offline = client.get("/api/v1/hardware/status").json()
    assert offline["online"] is False and offline["csi"]["state"] == "offline"
    assert send()["calibration_windows"] == 1  # reconnect requires a new baseline
    assert send(uptime_ms=0)["calibration_windows"] == 1  # board reboot
    assert send(channel=11)["calibration_windows"] == 1  # different RF channel

    assert remote.post("/api/v1/hardware/csi/calibrate").status_code == 403
    reset = client.post("/api/v1/hardware/csi/calibrate").json()
    assert reset["csi"]["threshold"] is None
    assert reset["csi"]["calibration_windows"] == 0
    assert reset["mode"] == "auto"
    assert send()["state"] == "calibrating"

    for invalid in ({"sigma": -1}, {"amplitudes": [257]}, {"frames": 0}, {"rssi": None}):
        assert tick(batch() | {"csi": sample | invalid}).status_code == 422
    for _ in range(hardware.CSI_BASELINE_WINDOWS):
        measured = send(sigma=0)
    assert measured["threshold"] >= hardware.CSI_MIN_SIGMA
    assert send(sigma=0)["state"] == "quiet"
    assert tick(batch()).status_code == 200  # pre-CSI firmware remains supported
    assert client.get("/api/v1/hardware/status").json()["csi"] is None
