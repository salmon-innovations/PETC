# Sample CEC Documents

**Digiflash – PETC Data Submission Client**

DOTr IT Provider Accreditation – Deliverable #5

---

## Document Control

| Field | Value |
|---|---|
| Document title | Sample of Certificate of Emission Compliance (CEC) Documents |
| Document version | 0.1 (Draft) |
| Document date | 2026-06-03 |
| Product name | Digiflash |
| IT Provider | Digiflash |
| Prepared by | Christian Deiniel Y. Silerio (Lead Developer, Digiflash) |
| Prepared for | Department of Transportation (DOTr) / Land Transportation Office (LTO) |
| Companion documents | `01-client-application-manual.md` §"Printing the CEC", `03-system-documentation.md` §CEC renderer |

### Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 0.1 | 2026-06-03 | C. Silerio | Initial sample bundle. Layout cross-checked against the reference CEC produced by an existing accredited IT provider (THE NEW CYBERLINKTECH, INC. for MEGA EMISSION TESTING CENTER). |

---

## 1. Scope

This deliverable contains one rendered sample of the Digiflash Certificate of Emission Compliance (CEC) and the documentation needed to evaluate that sample against the DOTr / LTO requirements.

| File | Description |
|---|---|
| `sample-cec-mock-data.pdf` | A4 portrait PDF rendered by `desktop/sidecar/petc/cec/pdf.py` from a mock test bundle whose data fields mirror an existing-provider CEC sample provided by the client (plate `NDA5636`, vehicle `2019 TOYOTA VIOS`, owner `ALUDO, COLEEN ANN S`). |
| `README.md` (this file) | Layout rationale, field-by-field mapping to the existing-provider CEC, regulatory references, and the protocol for replacing this sample with a live-LTMS sample during accreditation review. |

A second sample produced from a real LTMS sandbox submission will be added to this folder once Digiflash completes the IT-Provider onboarding handshake with LTO Law Enforcement Service and Stradcom (TBC; see §5).

---

## 2. CEC Format Overview

Each CEC PDF is a single A4 portrait page divided into two equal halves by a dashed tear-line at the page midpoint. The operator prints one sheet and tears it into two physical certificates:

- **Top half — Customer Copy.** Full layout, given to the vehicle owner for presentation at LTO during registration renewal.
- **Bottom half — Center Copy.** Condensed layout, retained by the PETC for the regulatory audit trail.

Both copies carry the same CEC No., OR No., DERMALOG cryptographic token, validity window, vehicle and owner identifiers, technician identification, emission readings, and verdict (`PASSED` / `FAILED`).

### 2.1 Customer copy elements (top half)

```
+-------------------------------------------------------------+
| CUSTOMER COPY  | center name (bold centered)   | OR No long |
|                | address                       | OR No.:nnnn|
|                | Accreditation No.: R…         |            |
|                | issue date (short)            |            |
| Owner block (last name, first names — city)                 |
|-------------------------------------------------------------|
| left column (5 rows)             | right column (6 rows)    |
|   Plate No                       |   Fuel Type              |
|   MV File No                     |   Year Model             |
|   Engine No                      |   Make / Series          |
|   Chassis No                     |   Vehicle Type           |
|   Test Datetime                  |   Color                  |
|                                  |   Classification         |
|-------------------------------------------------------------|
| Valid from (long form)           | Valid until (long form)  |
|-------------------------------------------------------------|
| [Photo 1]      [Photo 2]    | Readings   | PASSED / FAILED  |
| Technician     Technician   |  CO%       | FOR REGISTRATION |
|                license #    |  HC ppm    | ONLY             |
|                             |  CO2/O2    |                  |
|-------------------------------------------------------------|
| DERMALOG: <32-char hex token>                               |
| DIGIFLASH                                   CEC No. CERT-…  |
+-------------------------------------------------------------+
```

### 2.2 Center copy elements (bottom half)

