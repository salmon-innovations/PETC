-- Optional commercial rate negotiated for one center.
-- NULL means use wallet.charge_per_upload_centavos from platform settings.
ALTER TABLE tenants
    ADD COLUMN cec_charge_override_centavos BIGINT
        CHECK (cec_charge_override_centavos >= 0);

COMMENT ON COLUMN tenants.cec_charge_override_centavos IS
    'Per-accepted-CEC charge override in centavos; NULL inherits the platform default';

-- Freeze the commercial quote when the cloud receives a submission. Price
-- changes must never alter already queued, held, or retrying filings.
ALTER TABLE submissions
    ADD COLUMN charge_snapshot_centavos BIGINT,
    ADD COLUMN price_snapshotted_at TIMESTAMPTZ;

UPDATE submissions s
   SET charge_snapshot_centavos = COALESCE(
           (SELECT t.cec_charge_override_centavos
              FROM tenants t
             WHERE t.id = s.tenant_id),
           (SELECT (value #>> '{}')::bigint
              FROM platform_settings
             WHERE key = 'wallet.charge_per_upload_centavos'),
           8000),
       price_snapshotted_at = s.created_at;

ALTER TABLE submissions
    ALTER COLUMN charge_snapshot_centavos SET DEFAULT 8000,
    ALTER COLUMN charge_snapshot_centavos SET NOT NULL,
    ALTER COLUMN price_snapshotted_at SET DEFAULT now(),
    ALTER COLUMN price_snapshotted_at SET NOT NULL,
    ADD CONSTRAINT submissions_charge_snapshot_nonnegative
        CHECK (charge_snapshot_centavos >= 0);
