# System Documentation

**PETC Data Submission SaaS – Client Application**

DOTr IT Provider Accreditation – Deliverable #3

---

## 1. Document Control

| Field | Value |
|---|---|
| Document title | System Documentation – PETC Data Submission SaaS Client Application |
| Document version | 0.1 (Draft) |
| Document date | 2026-06-01 |
| Prepared by | Christian Deiniel Y. Silerio (Developer, Salmon Innovations) |
| Prepared for | Emmanuel Jayson Florendo Jr. (Client) |
| Submitting agency | Department of Transportation (DOTr) / Land Transportation Office (LTO) |
| Software product | PETC Data Submission SaaS |
| Client Application version | 0.1.0 |
| Source commit | `985bfb0451ff06fc611f1aade018dd274d2f3de8` |

### 1.1 Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 0.1 | 2026-06-01 | C. Silerio | Initial draft for DOTr accreditation submission. |

### 1.2 Scope of this Document

This document satisfies the System Documentation requirement of the DOTr IT Provider accreditation, which calls for:

1. A complete description of the executable file of the Client Program and its System Security Policy.
2. A declaration and list of the main application sub-programs and other files associated with the submitted Client Application.
3. Screenshots of folder location, file location, and size for each system file.

The "Client Application" referred to throughout this document is the **PETC desktop application** installed at each accredited Private Emission Testing Center. The cloud backend (operator-only, used for analytics, licensing, and mirror ingestion) is described where it intersects with the Client Application but is not itself the subject of this accreditation.

---

## 2. System Overview

### 2.1 Product Description

The PETC Data Submission SaaS is a multi-tenant emission-testing platform for accredited Private Emission Testing Centers in the Philippines. At each center, a Windows desktop application captures emission readings from supported analyzer hardware, photographs the vehicle and operator workstation, merges captured data with vehicle and owner data retrieved from LTMS and Stradcom, and submits a completed emission test record back to LTMS and Stradcom. A printed Certificate of Emission Compliance (CEC) is issued to the vehicle owner upon a passing result.

The desktop application is the source of truth for test records at each center. An optional cloud backend mirrors completed records for cross-center analytics and licensing.

### 2.2 Three-Tier Architecture

```
+--------------------------------------------------------------+
| Tier 1 – Hardware at the Testing Bay                         |
|   * Emission analyzer (gas or diesel, serial RS-232/USB)     |
|   * Webcam(s) for vehicle and bay photos                     |
|   * Receipt / CEC printer                                    |
+--------------------------------------------------------------+
                              |
                              v  (USB / Serial COM)
+--------------------------------------------------------------+
| Tier 2 – Client Application (Desktop, at each PETC)          |
|   * Electron main process     (Node.js / TypeScript)         |
|   * React renderer            (TypeScript / React 18)        |
|   * Python FastAPI sidecar    (Python 3.11)                  |
|   * Local SQLite database     (source of truth)              |
|   Loopback only: 127.0.0.1:8765                              |
+--------------------------------------------------------------+
                              |
                              v  (HTTPS, outbound only)
+--------------------------------------------------------------+
| Tier 3 – Government Registries and Operator Cloud            |
|   * LTMS (vehicle / driver registry, submission target)      |
|   * Stradcom (registry integration)                          |
|   * PETC Cloud (Spring Boot + Postgres, operator-only)       |
+--------------------------------------------------------------+
```

### 2.3 Source-of-Truth Statement

The local SQLite database (`petc.db`) on each PETC desktop is the authoritative record of emission tests conducted at that center. Cloud mirroring is opportunistic and **must not** block testing, CEC issuance, or LTMS submission. A center can continue to operate while disconnected from the PETC operator cloud, provided LTMS connectivity is available for submission.

---

## 3. Executable File Description – Client Program

The Client Application delivered at each PETC consists of three packaged components, all bundled inside one Windows installer produced by `electron-builder`.

### 3.1 Primary Executable