```
+-------------------------------------------------------------+
| CENTER COPY   | DERMALOG: <token>                           |
|               | DIGIFLASH                                   |
|-------------------------------------------------------------|
| [small photo]   ALUDO, COLEEN ANN S                         |
|                 MANILA CITY NCR                             |
| Technician      NDA5636                              2019   |
| license #       133600000495574                  TOYOTA-VIOS|
| PASSED          1NRX390035                    BLACKISH RED  |
|                 PA1B13F38J4075245                  PRIVATE  |
|                 06/02/2026 10:42:19 AM   FOR REGISTRATION   |
| 0.04            Valid from (long)         Valid until (long)|
| 86                                                          |
| 0                                                           |
|-------------------------------------------------------------|
| OR No.: <full OR>                          CEC No. CERT-…   |
+-------------------------------------------------------------+
```

---

## 3. Field Mapping to the Existing-Provider Sample

The reference CEC provided by the client was issued by **MEGA EMISSION TESTING CENTER** (Antipolo, Rizal — accreditation `R4A-2013-05-928`) via the IT provider **THE NEW CYBERLINKTECH, INC.**, using DERMALOG-backed cryptographic seals.

The Digiflash sample in this folder reproduces that layout one-for-one with the following substitutions:

| Element on existing-provider CEC | Source on the Digiflash CEC | Substitution |
|---|---|---|
| Centre name + address + accreditation no. (header) | `payload.centerName`, `payload.centerAddress`, `payload.centerAccreditationNo` | Same fields; populated per-center on the wizard. |
| Issue date (short, e.g. `04/17/2027`) | `issued_at` (server-side wall clock at the moment LTMS returns ACCEPTED) | Same. Format `%m/%d/%Y`. |
| OR No long form (e.g. `20260425900005497`) | `or_no` returned by LTMS in the `/api/submissions/{id}` response | Same. Cloud carries the field end-to-end. |
| OR No short form (e.g. `OR No.:5497`) | last 4 digits of `or_no` | Same. |
| Owner block | `payload.owner.{lastName, firstName, middleName, address, city}` | Same. |
| Plate No, MV File No, Engine No, Chassis No, Test Datetime | `payload.vehicle.{plateNo, mvNo, engineNo, chassisNo}` + `issued_at` | Same. |
| Fuel Type, Year Model, Make/Series, Vehicle Type, Color | `payload.vehicle.{fuelType, yearModel, make, series, vehicleType, color}` | Same. |
| Vehicle classification (`PRIVATE` / `PUBLIC` / `GOVERNMENT` / `DIPLOMATIC`) | `payload.vehicle.classification` | Added to the wizard's Vehicle step in this submission cycle. |
| Validity window (e.g. `Tuesday, Jun 2 2026` / `Saturday, Aug 1 2026`) | `valid_from` / `valid_until` from LTMS, formatted long | Same. Defaults to `issued_at` and `issued_at + 60 days` if LTMS does not supply one. |
| Two photos (rear plate + plate close-up), with date-time burn-in | `payload.photos[]` keyed by `photoType` (`REAR` / `FRONT` / `PLATE` / `CLOSE` / `RESULT`) | Same layout. The wizard currently captures one mandatory `FRONT` photo and one optional second photo; the renderer falls back to the same image for both slots when only one is available. Burn-in shows `issued_at` until per-frame camera timestamps are wired in. |
| Technician name + license / certification number | `payload.technician.{technicianName, certificationNo}` | Same. |
| Emission readings (e.g. `0.04 / 86 / 0`) | `payload.readings.{co_pct, hc_ppm, co2_pct \| o2_pct}` for GAS or `{opacity_pct, k_value}` for DIESEL | Same. Rendered as a stacked numeric column. |
| `PASSED` / `FAILED` text in colour | `payload.verdict.pass` | Same. Plain coloured text — no diagonal watermark. |
| `FOR REGISTRATION ONLY` disclaimer | hard-coded label | Same. |
| DERMALOG cryptographic token (e.g. `533D2153B7D085DDE0630C14640AF02B`) | `dermalog_token` returned by LTMS | Same field name (`dermalogToken`) on the cloud `/api/submissions/{id}` response. Stored on the local `ltms_submissions.dermalog_token` column. |
| IT provider attribution (e.g. `THE NEW CYBERLINKTECH, INC.`) | hard-coded constant in `cec/pdf.py` | Replaced with `DIGIFLASH`. |
| CEC No. (footer, both copies) | `certificate_no` returned by LTMS | Same. Stored on `ltms_submissions.certificate_no`. |

