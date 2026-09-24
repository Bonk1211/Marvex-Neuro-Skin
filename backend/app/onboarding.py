"""Building-manager onboarding: the whole site survey is one form plus a few files.

The profile ships prefilled with the commissioning defaults, so the twin already runs
before a manager touches anything. Saving a section or attaching a document only refines
what is already live -- that is the plug-and-play claim this endpoint has to keep honest,
so readiness never reports "blocked", only "default" versus "from the manager".
"""

import base64
import binascii
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import DEFAULTS
from app.domain.facade import ORIENTATIONS

router = APIRouter(prefix="/api/v1/onboarding", tags=["onboarding"])
logger = logging.getLogger("neuroskin.onboarding")

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "onboarding"
PROFILE_PATH = DATA_DIR / "profile.json"
# ponytail: one JSON file plus a blob directory owned by this process, like the servo
# calibration. Move both to shared storage if several backends ever serve one building.
_lock = Lock()

DocumentKind = Literal["structure", "location", "hvac", "other"]
KIND_LABELS: dict[str, str] = {
    "structure": "Building structure",
    "location": "Site and location",
    "hvac": "HVAC details",
    "other": "Supporting document",
}
# Base64 inflates by 4/3, so this caps a single attachment at roughly 8 MB of file.
MAX_ENCODED = 11_000_000


class Location(BaseModel):
    name: str = Field(default=DEFAULTS.location_name, min_length=1, max_length=120)
    latitude: float = Field(default=DEFAULTS.latitude, ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(default=DEFAULTS.longitude, ge=-180, le=180, allow_inf_nan=False)
    timezone: str = Field(default=DEFAULTS.timezone, min_length=1, max_length=64)


class Structure(BaseModel):
    floors: int = Field(default=DEFAULTS.floors, ge=1, le=200)
    floor_height_m: float = Field(default=DEFAULTS.floor_height_m, ge=2, le=12, allow_inf_nan=False)
    facade_orientation: Literal[tuple(ORIENTATIONS)] = DEFAULTS.facade_orientation  # type: ignore[valid-type]
    # 90 is a plain vertical wall; above 90 the facade leans out over itself.
    facade_tilt: float = Field(default=DEFAULTS.facade_tilt, ge=45, le=135, allow_inf_nan=False)
    roof_pitch: float = Field(default=DEFAULTS.roof_pitch, ge=0, le=60, allow_inf_nan=False)
    roof_overhang_m: float = Field(
        default=DEFAULTS.roof_overhang_m, ge=0, le=10, allow_inf_nan=False
    )
    zone_rows: int = Field(default=DEFAULTS.facade_zone_rows, ge=1, le=12)
    zone_columns: int = Field(default=DEFAULTS.facade_zone_columns, ge=1, le=12)


class Hvac(BaseModel):
    """Plant description, recorded against the building. The twin reports a relative
    cooling-load proxy that no field here feeds; none of this becomes a metered kWh."""

    system: Literal["central_chiller", "district_cooling", "vrf", "split"] = "central_chiller"
    cooling_setpoint_c: float = Field(default=24.0, ge=16, le=30, allow_inf_nan=False)
    cop: float = Field(default=3.5, ge=1, le=10, allow_inf_nan=False)
    plant_capacity_kw: float = Field(default=1200.0, ge=1, le=100_000, allow_inf_nan=False)
    operating_start_hour: int = Field(default=DEFAULTS.day_start_hour, ge=0, le=23)
    operating_end_hour: int = Field(default=DEFAULTS.day_end_hour, ge=1, le=24)
    bms_protocol: Literal["none", "bacnet", "modbus", "mqtt"] = "none"


class BuildingProfile(BaseModel):
    location: Location = Location()
    structure: Structure = Structure()
    hvac: Hvac = Hvac()
    updated_at: str | None = None


class DocumentUpload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: DocumentKind = "other"
    content: str = Field(min_length=1, max_length=MAX_ENCODED)
    note: str = Field(default="", max_length=280)


class DocumentRecord(BaseModel):
    id: str
    name: str
    kind: DocumentKind
    note: str = ""
    size_bytes: int
    uploaded_at: str


class OnboardingState(BaseModel):
    profile: BuildingProfile
    documents: list[DocumentRecord]
    readiness: list[dict[str, object]]
    defaults: BuildingProfile
    # The whole point of the page: nothing above blocks the building from running today.
    blocking_items: int = 0
    site_visits_required: int = 0
    extra_hardware_required: bool = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._ -]", "_", Path(name).name).strip() or "document"
    return cleaned[:120]


def _read_state() -> tuple[BuildingProfile, list[DocumentRecord]]:
    try:
        body = json.loads(PROFILE_PATH.read_text())
        profile = BuildingProfile.model_validate(body.get("profile", {}))
        documents = [DocumentRecord.model_validate(d) for d in body.get("documents", [])]
        return profile, documents
    except FileNotFoundError:
        pass
    except (OSError, ValueError):  # ValidationError and JSONDecodeError are ValueErrors
        logger.warning(
            "Ignoring unreadable onboarding profile; using defaults",
            extra={"event": "onboarding_profile_invalid"},
        )
    return BuildingProfile(), []


