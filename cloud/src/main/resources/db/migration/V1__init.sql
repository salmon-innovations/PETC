-- ============================================================
-- V1: Schema init with Row-Level Security for multi-tenancy
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Cross-tenant tables (no tenant_id)
-- ────────────────────────────────────────────────────────────
CREATE TABLE tenants (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_configs (
    tenant_id       UUID        PRIMARY KEY REFERENCES tenants(id),
    analyzer_brand  TEXT,
    printer_type    TEXT        NOT NULL DEFAULT 'escpos',
    agent_port      INT         NOT NULL DEFAULT 8765,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE super_admin_users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT        NOT NULL UNIQUE,
    password_hash   TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- Tenant-scoped tables
-- All have tenant_id; RLS enforced below.
-- ────────────────────────────────────────────────────────────
CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    email           TEXT        NOT NULL,
    password_hash   TEXT        NOT NULL,
    full_name       TEXT        NOT NULL,
    active          BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

CREATE TABLE roles (
    id          SERIAL      PRIMARY KEY,
    name        TEXT        NOT NULL UNIQUE   -- operator, cashier, manager, tenant_admin
);
INSERT INTO roles(name) VALUES ('operator'), ('cashier'), ('manager'), ('tenant_admin');

CREATE TABLE user_roles (
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     INT         NOT NULL REFERENCES roles(id),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE refresh_tokens (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id   UUID        NOT NULL REFERENCES tenants(id),
    token_hash  TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN     NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vehicles_cache (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    plate_number    TEXT        NOT NULL,
    make            TEXT,
    model           TEXT,
    year            INT,
    fuel_type       TEXT,       -- GAS | DIESEL
    engine_no       TEXT,
    chassis_no      TEXT,
    owner_name      TEXT,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',
    UNIQUE (tenant_id, plate_number)
);

CREATE TABLE drivers_cache (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    license_no      TEXT        NOT NULL,
    full_name       TEXT,
    license_type    TEXT,
    expiry_date     DATE,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',
    UNIQUE (tenant_id, license_no)
);

CREATE TABLE emission_tests (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    operator_id     UUID        NOT NULL REFERENCES users(id),
    plate_number    TEXT        NOT NULL,
    fuel_type       TEXT        NOT NULL CHECK (fuel_type IN ('GAS', 'DIESEL')),
    pass_fail       BOOLEAN,
    session_token   TEXT        NOT NULL,
    analyzer_serial TEXT,
    raw_bytes       BYTEA,
    tested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_at     TIMESTAMPTZ
);

CREATE TABLE gas_test_results (
    test_id         UUID        PRIMARY KEY REFERENCES emission_tests(id),
    co_pct          NUMERIC(6,3),
    hc_ppm          NUMERIC(8,2),
    co2_pct         NUMERIC(6,3),
    o2_pct          NUMERIC(6,3),
    lambda_value    NUMERIC(6,4),
    rpm             INT,
    oil_temp_c      NUMERIC(5,1)
);

CREATE TABLE diesel_test_results (
    test_id         UUID        PRIMARY KEY REFERENCES emission_tests(id),
    opacity_pct     NUMERIC(5,2),
    k_value         NUMERIC(6,4),
    rpm             INT,
    boost_kpa       NUMERIC(7,2)
);

CREATE TABLE test_photos (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id         UUID        NOT NULL REFERENCES emission_tests(id),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    s3_key          TEXT        NOT NULL,
    mime_type       TEXT        NOT NULL DEFAULT 'image/jpeg',
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ltms_submissions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id         UUID        NOT NULL REFERENCES emission_tests(id),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    state           TEXT        NOT NULL DEFAULT 'PENDING'
                                CHECK (state IN ('PENDING','UPLOADING','ACCEPTED','REJECTED')),
    certificate_no  TEXT,
    submitted_at    TIMESTAMPTZ,
    accepted_at     TIMESTAMPTZ,
    last_error      TEXT,
    attempts        INT         NOT NULL DEFAULT 0
);

CREATE TABLE receipts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id         UUID        NOT NULL REFERENCES emission_tests(id),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    copy_count      INT         NOT NULL DEFAULT 2,
    printed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gov_outbox (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    event_type      TEXT        NOT NULL,
    payload         JSONB       NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'PENDING'
                                CHECK (status IN ('PENDING','IN_FLIGHT','DONE','DEAD')),
    attempts        INT         NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_retry      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error      TEXT,
    response        JSONB
);

CREATE TABLE audit_log (
    id              BIGSERIAL   PRIMARY KEY,
    tenant_id       UUID        REFERENCES tenants(id),
    user_id         UUID        REFERENCES users(id),
    action          TEXT        NOT NULL,
    entity_type     TEXT,
    entity_id       TEXT,
    detail          JSONB,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- Indexes
-- ────────────────────────────────────────────────────────────
CREATE INDEX idx_emission_tests_tenant_plate ON emission_tests(tenant_id, plate_number);
CREATE INDEX idx_emission_tests_tenant_date  ON emission_tests(tenant_id, tested_at DESC);
CREATE INDEX idx_ltms_submissions_state      ON ltms_submissions(state, tenant_id);
CREATE INDEX idx_gov_outbox_retry            ON gov_outbox(status, next_retry);
CREATE INDEX idx_audit_log_tenant_time       ON audit_log(tenant_id, occurred_at DESC);

-- ────────────────────────────────────────────────────────────
-- Row-Level Security
-- The app sets: SET LOCAL app.tenant_id = '<uuid>'
-- at the start of every request (see TenantContextFilter).
-- ────────────────────────────────────────────────────────────
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles_cache   ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers_cache    ENABLE ROW LEVEL SECURITY;
ALTER TABLE emission_tests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE gas_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE diesel_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_photos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ltms_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_outbox       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log        ENABLE ROW LEVEL SECURITY;

-- Helper: current tenant from session config, returns NULL if unset
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID
    LANGUAGE sql STABLE
AS $$
    SELECT NULLIF(current_setting('app.tenant_id', true), '')::UUID;
$$;

-- Macro to create the tenant-isolation policy on any table
-- Each table gets a USING clause that short-circuits for superuser (migrations)
CREATE POLICY tenant_isolation ON users
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON refresh_tokens
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON vehicles_cache
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON drivers_cache
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON emission_tests
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

-- gas/diesel result tables join through emission_tests; policy mirrors parent
CREATE POLICY tenant_isolation ON gas_test_results
    USING (
        test_id IN (
            SELECT id FROM emission_tests
            WHERE tenant_id = current_tenant_id() OR current_tenant_id() IS NULL
        )
    );

CREATE POLICY tenant_isolation ON diesel_test_results
    USING (
        test_id IN (
            SELECT id FROM emission_tests
            WHERE tenant_id = current_tenant_id() OR current_tenant_id() IS NULL
        )
    );

CREATE POLICY tenant_isolation ON test_photos
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON ltms_submissions
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON receipts
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON gov_outbox
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

CREATE POLICY tenant_isolation ON audit_log
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);
