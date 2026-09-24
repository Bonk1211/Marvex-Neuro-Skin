"""Cross-section view of one floor: the solved radiosity field behind Et/Ev.

The dashboard's floor scene draws sun paths only. This serves the interreflection
underneath them -- every patch's radiosity, and how much of it reaches one occupant's
eye plane -- so a section view can show where a seat's light actually comes from.

The yaw sweep re-aims one occupant's eye normal against a single solved room. That is
the whole argument for sensing posture: the room does not change, the head does.

Modelled from the same diffuse-patch oracle as the training labels. Not Radiance,
not measured comfort. See docs/appendix for what this does and does not establish.
"""

from math import degrees, pi, radians
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import DEFAULTS
from app.domain.daylight.oracle import illuminance_at_probes, probe_breakdown, solve_radiosity
from app.domain.daylight.room import RoomGeometry, probes_for, zone_for
from app.domain.facade import ORIENTATIONS

router = APIRouter(prefix="/api/v1/daylight", tags=["daylight"])

Orientation = Literal["north", "east", "south", "west"]
# Enough steps to read the shape of the curve without shipping a 360-entry payload.
YAW_STEPS = 24


class SectionRequest(BaseModel):
    """Oracle inputs, not zone ids: flux is what already passed the louvres."""

    orientation: Orientation = DEFAULTS.facade_orientation  # type: ignore[assignment]
    band: int = Field(0, ge=0, lt=DEFAULTS.facade_zone_rows)
    beam_flux: float = Field(0.0, ge=0, le=1500, allow_inf_nan=False)
    diffuse_flux: float = Field(0.0, ge=0, le=1500, allow_inf_nan=False)
    solar_elevation: float = Field(0.0, ge=-90, le=90, allow_inf_nan=False)
    solar_azimuth: float = Field(0.0, ge=0, le=360, allow_inf_nan=False)
    # Which occupant to decompose. None picks the seat with the highest Ev, which is
    # the one a glare complaint would come from.
    probe_index: int | None = Field(None, ge=0)
    # Head yaw override in degrees, 0 facing the glazing. None keeps the layout's facing.
    view_deg: float | None = Field(None, ge=-360, le=360, allow_inf_nan=False)
    # Restrict the default pick to one facade zone, so a section follows the zone the
    # rest of the dashboard has selected. Ignored when probe_index names a probe, and
    # falls back to the whole band when the zone holds no seat.
    zone: str | None = Field(None, max_length=8)


class PatchPayload(BaseModel):
    centre: tuple[float, float, float]
    normal: tuple[float, float, float]
    area: float
    reflectance: float
    # First-hit beam before any bounce, and total leaving the patch after them.
    direct_lux: float
    radiosity_lux: float
    # What this patch alone delivers to the selected occupant's eye plane.
    contribution_lux: float


class SectionProbePayload(BaseModel):
    index: int
    kind: Literal["seat", "desk"]
    x: float
    z: float
    height_m: float
    view_deg: float | None
    zone: str
    task_lux: float
    eye_lux: float


class SelectedPayload(BaseModel):
    index: int
    view_deg: float | None
    task_lux: float
    eye_lux: float
    # Unbounced sun straight into the eye, and the interreflected remainder.
    eye_direct_lux: float
    eye_interreflected_lux: float
    over_cap: bool


class YawSample(BaseModel):
    view_deg: float
    eye_lux: float


class SectionResponse(BaseModel):
    room: dict[str, float]
    sun: tuple[float, float, float]
    normal_beam_w_m2: float
    patch_divisions: int
    bounces: int
    ev_comfort_lux: float
    ev_cap_lux: float
    patches: list[PatchPayload]
    probes: list[SectionProbePayload]
    selected: SelectedPayload | None
    yaw_sweep: list[YawSample]
    provenance: str


PROVENANCE = (
    "Diffuse-patch radiosity, 4x4 patches per surface and four bounces, in an empty "
    "illustrative box. Modelled, not measured; not Radiance, and not a validated "
    "glare index."
)


