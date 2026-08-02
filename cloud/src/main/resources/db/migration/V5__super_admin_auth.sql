-- ============================================================
-- V5: Super-admin authentication for the cloud operator portal
-- ============================================================
-- The portal is cross-tenant by design (it lists every center, issues
-- licenses, and renders the cross-center dashboard), so a super admin has
-- no single owning tenant.  RLS policies already allow this: every
-- tenant_isolation policy is
--     USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL)
-- and TenantContextFilter leaves app.tenant_id unset when the JWT carries a
-- null tenantId.  A null tenant therefore reads across all tenants, which is
-- the intended super-admin capability.

-- ── refresh_tokens: allow super-admin sessions ──────────────────────────
-- Center-user tokens keep pointing at users/tenants; super-admin tokens
-- carry super_admin_id instead and leave both nullable columns NULL.
ALTER TABLE refresh_tokens
    ALTER COLUMN user_id   DROP NOT NULL,
    ALTER COLUMN tenant_id DROP NOT NULL,
    ADD COLUMN super_admin_id UUID REFERENCES super_admin_users(id) ON DELETE CASCADE;

-- Exactly one subject per token.  This restores at row level the guarantee
-- the NOT NULL constraints used to give: a center token must still have both
-- user_id and tenant_id, so a bug cannot silently insert an untenanted
-- center session.
ALTER TABLE refresh_tokens
    ADD CONSTRAINT refresh_tokens_subject_check CHECK (
        (super_admin_id IS NULL AND user_id IS NOT NULL AND tenant_id IS NOT NULL)
        OR
        (super_admin_id IS NOT NULL AND user_id IS NULL AND tenant_id IS NULL)
    );

CREATE INDEX idx_refresh_tokens_super_admin ON refresh_tokens(super_admin_id);

-- RLS: the existing tenant_isolation policy on refresh_tokens compares
-- tenant_id = current_tenant_id(), which is never true for a NULL tenant_id.
-- Super-admin rows must stay reachable when app.tenant_id is unset (the
-- super-admin case) so refresh/revoke can find them.
DROP POLICY IF EXISTS tenant_isolation ON refresh_tokens;
CREATE POLICY tenant_isolation ON refresh_tokens
    USING (
        current_tenant_id() IS NULL
        OR (super_admin_id IS NULL AND tenant_id = current_tenant_id())
    );

-- ── Dev seed: portal super admin ────────────────────────────────────────
-- DEV/ACCREDITATION-DEMO SEED ONLY.
-- This password hash is committed to source control and will be present in
-- every environment that runs this migration.  Rotate or remove before any
-- production deployment.
--   email:    connect@lisensyago.ph
--   password: test12345!
INSERT INTO super_admin_users (email, password_hash)
VALUES (
    'connect@lisensyago.ph',
    '$2b$10$mrPeRu0GG3WpLFGqpzB/GupQBLq1.p.0d7Ql2fsDbWOs5k.A4/DO.'
)
ON CONFLICT (email) DO NOTHING;
