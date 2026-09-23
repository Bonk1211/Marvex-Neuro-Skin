.PHONY: dev backend frontend install test clean

# Run backend (:8000) and frontend (:3000) together; Ctrl-C stops both.
# ponytail: plain background jobs + trap, no process manager
dev:
	@trap 'kill 0' EXIT INT TERM; \
	$(MAKE) backend & \
	$(MAKE) frontend & \
	wait

# HOST=0.0.0.0 lets the ESP32 reach the API over WiFi; loopback by default.
HOST ?= 127.0.0.1

backend:
	cd backend && uv run uvicorn app.main:app --reload --host $(HOST) --port 8000 $(if $(wildcard backend/.env),--env-file .env,)

frontend:
	cd frontend && npm run dev

install:
	cd backend && uv sync --extra dev
	cd frontend && npm install

test:
	cd backend && uv run pytest
	cd frontend && npm test

clean:
	rm -rf backend/.pytest_cache backend/.ruff_cache frontend/.next

.PHONY: daylight-data daylight-train daylight-ablate assurance-matrix
# CLI overrides: make daylight-data ARGS=--smoke (make itself has no --smoke option).
daylight-data:
	cd backend && uv run python -m scripts.generate_daylight_dataset $(ARGS)

daylight-train:
	cd backend && uv run jupyter nbconvert --to notebook --execute --inplace --ExecutePreprocessor.timeout=-1 notebooks/daylight_surrogate_training.ipynb

daylight-ablate:
	cd backend && uv run python -m scripts.ablation_glare_blindness $(ARGS)

# Seeded sensor fault matrix; ARGS=--smoke (temp output) or ARGS="--split calibration".
assurance-matrix:
	cd backend && uv run python -m scripts.assurance_matrix $(ARGS)
