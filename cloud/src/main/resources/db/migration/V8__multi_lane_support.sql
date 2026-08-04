-- ============================================================
-- V8: Multiple independently credentialed lanes per PETC center
-- ============================================================
-- A tenant remains the center-level commercial boundary (authorization,
-- wallet and price).  A lane is the independently operated desktop endpoint.

CREATE TABLE center_authorizations (
    tenant_id                   UUID PRIMARY KEY REFERENCES tenants(id),
    authorization_status        TEXT NOT NULL DEFAULT 'ACTIVE'
                                CHECK (authorization_status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
    authorization_expires_at    TIMESTAMPTZ,
    suspended_at                TIMESTAMPTZ,
    revoked_at                  TIMESTAMPTZ,
    status_reason               TEXT,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing status used to live on the (single) API credential.  Preserve the
-- most recently issued credential's status as the center-wide authorization.
INSERT INTO center_authorizations (
    tenant_id, authorization_status, authorization_expires_at,
    suspended_at, revoked_at, status_reason
)
SELECT DISTINCT ON (tenant_id)
       tenant_id, authorization_status, authorization_expires_at,
       suspended_at, revoked_at, status_reason
  FROM center_licenses
 ORDER BY tenant_id, active DESC, created_at DESC
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO center_authorizations (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE TABLE lanes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    lane_number         INT NOT NULL CHECK (lane_number > 0),
    active              BOOLEAN NOT NULL DEFAULT true,
    daily_upload_limit  INT NOT NULL DEFAULT 80 CHECK (daily_upload_limit >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, lane_number)
);

-- Every existing center becomes Lane 1.  This keeps historical submissions
-- and installed desktops working without an immediate re-provisioning event.
INSERT INTO lanes (tenant_id, lane_number)
SELECT id, 1 FROM tenants
ON CONFLICT (tenant_id, lane_number) DO NOTHING;

CREATE TABLE lane_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lane_id         UUID NOT NULL REFERENCES lanes(id),
    key_hash        TEXT NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ
);

-- Keep legacy inactive rows as audit history, but only the currently active
-- center credential becomes the active Lane 1 credential.
INSERT INTO lane_credentials (lane_id, key_hash, active, created_at, revoked_at)
SELECT l.id, cl.key_hash, cl.active, cl.created_at,
       CASE WHEN cl.active THEN NULL ELSE cl.created_at END
  FROM center_licenses cl
  JOIN lanes l ON l.tenant_id = cl.tenant_id AND l.lane_number = 1;

CREATE UNIQUE INDEX idx_lane_credentials_one_active
    ON lane_credentials(lane_id) WHERE active = true;
CREATE INDEX idx_lane_credentials_active ON lane_credentials(active);
CREATE INDEX idx_lanes_tenant_active ON lanes(tenant_id, active);

ALTER TABLE submissions ADD COLUMN lane_id UUID REFERENCES lanes(id);
UPDATE submissions s
   SET lane_id = l.id
  FROM lanes l
 WHERE l.tenant_id = s.tenant_id AND l.lane_number = 1;
ALTER TABLE submissions ALTER COLUMN lane_id SET NOT NULL;

-- Test IDs originate at independent lane desktops, so their idempotency
-- boundary is a lane rather than the whole center.
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_tenant_id_test_id_key;
ALTER TABLE submissions ADD CONSTRAINT submissions_lane_test_key UNIQUE (lane_id, test_id);
CREATE INDEX idx_submissions_lane_created ON submissions(lane_id, created_at DESC);

-- One daily row is locked when a reservation is made/finalized.  Reservations
-- ensure concurrent or in-flight LTMS requests cannot exceed the cap even
-- though only an LTMS ACCEPTED CEC consumes it.
CREATE TABLE lane_daily_quota (
    lane_id             UUID NOT NULL REFERENCES lanes(id),
    business_date       DATE NOT NULL,
    accepted_count      INT NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
    reserved_count      INT NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
    limit_snapshot      INT NOT NULL CHECK (limit_snapshot >= 0),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lane_id, business_date),
    CHECK (accepted_count + reserved_count <= limit_snapshot)
);

