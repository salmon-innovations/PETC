# LTMS PETC v2 Integration Plan

**Status:** Confirmed foundation implemented; clarification-dependent phases remain gated
**Prepared:** 2026-08-09
**Implementation status:** The disabled integration foundation has been implemented and tested. Outbound LTMS access remains disabled by default, is not wired into the production submission path, and no LTMS endpoint was called during implementation or testing.

## 1. Purpose

This plan covers the confirmed work needed to connect the Digiflash PETC platform to the LTMS PETC v2 and JWT APIs. It separates work that can begin from work that cannot be finalized until LTMS clarifies the supplied contracts.

The source material reviewed for this plan is:

- `interface_PETC_v2_2.yml` (`info.version: 2.1.2`)
- `PETV_V2_ERROR_CODES.xlsx`
- `JWT_swagger_definition.yml` (`version: 1.0.0`)
- JWT username/password and biometric sample payloads
- JWT sample response and error-code CSV
- LTMS confirmation that every center must be registered and receives its own username and password

### Implementation checkpoint

Implemented now:

- Phase 0 safety controls: explicit mode and enablement gates, exact HTTPS host allowlisting, response redaction, and disabled defaults.
- Phase 1 center identity/configuration foundation: tenant-scoped configuration, secret references rather than passwords, credential-verification state, audited admin operations, authenticated center derivation, and scoped ECS task-role permission for center secrets.
- Phases 2 and 3 isolated client boundary: typed JWT/PETC clients, token lifecycle abstractions, response decoding, critical flow-control error classification, and fixture-based tests. These clients are not connected to live application workflows.
- Phase 6 durable submission foundation: explicit lifecycle states, immutable attempt history, leases, atomic multi-worker claims, retry scheduling, and reconciliation state.
- Phase 8 state compatibility: desktop and portal understand the expanded lifecycle states, and the sidecar canonicalizes the configured center identity before upload.
- LTMS schema changes use V9/V10 because V7/V8 are already assigned to center pricing and multi-lane support in the deployment history.

Intentionally not completed until LTMS answers the blockers:

- Resolving center password values from Secrets Manager and durable encrypted/shared JWT storage with a distributed refresh lock.
- Wiring vehicle lookup, limits, JWT generation, upload, replacement, or reconciliation into production services.
- Final upload serialization, CEC/OR-number allocation, complete error catalog validation, eligibility rules, printing, and billing behavior.
- Any real QA/UAT or production call. Only the production NAT IP is allowlisted; an approved UAT exercise must run through that network while remaining logically isolated from production processing.

## 2. Confirmed architecture and constraints

1. The PETC desktop never calls LTMS directly.
2. LTMS has allowlisted only the production AWS NAT gateway IP. Any approved QA/UAT call must originate through that production network path without being treated as a production transaction.
3. Every center has its own LTMS username and password and uses its assigned `business-id`.
4. LTMS credentials and JWTs are never delivered to or stored by the desktop.
5. The Digiflash center key determines the tenant, center, LTMS username, business ID, PETC code, and credential secret used for a request.
6. The cloud calls LTMS synchronously from a durable submission queue; the desktop polls Digiflash rather than LTMS.
7. Analyzer frames, photos, hashes, and other evidence remain in Digiflash storage. Only the fields prescribed by the LTMS JSON contract are sent to LTMS.
8. The supplied APIs can search LTMS vehicle/limit data and create, replace, search, and count CEC records. They do not update LTMS vehicle master data.
9. Biometric JWT authentication is out of scope unless LTMS explicitly requires it. The confirmed center username/password method will be used.
10. Development and automated tests must use local fixtures/mocks. The UAT portal has LTMS outbound and upload flags set to false. No real test may call LTMS unless a separately approved UAT exercise is deployed through the production NAT.

## 3. Target operational flow

