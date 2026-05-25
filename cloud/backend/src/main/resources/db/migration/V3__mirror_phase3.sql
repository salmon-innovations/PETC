-- ============================================================
-- V3: Richer desktop mirror support for Phase 3
-- ============================================================

ALTER TABLE mirror_emission_tests
    ADD COLUMN IF NOT EXISTS plate_number    TEXT,
    ADD COLUMN IF NOT EXISTS started_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS readings_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS photo_count     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_event_type TEXT,
    ADD COLUMN IF NOT EXISTS last_event_at   TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE mirror_ltms_submissions
    ADD COLUMN IF NOT EXISTS payload_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS submitted_at     TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS mirror_events (
    id           BIGSERIAL   PRIMARY KEY,
    tenant_id    UUID        NOT NULL REFERENCES tenants(id),
    center_id    TEXT        NOT NULL,
    entity_type  TEXT        NOT NULL,
    entity_id    TEXT        NOT NULL,
    payload_json JSONB       NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mirror_test_photos (
    id           TEXT        PRIMARY KEY,
    tenant_id    UUID        NOT NULL REFERENCES tenants(id),
    test_id      TEXT        NOT NULL REFERENCES mirror_emission_tests(id),
    photo_type   TEXT        NOT NULL,
    file_path    TEXT        NOT NULL,
    s3_key       TEXT,
    captured_at  TIMESTAMPTZ,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mirror_events_tenant_received
    ON mirror_events(tenant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_mirror_events_entity
    ON mirror_events(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_mirror_photos_test
    ON mirror_test_photos(test_id);

ALTER TABLE mirror_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mirror_test_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON mirror_events;
CREATE POLICY tenant_isolation ON mirror_events
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

DROP POLICY IF EXISTS tenant_isolation ON mirror_test_photos;
CREATE POLICY tenant_isolation ON mirror_test_photos
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);
