# DOTr DO 2023-008 Compliance Matrix

**Primary baseline:** DOTr Department Order No. 2023-008, dated 06 March 2023.  
**Scope:** PETC IT Service Provider client program controls, cloud submission controls, and Annex 6 / PETC Form 02 evidence.

DOTC DO 2005-37 is retained as historical context only. This accreditation package is aligned to DOTr DO 2023-008 unless a reviewer requests a separate legacy mapping.

## Section 8.4 Client Program Controls

| DO 2023-008 item | Implementation / evidence | Owner | Status | Gap / next action |
|---|---|---|---|---|
| Automatically detect interfaced test machine; no operation without interface | Production profile rejects mock analyzer and refuses startup/test start without connected analyzer. See `desktop/sidecar/petc/runtime.py`, `service.py`, and `/test/start`. | Engineering | Implemented | Add on-site screenshot with real Fofen adapter connected. |
| Automatic capture within 5 seconds | Sidecar measures `read_result()` duration and rejects capture beyond 5 seconds. | Engineering | Implemented | Confirm timing against final analyzer firmware. |
| No stale third-party result stored beyond 2 minutes | Duplicate/non-adapter analyzer frames are rejected in production; stale intermediate result policy is documented for adapter certification. | Engineering | Partial | Add adapter-level quarantine table if final analyzer SDK exposes pre-final readings. |
| Reject corrupted, manually edited, duplicate, or non-native entries | Server-side analyzer result validation rejects missing/non-numeric/zero/negative readings and duplicate raw frames. | Engineering | Implemented | Add corrupted-frame tests per final serial protocol. |
| Filter duplicate uploaded test results | Cloud `submissions` uses unique `(tenant_id, test_id)` idempotency; desktop rejects duplicate machine raw frames. | Engineering | Implemented | Add explicit conflict-response test for duplicate cloud submission. |
| Time/date synchronization | Cloud-mediated flow timestamps submissions and photos in UTC; workstation must run NTP. | Operations | Partial | Add installer self-check for OS time drift. |
| One-hour lock before retest after failure | `/test/start` rejects same-plate retest within 1 hour after a failed test. | Engineering | Implemented | Add UI copy explaining lock reason. |
| No CEC print without interfaced test | CEC print requires an accepted `LtmsSubmission` tied to a completed local emission test. | Engineering | Implemented | Add hardware inspection screenshot. |
| No zero/negative gas/diesel values | `_validate_readings_for_do()` rejects zero/negative regulated values. | Engineering | Implemented | Tune field list if DOTr provides a narrower prescribed data dictionary. |
| Reprint restrictions | Receipt rows now store `ORIGINAL` vs `REPRINT`; reprint preserves original submission data and rejects tests older than 2 months. | Engineering | Implemented | Add UI label for reprint copy. |
| No blank mandatory fields | Upload validates center, vehicle, owner, technician, analyzer serial, readings, and photos before submission. | Engineering | Implemented | Extend to final DOTr prescribed report schema when received. |
| Provider name/logo/coded identifier | Manual and CEC identify Digiflash; build metadata remains in package manifest. | Product | Partial | Add explicit coded identifier on the renderer footer. |
| Upload first before printing CEC | Desktop blocks CEC print until submission state is `ACCEPTED`; production also requires uploaded photos. | Engineering | Implemented | Add E2E screenshot bundle. |
| Prescribed report/data format | Current payload follows local wizard schema and cloud `payload` JSON. | Engineering | Partial | Replace with final LTMS/IRDS contract once issued. |
| Reject uploads from expired/suspended/revoked PETCs | Cloud `center_licenses` now includes authorization status/expiry and rejects non-active centers for registry, photo, and submission endpoints. | Engineering | Implemented | Add admin UI for status changes. |
| Audit services enabled | Audit entries are created for test start, result capture, photo capture, submission outcomes, CEC print/reprint. | Engineering | Partial | Add read-only reviewer export endpoint. |
| No access codes during internet failure | Production path requires cloud submission; local mock path is disabled outside dev/demo. | Engineering | Implemented | Add operator message for cloud-unavailable state. |
| Realtime image upload with 1-hour grace for confirmed connectivity malfunction | Photo upload is required before submission/print; waiting submissions carry incident due time. | Engineering | Partial | Add incident workflow button and one-hour connectivity evidence capture. |
| Incident report within 24 hours for failed realtime upload | `incident_due_at` is stored for non-terminal cloud submissions; template included. | Operations | Partial | Add monthly/incident export automation. |

## Annex 6 / PETC Form 02 Evidence

| Annex 6 evidence | Repo location | Status |
|---|---|---|
| Client Application Program Manual | `docs/accreditation/01-client-application-manual.md` | Draft, DO 2023-008 aligned |
| Set-up and network layout | `docs/accreditation/02-setup-and-network-layout.md` and `06-network-architecture.md` | Draft, cloud-mediated architecture |
| System documentation, executable description, security policy | `docs/accreditation/03-system-documentation.md` | Draft |
| Source code package and manifest | `docs/accreditation/04-source-code/` | Draft |
| File location / size screenshots | `docs/accreditation/03-system-documentation.md` placeholders | Pending packaged build |
| Interfacing software | Analyzer adapters under `desktop/sidecar/petc/analyzer/` | Draft |
| Installation certificate per PETC | `docs/accreditation/templates/installation-certificate-template.md` | Template added |
| PETC client list | `docs/accreditation/templates/petc-client-list-template.md` | Template added |
| Monthly network monitoring report | `docs/accreditation/templates/monthly-network-monitoring-report-template.md` | Template added |
| Incident report | `docs/accreditation/templates/incident-report-template.md` | Template added |
| Audit access procedure | `03-system-documentation.md` plus this matrix | Partial |
| Data flowchart | `docs/accreditation/templates/data-flowchart.md` | Template added |