1. Register and provision a center's LTMS identity in Digiflash.
2. Authenticate the desktop to Digiflash using its center key.
3. Derive the center's LTMS configuration on the cloud; never trust LTMS identity fields supplied by the desktop.
4. Reuse or safely generate a per-center LTMS JWT through the NAT gateway.
5. Search the vehicle with `GET /v2/cec/search_vehicle` using purpose and the applicable identifiers.
6. Return LTMS vehicle details, applicable limits, latest upload, next inspection date, and concerns to the desktop.
7. Block testing/upload when LTMS reports an ineligible vehicle, incomplete master data, incorrect limit configuration, an electric/None fuel type, or an active retest lock.
8. Capture analyzer readings, raw frame, analyzer identity, timestamps, and required photos locally.
9. Send the complete evidence bundle to the Digiflash cloud.
10. Build and validate the LTMS payload on the cloud using trusted center configuration and the actual captured test data.
11. Atomically claim the queued submission and call either new upload or replacement.
12. Persist the request outcome, `inbox_id`, CEC number, evaluation, expiry, error headers, reasons, and audit metadata.
13. If the network outcome is uncertain, reconcile through `GET /v2/cec/search` before repeating a mutating request.
14. Return the authoritative LTMS result to the desktop and apply the approved printing and billing rules.

## 4. Phase plan

### Phase 0 - Safety boundary and feature controls

**Readiness:** Ready.

**Code and configuration work**

- Introduce explicit LTMS modes: `mock`, `qa-disabled`, `qa-enabled`, and `production` (exact names may follow existing profile conventions).
- Keep outbound LTMS calls disabled by default and use a separate disabled-by-default gate for CEC upload/replacement mutations.
- Require an explicit deployment flag before any real LTMS client can be constructed.
- Allow only configured HTTPS LTMS hosts; reject arbitrary base URLs.
- Ensure logs redact Authorization headers, passwords, JWTs, biometric data, owner PII, and full request bodies.
- Add a production startup guard requiring live LTMS configuration only when commissioning has been approved.

**Acceptance criteria**

- Unit/integration tests cannot reach LTMS hosts.
- Enabling a real client requires an explicit environment setting and complete center configuration.
- Secrets and tokens never appear in application logs or API responses.

### Phase 1 - Per-center LTMS identity and credential provisioning

**Readiness:** Ready; secret naming and operator workflow can be refined during implementation review.

**Database and service work**

- Add a tenant-scoped LTMS center configuration containing:
  - Digiflash tenant and center identifiers
  - LTMS username
  - LTMS business ID
  - PETC code
  - AWS Secrets Manager secret reference for the LTMS password
  - QA/production environment designation
  - Enabled/disabled status
  - Last credential verification state and timestamp
- Do not store the LTMS password in PostgreSQL, SQLite, desktop properties, audit details, or source control.
- Derive the center identity from `CenterKeyValidator`; reject a request whose submitted center ID conflicts with the authenticated center.
- Add audited administrator operations for provisioning, disabling, and rotating a center's LTMS secret reference.
- Extend IAM so only the cloud task role can read the scoped LTMS secrets.

**Acceptance criteria**

- One center cannot select or use another center's LTMS identity.
- Desktop payload manipulation cannot change `username`, `business-id`, PETC code, or secret reference.
- Password rotation does not require a desktop update.

### Phase 2 - Per-center JWT manager

**Readiness:** Partially ready. The client and safe caching can be implemented; refresh timing is blocked by contradictory lifetime information.

**Code work**

- Add a JWT client for `POST /ords/dl_user_management/authentication/latest/authenticate`.
- Send only the confirmed username/password payload; do not implement fingerprint collection or storage.
- Treat the successful response as a raw compact JWT string.
- Parse `iat` and `exp` for cache scheduling without treating unverified claims as authorization decisions.
- Maintain an encrypted shared token record keyed by center/environment/username.
- Use a database row lock, advisory lock, or equivalent distributed lock so only one ECS task generates a center token.
- Recheck the cache after acquiring the lock to prevent duplicate generation.
- Implement code-aware behavior:
  - `311`: refresh once and retry the original request once.
  - `312`: reload/reuse the shared token; do not generate another.
  - `310`, `313`, `314`, `317`, `318`, `320`: stop calls for that center and alert operations.
  - `301`, `321`: mark the center as missing LTMS privileges.
