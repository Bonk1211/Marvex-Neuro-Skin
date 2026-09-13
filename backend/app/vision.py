"""Cloud inference for camera frames, including frames from prerecorded demos."""

import base64
import binascii
import json
import os
from urllib.error import URLError
from urllib.request import Request, urlopen

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.feed_health import record_feed

router = APIRouter(prefix="/api/v1/vision", tags=["vision"])
WORKFLOW_URL = (
    "https://serverless.roboflow.com/infer/workflows/jias-workspace-tnv49/general-segmentation-api"
)


class CloudFrame(BaseModel):
    image: str = Field(min_length=1, max_length=2_000_000)
    width: int = Field(gt=0, le=1920)
    height: int = Field(gt=0, le=1920)

    @field_validator("image")
    @classmethod
    def jpeg_frame(cls, value: str) -> str:
        try:
            data = base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError("Expected a base64 JPEG frame") from exc
        if not data.startswith(b"\xff\xd8\xff") or not data.endswith(b"\xff\xd9"):
            raise ValueError("Expected a JPEG frame")
        return value


class CloudDetection(BaseModel):
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)


class CloudResult(BaseModel):
    detections: list[CloudDetection]
    width: int = Field(gt=0, le=1920)
    height: int = Field(gt=0, le=1920)
    cloud_cover: float | None = None
    cloud_mask: list[list[int]] | None = None
    annotated_image: str | None = None


def decode_mask(mask: dict, width: int, height: int) -> np.ndarray:
    """Decode COCO's signed, delta-encoded 5-bit counts into a column-major mask.

    Format: https://github.com/cocodataset/cocoapi/blob/master/common/maskApi.c
    """
    if mask["size"] != [height, width]:
        raise ValueError("Mask dimensions do not match frame")
    counts = mask["counts"]
    if isinstance(counts, str):
        runs = []
        value = shift = 0
        for char in counts:
            code = ord(char) - 48
            if not 0 <= code <= 63 or shift > 25:
                raise ValueError("Invalid mask encoding")
            value |= (code & 31) << shift
            shift += 5
            if code & 32:
                continue
            if code & 16:
                value -= 1 << shift
            if len(runs) > 2:
                value += runs[-2]
            runs.append(value)
            value = shift = 0
        if shift:
            raise ValueError("Truncated mask")
        counts = runs
    if (
        not isinstance(counts, list)
        or not counts
        or any(type(n) is not int or n < 0 for n in counts)
        or sum(counts) != width * height
    ):
        raise ValueError("Invalid mask size")
    return np.repeat(np.arange(len(counts)) % 2 == 1, counts).reshape((height, width), order="F")


def parse_clouds(payload: dict, width: int, height: int) -> CloudResult:
    # A named Workflow output contains the standard segmentation predictions.
    outputs = payload["outputs"]
    if not isinstance(outputs, list) or len(outputs) != 1:
        raise ValueError("Expected one frame")
    candidates = [
        value
        for value in outputs[0].values()
        if isinstance(value, dict)
        and isinstance(value.get("predictions"), list)
        and isinstance(value.get("image"), dict)
    ]
    if len(candidates) != 1:
        raise ValueError("Workflow must expose one segmentation predictions output")
    prediction = candidates[0]
    result = CloudResult(
        detections=[],
        width=prediction["image"].get("width") or width,
        height=prediction["image"].get("height") or height,
    )
    union = np.zeros((result.height, result.width), dtype=bool)
    confident = False
    for item in prediction["predictions"]:
        if str(item["class"]).strip().lower() != "cloud":
            continue
        detection = CloudDetection.model_validate(item)
        result.detections.append(detection)
        pixels = decode_mask(item["rle_mask"], result.width, result.height)
        if detection.confidence >= 0.5:
            union |= pixels
            confident = True
    # ponytail: full-frame cloud area is a demo sky proxy; calibrate a sky ROI
    # and confidence threshold before connecting a physical camera/controller.
    result.cloud_cover = round(float(union.mean()), 4) if confident else None
    if confident:
        # Small mask for the 3D canopy; retain the full-resolution area above.
        rows = np.linspace(0, result.height - 1, 72).astype(int)
        columns = np.linspace(0, result.width - 1, 128).astype(int)
        result.cloud_mask = union[np.ix_(rows, columns)].astype(int).tolist()
    annotated = outputs[0].get("annotated_image", {})
    if annotated.get("type") == "base64":
        encoded = annotated["value"]
        data = base64.b64decode(encoded, validate=True)
        mime = "image/png" if data.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg"
        if mime == "image/jpeg" and not data.startswith(b"\xff\xd8\xff"):
            raise ValueError("Invalid annotated image")
        result.annotated_image = f"data:{mime};base64,{encoded}"

    return result


@router.post("/clouds", response_model=CloudResult)
def detect_clouds(frame: CloudFrame) -> CloudResult:
    key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "Cloud vision needs ROBOFLOW_API_KEY on the backend.")
    request = Request(
        WORKFLOW_URL,
        data=json.dumps(
            {
                "inputs": {"image": {"type": "base64", "value": frame.image}, "classes": "cloud"},
                "use_cache": True,
            }
        ).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=25) as response:
            raw = response.read(6_000_001)
        if len(raw) > 6_000_000:
            raise ValueError("Workflow response too large")
        result = parse_clouds(json.loads(raw), frame.width, frame.height)
        record_feed("roboflow", "applied")
        return result
    except (URLError, TimeoutError, OSError):
        record_feed("roboflow", "error")
        # Never return upstream bodies/URLs, which may contain credentials.
        raise HTTPException(
            502, "Cloud vision is unavailable. Check Roboflow access and retry."
        ) from None
    except (ValueError, KeyError, TypeError, AttributeError, ValidationError):
        record_feed("roboflow", "error")
        raise HTTPException(
            502,
            "Unexpected workflow output. Expose segmentation predictions with image dimensions "
            "and cloud RLE masks in Roboflow.",
        ) from None
