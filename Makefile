# ytdown developer commands (macOS/Linux, or Windows with make + Git Bash).
PY := engine/.venv/bin/python
ifeq ($(OS),Windows_NT)
PY := engine/.venv/Scripts/python
endif

.PHONY: setup dev engine web test build docker

setup:            ## create the venv and install everything
	python3 -m venv engine/.venv || python -m venv engine/.venv
	$(PY) -m pip install -q -r engine/requirements.txt
	cd web && npm ci

dev:              ## engine with reload on :8787 + Vite dev server on :5173 (proxies /api)
	@echo "Engine http://127.0.0.1:8787  |  App http://127.0.0.1:5173"
	( cd engine && ../$(PY) -m ytdown_engine --reload ) & ( cd web && npm run dev ); wait

engine:
	cd engine && ../$(PY) -m ytdown_engine

web:
	cd web && npm run dev

test:             ## unit tests + typecheck
	cd engine && ../$(PY) -m pytest -q tests
	cd web && npx tsc -p tsconfig.json --noEmit

build:
	cd web && npm run build

docker:
	docker compose up --build -d