- Never apply unbounded/exponential retries to authentication.

**Acceptance criteria**

- Concurrent workers request at most one new token for a center.
- A token is never used with a different username.
- Account-lock errors stop further automated authentication attempts.
- Token behavior is tested entirely with fixtures.

**Blocker**

- Final proactive-refresh timing awaits LTMS confirmation of current lifetime and minimum generation interval.

### Phase 3 - LTMS transport client and error model

**Readiness:** Ready for an isolated, disabled client using fixtures.

**Code work**

- Create a dedicated `LtmsV2Client`; do not continue modelling this contract as a generic Stradcom/driver registry.
- Add typed operations for:
  - `GET /v2/cec/limits`
  - `GET /v2/cec/search_vehicle`
  - `POST /v2/cec/upload`
  - `PUT /v2/cec/replace`
  - `GET /v2/cec/search`
  - `GET /v2/cec/upload_limits`
- Add standard headers from trusted center configuration: Bearer JWT, `username`, and `business-id`.
- Preserve `inbox_id`, HTTP status, `error_code`, `error_msg`, reasons, and relevant response body for every call.
- Implement explicit connection, read, and total timeouts.
- Redact sensitive values in diagnostics while preserving support references.
- Convert the supplied error workbook into a maintained code catalog with outcome class and operator action.

**Acceptance criteria**

- Client contract tests cover success and every documented HTTP response shape using local fixtures.
- HTTP status alone never determines retryability.
- Every support-worthy failure retains its `inbox_id`.

### Phase 4 - Vehicle search, limits, and eligibility

**Readiness:** Partially ready. Search and returned eligibility data are confirmed; some data ownership and enum rules remain blocked.

**Cloud and desktop work**

- Replace plate-only lookup with a request supporting plate, MV file number, chassis number, and engine number.
- Require inspection purpose before lookup.
- Use chassis and engine numbers for initial registration.
- Include diesel type when applicable.
- Return a Digiflash response containing:
  - LTMS `inbox_id`
  - MV details and completeness flag
  - Vehicle-specific limits
  - Latest upload and next permissible inspection date
  - Inspection parameter concerns
- Remove the live-flow assumption that an LTMS miss can be bypassed with manual vehicle entry.
- Block upload for documented vehicle/master-data/limit concerns.
- Cache lookup data only for a short, explicitly configured period; always revalidate near submission if the business flow permits a delay.
- Replace hardcoded desktop thresholds as the authoritative result source. LTMS limits may drive a preview; LTMS evaluation remains final.

**Acceptance criteria**

- Initial-registration searches never use plate or MV file number.
- A `409` with concerns is visible and prevents upload.
- Electric and None fuel types cannot enter the emission workflow.
- The desktop shows the LTMS next permissible inspection time.

**Blockers**

- Confirm motorcycle fuel/group modelling.
- Confirm whether owner data is available from another endpoint and which returned fields an operator may edit.

### Phase 5 - Canonical test evidence and LTMS payload preparation

**Readiness:** Partially ready. The Digiflash evidence model can be corrected now; final LTMS serialization is blocked by schema gaps.

**Code work**

- Preserve the analyzer's actual `tested_at` value end to end; remove use of dispatch time as inspection time.
- Preserve the current owner, vehicle, technician, purpose, analyzer, readings, and photo evidence as a typed canonical submission rather than an unvalidated map.
- Correct the current cloud mapper, which reads top-level fields while the desktop sends nested vehicle, verdict, and technician objects.
- Separate:
  - Evidence retained by Digiflash
  - Fields serialized to LTMS
- Introduce explicit reading mappings:
  - `opacity_pct` to `ave_d`
  - `co_pct` to `co`
  - `hc_ppm` to `hc`
  - `co2_pct` to `co2`
  - `o2_pct` to `o2`
  - `no_ppm` to `nox`
  - `oil_temp_c` to `temperature`
  - Existing RPM and lambda fields to their LTMS counterparts
