-- ============================================================
-- V7: Per-center pricing and immutable submission price quotes
-- ============================================================

CREATE TABLE tenant_billing_configs (
    tenant_id                         UUID        PRIMARY KEY REFERENCES tenants(id),
    charge_per_upload_centavos        BIGINT      NOT NULL DEFAULT 8000
                                                 CHECK (charge_per_upload_centavos >= 0),
    low_balance_threshold_centavos    BIGINT      NOT NULL DEFAULT 40000
                                                 CHECK (low_balance_threshold_centavos >= 0),
    updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                        TEXT
);

-- Preserve any platform defaults that were configured before this migration,
-- while retaining PHP 80 / PHP 400 if the legacy settings are absent.
INSERT INTO tenant_billing_configs (
    tenant_id, charge_per_upload_centavos, low_balance_threshold_centavos, updated_by
)
SELECT t.id,
       COALESCE((SELECT (value #>> '{}')::bigint FROM platform_settings
                  WHERE key = 'wallet.charge_per_upload_centavos'), 8000),
       COALESCE((SELECT (value #>> '{}')::bigint FROM platform_settings
                  WHERE key = 'wallet.low_balance_threshold_centavos'), 40000),
       'migration'
  FROM tenants t;

ALTER TABLE tenant_billing_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_billing_configs
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

-- The amount quoted when a submission is received is the amount eventually
-- charged if LTMS accepts it. A corrected REJECTED/DEAD resubmission refreshes
-- both fields because it is a new billing event.
ALTER TABLE submissions
    ADD COLUMN charge_snapshot_centavos BIGINT,
    ADD COLUMN price_snapshotted_at      TIMESTAMPTZ;

UPDATE submissions s
   SET charge_snapshot_centavos = COALESCE(
           (SELECT c.charge_per_upload_centavos
              FROM tenant_billing_configs c
             WHERE c.tenant_id = s.tenant_id),
           8000),
       price_snapshotted_at = s.created_at;

ALTER TABLE submissions
    ALTER COLUMN charge_snapshot_centavos SET DEFAULT 8000,
    ALTER COLUMN charge_snapshot_centavos SET NOT NULL,
    ALTER COLUMN price_snapshotted_at SET DEFAULT now(),
    ALTER COLUMN price_snapshotted_at SET NOT NULL,
    ADD CONSTRAINT submissions_charge_snapshot_check
        CHECK (charge_snapshot_centavos >= 0);
