-- ============================================================
-- V6: Prepaid wallet, immutable ledger, runtime platform settings
-- ============================================================
-- The cloud is the sole egress point to LTMS/IRDS (one whitelisted IP at LTO),
-- so it is also where per-filing billing is metered. Centers hold a prepaid
-- balance; each accepted CEC debits it.
--
-- Money is integer centavos everywhere. Never floating point.

-- ── BLOCKED submission state ────────────────────────────────────────────
-- Dispatch-time hold when the wallet cannot cover the charge. The upload is
-- still accepted (202) and the record is safe in the cloud; only the LTMS
-- filing waits.
ALTER TABLE submissions DROP CONSTRAINT submissions_state_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_state_check
    CHECK (state IN ('PENDING', 'IN_FLIGHT', 'ACCEPTED', 'REJECTED', 'DEAD', 'BLOCKED'));

ALTER TABLE submissions
    ADD COLUMN blocked_at        TIMESTAMPTZ,
    ADD COLUMN grace_released_at TIMESTAMPTZ,
    -- Counts acceptance EVENTS, not rows.
    --
    -- enqueue() upserts on (tenant_id, test_id) and resets REJECTED/DEAD back
    -- to PENDING on the SAME row, so a corrected resubmission is the same
    -- submission_id accepted a second time. Charging is per acceptance event,
    -- so the ledger's idempotency key must be (submission_id, acceptance_seq).
    -- Keyed on submission_id alone, the second legitimate charge would be
    -- silently swallowed as a duplicate.
    ADD COLUMN acceptance_seq    INT NOT NULL DEFAULT 0;

CREATE INDEX idx_submissions_blocked
    ON submissions(tenant_id, blocked_at) WHERE state = 'BLOCKED';

-- ── wallet_accounts: cached projection, NOT the source of truth ─────────
-- balance_centavos is always derivable as SUM(amount_centavos) over
-- wallet_ledger. It is materialised here only so the hot paths (dispatch
-- balance check every 2s, desktop status poll) are a single indexed read
-- rather than an aggregate. If the two ever disagree, the ledger wins and
-- the writer has a bug — see WalletService.recomputeBalance().
CREATE TABLE wallet_accounts (
    tenant_id        UUID        PRIMARY KEY REFERENCES tenants(id),
    balance_centavos BIGINT      NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── wallet_ledger: append-only ──────────────────────────────────────────
-- No UPDATE, no DELETE, ever. Corrections are expressed as a compensating
-- ADJUSTMENT row so the history of what was charged, when, and by whom stays
-- permanently reconstructible for billing disputes and accreditation review.
CREATE TABLE wallet_ledger (
    id              BIGSERIAL   PRIMARY KEY,
    tenant_id       UUID        NOT NULL REFERENCES tenants(id),
    entry_type      TEXT        NOT NULL
                                CHECK (entry_type IN ('TOPUP', 'CHARGE', 'ADJUSTMENT')),
    -- Signed, so balance is a plain SUM: TOPUP > 0, CHARGE < 0.
    amount_centavos BIGINT      NOT NULL CHECK (amount_centavos <> 0),
    balance_after   BIGINT      NOT NULL,
    submission_id   UUID        REFERENCES submissions(id),
    acceptance_seq  INT,
    -- Super admin email for TOPUP/ADJUSTMENT; 'system' for scheduler CHARGEs.
    created_by      TEXT,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Sign must match the type, so a CHARGE can never accidentally credit.
    CONSTRAINT wallet_ledger_sign_check CHECK (
        (entry_type = 'TOPUP' AND amount_centavos > 0)
        OR (entry_type = 'CHARGE' AND amount_centavos < 0)
        OR (entry_type = 'ADJUSTMENT')
    ),
    -- Every charge is attributable to one acceptance event.
    CONSTRAINT wallet_ledger_charge_ref_check CHECK (
        entry_type <> 'CHARGE'
        OR (submission_id IS NOT NULL AND acceptance_seq IS NOT NULL)
    )
);

-- The double-charge guard. One charge per acceptance EVENT: resubmitting a
-- rejected test and having it accepted again DOES charge again (different
-- acceptance_seq), but a retry of the same acceptance cannot.
CREATE UNIQUE INDEX idx_wallet_ledger_charge_once
    ON wallet_ledger(submission_id, acceptance_seq) WHERE entry_type = 'CHARGE';

CREATE INDEX idx_wallet_ledger_tenant_time ON wallet_ledger(tenant_id, created_at DESC);

-- Append-only enforced by the database, not merely by convention in the
-- service layer.
CREATE RULE wallet_ledger_no_update AS ON UPDATE TO wallet_ledger DO INSTEAD NOTHING;
CREATE RULE wallet_ledger_no_delete AS ON DELETE TO wallet_ledger DO INSTEAD NOTHING;

-- ── platform_settings: runtime-mutable, platform-wide ───────────────────
-- JSONB so the backoff ladder is a real array rather than a parsed string.
-- Deliberately not tenant-scoped: these are platform settings, so no RLS.
CREATE TABLE platform_settings (
    key        TEXT        PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT
);

INSERT INTO platform_settings (key, value, updated_by) VALUES
    -- PHP 80.00 per accepted CEC.
    ('wallet.charge_per_upload_centavos',     '8000'::jsonb,          'system'),
    -- Warn the center below PHP 400.00 (five uploads).
    ('wallet.low_balance_threshold_centavos', '40000'::jsonb,         'system'),
    -- DO 2023-008 escape hatch: force-dispatch a held submission after 2h.
    ('wallet.grace_release_minutes',          '120'::jsonb,           'system'),
    -- Grace release stops below PHP -5,000.00 of debt. Below this the hold
    -- stands and the dashboard escalates for commercial follow-up.
    ('wallet.debt_floor_centavos',            '-500000'::jsonb,       'system'),
    ('submission.max_attempts',               '5'::jsonb,             'system'),
    ('submission.backoff_seconds',            '[5,15,60,300,900]'::jsonb, 'system');

-- ── RLS, mirroring the existing tenant_isolation pattern ────────────────
-- NOTE: the submission job runner and every center-key request run with
-- app.tenant_id UNSET, so current_tenant_id() is NULL and these policies are
-- permissive for them by design. Wallet access on those paths MUST carry an
-- explicit tenant_id predicate — RLS is defence in depth here, not the
-- control. See SubmissionService.getStatus().
ALTER TABLE wallet_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wallet_accounts
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wallet_ledger
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

-- ── audit_log: allow super-admin and system actors ──────────────────────
-- Super admins live in super_admin_users, not users, so the existing user_id
-- FK cannot represent them. Add a parallel nullable FK rather than widening
-- user_id, which keeps the center-user FK's referential guarantee intact.
-- Scheduler-written rows (CHARGE, BLOCKED, GRACE_RELEASED) have no human
-- actor at all: both FKs NULL, actor_label = 'system'.
ALTER TABLE audit_log
    ADD COLUMN super_admin_id UUID REFERENCES super_admin_users(id),
    ADD COLUMN actor_label    TEXT;
