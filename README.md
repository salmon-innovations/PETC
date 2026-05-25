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
# From the repository root
python3 -m venv desktop/.venv
desktop/.venv/bin/python -m pip install -e "desktop[dev]"
```

If your terminal is already inside `desktop/`, use:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
```

On Windows, use:

```powershell
# From the repository root
python -m venv desktop\.venv
desktop\.venv\Scripts\python -m pip install -e "desktop[dev]"
```

If your PowerShell terminal is already inside `desktop\`, use:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
```

## Mock LTMS Workflow

The mock workflow is the most important development path right now. It lets you test the full desktop capture and LTMS upload wizard without real hardware or registry credentials.

Start the mock sidecar:

```bash
# From the repository root
PETC_DATA_DIR=/tmp/petc-mock-data \
PETC_PORT=8765 \
PETC_GOV_MOCK=true \
desktop/.venv/bin/python -m petc.service
```

If your terminal is already inside `desktop/`, use:

```bash
PETC_DATA_DIR=/tmp/petc-mock-data \
PETC_PORT=8765 \
PETC_GOV_MOCK=true \
.venv/bin/python -m petc.service
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

## Serial Analyzer Hardware

The sidecar supports two serial adapter types selected by the `PETC_ANALYZER` environment variable.

| `PETC_ANALYZER` | Protocol | Direction | Adapter class |
|---|---|---|---|
| `mock` (default) | — | — | `MockAnalyzer` |
| `serial_gas` | ASCII delimited, CRLF terminated | push (passive) | `AsciiGasAnalyzer` |
| `serial_diesel` | Binary framed, CRC-16/MODBUS | poll (trigger byte `0x05`) | `BinaryDieselAnalyzer` |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PETC_ANALYZER` | `mock` | Adapter type: `mock`, `serial_gas`, or `serial_diesel` |
| `PETC_ANALYZER_PORT` | `COM1` | COM port name, e.g. `COM3` or `/dev/ttyUSB0` |
| `PETC_ANALYZER_BAUD` | `9600` | Baud rate |

### ASCII gas frame format

One line per measurement, CR+LF terminated:

```text
CO=0.12,HC=85,CO2=14.2,O2=0.4,LAM=1.001,RPM=2500,TEMP=85.3,SN=A12345,PF=1\r\n
```

Required fields: `CO`, `HC`, `CO2`, `O2`, `LAM`. Optional: `RPM`, `TEMP`, `SN`, `PF` (1=pass, 0=fail).

### Binary diesel frame format

Little-endian, 25 bytes total:

```text
Offset  Len  Type      Field
0       1    uint8     SOH (0x01)
1       1    uint8     Payload length (21)
2       4    float32   Opacity %
6       4    float32   k-value (m⁻¹)
10      2    uint16    RPM (0 = not available)
12      4    float32   Boost pressure kPa (0.0 = not available)
16      1    uint8     Pass/fail (0x01=pass, 0x00=fail, 0xFF=unknown)
17      6    char[6]   Serial number (ASCII, null-padded)
23      2    uint16    CRC-16/MODBUS of bytes 0–22
```

### Start the sidecar with a real analyzer

Gas:

```bash
PETC_ANALYZER=serial_gas \
PETC_ANALYZER_PORT=COM3 \
PETC_ANALYZER_BAUD=9600 \
PETC_DATA_DIR=/tmp/petc-data \
PETC_PORT=8765 \
PETC_GOV_MOCK=true \
desktop/.venv/bin/python -m petc.service
```

Diesel:

```bash
PETC_ANALYZER=serial_diesel \
PETC_ANALYZER_PORT=/dev/ttyUSB0 \
PETC_ANALYZER_BAUD=19200 \
PETC_DATA_DIR=/tmp/petc-data \
PETC_PORT=8765 \
PETC_GOV_MOCK=true \
desktop/.venv/bin/python -m petc.service
```

### Discover available ports

The sidecar exposes available COM ports for the settings screen:

```bash
curl -s http://127.0.0.1:8765/api/v1/ports
```

### Testing without hardware

No physical analyzer is needed. The test suite uses raw byte fixtures fed directly into `parse_frame()`:

```text
desktop/tests/fixtures/gas_pass.txt       ASCII gas frame, all fields present
desktop/tests/fixtures/gas_no_optional.txt  ASCII gas frame, required fields only
desktop/tests/fixtures/diesel_pass.bin    Binary diesel frame with valid CRC
```

