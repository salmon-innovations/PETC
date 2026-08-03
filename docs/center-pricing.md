# Center pricing

Each emission center has its own integer-centavo `charge_per_upload_centavos`
and `low_balance_threshold_centavos` in `tenant_billing_configs`. Existing and
new centers default to PHP 80 per accepted CEC and a PHP 400 warning threshold.
The platform billing values are defaults for creating centers; changing them
does not rewrite existing center configurations.

When the cloud receives a submission, it copies the center's current charge to
`submissions.charge_snapshot_centavos`. Dispatch affordability, blocked-queue
release, grace release, and the eventual accepted ledger debit all use that
snapshot. LTMS rejections remain free. Reposting a `REJECTED` or `DEAD`
submission is a new receipt and takes a new price snapshot.

Super admins edit a center's price and warning threshold from its wallet page.
The update is immediate for newly received submissions and writes a
`CENTER_PRICING_CHANGED` audit entry with the old and new values.

The sidecar persists the last successful `/api/wallet/me` response in local
SQLite under `wallet.last_registered`. Electron displays the last registered
price and marks the wallet data stale based on its fetch time. This local value
is informational only and never prevents a test or upload.
