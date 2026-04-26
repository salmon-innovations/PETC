.PHONY: help dev dev-infra stop \
        install-renderer install-cloud-frontend install-sidecar \
        dev-renderer dev-cloud-frontend dev-backend dev-sidecar \
        build-renderer build-cloud-frontend build-backend build-sidecar build-electron \
        test-sidecar test-backend test-renderer test-cloud-frontend

help:
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  %-28s %s\n", $$1, $$2}'

# ── Infrastructure ────────────────────────────────────────────────────────────

dev-infra: ## Start MinIO (Postgres + Redis from shared containers)
	docker compose up -d minio

dev: ## Start cloud backend + cloud frontend + MinIO
	docker compose up --build

stop: ## Tear down cloud docker services
	docker compose down

# ── Install ───────────────────────────────────────────────────────────────────

install-renderer: ## npm install for desktop renderer
	cd desktop/renderer && npm install

install-cloud-frontend: ## npm install for cloud operator portal
	cd cloud/frontend && npm install

install-sidecar: ## pip install sidecar in editable mode
	cd desktop && pip3 install -e ".[dev]"

# ── Dev servers ───────────────────────────────────────────────────────────────

dev-renderer: ## Vite dev server for desktop renderer (port 5173)
	cd desktop/renderer && npm run dev

dev-cloud-frontend: ## Vite dev server for cloud operator portal (port 5174)
	cd cloud/frontend && npm run dev

dev-backend: ## Spring Boot dev (requires JAVA_HOME pointing to JDK 21)
	cd cloud/backend && ./gradlew bootRun

dev-sidecar: ## Run Python sidecar directly without Electron
	cd desktop/sidecar && python3 -m petc.service

# ── Build ─────────────────────────────────────────────────────────────────────

build-renderer: ## Production build of desktop renderer
	cd desktop/renderer && npm run build

build-cloud-frontend: ## Production build of cloud operator portal
	cd cloud/frontend && npm run build

build-backend: ## Build Spring Boot JAR
	cd cloud/backend && ./gradlew bootJar

build-sidecar: ## PyInstaller: freeze sidecar → desktop/sidecar/dist/petc/
	cd desktop/sidecar && pyinstaller ../installer/petc_sidecar.spec \
	  --distpath dist --workpath build/pyinstaller

build-electron: build-renderer build-sidecar ## Package full Electron installer (all platforms)
	cd desktop && npx electron-builder --config installer/electron-builder.yml

# ── Tests ─────────────────────────────────────────────────────────────────────

test-sidecar: ## Run Python sidecar tests
	cd desktop/sidecar && python3 -m pytest -v

test-backend: ## Run Spring Boot tests (uses Testcontainers)
	cd cloud/backend && ./gradlew test

test-renderer: ## Run Vitest for desktop renderer
	cd desktop/renderer && npm test

test-cloud-frontend: ## Run Vitest for cloud operator portal
	cd cloud/frontend && npm test
