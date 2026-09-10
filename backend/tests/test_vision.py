import base64
import io
import json
from urllib.error import URLError

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
FRAME = {
    "width": 100,
    "height": 80,
    "image": base64.b64encode(b"\xff\xd8\xff\x00\xff\xd9").decode(),
}


def test_cloud_workflow_contract_and_failures(monkeypatch):
    monkeypatch.delenv("ROBOFLOW_API_KEY", raising=False)
    assert client.post("/api/v1/vision/clouds", json=FRAME).status_code == 503
    monkeypatch.setenv("ROBOFLOW_API_KEY", "test-secret")
    assert client.post("/api/v1/vision/clouds", json={"image": "https://x"}).status_code == 422
    assert client.post("/api/v1/vision/clouds", json={"image": "A" * 2_000_001}).status_code == 422

    payload = {
        "outputs": [
            {
                "predictions": {
                    "image": {"width": 3, "height": 2},
                    "predictions": [
                        {
                            "class": "cloud",
                            "confidence": 0.9,
                            "rle_mask": {"size": [2, 3], "counts": "121O0"},
                        }
                    ],
                }
            }
        ]
    }

    def upstream(request, timeout):
        assert request.get_header("Authorization") == "Bearer test-secret"
        body = json.loads(request.data)
        assert "api_key" not in body
        assert body["inputs"] == {
            "image": {"type": "base64", **{"value": FRAME["image"]}},
            "classes": "cloud",
        }
        assert body["use_cache"] is True
        assert timeout == 25
        return io.BytesIO(json.dumps(payload).encode())

    monkeypatch.setattr("app.vision.urlopen", upstream)
    result = client.post("/api/v1/vision/clouds", json=FRAME)
    assert result.status_code == 200
    assert result.json()["detections"][0]["confidence"] == 0.9
    mask = result.json()["cloud_mask"]
    assert len(mask) == 72 and len(mask[0]) == 128
    assert {value for row in mask for value in row} == {0, 1}
    payload["outputs"][0]["predictions"]["predictions"] = []
    assert client.post("/api/v1/vision/clouds", json=FRAME).json()["detections"] == []
    payload["outputs"][0]["predictions"]["image"] = {"width": None, "height": None}
    assert client.post("/api/v1/vision/clouds", json=FRAME).json()["width"] == 100
    payload["outputs"] = [{"unexpected": {}}]
    assert client.post("/api/v1/vision/clouds", json=FRAME).status_code == 502

    def unavailable(*args, **kwargs):
        raise URLError("private upstream detail test-secret")

    monkeypatch.setattr("app.vision.urlopen", unavailable)
    result = client.post("/api/v1/vision/clouds", json=FRAME)
    assert result.status_code == 502
    assert "test-secret" not in result.text


def test_mask_union_and_uncertain_detections():
    import numpy as np
    import pytest

    from app.vision import decode_mask, parse_clouds

    mask = {"size": [2, 3], "counts": "121O0"}
    np.testing.assert_array_equal(
        decode_mask(mask, 3, 2), [[False, True, True], [True, False, False]]
    )
    cloud = {"class": "cloud", "confidence": 0.9, "rle_mask": mask}
    payload = {
        "outputs": [
            {
                "predictions": {
                    "image": {"width": 3, "height": 2},
                    "predictions": [cloud, cloud],
                }
            }
        ]
    }
    assert parse_clouds(payload, 3, 2).cloud_cover == 0.5
    cloud["confidence"] = 0.1
    assert parse_clouds(payload, 3, 2).cloud_cover is None
    for counts in ("P", "~", [1, 2], [-1, 7]):
        with pytest.raises(ValueError):
            decode_mask({"size": [2, 3], "counts": counts}, 3, 2)
    with pytest.raises(ValueError):
        decode_mask(mask, 2, 3)


def test_vision_reaches_brain_at_one_tick_and_keeps_safety_and_fallback():
    from datetime import datetime, timedelta, timezone

    request = {"scenario": "lie_detector", "wind_override": 3}
    baseline = client.post("/api/v1/simulations/run", json=request).json()
    observation = {
        "tick_index": 72,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "cloud_cover": 0.94,
    }
    fresh = client.post(
        "/api/v1/simulations/run",
        json={
            **request,
            "vision_observation": observation,
        },
    ).json()
    assert fresh["ticks"][:72] == baseline["ticks"][:72]
    assert not baseline["ticks"][72]["sensor_trusted"]
    assert fresh["ticks"][72]["sensor_trusted"]
    assert fresh["ticks"][72]["cloud_source"] == "vision"
    assert fresh["ticks"][72]["environment_cloud"] == baseline["ticks"][72]["cloud"]
    assert fresh["ticks"][72]["expected_ghi"] < baseline["ticks"][72]["expected_ghi"]
    assert fresh["ticks"][73]["cloud_source"] == "environment"
    for wall in fresh["ticks"][72]["facade"]:
        for zone in wall["zones"]:
            assert "AI vision sky estimate" in zone["reason"]
    for age in (61, -10):
        expired = {
            **observation,
            "captured_at": (datetime.now(timezone.utc) - timedelta(seconds=age)).isoformat(),
        }
        fallback = client.post(
            "/api/v1/simulations/run",
            json={
                **request,
                "vision_observation": expired,
            },
        ).json()
        assert fallback == baseline
    safety = client.post(
        "/api/v1/simulations/run",
        json={
            **request,
            "wind_override": 25,
            "vision_observation": observation,
        },
    ).json()
    assert safety["ticks"][72]["mode"] == "SAFE"
    assert (
        client.post(
            "/api/v1/simulations/run",
            json={
                **request,
                "vision_observation": {**observation, "cloud_cover": 1.1},
            },
        ).status_code
        == 422
    )
