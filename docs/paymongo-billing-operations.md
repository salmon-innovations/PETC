# PayMongo billing operations

## Safe defaults

PayMongo is disabled unless `PAYMONGO_ENABLED=true`. UAT and production Terraform both retain this disabled default. Existing centers and submissions migrate as `PREPAID`.

Never put API or webhook secrets in source, Terraform values, Docker Compose, the desktop environment, or the Electron bundle. The test secret previously pasted into chat must be rotated before use.

## UAT enablement

1. Rotate the exposed test API secret in PayMongo.
2. Create a separate test-mode PayMongo webhook subscribing to `payment.paid` and `payment_intent.succeeded` at:

   `https://<uat-api>/api/payments/paymongo/webhook`

3. Store the rotated `sk_test_...` key and the webhook's distinct signing secret as two AWS Secrets Manager secrets.
4. Supply their ARNs as `paymongo_secret_key_secret_arn` and `paymongo_webhook_secret_arn` to the UAT Terraform module.
5. Set `paymongo_enabled = true`, keep `paymongo_live_mode = false`, and keep `paymongo_expose_test_url = true` in UAT.
6. Apply infrastructure, deploy the cloud image, and verify the V15 Flyway migration.
7. Generate a QR in the desktop Billing page. Do not scan a test QR with a real banking app; use PayMongo's returned test simulator URL.
8. Confirm one and only one row exists in each link of the reconciliation chain: `payment_topups` paid record → PayMongo provider payment ID → `wallet_ledger` verified `TOPUP`.
9. Replay the webhook and restart the cloud during a pending payment to verify idempotency and recovery.

## Production enablement

Use a separate live webhook URL/secret and live API secret. Set `paymongo_live_mode = true` and keep `paymongo_expose_test_url = false`. Enable only after UAT reconciliation has zero unexplained differences. The cloud rejects webhook events whose `livemode` does not match its environment.

## Reconciliation and alerts

- Provider reconciliation runs every 30 seconds by default and repairs missed webhooks.
- Webhook processing claims are recovered after five minutes.
- `CREATING` top-ups replay the same provider idempotency keys after restart.
- Dynamic QR top-ups expire locally when their provider expiry passes, but a later verified success can still fulfill if the payment actually completed.
- Reconcile PayMongo paid payments, `payment_topups`, and external `wallet_ledger` references daily.
- Review failed webhook inbox rows, long-lived creating/awaiting top-ups, wallet projection drift, uninvoiced closed usage, and overdue invoices.

## Postpaid schedule

Billing periods are half-open Philippine-time windows: day 1 through the start of day 16, then day 16 through the start of the next month. The catch-up scheduler finalizes closed windows containing uninvoiced usage and cannot create two invoices for the same center and period.

Past-due invoices alert operators and administrators but do not automatically block LTMS uploads. A commercial suspension requires an explicit audited operational decision.