CREATE TABLE submission_quota_reservations (
    submission_id       UUID PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
    lane_id             UUID NOT NULL REFERENCES lanes(id),
    business_date       DATE NOT NULL,
    state               TEXT NOT NULL CHECK (state IN ('RESERVED', 'CONSUMED', 'RELEASED')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalized_at        TIMESTAMPTZ,
    UNIQUE (lane_id, business_date, submission_id)
);
CREATE INDEX idx_submission_quota_reservations_lane_day
    ON submission_quota_reservations(lane_id, business_date);

-- Do not grant an existing center a fresh 80 slots when this migration is
-- deployed mid-day.  Historic daily rows are intentionally not reconstructed:
-- only today's live operational limit needs to be carried forward.
INSERT INTO lane_daily_quota (lane_id, business_date, accepted_count, reserved_count, limit_snapshot)
SELECT l.id,
       (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date,
       count(s.id) FILTER (
           WHERE s.state = 'ACCEPTED'
             AND (s.accepted_at AT TIME ZONE 'Asia/Manila')::date =
                 (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
       )::int,
       count(s.id) FILTER (WHERE s.state IN ('PENDING', 'IN_FLIGHT', 'BLOCKED'))::int,
       GREATEST(l.daily_upload_limit, count(s.id) FILTER (
           WHERE s.state = 'ACCEPTED'
             AND (s.accepted_at AT TIME ZONE 'Asia/Manila')::date =
                 (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
       )::int + count(s.id) FILTER (WHERE s.state IN ('PENDING', 'IN_FLIGHT', 'BLOCKED'))::int,
       count(s.id) FILTER (
           WHERE s.state = 'ACCEPTED'
             AND (s.accepted_at AT TIME ZONE 'Asia/Manila')::date =
                 (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
       )::int)
  FROM lanes l
  LEFT JOIN submissions s ON s.lane_id = l.id
 GROUP BY l.id, l.daily_upload_limit
ON CONFLICT (lane_id, business_date) DO NOTHING;

-- Existing non-terminal work must reserve capacity before the new worker can
-- finalize it. This migration runs once, so it also repairs the invariant that
-- every dispatchable submission owns exactly one reservation.
INSERT INTO submission_quota_reservations (submission_id, lane_id, business_date, state)
SELECT s.id, s.lane_id, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, 'RESERVED'
  FROM submissions s
 WHERE s.state IN ('PENDING', 'IN_FLIGHT', 'BLOCKED')
ON CONFLICT (submission_id) DO NOTHING;

-- The original local-photo metadata is retained for auditability; new S3
-- presigns are lane-prefixed below in the application layer.
ALTER TABLE test_photos ADD COLUMN IF NOT EXISTS lane_id UUID REFERENCES lanes(id);
UPDATE test_photos p SET lane_id = l.id
  FROM lanes l WHERE l.tenant_id = p.tenant_id AND l.lane_number = 1 AND p.lane_id IS NULL;
ALTER TABLE test_photos ALTER COLUMN lane_id SET NOT NULL;
CREATE INDEX idx_test_photos_lane ON test_photos(lane_id);

-- All lane tables are tenant-contained.  As with the original tables, code
-- on the center-key path always carries explicit tenant/lane predicates.
ALTER TABLE lanes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lanes
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);
ALTER TABLE center_authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON center_authorizations
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);
ALTER TABLE lane_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lane_credentials
    USING (lane_id IN (SELECT id FROM lanes WHERE tenant_id = current_tenant_id())
           OR current_tenant_id() IS NULL);
ALTER TABLE lane_daily_quota ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lane_daily_quota
    USING (lane_id IN (SELECT id FROM lanes WHERE tenant_id = current_tenant_id())
           OR current_tenant_id() IS NULL);
ALTER TABLE submission_quota_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON submission_quota_reservations
    USING (lane_id IN (SELECT id FROM lanes WHERE tenant_id = current_tenant_id())
           OR current_tenant_id() IS NULL);
