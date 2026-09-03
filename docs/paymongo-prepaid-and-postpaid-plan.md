# PayMongo prepaid top-ups and semi-monthly postpaid billing

**Status:** Core implementation completed; provider UAT and production enablement remain gated  
**Prepared:** 2026-08-13  
**Scope:** Cloud API, Postgres, operator portal, Windows desktop/sidecar, deployment, reconciliation, and tests

## Implementation note (2026-08-13)

The repository now contains the V15 billing/payment schema, prepaid/postpaid submission accounting, dynamic Payment Intent QR Ph adapter, signed webhook inbox and recovery workers, center/admin APIs, desktop/sidecar billing UI, portal billing profiles/invoice details/settlement recording, and disabled-by-default deployment configuration. Automated backend, sidecar, and frontend verification passes. Live provider UAT was deliberately not performed with the key pasted in chat; rotate it, configure an environment-specific webhook secret, then follow the rollout gates below.

## 1. Recommended product decisions

1. Keep the cloud as the only accounting authority. The desktop may request and display a QR, but it must never hold a PayMongo secret or credit a wallet locally.
2. Use PayMongo **Payment Acceptance QR Ph through Payment Intents** for the first prepaid implementation. It provides a one-time dynamic QR for an exact amount, supports the supplied test-key environment, and has a retrievable payment status.
3. Do not use `/v3/qr/mpm/generate` for the first test implementation. PayMongo currently documents that endpoint as Wallet QR/money movement, requires an activated PayMongo Wallet and a live secret key, and does not support test mode. Keep the PayMongo integration behind a `QrPaymentGateway` interface so a Wallet QR adapter can be piloted later without changing the PETC accounting model.
4. Do not use the static `/v1/qrph/generate` endpoint for self-service reloads. A dynamic QR ties one center, one exact amount, one expiry, and one provider payment to one top-up request, which is safer to reconcile.
5. Prepaid centers are debited only for an LTMS-accepted CEC, preserving the current rule and `charge_snapshot_centavos` behavior. Rejected or failed attempts are not billable.
6. Postpaid centers accrue the same accepted-CEC charge as immutable usage instead of debiting a wallet. A postpaid center is never held by the prepaid balance gate.
7. Interpret the requested “15th and 30th” schedule as statement cutoffs at the end of the 15th and the end of the **last calendar day** of each month in `Asia/Manila`. This avoids losing or delaying usage on February 28/29 and on the 31st. The finalizer runs just after the closed window, on the 16th and first of the next month.
8. Initially collect postpaid invoices outside PayMongo and let an administrator record settlement with a reference. PayMongo QR remains prepaid-only as requested.

## 2. Existing foundation to preserve

The current implementation already has several important invariants:

- Money is represented as integer centavos.
- `wallet_ledger` is append-only and is the source of truth; `wallet_accounts` is a cached projection.
- Each accepted CEC uses an immutable per-submission price snapshot.
- The accepted state change and prepaid debit commit in one database transaction.
- A unique `(submission_id, acceptance_seq)` key prevents duplicate acceptance charges.
- The desktop sidecar fetches a center-scoped wallet summary with `X-Center-Key`, caches it, and exposes it to the renderer without exposing the center key.
- Insufficient prepaid funds hold a submission in the cloud; a top-up releases affordable held submissions FIFO.

The new work should extend these rules rather than replace them.

## 3. Target flow

### 3.1 Prepaid QR top-up

