from dataclasses import dataclass


@dataclass(frozen=True)
class SimulationDefaults:
    latitude: float = 2.9220
    longitude: float = 101.6885
    timezone: str = "Asia/Kuala_Lumpur"
    tick_minutes: int = 10
    seed: int = 42
    angle_min: float = 0.0
    angle_max: float = 60.0
    angle_step: float = 5.0
    shaded_default: float = 60.0
    retract_flat: float = 0.0
    critical_wind: float = 15.0
    movement_threshold: float = 0.025
    min_elevation: float = 8.0
    expected_irradiance_threshold: float = 250.0
    near_zero_irradiance: float = 25.0
    low_cloud_threshold: float = 0.35
    cloud_attenuation: float = 0.72
    daylight_evaluation_ghi: float = 200.0
    location_name: str = "ST Diamond Building, Putrajaya"
    facade_orientation: str = "west"
    # The Diamond Building's facades lean out 25 degrees, so the outward normal
    # sits 25 degrees below horizontal: 90 + 25 in pvlib's surface-tilt terms.
    # That overhang is the building's passive shading device. 90 = a plain wall.
    facade_tilt: float = 115.0
    floors: int = 7
    # Roof pitch in degrees, measured from horizontal. The building carries a
    # 71.4 kWp rooftop PV array but no source publishes the roof geometry or the
    # array tilt, so this is an assumption shaped like a real low-latitude array.
    # Set 0 for a flat roof, where every segment reads the same by definition.
    roof_pitch: float = 10.0
    floor_height_m: float = 3.6
    # The roof slab oversails the top of the facade. That lip is what shades the
    # upper facade zones first as the sun climbs, so zone readings vary by row.
    roof_overhang_m: float = 1.6
    # Facade zones per wall: the 4 x 4 grid the 3D view draws, each cell with its
    # own louvre controller. Rows are numbered from the bottom, columns from the
    # wall's left edge seen from outside.
    facade_zone_rows: int = 4
    facade_zone_columns: int = 4
    # The bay at each end of a wall wraps a corner of the building, so the room
    # behind it is glazed on two sides. This is the share of the neighbouring
    # facade's gain that its controller has to answer for as well.
    corner_daylight_coupling: float = 0.45


DEFAULTS = SimulationDefaults()