- Omit non-applicable fuel-specific readings instead of sending zero or placeholders.
- Populate center/accreditation data from trusted server configuration and technician data from the authenticated technician profile.
- Add strict length, enum, conditional-field, and timestamp prevalidation before enqueue/dispatch.

**Acceptance criteria**

- Dispatch never changes the captured inspection timestamp.
- The exact canonical payload is immutable after queue acceptance except through an explicit replacement workflow.
- Photos/raw frames are retained but never accidentally included in the LTMS JSON.
- No mock or placeholder center/technician values can pass production validation.

**Blockers**

- Correct definitions for the request's missing `fuel_type`, `dotr_vehicle_group`, and `classification` properties.
- Required reading matrix, units, scale, and decimal precision.
- Final CEC number construction and inspection timestamp/timezone rules.
- Mandatory accreditation fields.

### Phase 6 - Durable submission state and worker safety

**Readiness:** Ready.

**Database and worker work**

- Extend submissions with:
  - Operation: new upload or replacement
  - CEC number
  - LTMS `inbox_id`
  - Evaluation and expiry
  - LTMS error code/message and reasons
  - Next permitted action time
  - Reconciliation status
  - Immutable request/response attempt history
- Replace the current binary accepted/rejected model with explicit states such as:
  - `PENDING`
  - `IN_FLIGHT`
  - `RECONCILING`
  - `PASSED`
  - `FAILED_EVALUATION`
  - `ACTION_REQUIRED`
  - `DEFERRED`
  - `AUTH_BLOCKED`
  - `DEAD`
- Claim work atomically using `FOR UPDATE SKIP LOCKED`, compare-and-set, or an equivalent database-safe mechanism.
- Ensure only one worker can dispatch a submission at a time across multiple ECS tasks.
- Preserve every attempt without overwriting the original LTMS request evidence.

**Acceptance criteria**

- Two cloud tasks cannot submit the same row concurrently.
- A process crash leaves the submission recoverable and auditable.
- Failed evaluation is distinguishable from transport failure and payload rejection.

### Phase 7 - Upload, replacement, and reconciliation

**Readiness:** Partially ready. Endpoint roles are confirmed; CEC construction and several business rules remain blockers.

**Code work**

- Implement new CEC submission using `POST /v2/cec/upload`.
- Implement correction using `PUT /v2/cec/replace` as a distinct command.
- Keep the same CEC number for replacement and preserve the full original history.
- Before replacement, use CEC search to verify existence, latest evaluation, `is_used_in_trx`, and eligibility.
- Do not immediately replay POST/PUT after timeout or connection loss.
- Mark uncertain outcomes `RECONCILING` and search by CEC number or known `inbox_id`.
- Treat duplicate codes such as `943` and duplicate inspection time `976` as reconciliation triggers.
- Handle deferrals separately:
  - Daily limit `905`: defer to the next eligible day.
  - Currently processing `926`: short controlled delay.
  - Failed-test lock `955` and related evaluation codes: wait until the documented next possible time.
- Refresh JWT once for `311`; do not mix authentication recovery with business retries.

**Acceptance criteria**

- A timeout after LTMS commit cannot create a second CEC submission.
- New and replacement histories remain distinguishable.
- Retry scheduling follows LTMS error meaning, not HTTP status alone.

**Blockers**

- CEC allocation/format and OR-number source.
- Actual failed-evaluation response shape.
- Exact replacement eligibility and behavior when `is_used_in_trx=true`.

### Phase 8 - Desktop, portal, printing, and billing

**Readiness:** Partially ready.

**Code work**

- Update the desktop wizard for purpose, search method, diesel type, LTMS concerns, limits, and next inspection time.
- Display actionable messages rather than raw LTMS codes while retaining codes for support.
- Add status handling for pending, reconciling, deferred, authentication blocked, failed evaluation, and passed.
- Add CEC history/search and daily upload-limit views to the operator/admin interfaces.
- Prevent printing until the approved LTMS terminal outcome and required fields are available.
- Preserve local evidence and audit links for every printed/reprinted document.
- Apply wallet charging atomically at the business event selected during clarification.

