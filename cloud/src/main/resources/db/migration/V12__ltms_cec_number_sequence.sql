-- Center-generated CEC numbers must be unique across concurrent workers.
-- The OR portion is a per-center, per-Philippine-calendar-year sequence.
CREATE TABLE ltms_cec_number_sequences (
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    sequence_year   INTEGER     NOT NULL,
    last_value      BIGINT      NOT NULL CHECK (last_value > 0),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, sequence_year)
);

ALTER TABLE ltms_cec_number_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ltms_cec_number_sequences
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);
