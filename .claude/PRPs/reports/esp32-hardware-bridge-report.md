# Implementation Report: ESP32 Hardware Bridge for the Digital Twin

## Summary

Connected the physical 2×2 louvre rig to the NeuroSkin backend and dashboard:

- **ESP32 firmware** (`hardware/esp32/neuroskin_bridge`): reads 4 × BH1750 on two I²C buses, POSTs them every 500 ms over WiFi, applies the returned louvre angles through the PCA9685 (channels 4–7) with slew limiting, and falls back to a safe angle when the backend is silent for 3 s.
- **FastAPI module** (`backend/app/hardware.py`): `POST /api/v1/hardware/tick` (token-gated), `GET /status`, `POST /control` (loopback-only). Two modes: `auto` (per-panel 300–700 lux band, 5° step) and `twin` (mirrors zone angles W13/W14/W9/W10; expires after 30 s).
- **Dashboard** (`LiveHardwarePanel`): always-mounted right-rail card with live lux, commanded/target angles, online state, and an Auto / Mirror twin switch that pushes the selected tick's zone angles.
- **Docs**: `hardware/README.md` rewritten from the unbuilt Raspberry Pi/TCA9548A plan to the as-built ESP32 bridge; root README claim corrected; PRD §4.3 exception recorded.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| Confidence | 8/10 | Single pass with one real bug found by the existing dashboard suite (malformed status body crashed the dashboard) |
| Files Changed | 15 (6 create, 9 update) | 16 (6 create, 10 update — `NeuroSkinDashboard.test.tsx` also updated) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Backend live bridge module | [done] Complete | |
| 2 | Register router + log field | [done] Complete | |
| 3 | Backend tests | [done] Complete | Added auth-before-validation assertion; wrapped one E501 line |
| 4 | Backend run config (Makefile HOST, .env.example, .gitignore) | [done] Complete | |
| 5 | ESP32 firmware | [done] Complete | Compiles on esp32:esp32 3.3.11; ArduinoJson 7.4.3 installed |
| 6 | Frontend API client | [done] Complete | |
| 7 | LiveHardwarePanel component | [done] Complete | Deviated — added `asStatus` guard (see Deviations) |
| 8 | Mount in dashboard | [done] Complete | Deviated — dashboard test mocks the panel (see Deviations) |
| 9 | Frontend test | [done] Complete | Added a third test for the malformed-body regression |
| 10 | Rewrite hardware/README.md | [done] Complete | |
| 11 | Root README + PRD scope note | [done] Complete | PRD diff verified: only the blockquote added on top of the user's uncommitted edits |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | [done] Pass | `ruff check app tests` clean; `tsc --noEmit` clean; `eslint .` clean |
| Unit Tests | [done] Pass | Backend 119 passed (7 new); frontend 93 passed / 18 files (3 new) |
| Build | [done] Pass | `next build` succeeded; firmware `arduino-cli compile --fqbn esp32:esp32:esp32` succeeded (80% flash, 15% RAM) |
| Integration | [done] Pass | Live uvicorn on 0.0.0.0:8765: tick → 35/25/30/30(fault); wrong token → 401; status online with panel data; control twin → tick mirrors 10/20/40/60; `/control` via LAN IP 192.168.0.169 → 403; `/status` via LAN IP → 200; `hardware_mode_changed` logged |
| Edge Cases | [done] Pass | Missing/extra panel, lux −1, angle 61, twin w/o angles, wrong zone, auto+angles, non-loopback control, twin TTL expiry, offline after 3 s, sensor fault isolation, malformed status body |
| Physical rig | Not run | Requires the user's hardware: boot OK lines, brownout, direction, sensor-position mapping, backend-stop fallback |
| Browser visual check | Not run | Card rendering verified through RTL tests and production build only |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `backend/app/hardware.py` | CREATED | +215 |
| `backend/tests/test_hardware.py` | CREATED | +125 |
| `hardware/esp32/neuroskin_bridge/neuroskin_bridge.ino` | CREATED | +170 |
| `hardware/esp32/neuroskin_bridge/secrets.h.example` | CREATED | +7 |
| `frontend/src/components/neuroskin/LiveHardwarePanel.tsx` | CREATED | +204 |
| `frontend/src/components/neuroskin/LiveHardwarePanel.test.tsx` | CREATED | +91 |
| `backend/app/main.py` | UPDATED | +2 |
| `backend/app/logging_config.py` | UPDATED | +2 |
| `backend/.env.example` | UPDATED | +2 |
| `Makefile` | UPDATED | +4 / -1 |
| `.gitignore` | UPDATED | +1 |
| `frontend/src/lib/api-client.ts` | UPDATED | +38 |
| `frontend/src/components/neuroskin/NeuroSkinDashboard.tsx` | UPDATED | +4 |
| `frontend/src/components/neuroskin/NeuroSkinDashboard.test.tsx` | UPDATED | +3 |
| `hardware/README.md` | UPDATED | +188 / -222 |
| `README.md` | UPDATED | +1 / -1 |
| `docs/neuroskin_software_prd.md` | UPDATED | +2 (on top of pre-existing uncommitted user edits) |

Local, gitignored (not committed): `hardware/esp32/neuroskin_bridge/secrets.h` (placeholder copy for compiling).

## Deviations from Plan

1. **`asStatus` guard in `LiveHardwarePanel`**
   - **WHAT:** a status or control response is accepted only if it has `panels`; otherwise the card shows "backend unreachable".
   - **WHY:** the existing dashboard suite returned simulation payloads for every URL. That crashed the entire dashboard with `Cannot read properties of undefined (reading 'bh1')`. The same crash would happen against an older backend or a proxy error page.
2. **Dashboard test mocks the panel** (`vi.mock('./LiveHardwarePanel', ...)`) instead of filtering fetch calls by URL.
   - **WHAT:** a 3-line mock in `NeuroSkinDashboard.test.tsx`.
   - **WHY:** those tests read fetch calls by index (`mock.calls[5][1].body`) and count them exactly in 9 places. The panel's 1 s status polling interleaves extra calls, so filtering would have meant rewriting many assertions. The panel's behaviour is covered by its own tests.
3. **Extra tests**
   - **WHAT:** an auth-order assertion, where a malformed body with no token returns 401, and a malformed-body panel test.
   - **WHY:** to lock in the plan's gotcha and the bug fix above.

## Issues Encountered

- FastAPI 0.141 no longer exposes `.path` on included routers. The route check used `app.openapi()['paths']` instead.
- `make -n dev` exits 144 because the `dev` recipe's `trap 'kill 0'` still runs under `-n`. This happens only with the dry-run flag; no processes were left running.
- The ECC GateGuard hook blocked each first write or edit per file until facts were restated. Some parallel edits were applied only partially and were retried, then each was verified by grep or diff.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `backend/tests/test_hardware.py` | 7 | Token 401/503 and auth order; batch validation; independent lux step + fault; clamp; twin mirror + TTL expiry + log event; control validation + loopback 403; status lifecycle + offline |
| `frontend/src/components/neuroskin/LiveHardwarePanel.test.tsx` | 3 | Live readings + twin push body; disabled mirror + unreachable backend + `twinAngles` null; malformed body does not crash |

## Next Steps
- [ ] Add `HARDWARE_TOKEN` to `backend/.env` and fill `secrets.h` (the laptop LAN IP was 192.168.0.169 during validation; re-check it before flashing)
- [ ] Flash and run the manual rig checklist in `hardware/README.md` (boot OK lines, sensor-to-zone mapping, direction, backend-stop fallback, brownout)
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
