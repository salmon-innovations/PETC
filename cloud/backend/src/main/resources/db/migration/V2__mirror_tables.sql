-- ============================================================
-- V2: Cloud-side mirror tables (read-only copies from desktop)
-- Desktop is canonical; cloud never writes back to these.
-- ============================================================

CREATE TABLE mirror_emission_tests (
    id              TEXT        PRIMARY KEY,
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    session_token   TEXT        NOT NULL,
    fuel_type       TEXT        NOT NULL,
    pass_fail       BOOLEAN,
    serial_no       TEXT,
    captured_at     TIMESTAMPTZ,
    raw_hex         TEXT,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mirror_ltms_submissions (
    id              TEXT        PRIMARY KEY,
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    test_id         TEXT        NOT NULL REFERENCES mirror_emission_tests(id),
    state           TEXT        NOT NULL,
    certificate_no  TEXT,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mirror_tests_tenant   ON mirror_emission_tests(tenant_id, captured_at DESC);
CREATE INDEX idx_mirror_ltms_tenant    ON mirror_ltms_submissions(tenant_id, state);

ALTER TABLE mirror_emission_tests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mirror_ltms_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON mirror_emission_tests
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON mirror_ltms_submissions
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

-- ── Licensing table ──────────────────────────────────────────────────────
CREATE TABLE licenses (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id),
    center_name TEXT        NOT NULL,
    key_hash    TEXT        NOT NULL UNIQUE,   -- sha256 of the raw API key
    active      BOOLEAN     NOT NULL DEFAULT true,
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ
);

-- ── Update channels ──────────────────────────────────────────────────────
CREATE TABLE update_channels (
    id          SERIAL      PRIMARY KEY,
    channel     TEXT        NOT NULL UNIQUE,   -- 'stable' | 'beta'
    version     TEXT        NOT NULL,
    base_url    TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO update_channels(channel, version, base_url)
VALUES ('stable', '0.1.0', 'https://releases.example.com/petc');
