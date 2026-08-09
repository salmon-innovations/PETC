-- ============================================================
-- V9: Per-center LTMS identity and secret-reference provisioning
-- ============================================================
-- LTMS passwords and JWTs are deliberately absent from this schema.  The
-- password_secret_ref points to the cloud task role's secret store entry; it
-- is not a credential and must not be returned to desktop clients or audits.

CREATE TABLE ltms_center_configs (
    tenant_id                           UUID        PRIMARY KEY REFERENCES tenants(id),
    center_id                           TEXT        NOT NULL,
    ltms_username                       TEXT        NOT NULL,
    ltms_business_id                    TEXT        NOT NULL,
    petc_code                           TEXT        NOT NULL,
    password_secret_ref                 TEXT        NOT NULL,
    environment                         TEXT        NOT NULL
                                                CHECK (environment IN ('QA', 'PRODUCTION')),
    enabled                             BOOLEAN     NOT NULL DEFAULT false,
    credential_verification_state       TEXT        NOT NULL DEFAULT 'UNVERIFIED'
                                                CHECK (credential_verification_state IN (
                                                    'UNVERIFIED',
                                                    'VERIFIED',
                                                    'INVALID_CREDENTIALS',
                                                    'ACCOUNT_LOCKED',
                                                    'MISSING_PRIVILEGE'
                                                )),
    credential_verified_at              TIMESTAMPTZ,
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ltms_center_configs_nonempty_fields CHECK (
        btrim(center_id) <> ''
        AND btrim(ltms_username) <> ''
        AND btrim(ltms_business_id) <> ''
        AND btrim(petc_code) <> ''
        AND btrim(password_secret_ref) <> ''
    )
);

CREATE UNIQUE INDEX idx_ltms_center_configs_center_id
    ON ltms_center_configs(center_id);
CREATE INDEX idx_ltms_center_configs_enabled
    ON ltms_center_configs(environment, enabled) WHERE enabled = true;

-- Configuration is tenant-scoped.  Center-key code must still query with its
-- validated tenant and center IDs because that path carries no JWT/RLS context.
ALTER TABLE ltms_center_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ltms_center_configs
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);
