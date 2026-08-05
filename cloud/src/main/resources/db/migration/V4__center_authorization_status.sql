-- ============================================================
-- V4: DOTr DO 2023-008 PETC authorization status enforcement
-- ============================================================

ALTER TABLE center_licenses
    ADD COLUMN authorization_status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (authorization_status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
    ADD COLUMN authorization_expires_at TIMESTAMPTZ,
    ADD COLUMN suspended_at TIMESTAMPTZ,
    ADD COLUMN revoked_at TIMESTAMPTZ,
    ADD COLUMN status_reason TEXT;

CREATE INDEX idx_center_licenses_authorization_status
    ON center_licenses(authorization_status, authorization_expires_at);
