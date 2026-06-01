-- ============================================================
-- V2: Cloud-mediated LTMS submissions + center API key licenses
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Center API keys — one per tenant, bcrypt-hashed
-- ────────────────────────────────────────────────────────────
CREATE TABLE center_licenses (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id),
    key_hash    TEXT        NOT NULL,
    center_id   TEXT        NOT NULL,
    active      BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_center_licenses_tenant_active
    ON center_licenses(tenant_id) WHERE active = true;
CREATE INDEX idx_center_licenses_active ON center_licenses(active);

-- ────────────────────────────────────────────────────────────
-- Cloud-side submissions queue
-- Desktop pushes a bundle here; SubmissionJobRunner calls LTMS.
-- ────────────────────────────────────────────────────────────
CREATE TABLE submissions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    center_id       TEXT        NOT NULL,
    test_id         TEXT        NOT NULL,
    payload         JSONB       NOT NULL,
    state           TEXT        NOT NULL DEFAULT 'PENDING'
                                CHECK (state IN ('PENDING','IN_FLIGHT','ACCEPTED','REJECTED','DEAD')),
    certificate_no  TEXT,
    ltms_ref_no     TEXT,
    rejection_reason TEXT,
    attempts        INT         NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_attempt_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at     TIMESTAMPTZ,
    UNIQUE (tenant_id, test_id)
);

CREATE INDEX idx_submissions_pending
    ON submissions(state, next_attempt_at)
    WHERE state IN ('PENDING', 'IN_FLIGHT');

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON submissions
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);