def _write_state(profile: BuildingProfile, documents: list[DocumentRecord]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary = PROFILE_PATH.with_suffix(".tmp")
    body = {
        "profile": profile.model_dump(),
        "documents": [d.model_dump() for d in documents],
    }
    temporary.write_text(json.dumps(body, indent=2) + "\n")
    temporary.replace(PROFILE_PATH)  # atomic: a crash never leaves half a file


def _readiness(
    profile: BuildingProfile, documents: list[DocumentRecord]
) -> list[dict[str, object]]:
    """One row per twin input, each already satisfied. Rows say where the value came from."""
    defaults = BuildingProfile()
    kinds = {doc.kind for doc in documents}

    def row(item: str, label: str, section: str, detail: str) -> dict[str, object]:
        edited = getattr(profile, section).model_dump() != getattr(defaults, section).model_dump()
        attached = section in kinds
        source = "document" if attached else "manager" if edited else "default"
        return {
            "id": item,
            "label": label,
            "source": source,
            "ready": True,
            "detail": detail,
            "documents": sum(doc.kind == section for doc in documents),
        }

    return [
        row(
            "geometry",
            "Facade geometry and floors",
            "structure",
            f"{profile.structure.floors} floors, {profile.structure.zone_rows}x"
            f"{profile.structure.zone_columns} louvre zones per wall, "
            f"{profile.structure.facade_orientation} primary facade.",
        ),
        row(
            "site",
            "Site, sun path and weather",
            "location",
            f"{profile.location.latitude:.4f}, {profile.location.longitude:.4f} "
            f"({profile.location.timezone}) drives the solar position and the forecast feed.",
        ),
        row(
            "hvac",
            "HVAC plant and schedule",
            "hvac",
            f"{KIND_LABELS['hvac']}: {profile.hvac.system.replace('_', ' ')}, COP "
            f"{profile.hvac.cop:.1f}, {profile.hvac.cooling_setpoint_c:.0f} C setpoint, "
            f"{profile.hvac.operating_start_hour:02d}:00-{profile.hvac.operating_end_hour:02d}:00.",
        ),
        {
            "id": "sensors",
            "label": "Sensing and actuation",
            "source": "default",
            "ready": True,
            "detail": (
                "Runs on the existing facade with simulated sensing. The ESP32 lux rig and "
                "sky camera are optional add-ons, not prerequisites."
            ),
            "documents": sum(doc.kind == "other" for doc in documents),
        },
    ]


def _state(profile: BuildingProfile, documents: list[DocumentRecord]) -> OnboardingState:
    return OnboardingState(
        profile=profile,
        documents=documents,
        readiness=_readiness(profile, documents),
        defaults=BuildingProfile(),
    )


@router.get("", response_model=OnboardingState)
def read_onboarding() -> OnboardingState:
    with _lock:
        return _state(*_read_state())


@router.post("/profile", response_model=OnboardingState)
def save_profile(profile: BuildingProfile) -> OnboardingState:
    if profile.hvac.operating_end_hour <= profile.hvac.operating_start_hour:
        raise HTTPException(422, "Operating hours must end after they start.")
    with _lock:
        _, documents = _read_state()
        saved = profile.model_copy(update={"updated_at": _now()})
        _write_state(saved, documents)
    logger.info(
        "Building profile saved",
        extra={"event": "onboarding_profile_saved", "location": saved.location.name},
    )
    return _state(saved, documents)


@router.post("/documents", response_model=OnboardingState)
def upload_document(upload: DocumentUpload) -> OnboardingState:
    try:
        payload = base64.b64decode(upload.content, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(422, "Expected base64 file content.") from exc
    if not payload:
        raise HTTPException(422, "Document is empty.")

    record = DocumentRecord(
        id=uuid4().hex[:12],
        name=_safe_name(upload.name),
        kind=upload.kind,
        note=upload.note,
        size_bytes=len(payload),
        uploaded_at=_now(),
    )
    with _lock:
        profile, documents = _read_state()
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        (DATA_DIR / f"{record.id}__{record.name}").write_bytes(payload)
        documents = [*documents, record]
        _write_state(profile, documents)
    logger.info(
        "Onboarding document stored",
        extra={
            "event": "onboarding_document_stored",
            "document_id": record.id,
            "kind": record.kind,
            "size_bytes": record.size_bytes,
        },
    )
    return _state(profile, documents)


@router.delete("/documents/{document_id}", response_model=OnboardingState)
def delete_document(document_id: str) -> OnboardingState:
    with _lock:
        profile, documents = _read_state()
        kept = [doc for doc in documents if doc.id != document_id]
        if len(kept) == len(documents):
            raise HTTPException(404, "Document not found.")
        for stale in DATA_DIR.glob(f"{document_id}__*"):
            stale.unlink(missing_ok=True)
        _write_state(profile, kept)
    return _state(profile, kept)


@router.post("/reset", response_model=OnboardingState)
def reset_onboarding() -> OnboardingState:
    """Back to the shipped defaults, attachments included: the state a new building starts in."""
    with _lock:
        _, documents = _read_state()
        for doc in documents:
            for stale in DATA_DIR.glob(f"{doc.id}__*"):
                stale.unlink(missing_ok=True)
        profile = BuildingProfile()
        _write_state(profile, [])
    return _state(profile, [])
