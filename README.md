# PETC Emission Testing Center System

Desktop-first emission testing system for Private Emission Testing Centers (PETCs) in the Philippines.

The accredited center-side app is a Windows desktop application. It captures analyzer readings, stores photos and test records locally, and uploads completed tests to LTMS/Stradcom through a sidecar service. The cloud backend is operator-only: cross-center analytics, licensing, update manifests, and mirror ingestion.

## Architecture

```text
Emission analyzer + cameras
        |
        v
Desktop App at the center
  Electron + React renderer
  Electron main process
  Python FastAPI sidecar
  SQLite local database
        |
        v
Cloud backend, optional mirror
  Spring Boot + Postgres
  Cloud React operator portal
```

The desktop SQLite database is the source of truth at the center. Cloud sync is opportunistic and should not block testing or LTMS submission.

## Project Layout

```text
desktop/
  electron/              Electron main/preload process
  renderer/              Desktop React UI
  sidecar/petc/          Python FastAPI sidecar, hardware adapters, SQLite models
  tests/                 Sidecar tests
  installer/             PyInstaller and electron-builder config

cloud/backend/           Spring Boot operator backend
cloud/frontend/          Cloud operator portal
shared/contracts/        Shared sync contract schemas
```

## Prerequisites

- Node.js 20+
- npm
- Python 3.11+
- Java 21, for the cloud backend
- Docker, for cloud support services

## Desktop Setup

Install renderer dependencies:

```bash
cd desktop/renderer
npm install
```

Install Electron desktop dependencies:

```bash
cd desktop
npm install
```

Create and install the Python sidecar virtual environment:

```bash
python3 -m venv desktop/.venv
desktop/.venv/bin/python -m pip install -e "desktop[dev]"
```

On Windows, use:

```powershell
python -m venv desktop\.venv
desktop\.venv\Scripts\python -m pip install -e "desktop[dev]"
```

## Mock LTMS Workflow

The mock workflow is the most important development path right now. It lets you test the full desktop capture and LTMS upload wizard without real hardware or registry credentials.

Start the mock sidecar:

```bash
PETC_DATA_DIR=/tmp/petc-mock-data \
PETC_PORT=8765 \
PETC_GOV_MOCK=true \
desktop/.venv/bin/python -m petc.service
```

Start the renderer:

```bash
cd desktop/renderer
npm run dev -- --host 127.0.0.1
```

Run Electron from another terminal:

```bash
cd desktop
npm run build:electron
npm run electron
```

Sign in with the seeded mock operator:

```text
Email:    operator@petc.local
Password: password
```

### Mock Plate Numbers

Use these values to test specific paths:

| Plate | Behavior |
|---|---|
| `ABC1234` | Gas vehicle, individual owner, accepted submit |
| `DSL1234` | Diesel truck, organization owner, accepted submit |
| `MC1234` | Motorcycle, individual owner |
| `NOTFOUND` | Registry lookup miss, manual-entry path |
| `FAIL1234` | Mock registry data, rejected submit |

### UI Test Flow

1. Log in.
2. Open **Run Test**.
3. Enter a mock plate, for example `ABC1234` or `DSL1234`.
4. Choose the fuel type and click **Start Test**.
5. Wait for mock analyzer readings.
6. Capture at least one photo.
7. Open **LTMS Upload**.
8. Open the pending test.
9. Complete the 6-step LTMS wizard:
   - Vehicle details
   - Owner
   - Engine flags + readings
   - Technician / certification
   - Photos
   - Review & submit
10. Capture required front and rear photos in Step 5.
11. Submit in Step 6.

Accepted mock submissions return a `CERT-...` certificate number and trigger the mock receipt printer. Rejected mock submissions display the rejection reason inline.

## Useful API Checks

Health:

```bash
curl -s http://127.0.0.1:8765/health
```

Login:

```bash
curl -s -X POST http://127.0.0.1:8765/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"operator@petc.local","password":"password"}'
```

Vehicle lookup:

```bash
curl -s -X POST http://127.0.0.1:8765/api/v1/vehicle/lookup \
  -H "Content-Type: application/json" \
  -d '{"plate":"DSL1234"}'
```

## Testing

Run all sidecar tests:

```bash
desktop/.venv/bin/pytest desktop/tests -q
```

Build the desktop renderer and Electron main process:

```bash
cd desktop
npm run build
```

Build only the renderer:

```bash
cd desktop/renderer
npm run build
```

## Cloud Development

Start cloud services:

```bash
docker compose up --build
```

Cloud ports:

- Backend: `http://localhost:8080`
- Cloud frontend: `http://localhost:3000`
- MinIO API: `http://localhost:9000`
- MinIO console: `http://localhost:9001`

The desktop app does not run in Docker.

## Current Development Notes

- The analyzer, camera, printer, and gov registry integrations are mocked by default.
- The LTMS upload wizard currently targets the mock registry contract and stores full submission payloads in SQLite.
- Existing dev SQLite databases are upgraded with additive startup migrations while the schema is still moving quickly.
- The desktop app remains usable offline; cloud mirroring is non-critical.