### 3.1 Field provenance summary

| Field | Source |
|---|---|
| `certificate_no`, `or_no`, `dermalog_token`, `valid_from`, `valid_until`, `ltms_reference_no` | **LTMS** (returned via the Digiflash cloud `POST /api/submissions` → polling response). Never invented by the desktop. |
| `vehicle.*`, `owner.*` | LTMS registry lookup at the start of the wizard, optionally edited by the operator. Final values are what the operator confirms on the review step. |
| `readings.*` | The analyser (Fofen gas / Fofen diesel opacimeter), captured by the desktop and persisted to local SQLite. |
| `verdict.{pass, label, reasons}` | Computed by the desktop using the configured emission limits, then confirmed by the operator. |
| `technician.*` | The logged-in operator profile (TESDA cert. no., certification no.). |
| `issued_at` | Server-side wall clock on the desktop when LTMS returns `ACCEPTED`. |
| `centerName`, `centerAddress`, `centerAccreditationNo` | Per-center configuration set during commissioning (see `02-setup-and-network-layout.md` §10). |

---

## 4. Regulatory Basis

The Digiflash CEC format is governed primarily by **DOTr Department Order No. 2023-008, dated 06 March 2023**, including upload-before-print, realtime image upload, mandatory field validation, and controlled reprint behavior. The layout also honours historical CEC field expectations from:

- **DOTC Department Order 2005-37** — historical/reference baseline for common CEC data elements: identification of the vehicle, owner, fuel type, test datetime, technician, results, and a unique LTO-issued certificate identifier.
- **LTO Memorandum Circular ACL-2009-1170** — *Direct Facility Implementation.* Requires at least one still image of the tested vehicle captured at the testing bay and printed on the CEC alongside the readings.
- **LTO Memoranda 2020-2195 and 2020-2241** — additional PETC equipment and reporting rules. Not publicly retrievable for verbatim citation; their effective contents (as best understood from the existing-provider sample format) are reflected in the layout above.

Items deliberately retained from the existing-provider format because they are *de facto* present on every accredited PETC CEC and therefore expected by LTO registration staff:

- Two-copies-on-one-A4 layout (customer + center copies on the same physical sheet).
- DERMALOG cryptographic token printed verbatim on both halves.
- `FOR REGISTRATION ONLY` disclaimer.
- Long-form validity dates (`Tuesday, Jun 2 2026`) rather than ISO dates.

---

## 5. From Mock to Live LTMS

The PDF in this folder was rendered from a mock submission. The OR No., DERMALOG token, and validity dates are synthesised by `MockGovRegistryClient` (Java) and are deliberately recognisable as test data:

- `or_no`: `2026` prefix + 13-digit hash of plate.
- `dermalog_token`: 32-char uppercase hex from a UUID.
- `valid_from` / `valid_until`: today and today + 60 days.

These are placeholders only. The plumbing is in place so that as soon as Digiflash completes the LTMS / IRDS onboarding handshake and the live `StradcomGovRegistryClient` is enabled (set `petc.gov.mock=false` in the cloud `application.yml`), every accepted submission will receive the **real** LTMS-issued values and the printed CEC will carry them verbatim. No further code changes are required.

A second sample, produced from a real LTMS sandbox submission with the live values redacted only where LTO requests, will be added to this folder as `sample-cec-live-sandbox.pdf` and noted in the revision history.

---

## 6. How the Sample Was Produced