**Acceptance criteria**

- Operators can distinguish data correction, retest wait, quota exhaustion, LTMS outage, and account lockout.
- No CEC is printed from a locally calculated verdict alone.
- Billing and printing are idempotent.

**Blockers**

- Whether failed evaluations/replacements count against daily limit and billing.
- Whether failed evaluations produce a printable document.
- Source and continued requirement for OR number and DERMALOG token.
- Whether `cec_number` is the final printable certificate identifier.

### Phase 9 - Infrastructure, security, and operations

**Readiness:** Ready except for confirming the controlled UAT execution design through the already-allowlisted production NAT.

**Infrastructure work**

- Add scoped Secrets Manager resources/references for center LTMS passwords.
- Add task-role permission to read only required LTMS secrets.
- Configure JWT and PETC hosts per environment without embedding credentials in environment variables.
- Confirm ECS remains in private subnets with no public IP and routes outbound through the approved NAT.
- Add alarms for:
  - Authentication lockout/configuration errors
  - Token generation anomalies
  - Submission backlog and `DEAD` growth
  - Reconciliation age
  - LTMS 5xx/error-code rate
  - Daily limit exhaustion
- Add support tooling that produces endpoint, center reference, timestamp, CEC number, and `inbox_id` without exposing credentials or unnecessary PII.

**Acceptance criteria**

- Network design prevents desktops and public application paths from directly reaching LTMS.
- Secrets are not present in Terraform state as plaintext values supplied by operators.
- Each operational alert identifies the affected center without exposing its password or JWT.

### Phase 10 - Test, QA, and controlled release

**Readiness:** Local testing is ready; real QA is gated by authorization and clarified contracts.

**Test work**

- Unit tests for DTO validation, mappings, timestamps, token parsing, and error classification.
- Fixture-based contract tests for all six PETC endpoints and the JWT endpoint.
- Tests for every supplied JWT and PETC error code.
- Multi-worker tests for token generation and submission claiming.
- Timeout-after-commit, duplicate, and reconciliation tests.
- Gas, diesel, motorcycle, renewal, initial registration, and compliance scenarios.
- Failed evaluation and one-hour replacement scenarios.
- Credential rotation, privilege failure, and account-lock prevention scenarios.
- Security tests confirming cross-center isolation and secret redaction.

**Release gates**

1. LTMS answers the blocking questions below.
2. DTOs and fixtures are updated to the corrected contract.
3. Local and cloud tests pass with no external LTMS calls.
4. UAT credentials and use of the production NAT as the sole allowlisted egress are confirmed.
5. A separately approved UAT test window is scheduled, with production processing and LTMS mutation flags disabled except for the explicitly controlled test runner.
6. QA results are reconciled against LTMS-provided records.
7. Production credentials and production go-live authorization are independently verified; UAT use of the production NAT does not constitute production approval.
8. Production live-mode feature flag is enabled only after sign-off.

## 5. LTMS clarification request

The following should be sent to the LTMS API owner. A corrected OpenAPI file plus real, redacted request/response examples is preferred over prose answers.

### A. Contract version and endpoints

1. Please confirm the current PETC API version. The filename indicates v2.2, while `info.version` is `2.1.2`.
2. Please provide the authoritative QA and production HTTPS base URLs for both the PETC and JWT APIs.
3. Please provide success and failure response examples for every endpoint, including HTTP status, response headers, and body.

### B. JWT authentication

4. Please confirm the current JWT lifetime and safe token-generation interval. The supplied historical sample has a two-hour `iat` to `exp` lifetime, while error `312` describes validity up to 25 hours and generation every 10 to 25 hours.
5. Should clients refresh only after expiry, at a documented time before expiry, or when error `311` is received?
6. When error `312` is returned, how can an IT provider retrieve/reuse the still-valid token if its local cached copy has been lost?
7. What HTTP statuses, headers, and bodies carry JWT authentication errors?
8. Please confirm the password expiration, rotation, failed-attempt, lockout, and account-unlock procedures.
9. Please list the exact privileges a center user requires for all PETC v2 endpoints.
10. Can one LTMS username be linked to more than one `business-id`, or is the relationship always one center/user to one business ID?