| Property | Value |
|---|---|
| Filename | `PETC.exe` |
| Type | Electron desktop application |
| Runtime | Embedded Chromium + Node.js (Electron 28+) |
| Source entry point | [desktop/electron/main.ts](../../desktop/electron/main.ts) |
| Preload script | [desktop/electron/preload.ts](../../desktop/electron/preload.ts) |
| Build configuration | [desktop/package.json](../../desktop/package.json), [desktop/installer/](../../desktop/installer/) |
| Default install location | `C:\Program Files\PETC\` |

The Electron main process is responsible for: creating the main application window, spawning and supervising the Python sidecar subprocess, mediating IPC between renderer and main, and applying signed auto-updates pulled from the operator cloud update channel.

### 3.2 Embedded Sidecar Executable

| Property | Value |
|---|---|
| Filename | `petc-sidecar.exe` (PyInstaller-frozen) |
| Type | Local HTTP service |
| Runtime | Embedded Python 3.11 |
| Source entry point | [desktop/sidecar/petc/service.py](../../desktop/sidecar/petc/service.py) |
| Bind address | `127.0.0.1:8765` (loopback only — no LAN exposure) |
| Lifecycle | Spawned by Electron main at app start; terminated on app exit |
| Build configuration | [desktop/pyproject.toml](../../desktop/pyproject.toml), [desktop/installer/](../../desktop/installer/) |

The sidecar exposes a private FastAPI HTTP server that the React renderer calls for: authentication, vehicle lookup against the LTMS/Stradcom registry, analyzer reading capture, camera and printer control, CEC generation, and LTMS submission.

### 3.3 Bundled User Interface

| Property | Value |
|---|---|
| Type | Static React + Vite build (HTML, JS, CSS) |
| Runtime | Loaded into the Electron renderer process |
| Source entry point | [desktop/renderer/src/main.tsx](../../desktop/renderer/src/main.tsx) |
| Application shell | [desktop/renderer/src/App.tsx](../../desktop/renderer/src/App.tsx) |
| Built asset location | `resources/app.asar/renderer/dist/` (inside installer) |

### 3.4 Runtime Data Locations

| Asset | Location |
|---|---|
| Local SQLite database | `%APPDATA%\PETC\petc.db` |
| Photo storage | `%APPDATA%\PETC\photos\` |
| Application logs | `%APPDATA%\PETC\logs\` |
| User-specific settings | `%APPDATA%\PETC\settings\` |

The `%APPDATA%\PETC\` directory is created by the installer with NTFS ACLs restricting access to the operating-system user account that runs the application.

---

## 4. System Security Policy

This section is the formal Security Policy of the Client Application required by the DOTr accreditation. Each control area below describes the policy and the source-code location where it is enforced.

### 4.1 Authentication

- Operators log in to the Client Application via the local sidecar endpoint `POST /auth/login`.
- User passwords are stored as bcrypt hashes via `passlib` and are never persisted in plaintext.
- A successful login issues a short-lived JWT session token, held in the renderer's Zustand state for the duration of the session.
- Cloud mirror requests carry an `X-Center-Key` header whose hash is verified server-side against the `licenses.key_hash` column on the operator cloud.
- Enforced in: [desktop/sidecar/petc/api/](../../desktop/sidecar/petc/api/), [desktop/sidecar/petc/service.py](../../desktop/sidecar/petc/service.py).

### 4.2 Authorization (Role-Based Access Control)

- Three roles are recognised by the Client Application:
  - **Encoder** – performs tests, captures readings and photos, submits to LTMS.
  - **Supervisor / Admin** – reviews tests, manages operators, configures hardware.
  - **Platform Super Admin** – operates only on the cloud portal; no rights inside the Client Application.
- Authorization decisions are enforced at every protected sidecar route.
- Cloud-side enforcement is performed by the stateless JWT filter in the Spring Security configuration: [cloud/backend/src/main/java/com/petc/config/SecurityConfig.java](../../cloud/backend/src/main/java/com/petc/config/SecurityConfig.java).

### 4.3 Tenant Isolation

- Each accredited PETC corresponds to exactly one tenant on the operator cloud.
- Every cloud request originating from a Client Application is bound to a tenant via the `X-Center-Key` header. The validator resolves the key to a `tenantId`, and every downstream query is scoped by that `tenantId`.
- A tenant's records are never visible to operators of another tenant.

### 4.4 Data Protection

- The local SQLite database is stored under the per-user `%APPDATA%\PETC\` directory, inheriting NTFS access controls of that user account.
- The cloud-side API key (`PETC_CLOUD_KEY`) is stored in the operating system credential store / encrypted configuration file, never in plaintext source.
- Test photos are written to the local photos directory and are referenced by their SHA-256 content hash.
- All outbound communication to LTMS, Stradcom, and the PETC operator cloud is performed exclusively over HTTPS in production deployments.

### 4.5 Audit Logging

- Every state-changing action in the Client Application — operator login, test creation, photo capture, LTMS submission attempt, CEC issuance — is written to a local audit trail (the `app_settings` and outbox tables and a rolling log file).
- LTMS submission attempts log: timestamp, operator user ID, plate number, attempt outcome, and any error returned by the registry.
- When the cloud mirror is enabled, audit events are forwarded to the cloud `audit_logs` table.

### 4.6 Network Posture

- The Python sidecar binds to `127.0.0.1` only; it is not reachable from the local network or the internet.
- Outbound network connections are restricted to the following endpoints:
  - LTMS submission endpoint
  - Stradcom registry endpoint
  - PETC operator cloud (mirror ingestion and update channel)
- No inbound listener is exposed by the Client Application beyond the loopback sidecar.

### 4.7 Update Distribution

- Application updates are distributed through the operator cloud update channel at `/api/updates/**`.
- Each release manifest is signed; the Electron auto-updater verifies the manifest signature before applying any update.

---

## 5. Declaration and List of Main Sub-Programs

### 5.1 Declaration

I, **Christian Deiniel Y. Silerio**, in my capacity as Developer of the PETC Data Submission SaaS, declare that the sub-programs and files enumerated in this Section 5 and in Section 6 constitute the complete set of sub-programs and associated files that comprise the Client Application submitted under this accreditation. No undeclared executable code is included in the installer beyond standard third-party runtime dependencies declared in [desktop/package.json](../../desktop/package.json) and [desktop/pyproject.toml](../../desktop/pyproject.toml).

Signed: _______________________ Date: ________________

### 5.2 Electron Main Process (Node.js 20 / TypeScript)

Source root: [desktop/electron/](../../desktop/electron/)

| File | Purpose |
|---|---|
| `main.ts` | Application bootstrap; creates the browser window, spawns the Python sidecar, applies updates. |
| `preload.ts` | Secure IPC bridge between renderer and main process. |
| `bridge.d.ts` | TypeScript declarations for the renderer-side IPC contract. |
| `tsconfig.json` | TypeScript compiler configuration for the main process. |

### 5.3 React Renderer (TypeScript / React 18)

Source root: [desktop/renderer/src/](../../desktop/renderer/src/)

| Sub-program | Purpose |
|---|---|
| `pages/auth/` | Operator login screen. |
| `pages/test/` | "Run Test" workflow: plate lookup, fuel-type selection, analyzer readings capture. |
| `pages/upload/` | Six-step LTMS upload wizard: vehicle, owner, engine flags + readings, technician, photos, review & submit. |
| `pages/history/` | Past tests, filtering, re-printing of CEC. |
| `pages/settings/` | Analyzer / camera / printer configuration; COM port discovery. |
| `pages/analytics/` | Local center analytics dashboard. |
| `store/` | Zustand state (auth, current test, settings). |
| `api/` | Typed HTTP client for the local sidecar. |

### 5.4 Python Sidecar (Python 3.11 / FastAPI)

Source root: [desktop/sidecar/petc/](../../desktop/sidecar/petc/)

| Sub-program | Purpose |
|---|---|
| `service.py` | FastAPI application factory; sidecar entry point. |
| `api/` | REST routes (auth, vehicle lookup, tests, upload, ports, settings). |
| `analyzer/` | Serial hardware adapters (see 5.5). |
| `camera/` | Webcam capture via OpenCV. |
| `printer/` | Receipt and CEC printer integration. |
| `gov/` | LTMS and Stradcom registry clients (mock and real adapters). |
| `cec/` | Certificate of Emission Compliance PDF rendering. |
| `db/` | SQLAlchemy ORM models and Alembic migrations. |
| `cloud_sync/` | Outbound mirror pusher to operator cloud. |
| `queue/` | Outbox pattern for reliable mirror sync under intermittent connectivity. |
| `sync/` | Local-to-cloud synchronisation utilities. |

### 5.5 Hardware Analyzer Adapters (Python)

Source root: [desktop/sidecar/petc/analyzer/](../../desktop/sidecar/petc/analyzer/)

| Adapter file | Hardware | Protocol |
|---|---|---|
| `mock.py` | Mock analyzer (test fixture; used when `PETC_ANALYZER=mock`) | In-memory simulated readings |
| `base.py` | Analyzer abstract base classes | — |
| `serial_base.py` | Serial-COM abstraction | RS-232 / USB-serial |
| `builder.py` | Adapter factory; chooses adapter by `PETC_ANALYZER` value | — |
| `ascii_gas.py` | Generic gas analyzer | ASCII delimited, CRLF terminated, passive push |
| `binary_diesel.py` | Generic diesel opacimeter | Binary framed, CRC-16/MODBUS, polled with trigger byte `0x05` |
| `fty_opacimeter.py` | FTY-100 diesel opacimeter | Diesel opacity, polled |
| `fofen_gas.py` | Fofen petrol gas analyzer | Fofen binary framing |
| `fofen_ascii.py` | Fofen ASCII variant | ASCII variant |
| `fofen_framing.py` | Fofen frame parser | Binary frame decode |

Frame formats and unit-test fixtures for the ASCII gas and binary diesel adapters are documented in the project README and reproduced in Section 6.4.

---

## 6. Associated Files

### 6.1 Configuration Files

| File | Purpose |
|---|---|
| [desktop/package.json](../../desktop/package.json) | Electron / renderer Node dependencies and build scripts. |
| [desktop/pyproject.toml](../../desktop/pyproject.toml) | Python sidecar package metadata and dependencies. |
| [desktop/installer/](../../desktop/installer/) | electron-builder and PyInstaller specifications. |
| [cloud/backend/src/main/resources/application.yml](../../cloud/backend/src/main/resources/application.yml) | Spring Boot cloud configuration (JWT secret, DB, S3, Redis). |
| [docker-compose.yml](../../docker-compose.yml) | Cloud development services (Postgres, MinIO, Redis). |

#### 6.1.1 Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PETC_DATA_DIR` | `%APPDATA%\PETC` | Root directory for SQLite, photos, logs. |
| `PETC_PORT` | `8765` | Sidecar HTTP port (loopback only). |
| `PETC_ANALYZER` | `mock` | Adapter type: `mock`, `serial_gas`, `serial_diesel`, FTY, Fofen variants. |
| `PETC_ANALYZER_PORT` | `COM1` | COM port name (e.g. `COM3`, `/dev/ttyUSB0`). |
| `PETC_ANALYZER_BAUD` | `9600` | Baud rate. |
| `PETC_GOV_MOCK` | `true` (dev) | Use mock LTMS/Stradcom client instead of real registry. |
| `PETC_CLOUD_URL` | unset | Operator cloud base URL for mirror sync. |
| `PETC_CENTER_ID` | unset | Center identifier registered on cloud. |
| `PETC_CLOUD_KEY` | unset | Issued center API key for mirror authentication. |

### 6.2 Database Files

#### 6.2.1 Local (SQLite, source of truth)

- Database file: `%APPDATA%\PETC\petc.db`
- Schema migrations: [desktop/sidecar/petc/db/](../../desktop/sidecar/petc/db/) (Alembic)
- Core tables: `users`, `emission_tests`, `gas_test_results`, `diesel_test_results`, `test_photos`, `ltms_submissions`, `vehicles_cache`, `app_settings`, outbox tables.

#### 6.2.2 Cloud (PostgreSQL, mirror)

Schema migrations under [cloud/backend/src/main/resources/db/migration/](../../cloud/backend/src/main/resources/db/migration/):

| Migration | Purpose |
|---|---|
| `V1__initial_schema.sql` | Core tables: users, tenants, licenses. |
| `V2__mirror_tables.sql` | Mirror ingest: `mirror_events`, `mirror_emission_tests`, `mirror_test_photos`, `mirror_ltms_submissions`. |
| `V3__mirror_phase3.sql` | Phase-3 mirror enhancements. |

### 6.3 Runtime Data

| Asset | Location | Notes |
|---|---|---|
| Photo storage | `%APPDATA%\PETC\photos\` | Files named by SHA-256 hash of contents. |
| Application logs | `%APPDATA%\PETC\logs\` | Rolling daily files; retained 30 days. |

### 6.4 Test Fixtures (for inspector verification)

| Fixture | Purpose |
|---|---|
| [desktop/tests/fixtures/gas_pass.txt](../../desktop/tests/fixtures/gas_pass.txt) | ASCII gas frame with all fields. |
| [desktop/tests/fixtures/gas_no_optional.txt](../../desktop/tests/fixtures/gas_no_optional.txt) | ASCII gas frame, required fields only. |
| [desktop/tests/fixtures/diesel_pass.bin](../../desktop/tests/fixtures/diesel_pass.bin) | Binary diesel frame with valid CRC. |

Inspectors can verify analyzer parsing offline by running `pytest desktop/tests -q` against these fixtures; no physical analyzer is required.

---

## 7. Folder and File Inventory (Screenshots)

DOTr requires "Screenshots of folder location, file(s) location and size for each and every system files." This section lists every path that must be captured. Screenshots are produced separately (see follow-up task) and inserted under each numbered heading below.

### 7.1 Capture Procedure

For each item in the checklist below:

1. Open the path in **Windows File Explorer**.
2. Switch to **Details** view (View ribbon → Details).
3. Ensure these columns are visible: **Name**, **Date modified**, **Type**, **Size**.
4. Capture a full-window screenshot (Win+Shift+S or Alt+PrtScn).
5. Insert the image beneath the corresponding heading in this document.

Where command-line listings are preferred, run in PowerShell:

```powershell
Get-ChildItem -Force -Recurse <path> |
  Select-Object FullName, Length, LastWriteTime |
  Format-Table -AutoSize
```

and paste the formatted output.

### 7.2 Screenshot Checklist

| # | Path | Captured |
|---|---|---|
| 1 | `C:\Program Files\PETC\` (root install directory) | ☐ |
| 2 | `C:\Program Files\PETC\resources\app.asar.unpacked\sidecar\` (sidecar exe folder) | ☐ |
| 3 | `C:\Program Files\PETC\resources\app.asar\renderer\dist\` (renderer assets) | ☐ |
| 4 | `%APPDATA%\PETC\` (runtime data root) | ☐ |
| 5 | `%APPDATA%\PETC\petc.db` (SQLite database, showing file size) | ☐ |
| 6 | `%APPDATA%\PETC\photos\` (photo storage) | ☐ |
| 7 | `%APPDATA%\PETC\logs\` (application logs) | ☐ |
| 8 | Source: `desktop\electron\` (main process source) | ☐ |
| 9 | Source: `desktop\renderer\src\pages\` (UI sub-programs) | ☐ |
| 10 | Source: `desktop\sidecar\petc\` (sidecar root) | ☐ |
| 11 | Source: `desktop\sidecar\petc\analyzer\` (all analyzer adapter files) | ☐ |
| 12 | Source: `desktop\sidecar\petc\gov\` (LTMS / Stradcom clients) | ☐ |
| 13 | Source: `desktop\sidecar\petc\cec\` (CEC generation) | ☐ |
| 14 | Source: `desktop\sidecar\petc\db\` (DB models and migrations) | ☐ |
| 15 | Config: `desktop\package.json`, `desktop\pyproject.toml` | ☐ |
| 16 | Build: `desktop\installer\` | ☐ |
| 17 | Cloud config: `cloud\backend\src\main\resources\application.yml` | ☐ |
| 18 | Cloud migrations: `cloud\backend\src\main\resources\db\migration\` | ☐ |

### 7.3 Screenshot Placeholders

> _The numbered headings below correspond to each row in the checklist. Insert the captured screenshot under the matching heading._

#### 7.3.1 Install root – `C:\Program Files\PETC\`
*(screenshot to be inserted)*

#### 7.3.2 Sidecar executable folder
*(screenshot to be inserted)*

#### 7.3.3 Renderer asset folder
*(screenshot to be inserted)*

#### 7.3.4 Runtime data root – `%APPDATA%\PETC\`
*(screenshot to be inserted)*

#### 7.3.5 Local SQLite database – `petc.db`
*(screenshot to be inserted)*

#### 7.3.6 Photo storage directory
*(screenshot to be inserted)*

#### 7.3.7 Application log directory
*(screenshot to be inserted)*

#### 7.3.8 Electron main-process source
*(screenshot to be inserted)*

#### 7.3.9 React renderer pages
*(screenshot to be inserted)*

#### 7.3.10 Python sidecar root
*(screenshot to be inserted)*

#### 7.3.11 Hardware analyzer adapters
*(screenshot to be inserted)*

#### 7.3.12 LTMS / Stradcom client folder
*(screenshot to be inserted)*

#### 7.3.13 CEC generation folder
*(screenshot to be inserted)*

#### 7.3.14 Database models and migrations folder
*(screenshot to be inserted)*

#### 7.3.15 Build configuration files
*(screenshot to be inserted)*

#### 7.3.16 Installer specification folder
*(screenshot to be inserted)*

#### 7.3.17 Cloud `application.yml`
*(screenshot to be inserted)*

#### 7.3.18 Cloud Flyway migration folder
*(screenshot to be inserted)*

---

## 8. Version and Build Information

| Item | Value |
|---|---|
| Client Application version | `0.1.0` (from [desktop/package.json](../../desktop/package.json)) |
| Source repository commit at submission | `985bfb0451ff06fc611f1aade018dd274d2f3de8` |
| Node.js (renderer / main process build) | 20.x LTS |
| Python (sidecar runtime) | 3.11 |
| Java (cloud backend build) | 21 |
| Build tooling | `npm`, `electron-builder`, `PyInstaller`, Gradle |
| Target operating system | Windows 10 / 11 (64-bit) |
| Installer format | NSIS (electron-builder default) |

---

## 9. References

- Project Proposal: *Emission Testing Center Data Submission SaaS – Project Proposal*, Feb 26, 2026.
- Repository [README.md](../../README.md): desktop setup, analyzer protocols, mock LTMS workflow, cloud mirror testing.
- [desktop/electron/main.ts](../../desktop/electron/main.ts) – Electron entry point.
- [desktop/sidecar/petc/service.py](../../desktop/sidecar/petc/service.py) – Python sidecar entry point.
- [desktop/renderer/src/main.tsx](../../desktop/renderer/src/main.tsx) – React renderer entry point.
- [cloud/backend/src/main/java/com/petc/PetcCloudApplication.java](../../cloud/backend/src/main/java/com/petc/PetcCloudApplication.java) – Spring Boot cloud entry point.
- [cloud/backend/src/main/java/com/petc/config/SecurityConfig.java](../../cloud/backend/src/main/java/com/petc/config/SecurityConfig.java) – security configuration.

---

*End of System Documentation – PETC Data Submission SaaS Client Application.*
