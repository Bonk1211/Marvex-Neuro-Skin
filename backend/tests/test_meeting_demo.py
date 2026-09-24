from fastapi.testclient import TestClient

from app.main import app


def test_meeting_glare_is_balanced_without_changing_the_cloud_shaded_room():
    response = TestClient(app).get("/api/v1/daylight/meeting-demo")
    assert response.status_code == 200
    demo = response.json()
    before, after, shade = (demo[name] for name in ("glare", "balanced", "shaded"))
    assert before["angle"] == shade["angle"] == 0
    assert 60 <= after["angle"] <= 180
    assert before["beam"] > after["beam"] > shade["beam"] == 0
    assert max(p["eye_illuminance"] for p in before["probes"][:4]) > demo["ev_cap_lux"]
    meeting = after["probes"][:4]
    assert max(p["eye_illuminance"] for p in meeting) <= demo["ev_cap_lux"]
    assert all(300 <= p["task_illuminance"] <= 500 for p in meeting)
    shaded = shade["probes"][12:14]
    assert all(p["kind"] == "seat" and p["eye_illuminance"] < demo["ev_cap_lux"] for p in shaded)
    assert all(300 <= p["task_illuminance"] <= 500 for p in shaded)
    assert demo == TestClient(app).get("/api/v1/daylight/meeting-demo").json()