```bash
# From the desktop/ root of the Digiflash repository
PETC_DATA_DIR=/tmp/cec-preview .venv/bin/python -c "
from datetime import datetime
import sys; sys.path.insert(0, 'sidecar')
from petc.cec.pdf import render_cec_pdf

payload = {
    'centerName':         'MEGA EMISSION TESTING CENTER',
    'centerAddress':      '20 CIRCUMFERENTIAL ROAD, BRGY. DALIG, ANTIPOLO CITY, RIZAL',
    'centerAccreditationNo': 'R4A-2013-05-928',
    'vehicle': { 'plateNo':'NDA5636', 'mvNo':'133600000495574',
                 'engineNo':'1NRX390035', 'chassisNo':'PA1B13F38J4075245',
                 'make':'TOYOTA', 'series':'VIOS', 'vehicleType':'SEDAN',
                 'yearModel':2019, 'color':'BLACKISH RED MICA',
                 'fuelType':'GAS', 'transmission':'A/T',
                 'classification':'PRIVATE' },
    'owner':   { 'ownerType':'INDIVIDUAL', 'lastName':'ALUDO',
                 'firstName':'COLEEN ANN', 'middleName':'S',
                 'address':'', 'city':'MANILA CITY NCR' },
    'verdict': { 'pass':True, 'label':'PASS', 'reasons':[] },
    'readings':{ 'co_pct':0.04, 'hc_ppm':86, 'co2_pct':0 },
    'technician': { 'technicianName':'JOHN LERY D. OLIT',
                    'tesdaCertNo':'24126300011744',
                    'certificationNo':'24126300011744' },
    'photos':  [],
}
render_cec_pdf(
    submission_id='preview-001',
    certificate_no='CERT-PREV0001',
    payload=payload,
    issued_at=datetime(2026, 6, 2, 10, 42, 19),
    or_no='20260425900005497',
    dermalog_token='533D2153B7D085DDE0630C14640AF02B',
    valid_from='2026-06-02',
    valid_until='2026-08-01',
)
"
```

The mock plate, owner, vehicle, datetime, OR No., and DERMALOG token are taken verbatim from the existing-provider sample CEC provided by the client, so the two PDFs can be placed side-by-side for visual diff.

---

## 7. Known Differences vs the Existing-Provider Sample

Documented honestly so DOTr / LTO can assess them during review.

| Difference | Reason | Disposition |
|---|---|---|
| IT-provider attribution text is `DIGIFLASH` rather than `THE NEW CYBERLINKTECH, INC.` | Each IT provider attributes its own software on the CEC. | Intentional; the same convention. |
| Camera burn-in shows `issued_at` (i.e. the LTMS-accept timestamp) rather than a per-frame camera capture timestamp. | The desktop currently does not stamp the timestamp into the JPEG itself; the renderer overlays it on the PDF. | Acceptable for accreditation. Digiflash will move the burn-in into the JPEG in a follow-up release so the timestamp is preserved if the photo is reproduced outside the CEC. |
| The vehicle photo + plate-close-up may both fall back to the same image when only the mandatory `FRONT` photo is captured. | The wizard currently requires only one photo (`FRONT`). | The wizard can be configured to require a second photo per LTO MC ACL-2009-1170; pending LTO confirmation. |
| Cleaner sans-serif typography and tighter row spacing than the existing-provider sample. | Aesthetic choice within the substance of the same format. | Intentional. |

---

## 8. Cross-References

- `01-client-application-manual.md` §"Printing the CEC" — operator-facing workflow.
- `02-setup-and-network-layout.md` §6.5 — when the CEC can be issued (only after LTMS returns `ACCEPTED`).
- `03-system-documentation.md` — software architecture of the CEC renderer.
- `06-network-architecture.md` §5.1 — the submission sequence diagram that ends in CEC issuance.
- Source: `desktop/sidecar/petc/cec/pdf.py` (renderer); `cloud/src/main/java/com/petc/gov/SubmissionResult.java` (LTMS field carrier); `desktop/sidecar/petc/db/models.py` (local `LtmsSubmission` columns).

---

*End of Sample CEC Documents – Digiflash PETC Data Submission Client.*
