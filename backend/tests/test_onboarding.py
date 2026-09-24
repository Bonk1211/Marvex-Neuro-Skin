import base64

import pytest
from fastapi.testclient import TestClient

from app import onboarding
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    """Keep the manager's profile and attachments out of the repo's data directory."""
    monkeypatch.setattr(onboarding, "DATA_DIR", tmp_path)
    monkeypatch.setattr(onboarding, "PROFILE_PATH", tmp_path / "profile.json")
    return tmp_path


def sources(state: dict) -> dict[str, str]:
    return {row["id"]: row["source"] for row in state["readiness"]}


def test_defaults_are_already_live() -> None:
    state = client.get("/api/v1/onboarding").json()
    assert all(row["ready"] for row in state["readiness"])
    assert state["blocking_items"] == 0
    assert state["site_visits_required"] == 0
    assert state["extra_hardware_required"] is False
    assert sources(state) == {
        "geometry": "default",
        "site": "default",
        "hvac": "default",
        "sensors": "default",
    }


def test_saving_a_section_marks_only_that_section_as_the_managers() -> None:
    profile = client.get("/api/v1/onboarding").json()["profile"]
    profile["structure"]["floors"] = 12
    state = client.post("/api/v1/onboarding/profile", json=profile).json()
    assert state["profile"]["structure"]["floors"] == 12
    assert state["profile"]["updated_at"]
    assert sources(state)["geometry"] == "manager"
    assert sources(state)["site"] == "default"
    # Saved state survives the next read.
    assert client.get("/api/v1/onboarding").json()["profile"]["structure"]["floors"] == 12


def test_document_upload_lists_deletes_and_writes_the_file(isolated_store) -> None:
    payload = b"%PDF-1.4 floor plans"
    state = client.post(
        "/api/v1/onboarding/documents",
        json={
            "name": "../../level 3 plans.pdf",
            "kind": "structure",
            "content": base64.b64encode(payload).decode(),
            "note": "As-built, 2024",
        },
    ).json()
    [document] = state["documents"]
    assert document["name"] == "level 3 plans.pdf"  # path segments stripped
    assert document["size_bytes"] == len(payload)
    assert sources(state)["geometry"] == "document"
    stored = list(isolated_store.glob(f"{document['id']}__*"))
    assert [path.read_bytes() for path in stored] == [payload]

    state = client.delete(f"/api/v1/onboarding/documents/{document['id']}").json()
    assert state["documents"] == []
    assert not list(isolated_store.glob(f"{document['id']}__*"))
    assert client.delete(f"/api/v1/onboarding/documents/{document['id']}").status_code == 404


def test_bad_input_is_rejected() -> None:
    assert (
        client.post(
            "/api/v1/onboarding/documents",
            json={"name": "plans.pdf", "kind": "structure", "content": "not base64!"},
        ).status_code
        == 422
    )
    profile = client.get("/api/v1/onboarding").json()["profile"]
    profile["hvac"]["operating_start_hour"] = 19
    profile["hvac"]["operating_end_hour"] = 7
    assert client.post("/api/v1/onboarding/profile", json=profile).status_code == 422
    profile["structure"]["facade_orientation"] = "sideways"
    assert client.post("/api/v1/onboarding/profile", json=profile).status_code == 422


def test_reset_clears_profile_and_attachments(isolated_store) -> None:
    client.post(
        "/api/v1/onboarding/documents",
        json={"name": "chiller.csv", "kind": "hvac", "content": base64.b64encode(b"a,b").decode()},
    )
    profile = client.get("/api/v1/onboarding").json()["profile"]
    profile["location"]["name"] = "Somewhere else"
    client.post("/api/v1/onboarding/profile", json=profile)

    state = client.post("/api/v1/onboarding/reset").json()
    assert state["documents"] == []
    assert state["profile"] == state["defaults"]
    assert not list(isolated_store.glob("*__*"))