### C. Vehicle and fuel fields

11. In `uploadCEC_Request.vehicle`, `fuel_type`, `dotr_vehicle_group`, and `classification` are listed as required but are missing from `properties`. Please provide their types, allowed values, and examples.
12. Is `MOTORCYCLE` a DOTr vehicle group while its `fuel_type` remains `GAS`, or is `MOTORCYCLE` also a valid fuel type?
13. Please provide the allowed fuel values and the rules for diesel, gasoline, motorcycle, hybrid, electric, and `None` vehicles.
14. Which vehicle fields returned by `search_vehicle` may the PETC operator edit before upload?
15. Does another LTMS endpoint return owner details? The supplied `search_vehicle` response does not include the owner fields required by upload.

### D. Emission readings

16. Please provide a matrix of mandatory, optional, and prohibited readings for every fuel/vehicle group.
17. Please confirm units, scale, decimal precision, minimum, and maximum for `ave_d`, `co`, `co2`, `o2`, `nox`, `temperature`, `lambda`, `hc`, and `rpm`.
18. Please confirm whether LTMS `nox` corresponds to an analyzer's NO, NOx, or another derived value.
19. Are zero values always prohibited, or only for the fields identified by errors `961` and `962`?
20. Should unmeasured optional fields be omitted or explicitly sent as JSON `null`?

### E. CEC number and timestamps

21. Please provide the exact CEC-number format and length. The supplied schemas/examples show conflicting lengths.
22. Who allocates the OR-number portion, and how must the IT provider prevent duplicates across lanes and concurrent uploads?
23. Is the submitted `cec_number` also the final printable certificate number?
24. Please confirm the required timezone for `inspection_date` and whether the timestamp must omit an offset exactly as shown in the examples.
25. What clock-skew tolerance is accepted for error `973`, and which date boundary/timezone controls error `908`?

### F. Upload result, replacement, and reconciliation

26. Please provide the complete HTTP response for a failed evaluation, including error `917` and the `reasons` array.
27. Is a failed evaluation considered a successfully stored CEC even when returned with HTTP 400?
28. May only failed CECs be replaced? Are passed CECs ever replaceable?
29. What must the client do when `is_used_in_trx=true`?
30. After a POST/PUT timeout, is `GET /v2/cec/search?cec_number=...` the approved way to determine whether LTMS committed the request?
31. How long should the client wait/retry error `926` while a replacement is processing?
32. Does `next_possible_inspection_date` always provide the authoritative retry time for failed evaluation and error `955`?

### G. Limits, printing, and identifiers

33. Do failed evaluations, rejected payloads, replacements, and repeated/reconciled calls count toward `upload_count` and the daily limit?
34. Does a failed evaluation produce any document that the PETC must print or retain?
35. The supplied PETC API does not return an OR number or DERMALOG token. Are these still required on the CEC, and if so, which endpoint/field supplies them?
36. Is `expiry_date` the complete validity information, or is there also a validity start date?

## 6. Recommended implementation order

Work can begin, without enabling outbound calls, in this order:

1. Phase 0 safety controls.
2. Phase 1 per-center identity and secret references.
3. Phase 6 durable state and atomic worker claiming.
4. Phase 3 disabled transport client, DTO boundary, and error catalog.
5. Phase 2 JWT manager with configurable timing and fixture tests.
6. Phase 4 lookup and eligibility using fixtures.
7. Phase 5 canonical evidence model and known mappings.
8. Pause final LTMS serialization until the contract blockers are answered.
9. Complete Phases 7 and 8 after CEC/result/business-rule clarification.
10. Complete infrastructure gates and controlled QA under Phases 9 and 10.

This order fixes the current concurrency, payload ownership, audit, and secret-handling foundations without making assumptions that could send incorrect emission records to LTMS.
