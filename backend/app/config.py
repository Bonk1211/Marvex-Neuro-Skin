from dataclasses import dataclass


@dataclass(frozen=True)
class SimulationDefaults:
    latitude: float = 2.9220
    longitude: float = 101.6885
    timezone: str = "Asia/Kuala_Lumpur"
    tick_minutes: int = 10
    # Facade performance is only judged over the occupied day: 07:00 to 19:00
    # local time. Nothing the louvres do at 02:00 is worth simulating.
    day_start_hour: int = 7
    day_end_hour: int = 19
    seed: int = 42
    angle_min: float = 0.0
    angle_max: float = 60.0
    angle_step: float = 5.0  # Search brackets, not a mechanical angle increment.
    shaded_default: float = 60.0
    retract_flat: float = 0.0
    critical_wind: float = 15.0
    movement_threshold: float = 0.0002
    # Commissioning assumptions, not measured hardware/glazing specifications.
    # A tick is 10 minutes, so 6 deg/min lets the louvres cover the full 0-60 range within one
    # sample and still rate-limits anything faster. The old 1.2 moved at most 12 degrees a tick, so
    # the facade lagged its target by up to ~45 degrees and left glare ticks it could have avoided.
    actuator_speed_deg_per_min: float = 6.0
    glazing_shgc: float = 0.4
    # Direct solar exposure screen, not an occupant-view glare index (DGP).
    glare_limit_w_m2: float = 25.0
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
    # Occupant-plane assumptions, not measured comfort. Manesh et al. (2025),
    # doi:10.1016/j.autcon.2025.106474 supplies the screening thresholds/reflectances.
    ev_comfort_lux: float = 500.0
    ev_cap_lux: float = 1000.0
    et_band_low_lux: float = 300.0
    et_band_high_lux: float = 500.0
    daylight_angle_step: int = 5
    daylight_model_enabled: bool = False
    daylight_model_dir: str = "data/daylight/models"
    daylight_wall_reflectance: float = 0.5
    daylight_floor_reflectance: float = 0.2
    daylight_ceiling_reflectance: float = 0.8
    daylight_room_width_m: float = 6.4
    daylight_room_depth_m: float = 6.4
    daylight_eye_height_m: float = 1.2
    daylight_desk_height_m: float = 0.75
    daylight_oracle_bounces: int = 4
    daylight_patch_divisions: int = 4
    # Broad daylight approximation: Littlefair (1988), doi:10.1177/096032718802000405
    # measured mean global efficacy 107-109 lm/W; no spectral/glazing calibration.
    luminous_efficacy_lm_per_w: float = 110.0
    daylight_train_orientations: tuple[str, ...] = ("west", "south")
    daylight_transfer_orientations: tuple[str, ...] = ("east", "north")
    # Declination coverage: solstices/equinoxes, both overhead passages (~Mar 28/Sep 15).
    daylight_dataset_days: tuple[str, ...] = (
        "2026-01-21",
        "2026-02-21",
        "2026-03-20",
        "2026-03-28",
        "2026-04-21",
        "2026-06-21",
        "2026-07-21",
        "2026-08-21",
        "2026-09-15",
        "2026-09-23",
        "2026-10-21",
        "2026-12-21",
    )
    daylight_transfer_days: tuple[str, ...] = ("2026-03-20", "2026-06-21", "2026-12-21")
    daylight_dataset_tick_stride: int = 6
    daylight_dataset_bands: tuple[int, ...] = (1, 3)
    daylight_occupied_min: float = 0.2
    daylight_negligible_exceedance_percent: float = 1.0
    daylight_transfer_mae_ratio: float = 1.5
    daylight_transfer_mae_margin_lux: float = 50.0
    # Local sensor assurance. Preregistered starting values: retune from the
    # calibration seeds of scripts/assurance_matrix.py only, never evaluation seeds.
    assurance_min_model_irradiance: float = 100.0
    assurance_min_peers: int = 3
    # |k_zone / median(k_peers) - 1|, k = reading / modelled aperture incident.
    assurance_peer_deviation: float = 0.35
    # |q_now / median(q_history) - 1|, q = lux / modelled open lux through the blades.
    assurance_lux_deviation: float = 0.35
    # An adjacent zone within this ratio distance shares the suspect's drop.
    assurance_shadow_similarity: float = 0.25
    assurance_persist_ticks: int = 3
    assurance_window_ticks: int = 6
    # Stuck: the zone's last persist_ticks + 1 readings span less than this (W/m2)...
    # Calibration seeds: live sensors flicker ~6 W/m2 over three readings even under a
    # flat afternoon sky, so 20 (the preregistered value) waited 13 ticks for the sky.
    assurance_stuck_change: float = 0.05
    # ...while its peers' median reading-to-reading change sums to more than this.
    assurance_stuck_peer_change: float = 3.0
    # Verified fault recovery. Only these hypotheses may be isolated without an operator.
    recovery_auto_hypotheses: tuple[str, ...] = ("dead", "stuck")
    recovery_auto_score: float = 0.8
    # Verification counts only informative ticks: sunlit, no safety override, and the
    # corrected and uncorrected branches actually chose different louvre angles. A
    # tick where both agree says nothing about whether isolating the sensor helped.
    recovery_verify_ticks: int = 6
    recovery_informative_angle: float = 0.5
    recovery_min_valid_ticks: int = 4
    # Isolated for this many ticks with usable evidence, yet fewer than
    # min_valid_ticks informative ones: escalate as unverifiable.
    recovery_unverifiable_ticks: int = 18
    # Relative-objective units summed over the verification window; never energy.
    recovery_cost_margin: float = 0.01
    # A fault still seen after six hours of isolation needs maintenance, not substitution.
    recovery_max_episode_ticks: int = 36
    recovery_cooldown_ticks: int = 6


DEFAULTS = SimulationDefaults()

# Ticks in one simulated day, derived from the occupied window above (72 at 07:00-19:00,
# 10-minute ticks). Single source of truth for every tick index bound.
TICK_COUNT = (DEFAULTS.day_end_hour - DEFAULTS.day_start_hour) * 60 // DEFAULTS.tick_minutes
MAX_TICK = TICK_COUNT - 1
