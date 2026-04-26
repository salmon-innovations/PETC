-- ============================================================
-- V1: Core cloud schema
-- ============================================================

-- ── Tenants (one row per emission testing center) ────────────────────────
CREATE TABLE tenants (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    active      BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Cloud users (super-admins and center-level operators for the portal) ──
CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        REFERENCES tenants(id),   -- NULL = super-admin
    email           TEXT        NOT NULL UNIQUE,
    password_hash   TEXT        NOT NULL,
    full_name       TEXT        NOT NULL,
    role            TEXT        NOT NULL DEFAULT 'operator', -- 'super_admin' | 'operator'
    active          BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Refresh tokens ────────────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN     NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Audit log ─────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
    id          BIGSERIAL   PRIMARY KEY,
    tenant_id   UUID        REFERENCES tenants(id),
    user_id     UUID        REFERENCES users(id),
    action      TEXT        NOT NULL,
    entity_type TEXT,
    entity_id   TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant ON audit_log(tenant_id, occurred_at DESC);

-- ── current_tenant_id() helper (used by RLS policies in V2) ─────────────
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.tenant_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── Seed: default super-admin (password = "admin" bcrypt hash) ───────────
-- Change this immediately in production!
INSERT INTO users (email, password_hash, full_name, role)
VALUES (
    'admin@petc.ph',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj0go7/H.G9.',
    'Super Admin',
    'super_admin'
);