@router.post("/section", response_model=SectionResponse)
def section(request: SectionRequest) -> SectionResponse:
    room = RoomGeometry()
    probes = probes_for(request.orientation, request.band)
    zones = [zone_for(p, request.orientation, request.band, room) for p in probes]
    wall_azimuth = ORIENTATIONS[request.orientation]
    solved = dict(
        beam_flux=request.beam_flux,
        diffuse_flux=request.diffuse_flux,
        solar_elevation=request.solar_elevation,
        solar_azimuth=request.solar_azimuth,
        wall_azimuth=wall_azimuth,
    )
    field = solve_radiosity(room, **solved)
    lux = illuminance_at_probes(room, probes, **solved)
    efficacy = DEFAULTS.luminous_efficacy_lm_per_w

    seats = [i for i, p in enumerate(probes) if p.kind == "seat"]
    if request.zone:
        scoped = [i for i in seats if zones[i] == request.zone]
        # An empty zone must not blank the section; the band's brightest seat still
        # answers "what is this wall doing to whoever sits here".
        seats = scoped or seats
    index = request.probe_index
    if index is not None and index >= len(probes):
        index = None
    if index is None and seats:
        index = max(seats, key=lambda i: lux[i][1])

    view_rad = None if request.view_deg is None else radians(request.view_deg)
    selected: SelectedPayload | None = None
    yaw: list[YawSample] = []
    contribution = [0.0] * len(field.centres)
    if index is not None:
        probe = probes[index]
        detail = probe_breakdown(room, probe, field, view_rad=view_rad)
        contribution = [float(v) for v in detail.eye_patch_lux]
        effective = probe.view_rad if view_rad is None else view_rad
        selected = SelectedPayload(
            index=index,
            view_deg=None if effective is None else round(degrees(effective) % 360, 1),
            task_lux=round(detail.task_lux, 1),
            eye_lux=round(detail.eye_lux, 1),
            eye_direct_lux=round(detail.eye_direct_lux, 1),
            eye_interreflected_lux=round(detail.eye_lux - detail.eye_direct_lux, 1),
            over_cap=detail.eye_lux > DEFAULTS.ev_cap_lux,
        )
        # Seats only: a desk probe has no eye normal to sweep.
        if probe.kind == "seat":
            yaw = [
                YawSample(
                    view_deg=round(360 * step / YAW_STEPS, 1),
                    eye_lux=round(
                        probe_breakdown(
                            room, probe, field, view_rad=2 * pi * step / YAW_STEPS
                        ).eye_lux,
                        1,
                    ),
                )
                for step in range(YAW_STEPS)
            ]

    return SectionResponse(
        room={
            "width": room.width,
            "depth": room.depth,
            "height": room.height,
            "wall_reflectance": room.wall_reflectance,
            "floor_reflectance": room.floor_reflectance,
            "ceiling_reflectance": room.ceiling_reflectance,
            "desk_height": DEFAULTS.daylight_desk_height_m,
        },
        sun=tuple(round(float(v), 4) for v in field.sun),  # type: ignore[arg-type]
        normal_beam_w_m2=round(field.normal_beam, 2),
        patch_divisions=DEFAULTS.daylight_patch_divisions,
        bounces=DEFAULTS.daylight_oracle_bounces,
        ev_comfort_lux=DEFAULTS.ev_comfort_lux,
        ev_cap_lux=DEFAULTS.ev_cap_lux,
        patches=[
            PatchPayload(
                centre=tuple(round(float(v), 3) for v in field.centres[i]),  # type: ignore[arg-type]
                normal=tuple(float(v) for v in field.normals[i]),  # type: ignore[arg-type]
                area=round(float(field.areas[i]), 4),
                reflectance=round(float(field.reflectance[i]), 3),
                direct_lux=round(float(field.direct[i]) * efficacy, 1),
                radiosity_lux=round(float(field.radiosity[i]) * efficacy, 1),
                contribution_lux=round(contribution[i], 2),
            )
            for i in range(len(field.centres))
        ],
        probes=[
            SectionProbePayload(
                index=i,
                kind=p.kind,
                x=round(p.x, 3),
                z=round(p.z, 3),
                height_m=round(p.height_m, 3),
                view_deg=None if p.view_rad is None else round(degrees(p.view_rad) % 360, 1),
                zone=zones[i],
                task_lux=round(lux[i][0], 1),
                eye_lux=round(lux[i][1], 1),
            )
            for i, p in enumerate(probes)
        ],
        selected=selected,
        yaw_sweep=yaw,
        provenance=PROVENANCE,
    )