Use virtual COM port pairs for end-to-end testing on Linux (`socat`) or Windows (`com0com`):

```bash
# Linux — create a linked pair: /dev/ttyV0 <-> /dev/ttyV1
socat PTY,link=/dev/ttyV0,raw,echo=0 PTY,link=/dev/ttyV1,raw,echo=0 &
PETC_ANALYZER=serial_gas PETC_ANALYZER_PORT=/dev/ttyV0 \
  desktop/.venv/bin/python -m petc.service &
# Feed a test frame to the other end
printf 'CO=0.12,HC=85,CO2=14.2,O2=0.4,LAM=1.001\r\n' > /dev/ttyV1
```

### Adding a new analyzer brand

1. Create `desktop/sidecar/petc/analyzer/<brand>.py`.
2. Subclass `AsciiGasAnalyzer` or `BinaryDieselAnalyzer` (or `SerialAnalyzer` for a new protocol).
3. Override `parse_frame()` to map the brand's field names to `GasReading` / `DieselReading`.
4. Override `poll_command()` if the device needs a trigger byte.
5. Add a branch in `service._build_analyzer()` for the new `PETC_ANALYZER` value.
6. Add frame fixture files and corresponding `parse_frame()` unit tests.

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

### Fix Flyway Checksum Errors in Local Dev

If the backend fails with a message like:

```text
Validate failed: Migrations have failed validation
Migration checksum mismatch for migration version 1
```

it means the local `petc` Postgres database already applied an older version of a migration file. In development, the simplest fix is to reset the local schema and let Flyway replay all migrations.

This deletes local cloud data in the `petc` database. Run it as the Postgres admin user, because the app user may not own the `public` schema:

```bash
psql postgresql://postgres:postgres@localhost:5432/petc \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION petc; GRANT ALL ON SCHEMA public TO petc; GRANT ALL ON SCHEMA public TO public;"
```

If your local Postgres container uses a different admin password or container name, run the same SQL through that admin connection.

Then restart:

```bash
docker compose up --build
```

If you need to preserve data, do not drop the schema. Use Flyway repair only after confirming the migration file change is intentional:

```bash
docker run --rm flyway/flyway:latest \
  -url=jdbc:postgresql://host.docker.internal:5432/petc \
  -user=petc \
  -password=petc \
  repair
```

For production, never edit an applied migration file. Add a new `V4__...sql` migration instead.

## Cloud Mirror Testing

In local development, the cloud backend accepts the desktop's default mock key:

```text
X-Center-Key: dev-insecure-key
```

When that key is used, the backend automatically creates or reuses a `dev-center` tenant. This is controlled by:

```text
DEV_CENTER_KEY_ENABLED=true
DEV_CENTER_KEY=dev-insecure-key
DEV_CENTER_SLUG=dev-center
DEV_CENTER_NAME=Mock PETC Center
```

For a real center key issued from the operator portal, copy the yellow one-time API key into the center desktop app's sidecar environment. The key is not entered back into the portal.

```bash
PETC_CLOUD_URL=http://localhost:8080 \
PETC_CENTER_ID=makati-petc \
PETC_CLOUD_KEY='petc_replace_with_the_issued_key' \
PETC_DATA_DIR=/tmp/petc-mock-data \
PETC_PORT=8765 \
PETC_GOV_MOCK=true \
desktop/.venv/bin/python -m petc.service
```

To test mirror sync end to end:

1. Start the cloud backend on `http://localhost:8080`.
2. Start the desktop sidecar with:

```bash
PETC_CLOUD_URL=http://localhost:8080 \
PETC_CENTER_ID=dev-center \
PETC_CLOUD_KEY=dev-insecure-key \
PETC_DATA_DIR=/tmp/petc-mock-data \
PETC_PORT=8765 \
PETC_GOV_MOCK=true \
desktop/.venv/bin/python -m petc.service
```

3. Run a mock desktop test and LTMS upload.
4. Open the cloud operator portal analytics page.

The backend stores mirror events in:

- `mirror_events`
- `mirror_emission_tests`
- `mirror_test_photos`
- `mirror_ltms_submissions`

## Current Development Notes

- The analyzer, camera, printer, and gov registry integrations are mocked by default.
- The LTMS upload wizard currently targets the mock registry contract and stores full submission payloads in SQLite.
- Existing dev SQLite databases are upgraded with additive startup migrations while the schema is still moving quickly.
- The desktop app remains usable offline; cloud mirroring is non-critical.
