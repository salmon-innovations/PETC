# Source Tree Manifest

**Companion to** `04-source-code/README.md` (Deliverable #4)

This file annotates every significant tracked path in the repository at the submission tag `accreditation-2026-06-03`, one line per path, so DOTr reviewers can navigate the tree without guessing what each file is for. The full list of tracked files can always be regenerated with `git ls-files`.

Paths excluded from this manifest: build outputs (`build/`, `dist/`, `target/`, `.gradle/`), package caches (`node_modules/`, `.venv/`), IDE state (`.idea/`, `.vscode/`), the local SQLite database, the local photos directory, and Claude session metadata. These are all in `.gitignore` and are absent from the read-only clone.

---

## Top level

| Path | Description |
|---|---|
| `README.md` | Repo overview, architecture summary, dev quickstart. |
| `LICENSE.md` | Proprietary licence governing this accreditation access grant. |
| `Makefile` | Cross-component dev shortcuts (build / test / run for desktop + cloud). |
| `docker-compose.yml` | Local Postgres + Redis + MinIO services for cloud dev. |
| `.gitignore` | Excluded paths (caches, builds, secrets, local DB, local photos). |

---

## `desktop/` — center-side desktop application

### `desktop/` shell

| Path | Description |
|---|---|
| `desktop/package.json` | Electron + renderer NPM package; entrypoints, build scripts. |
| `desktop/pyproject.toml` | Python sidecar package; dependencies, entry script `petc-sidecar`. |
| `desktop/requirements.txt` | Locked Python deps (mirrored from pyproject for installer). |

### `desktop/electron/` — Electron main process

| Path | Description |
|---|---|
| `electron/main.ts` | Main process — spawns sidecar, opens renderer window. |
| `electron/preload.ts` | Preload script — exposes `window.petcBridge` API to the renderer. |
| `electron/bridge.d.ts` | Type declarations for the renderer ↔ main IPC bridge. |
| `electron/tsconfig.json` | TypeScript config for the main process. |

### `desktop/renderer/` — React UI

| Path | Description |
|---|---|
| `renderer/package.json` | Renderer NPM package (React, Vite, Tailwind, Vitest). |
| `renderer/vite.config.ts` | Vite build config. |
| `renderer/tailwind.config.js` | Tailwind theme. |
| `renderer/src/main.tsx` | React entry point. |
| `renderer/src/App.tsx` | Top-level component + router. |
| `renderer/src/api/sidecarClient.ts` | Typed wrapper around the local sidecar HTTP API. |
| `renderer/src/components/AppShell.tsx` | Layout (nav bar, status bar). |
| `renderer/src/components/CameraStream.tsx` | Live camera preview + capture. |
| `renderer/src/pages/auth/LoginPage.tsx` | Operator login. |
| `renderer/src/pages/test/RunTestPage.tsx` | Run-test flow (start, capture readings, complete). |
| `renderer/src/pages/upload/LtmsUploadPage.tsx` | Six-step upload wizard — the primary submission UI. |
| `renderer/src/pages/history/HistoryPage.tsx` | Test history table with CEC print + `WAITING_FOR_LTMS` polling. |
| `renderer/src/pages/analytics/AnalyticsPage.tsx` | Per-center analytics. |
| `renderer/src/pages/settings/SettingsPage.tsx` | Analyser / camera / printer settings. |
| `renderer/src/store/authStore.ts` | Zustand store for the logged-in operator. |
| `renderer/src/types/index.ts` | Shared TS types mirroring the sidecar API. |
| `renderer/src/utils/emissionLimits.ts` | Verdict computation (PASS / FAIL with reasons). |

### `desktop/sidecar/` — Python FastAPI sidecar

| Path | Description |
|---|---|
| `sidecar/petc/service.py` | Startup — wires analyser, camera, printer, gov client, sync threads. |
| `sidecar/petc/cloud_client.py` | HTTP client for the cloud `/api/photos/presign`, `/api/submissions`, registry endpoints. |
| `sidecar/petc/analyzer/base.py` | `Analyzer` protocol + `FuelType` + reading dataclasses. |
| `sidecar/petc/analyzer/builder.py` | Constructs the configured analyser from settings. |
| `sidecar/petc/analyzer/serial_base.py` | Common base for USB-Serial analysers. |
| `sidecar/petc/analyzer/fofen_gas.py` | Fofen gas analyser (binary protocol). |
| `sidecar/petc/analyzer/fofen_ascii.py` | Fofen gas analyser (ASCII receipt mode). |
| `sidecar/petc/analyzer/fofen_framing.py` | Fofen binary framing primitives. |
| `sidecar/petc/analyzer/fty_opacimeter.py` | FTY-100 diesel opacimeter (ASCII receipt parser). |
| `sidecar/petc/analyzer/ascii_gas.py` | Generic ASCII gas analyser. |
| `sidecar/petc/analyzer/binary_diesel.py` | Generic binary diesel analyser. |
| `sidecar/petc/analyzer/mock.py` | Deterministic mock analyser used in tests and dev. |
| `sidecar/petc/camera/capture.py` | Camera capture interface + mock implementation. |
| `sidecar/petc/camera/opencv_camera.py` | OpenCV-backed USB webcam capture. |
| `sidecar/petc/camera/builder.py` | Selects camera implementation per config. |
| `sidecar/petc/printer/base.py` | `Printer` protocol + `ReceiptData`. |
| `sidecar/petc/printer/mock.py` | Mock printer used in tests and dev. |
| `sidecar/petc/gov/base.py` | Local gov adapter protocol (`GovRegistryClient`) + dataclasses. |
| `sidecar/petc/gov/mock_client.py` | Local mock gov client (offline / dev path). |
| `sidecar/petc/gov/stradcom_client.py` | Local Stradcom adapter stub. |
| `sidecar/petc/api/server.py` | FastAPI app — every desktop HTTP endpoint. |
| `sidecar/petc/cec/pdf.py` | CEC PDF renderer (two copies per A4). |
| `sidecar/petc/db/models.py` | SQLAlchemy ORM models for the local SQLite DB. |
| `sidecar/petc/db/session.py` | SQLAlchemy session factory + DB path resolution. |
| `sidecar/petc/db/migrations/env.py` | Alembic env. |
| `sidecar/petc/cloud_sync/pusher.py` | Background daemon that drains the cloud mirror outbox. |
| `sidecar/petc/submissions/reconciler.py` | Background daemon that resolves `WAITING_FOR_LTMS` submissions by polling the cloud. |
| `sidecar/petc/queue/outbox.py` | Generic outbox / retry helper. |
| `sidecar/petc/sync/` | Reserved for future sync helpers (empty stub package). |

### `desktop/tests/` — pytest suite

| Path | Description |
|---|---|
| `tests/test_api.py` | End-to-end tests of the sidecar HTTP API. |
| `tests/test_analyzer.py` | Analyser protocol + mock + fixture tests. |
| `tests/test_serial_analyzers.py` | Fofen / FTY parser tests using captured byte fixtures. |
| `tests/test_outbox.py` | Outbox retry + dead-letter tests. |
| `tests/test_cloud_client.py` | `cloud_client.py` tests using `httpx.MockTransport`. |
| `tests/fixtures/*.bin`, `*.txt` | Captured analyser frames used by the parser tests. |

### `desktop/installer/`

| Path | Description |
|---|---|
| `installer/electron-builder.yml` | Electron Builder config for the Windows MSI. |
| `installer/petc_sidecar.spec` | PyInstaller spec used to freeze the Python sidecar inside the desktop bundle. |

---

## `cloud/` — Spring Boot cloud service

### `cloud/` shell

| Path | Description |
|---|---|
| `cloud/build.gradle.kts` | Gradle build for the **active** cloud service. |
| `cloud/settings.gradle.kts` | Gradle settings. |
| `cloud/Dockerfile` | Container image for the cloud service. |
| `cloud/gradlew` / `gradlew.bat` / `gradle/wrapper/` | Gradle wrapper (8.10). |

### `cloud/src/main/java/com/petc/`

| Path | Description |
|---|---|
| `PetcApplication.java` | Spring Boot main class (the active entry point). |
| `auth/SecurityConfig.java` | HTTP security (filter chain, allowed paths, JWT). |
| `auth/AuthController.java` | Operator-portal login + refresh endpoints. |
| `auth/AuthService.java` | Login + refresh token issuance. |
| `auth/JwtService.java` | JWT signing / parsing. |
| `auth/JwtAuthFilter.java` | Reads the JWT, populates the security context. |
| `auth/User.java` / `UserRepository.java` | Operator persistence. |
| `auth/RefreshToken.java` / `RefreshTokenRepository.java` | Refresh-token persistence (revocable). |
| `auth/Role.java` / `AuthException.java` | Role enum + auth-specific errors. |
| `tenant/Tenant.java` | Tenant entity. |
| `tenant/TenantAwarePrincipal.java` | Carries the tenant claim through the security context. |
| `tenant/TenantContextFilter.java` | `SET LOCAL app.tenant_id` per request — drives Postgres RLS. |
| `config/S3Config.java` | `S3Client` + `S3Presigner` beans. |
| `common/GlobalExceptionHandler.java` | Uniform error responses. |
| `gov/GovRegistryClient.java` | Interface for vehicle / driver lookup + submit-emission-result. |
| `gov/MockGovRegistryClient.java` | Active when `petc.gov.mock=true` (the default). |
| `gov/StradcomGovRegistryClient.java` | Stub for the real Stradcom integration; active when `petc.gov.mock=false`. |
| `gov/VehicleInfo.java`, `DriverInfo.java`, `EmissionPayload.java`, `SubmissionResult.java` | Gov-side DTOs (records). |
| `ingest/CenterKeyValidator.java` | `X-Center-Key` validation + tenant resolution. |
| `registry/RegistryController.java` | `/api/registry/vehicle/{plate}` and `/api/registry/driver/{lic}`. |
| `photos/PhotosController.java` | `/api/photos/presign` — short-lived S3 PUT URL. |
| `submissions/SubmissionsController.java` | `POST /api/submissions`, `GET /api/submissions/{id}`. |
| `submissions/SubmissionService.java` | Enqueue, status, state transitions, idempotency. |
| `submissions/SubmissionJobRunner.java` | `@Scheduled` background worker, retries, back-off. |

### `cloud/src/main/resources/`

| Path | Description |
|---|---|
| `application.yml` | Spring Boot config (datasource, S3, gov adapter, submission retry policy). |
| `db/migration/V1__init.sql` | Initial schema (`tenants`, `users`, mirror tables, audit log). |
| `db/migration/V2__submissions.sql` | `center_licenses`, `submissions` table + RLS policy. |
| `db/migration/V3__submission_cec_fields.sql` | Adds `or_no`, `dermalog_token`, `valid_from`, `valid_until`. |

### `cloud/src/test/java/com/petc/`

| Path | Description |
|---|---|
| `gov/MockGovRegistryClientTest.java` | Plate-behaviour tests, cert uniqueness, Optional semantics. |
| `submissions/SubmissionJobRunnerTest.java` | Accepted / rejected / gov-throws / empty-batch coverage. |

### `cloud/frontend/` — operator portal (React)

| Path | Description |
|---|---|
| `frontend/package.json` | React + Vite + Tailwind operator portal. |
| `frontend/src/...` | Login, dashboard, tenant management, history browsing. |
| `frontend/nginx.conf` | Production reverse proxy config for the portal container. |
| `frontend/Dockerfile` | Container image for the portal. |

### `cloud/backend/` — **DEPRECATED older spike**

| Path | Description |
|---|---|
| `cloud/backend/**` | Older Spring Boot spike. **Not the production cloud.** See `cloud/backend/DEPRECATED.md`. |

---

## `shared/`

| Path | Description |
|---|---|
| `shared/contracts/mirror-events.schema.json` | Desktop → cloud mirror event envelope. |
| `shared/contracts/presign-request.schema.json` | `POST /api/photos/presign` request schema. |
| `shared/contracts/presign-response.schema.json` | `POST /api/photos/presign` response schema. |
| `shared/contracts/submission-request.schema.json` | `POST /api/submissions` request schema. |
| `shared/contracts/submission-status.schema.json` | `GET /api/submissions/{id}` response schema. |
| `shared/ui/` | Shared UI assets (icons, brand). |

---

## `docs/accreditation/` — this submission package

| Path | Description |
|---|---|
| `README.md` | Index of all six deliverables and their draft status. |
| `01-client-application-manual.md` | Operator-facing client application manual. |
| `02-setup-and-network-layout.md` | Centre hardware + center LAN + edge of the WAN. |
| `03-system-documentation.md` | Software architecture, security, sub-program list. |
| `04-source-code/README.md` | This deliverable — access, build, third-party components. |
| `04-source-code/manifest.md` | This file. |
| `05-cec-samples/README.md` | CEC sample documentation + field mapping. |
| `05-cec-samples/sample-cec-mock-data.pdf` | One rendered sample CEC (mock data). |
| `06-network-architecture.md` | AWS / cloud platform architecture. |

---

*End of source tree manifest.*
