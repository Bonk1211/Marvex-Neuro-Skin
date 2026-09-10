.PHONY: dev backend frontend install test clean

# Run backend (:8000) and frontend (:3000) together; Ctrl-C stops both.
# ponytail: plain background jobs + trap, no process manager
dev:
	@trap 'kill 0' EXIT INT TERM; \
	$(MAKE) backend & \
	$(MAKE) frontend & \
	wait

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000 $(if $(wildcard backend/.env),--env-file .env,)

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
