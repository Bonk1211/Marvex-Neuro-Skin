"""Mirror bandPlan.ts, including nested desk-island transforms.

Plan units are treated as metres, an illustrative assumption. The oracle frame is
x across the facade, z inward from glazing at z=0, y up. view_rad=0 faces glazing.
The drawn chair's back is +z, so its facing is -z, not +z.
"""

from dataclasses import dataclass
from math import cos, isfinite, pi, sin
from typing import Literal

from app.config import DEFAULTS

ORIENTATIONS = ("north", "east", "south", "west")


@dataclass(frozen=True)
class RoomGeometry:
    width: float = DEFAULTS.daylight_room_width_m
    depth: float = DEFAULTS.daylight_room_depth_m
    height: float = DEFAULTS.floor_height_m
    wall_reflectance: float = DEFAULTS.daylight_wall_reflectance
    floor_reflectance: float = DEFAULTS.daylight_floor_reflectance
    ceiling_reflectance: float = DEFAULTS.daylight_ceiling_reflectance

    def __post_init__(self) -> None:
        if not all(isfinite(v) and v > 0 for v in (self.width, self.depth, self.height)):
            raise ValueError("Room dimensions must be finite and positive")
        if not all(
            isfinite(v) and 0 <= v < 1
            for v in (self.wall_reflectance, self.floor_reflectance, self.ceiling_reflectance)
        ):
            raise ValueError("Reflectances must be finite in [0, 1)")


@dataclass(frozen=True)
class Probe:
    kind: Literal["seat", "desk"]
    x: float
    z: float
    height_m: float
    view_rad: float | None

    def __post_init__(self) -> None:
        if self.kind not in ("seat", "desk") or not all(
            isfinite(v) for v in (self.x, self.z, self.height_m)
        ):
            raise ValueError("Invalid probe kind or coordinates")
        if self.kind == "seat" and (self.view_rad is None or not isfinite(self.view_rad)):
            raise ValueError("Seats require a finite facing angle")
        if self.kind == "desk" and self.view_rad is not None:
            raise ValueError("Desk probes have no eye-plane normal")


def plan_probes(program: str) -> tuple[tuple[str, float, float, float], ...]:
    """(kind, scene x, scene z, world rotation) in chair()/desk() creation order."""
    index = ORIENTATIONS.index(program)
    result = []

    def chair(x: float, z: float, rotation: float = 0) -> None:
        result.append(("seat", x, z, rotation))

    def desk(x: float, z: float, rotation: float = 0) -> None:
        result.append(("desk", x, z, rotation))
        chair(x + sin(rotation) * 0.47, z + cos(rotation) * 0.47, rotation)

    if index == 0:
        for x in (-2.03, -1.33, -0.63, 0.07):
            chair(x, -2.83, pi)
            chair(x, -1.58)
        chair(1.5, -2.2, -pi / 2)
        chair(2.78, -2.2, pi / 2)
    elif index == 1:
        for x in (-2.3, -1.15, 0, 1.15, 2.3):
            for z in (-2.15, -1.47):
                chair(x, z)
    elif index == 2:
        for x in (-1.57, 1.57):
            chair(x - 0.67, -2.2, -pi / 2)
            chair(x + 0.67, -2.2, pi / 2)
            chair(x, -2.86, pi)
            chair(x, -1.53)
    else:
        for x in (-2.08, 2.08):
            sign = -1 if x < 0 else 1
            chair(x + sign * 0.62, -2.25, sign * pi / 2)
        for x in (-1.35, -0.45, 0.45, 1.35):
            chair(x, -2.12)
    if index in (0, 3):
        splits = (-1.06, 0.02, 1.1) if index == 0 else (-1.06, -0.34, 0.38, 1.1)
        for low, high in zip(splits, splits[1:]):
            chair(-2.17, (low + high) / 2, pi / 2)
    elif index == 2:
        desk(-2.21, -0.41, pi / 2)
        chair(-1.93, 0.67, pi)
    if index == 0:
        for centre in (-1.56, 1.56):
            rotation = -0.15 if centre < 0 else 0.15
            for dx in (-0.49, 0.49):
                for z, theta in ((-0.24, pi), (0.24, 0)):
                    desk(
                        centre + cos(rotation) * dx + sin(rotation) * z,
                        2.16 - sin(rotation) * dx + cos(rotation) * z,
                        theta + rotation,
                    )
    elif index == 1:
        for x in (-2.35, -0.8, 0.8, 2.35):
            desk(x, 1.78, pi)
            desk(x, 2.53)
    elif index == 2:
        for x in (-2.14, 0, 2.14):
            chair(x - 0.68, 2.17, -pi / 2)
            chair(x + 0.68, 2.17, pi / 2)
            chair(x, 2.87)
    else:
        for i, x in enumerate((-2.37, -0.79, 0.79, 2.37)):
            desk(x, 2.33 if i % 2 else 1.78, 0 if i % 2 else pi)
    return tuple(result)


def probes_for(orientation: str, band: int) -> tuple[Probe, ...]:
    if orientation not in ORIENTATIONS or band not in range(DEFAULTS.facade_zone_rows):
        raise ValueError("Unknown orientation or floor group")
    side = ORIENTATIONS.index(orientation)
    room = RoomGeometry()
    # Exact cardinal bases avoid floating point noise in rotation-parity checks.
    tangent_x, tangent_z = ((1, 0), (0, 1), (-1, 0), (0, -1))[side]
    outward_x, outward_z = ((0, -1), (1, 0), (0, 1), (-1, 0))[side]
    return tuple(
        Probe(
            kind=kind,
            x=room.width / 2 + x * tangent_x + z * tangent_z,
            z=room.depth / 2 - x * outward_x - z * outward_z,
            height_m=(
                DEFAULTS.daylight_eye_height_m
                if kind == "seat"
                else DEFAULTS.daylight_desk_height_m
            ),
            view_rad=(-(rotation + side * pi / 2) % (2 * pi) if kind == "seat" else None),
        )
        for kind, x, z, rotation in plan_probes(ORIENTATIONS[(side + band) % 4])
    )


def zone_for(probe: Probe, orientation: str, band: int, room: RoomGeometry) -> str:
    column = min(
        DEFAULTS.facade_zone_columns - 1,
        # Local +x points left as seen outside; rendered bays count left to right.
        int((room.width - probe.x) / room.width * DEFAULTS.facade_zone_columns),
    )
    return f"{orientation[0].upper()}{band * DEFAULTS.facade_zone_columns + column + 1}"