1. An authorized desktop user selects a preset or custom top-up amount.
2. Renderer calls a localhost sidecar endpoint. The sidecar sends the request to the cloud with `X-Center-Key` and a stable client request UUID.
3. Cloud validates that the center is `PREPAID`, validates amount limits, creates a local `payment_topup` row, then creates a PayMongo Payment Intent with `payment_method_allowed: ["qrph"]`.
4. Cloud creates a `qrph` Payment Method and attaches it to the Payment Intent. The PayMongo secret stays in the cloud. The cloud returns the QR image, local top-up ID, amount, status, and expiry to the sidecar.
5. Desktop displays the QR and polls the cloud top-up status while it is open. Test/UAT may also expose PayMongo's `test_url` so QA can simulate success; production must not display it.
6. PayMongo sends a signed `payment.paid`/successful intent event to the cloud. The endpoint verifies the signature from the raw request body, records the event idempotently, and acknowledges promptly.
7. A worker retrieves the Payment Intent server-side and verifies all of the following before fulfillment: succeeded status, QR Ph source, PHP currency, exact requested amount, expected live/test mode, and the expected Payment Intent/payment IDs.
8. In one database transaction, cloud marks the top-up paid, appends exactly one `TOPUP` ledger entry keyed by the PayMongo payment ID, updates the wallet projection, and releases held submissions FIFO.
9. Desktop polling observes `PAID`, refreshes `/api/billing/me`, and shows the new cloud balance. No separate desktop-to-cloud synchronization write is required because the cloud already owns the top-up and balance.
10. A scheduled reconciliation worker retrieves non-terminal Payment Intents and repairs missed/delayed webhook outcomes. This is required because webhook delivery is not a durable queue owned by PETC.

### 3.2 Postpaid acceptance and invoicing

1. At enqueue time, copy both the effective price and billing mode/revision into the submission. This makes retry behavior deterministic if a center changes plans later.
2. The dispatch runner applies the wallet affordability gate only to `PREPAID` submissions. `POSTPAID` submissions continue to LTMS without a wallet check.
3. On LTMS acceptance, atomically set the accepted state and append one immutable `billing_usage` row keyed by `(submission_id, acceptance_seq)`. Prepaid usage also creates the existing wallet debit; postpaid usage remains uninvoiced until cutoff.
4. Billing windows are half-open Philippine-time intervals:
   - first half: `[month day 1 00:00, day 16 00:00)`
   - second half: `[day 16 00:00, next month day 1 00:00)`
5. A catch-up-safe scheduler checks for closed, uninvoiced windows rather than relying on one fragile exact cron execution. A unique `(tenant_id, period_start, period_end)` constraint prevents duplicate invoices.
6. Invoice finalization locks eligible usage, creates a final invoice and its line/detail records, links every included usage row, and calculates totals entirely from stored centavos. The sum of linked usage must equal the invoice subtotal.
7. Desktop shows the current cycle count/estimated amount, the next statement cutoff, open invoices, and past-due warnings. The operator portal shows detailed accepted CECs, rates, totals, adjustments, and settlement references.
8. Past-due status generates alerts but does not silently block regulatory uploads. Any commercial suspension must be a separate, explicit administrative action with audit history.

## 4. Data model

Create the next Flyway migration after `V14` and add the following.

### `billing_profiles`

- `tenant_id UUID PRIMARY KEY`
- `mode TEXT CHECK (mode IN ('PREPAID','POSTPAID'))`, default `PREPAID`
- `revision BIGINT NOT NULL`
- `timezone TEXT NOT NULL DEFAULT 'Asia/Manila'`
- `payment_terms_days INT` (recommended initial default: 7; confirm with finance)
- `credit_limit_centavos BIGINT NULL` for reporting/alerts, not automatic LTMS blocking
- `effective_at TIMESTAMPTZ`, `updated_at`, `updated_by`

Keep profile changes in the audit log. Plan changes should normally become effective at a statement boundary. Prevent a prepaid-to-postpaid switch while submissions are `BLOCKED` unless an administrator explicitly resolves how those old prepaid snapshots will be funded or migrated.

### Changes to `submissions`

- `billing_mode_snapshot TEXT NOT NULL DEFAULT 'PREPAID'`
- `billing_profile_revision BIGINT`

Keep the existing `charge_snapshot_centavos` as the price used by both modes.

### `billing_usage`

