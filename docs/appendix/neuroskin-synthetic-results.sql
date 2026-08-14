-- NeuroSkin synthetic appendix dataset
-- Generated from backend.app.domain.scenarios.run_scenario on 2026-08-14.
-- All values are synthetic. Cooling load is a relative index, not kWh.

DROP TABLE IF EXISTS reference_results;
CREATE TABLE reference_results (
  scenario TEXT PRIMARY KEY,
  ours_lux REAL,
  naive_lux REAL,
  ours_load REAL,
  naive_load REAL,
  ours_moves INTEGER,
  naive_moves INTEGER,
  rejected INTEGER,
  safe INTEGER
);
INSERT INTO reference_results VALUES
  ('Overview', 100.0, 16.7, 0.550, 0.456, 0, 2, 0, 0),
  ('Sensor Trust', 100.0, 51.9, 0.544, 0.489, 0, 6, 10, 0),
  ('Optimisation', 100.0, 16.7, 0.550, 0.456, 0, 2, 0, 0),
  ('Safety', 46.7, 16.7, 0.460, 0.456, 1, 2, 0, 4);

DROP TABLE IF EXISTS seed_sensitivity;
CREATE TABLE seed_sensitivity (
  seed INTEGER PRIMARY KEY,
  ours_lux REAL,
  naive_lux REAL,
  ours_load REAL,
  naive_load REAL,
  load_ratio REAL,
  ours_moves INTEGER,
  naive_moves INTEGER
);
INSERT INTO seed_sensitivity VALUES
  (0, 94.7, 57.9, 0.573, 0.522, 1.098, 0, 4),
  (1, 100.0, 55.2, 0.557, 0.506, 1.101, 0, 4),
  (2, 46.7, 46.7, 0.565, 0.552, 1.024, 0, 2),
  (3, 57.7, 15.4, 0.505, 0.468, 1.079, 1, 2),
  (4, 100.0, 40.0, 0.549, 0.524, 1.048, 0, 2),
  (5, 100.0, 78.1, 0.564, 0.540, 1.044, 0, 2),
  (6, 100.0, 61.1, 0.557, 0.494, 1.128, 0, 2),
  (7, 100.0, 66.7, 0.555, 0.537, 1.034, 0, 2),
  (8, 100.0, 100.0, 0.550, 0.550, 1.000, 0, 0),
  (9, 68.8, 68.8, 0.574, 0.570, 1.007, 0, 2);

DROP TABLE IF EXISTS fault_events;
CREATE TABLE fault_events (
  time_myt TEXT PRIMARY KEY,
  event TEXT,
  measured REAL,
  expected REAL,
  trust TEXT,
  ours_angle REAL,
  naive_angle REAL,
  ours_lux REAL,
  naive_lux REAL,
  ours_load REAL,
  naive_load REAL
);
INSERT INTO fault_events VALUES
  ('11:30', 'Injected dead pyranometer', 0.0, 816.12, 'Rejected', 55, 0, 325.9, 824.4, 0.4509, 0.7707),
  ('15:00', 'Genuine heavy cloud', 8.0, 281.63, 'Trusted', 55, 0, 20.0, 20.0, 0.3778, 0.5131);

DROP TABLE IF EXISTS safety_events;
CREATE TABLE safety_events (
  time_myt TEXT PRIMARY KEY,
  event TEXT,
  mode TEXT,
  target_angle REAL,
  final_angle REAL,
  measured REAL,
  relative_load REAL,
  result TEXT
);
INSERT INTO safety_events VALUES
  ('14:00', 'Power loss', 'SAFE', 60, 60, 721.02, 0.3939, 'Optimiser bypassed; fail shaded'),
  ('15:00', 'Marginal movement', 'HOLD', 40, 60, 682.98, 0.3887, 'Movement declined below threshold');

DROP TABLE IF EXISTS geometry_comparison;
CREATE TABLE geometry_comparison (
  geometry TEXT PRIMARY KEY,
  tilt REAL,
  ours_lux REAL,
  ours_load REAL,
  ours_moves INTEGER,
  naive_lux REAL,
  naive_load REAL,
  naive_moves INTEGER
);
INSERT INTO geometry_comparison VALUES
  ('Diamond as built: 25° outward', 115, 100.0, 0.550, 0, 16.7, 0.456, 2),
  ('Upright counterfactual', 90, 70.8, 0.507, 1, 12.5, 0.469, 2);

-- Appendix audit queries.
SELECT * FROM reference_results ORDER BY scenario;
SELECT * FROM seed_sensitivity ORDER BY seed;
SELECT * FROM fault_events ORDER BY time_myt;
SELECT * FROM safety_events ORDER BY time_myt;
SELECT * FROM geometry_comparison ORDER BY tilt DESC;