- `id UUID PRIMARY KEY`
- `tenant_id UUID NOT NULL`
- `submission_id UUID NOT NULL`
- `acceptance_seq INT NOT NULL`
- `billing_mode TEXT NOT NULL`
- `amount_centavos BIGINT NOT NULL CHECK (amount_centavos >= 0)`
- `accepted_at TIMESTAMPTZ NOT NULL`
- `invoice_id UUID NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- unique `(submission_id, acceptance_seq)`

This table is the common billable-event register. It lets finance prove that prepaid ledger charges and postpaid invoice details came from the same accepted-CEC rule.

### `payment_topups`

- local `id UUID PRIMARY KEY` and `tenant_id UUID NOT NULL`
- `client_request_id UUID NOT NULL`, unique per tenant
- provider fields: `provider`, `provider_payment_intent_id`, `provider_payment_method_id`, `provider_payment_id`
- `amount_centavos`, `currency`, `status` (`CREATING`, `AWAITING_PAYMENT`, `PAID`, `EXPIRED`, `FAILED`, `CANCELLED`)
- `livemode`, `expires_at`, `paid_at`, `failure_code`, `failure_message`
- short-lived QR display data if required; clear it after terminal state and never log it
- timestamps and a unique provider payment ID

Add explicit provider/reference columns to `wallet_ledger` and a partial unique index for externally funded top-ups. Do not depend on the free-text `note` column for payment idempotency.

### `payment_webhook_events`

- provider event ID as the primary/unique key
- event type, livemode, received/processed timestamps, processing status, payload hash
- optionally retain the encrypted/raw payload under a documented retention policy; do not log full payloads by default

### `billing_invoices`, `billing_invoice_lines`, and `billing_payments`

Invoices need a unique human-readable invoice number, tenant, period bounds, issued/due timestamps, subtotal/adjustment/total/amount-paid centavos, status (`OPEN`, `PARTIALLY_PAID`, `PAID`, `PAST_DUE`, `VOID`), and immutable center billing details captured at issue time. Link usage rows to invoice lines or expose them as invoice details. Settlements are append-only `billing_payments` carrying amount, method, external reference, actor, and timestamp.

Database invariants should ensure:

- one usage record per acceptance event;
- one provider credit per PayMongo payment;
- one invoice per center/window;
- a usage record belongs to at most one invoice;
- invoice totals equal line totals plus adjustments;
- no floating-point money fields.

## 5. API surface

### Center-key cloud API

- `GET /api/billing/me` — mode-aware summary. Prepaid returns balance/low/held/rate; postpaid returns cycle count/estimate/cutoff/open and past-due totals.
- `POST /api/billing/me/topups` — create an exact dynamic QR; prepaid only. Accept `{amountCentavos, clientRequestId}`.
- `GET /api/billing/me/topups/{topupId}` — center-scoped status and active QR display details.
- `GET /api/billing/me/topups?limit=...` — recent top-up attempts/receipts.
- `GET /api/billing/me/invoices` and `GET /api/billing/me/invoices/{invoiceId}` — center-scoped postpaid statements.

Keep `GET /api/wallet/me` during a compatibility window and have it delegate to the new summary for prepaid clients. Every center endpoint derives `tenant_id` from the validated center key, never from request data.

### Public provider webhook

- `POST /api/payments/paymongo/webhook`

This exact route is unauthenticated by PETC JWT/center key but must require a valid PayMongo signature, a fresh timestamp within the selected tolerance, the correct environment mode, and an unmodified raw body. Store the event durably and return a JSON `2xx` quickly; do accounting in an idempotent worker.

### Super-admin API

- Read/update a center billing profile and schedule mode changes.
- List/retrieve/finalize/void invoices with audited permissions.
- Record postpaid settlements and adjustments as compensating records.
- Retain the existing manual prepaid top-up only as an explicitly labeled administrative adjustment/fallback, not as a normal PayMongo payment path.

### Sidecar localhost API

Add mode-aware billing summary, create/get top-up, and invoice endpoints. The Electron renderer talks only to localhost. The sidecar owns the center-key call to cloud and maps provider/network errors to stable user-facing states.

## 6. UI changes

### Desktop

- Replace the sidebar's prepaid-only wallet component with a billing indicator.
- Prepaid: balance, price per accepted CEC, held count, **Reload wallet** action, QR modal, countdown, pending/paid/expired state, and recent receipts.
- Postpaid: `Postpaid` badge, current window accepted count and estimated total, next cutoff, and overdue alert; no QR/reload controls.
- Treat the displayed balance/estimate as cloud data with a visible last-updated time. The desktop must remain usable offline, but it cannot create a QR or confirm a payment offline.
- When a QR becomes paid, refresh both payment status and billing summary. Never optimistically add the amount in the renderer.

### Operator portal

- Billing mode and effective-date control on the center detail page.
- Prepaid payment history distinguishes verified PayMongo payments from manual admin adjustments.
- Postpaid current usage, statement list/detail, CSV/PDF export, due/past-due views, payment recording, and audit trail.
- Dashboard totals for pending prepaid payments, webhook/reconciliation failures, uninvoiced usage, open receivables, and past-due receivables.

## 7. PayMongo security and operations

- Rotate the test secret pasted into the planning conversation before any development use. It must be treated as exposed. The public test key is not secret, but should still be supplied through environment configuration rather than copied into code.
- Store `PAYMONGO_SECRET_KEY` and `PAYMONGO_WEBHOOK_SECRET` in AWS Secrets Manager and inject them only into the cloud task. The webhook signing secret is distinct from the API secret.
- Use separate test and live API keys, webhook endpoints/secrets, and alarms. Reject a `livemode` mismatch.
- Use HTTP Basic authentication with the secret key as username and an empty password for server-to-server PayMongo requests.
- Send a stable PayMongo `Idempotency-Key` on supported resource-creation operations. Persist it before the first network call and reuse it on retries. For attach/retrieve calls, retrieve current provider state before deciding whether a retry is safe.
- Verify HMAC signatures using the raw request bytes and constant-time comparison before parsing or storing an event. Apply timestamp replay protection.
- Redact authorization headers, QR payloads/images, client keys, webhook signatures, and provider payload details from logs and error responses.
- Use bounded connect/read/total timeouts, retry only safe/idempotent calls, and add a circuit breaker. A PayMongo outage must not affect postpaid LTMS dispatch.
- Alert on webhook signature failures, disabled webhooks, old pending top-ups, provider/local status mismatches, ledger projection drift, overdue invoice finalization, and invoice-total mismatches.

## 8. Implementation sequence

### Phase 0 — commercial and provider confirmation

- Rotate the exposed test secret.
- Confirm the PayMongo merchant has Payment Acceptance QR Ph enabled in test and live modes.
- Confirm whether Wallet QR `/v3/qr/mpm/generate` is desired later and whether a live PayMongo Wallet is activated. Do not combine Wallet QR and Payment Intent QR in one top-up.
- Confirm top-up min/max/presets, whether PETC credits the gross paid amount or net of PayMongo fees (recommended: gross, with fees borne/accounted separately), postpaid payment terms, tax/VAT fields, invoice numbering, billing contact, and PDF requirements.
- Confirm the last-calendar-day interpretation of “30th.”

### Phase 1 — billing domain and migration

- Add profiles, submission snapshots, usage, top-up, webhook, invoice, line, and payment tables/constraints.
- Backfill all existing centers as `PREPAID` and preserve existing wallet balances/ledger.
- Refactor accepted-event accounting so state transition, usage append, and prepaid debit/postpaid accrual remain atomic.
- Add billing-mode-aware dispatch without changing LTMS success criteria.

### Phase 2 — PayMongo adapter and fulfillment

- Implement typed PayMongo configuration/client and `QrPaymentGateway` interface.
- Implement Payment Intent + QR Ph creation, retrieval, expiry mapping, idempotency, and sanitized error mapping.
- Implement signed webhook inbox/worker and scheduled provider reconciliation.
- Make `WalletService` support an idempotent gateway-funded top-up actor/reference while keeping manual admin adjustments separate.

### Phase 3 — center/desktop prepaid experience

- Add center-key billing/top-up APIs and sidecar proxy methods.
- Build the reload modal, QR display, timer, status polling, retry/regenerate behavior, and verified receipt state.
- Refresh the existing wallet cache after fulfillment and validate release of held submissions.

### Phase 4 — postpaid invoice engine

- Implement Philippine-time window calculation, catch-up-safe finalization, unique invoices, usage claiming, totals, due dates, status transitions, and past-due sweeper.
- Add plan-change scheduling and transition validation.
- Add invoice detail/export and append-only manual settlement/adjustment flows.

### Phase 5 — portal and desktop postpaid experience

- Add profile controls, current/uninvoiced usage, statement pages, receivables dashboard, and audit views to the portal.
- Add mode-aware summary/current-cycle/invoice views to sidecar and desktop.

### Phase 6 — UAT, rollout, and reconciliation

- Enable test PayMongo configuration only in UAT; run the full simulated QR lifecycle using `test_url` rather than scanning test QR codes.
- Shadow-generate postpaid invoice previews for at least one full semi-monthly window and compare every total to accepted submissions before sending statements.
- Pilot prepaid QR with selected centers, then postpaid with selected centers. Keep kill switches for QR creation/webhook fulfillment and invoice finalization, while read/reconciliation paths remain available.
- Reconcile daily: PayMongo paid transactions ↔ `payment_topups` ↔ wallet `TOPUP` ledger entries, and accepted postpaid usage ↔ invoice details ↔ invoice totals.

## 9. Required test matrix

### Accounting/idempotency

- Duplicate create request, PayMongo retry, duplicate/out-of-order webhook, webhook plus polling race, and worker retry all produce exactly one wallet credit.
- Amount/currency/source/mode mismatch never credits the wallet.
- Payment fulfillment and wallet credit roll back together on database failure.
- Existing acceptance retry still creates only one usage/charge for one acceptance sequence.
- Prepaid acceptance debits; postpaid acceptance accrues; rejected LTMS calls do neither.

### QR lifecycle

- Create, await, simulate success, expire, regenerate, provider timeout, invalid signature, stale signature, malformed payload, missed webhook repaired by retrieval, and live/test mismatch.
- The renderer never receives a secret and never changes a balance locally.
- Two workstations for one center see the same cloud payment and balance outcome.

### Invoice boundaries

- Philippine-time acceptance immediately before/at/after each cutoff.
- February 28/29, April 30, months with a 31st, year boundary, scheduler downtime/catch-up, concurrent finalizers, zero-usage periods, price changes, plan changes, resubmission acceptance sequences, adjustments, partial payment, void, and past-due transition.
- Every invoice subtotal equals the sum of its immutable linked usage.

### Regression/security

- Existing prepaid hold, grace release, FIFO release, per-center price overrides, center-key tenant isolation, super-admin authorization, wallet projection checks, LTMS success/rejection behavior, and desktop offline/stale display.
- Verify secrets and authorization headers are absent from source, packaged desktop artifacts, HTTP responses, audit detail, and logs.

## 10. Definition of done

- A prepaid center can create a QR from the desktop, simulate/pay it, and observe exactly one verified cloud wallet credit and any affordable held submissions released.
- No PayMongo secret is present in desktop code/artifacts or committed configuration.
- A postpaid center uploads without wallet blocking, every accepted CEC appears once in current usage, and closed Philippine-time periods create one reproducible invoice.
- Prepaid QR is unavailable to postpaid centers, and postpaid billing does not debit a wallet.
- Webhook loss, duplication, reordering, timeout, and service restart are recoverable without lost or duplicate money.
- UAT reconciliation reports have zero unexplained differences before either feature is enabled in production.

## 11. PayMongo references used

- [Payment Acceptance QR Ph API](https://docs.paymongo.com/docs/payment-acceptance-qr-ph-api)
- [Payment Acceptance testing](https://docs.paymongo.com/docs/payment-acceptance-testing)
- [Create a Payment Intent](https://docs.paymongo.com/reference/create-a-paymentintent)
- [Create a Payment Method](https://docs.paymongo.com/reference/create-a-paymentmethod)
- [Attach to a Payment Intent](https://docs.paymongo.com/reference/attach-to-paymentintent)
- [Idempotent requests](https://docs.paymongo.com/reference/idempotent-requests)
- [Webhook resource](https://docs.paymongo.com/reference/webhook-resource)
- [Webhook setup and signature verification](https://docs.paymongo.com/docs/developer-tools-webhook-setup-management)
- [Wallet QR / MPM](https://docs.paymongo.com/docs/money-movement-moving-money-with-wallet-qr)
- [Generate an MPM QR](https://docs.paymongo.com/reference/generate-mpm-qr)
