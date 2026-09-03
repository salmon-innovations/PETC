-- ============================================================
-- V15: Prepaid PayMongo top-ups + semi-monthly postpaid billing
-- ============================================================
-- Existing centers and queued submissions remain PREPAID. Money is always
-- integer centavos and every external payment / accepted CEC has a database
-- uniqueness guard so retries cannot duplicate accounting entries.

CREATE TABLE billing_profiles (
    tenant_id                  UUID        PRIMARY KEY REFERENCES tenants(id),
    mode                       TEXT        NOT NULL DEFAULT 'PREPAID'
                                          CHECK (mode IN ('PREPAID', 'POSTPAID')),
    revision                   BIGINT      NOT NULL DEFAULT 1 CHECK (revision > 0),
    timezone                   TEXT        NOT NULL DEFAULT 'Asia/Manila',
    payment_terms_days         INT         NOT NULL DEFAULT 7
                                          CHECK (payment_terms_days BETWEEN 0 AND 365),
    credit_limit_centavos      BIGINT,
    effective_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                 TEXT
);

INSERT INTO billing_profiles (tenant_id, updated_by)
SELECT id, 'migration-v15' FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE submissions
    ADD COLUMN billing_mode_snapshot TEXT NOT NULL DEFAULT 'PREPAID'
        CHECK (billing_mode_snapshot IN ('PREPAID', 'POSTPAID')),
    ADD COLUMN billing_profile_revision BIGINT NOT NULL DEFAULT 1;

CREATE TABLE billing_invoices (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID        NOT NULL REFERENCES tenants(id),
    invoice_number          TEXT        NOT NULL UNIQUE,
    period_start            TIMESTAMPTZ NOT NULL,
    period_end              TIMESTAMPTZ NOT NULL,
    issued_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_at                  TIMESTAMPTZ NOT NULL,
    subtotal_centavos       BIGINT      NOT NULL DEFAULT 0 CHECK (subtotal_centavos >= 0),
    adjustment_centavos     BIGINT      NOT NULL DEFAULT 0,
    total_centavos          BIGINT      NOT NULL DEFAULT 0 CHECK (total_centavos >= 0),
    amount_paid_centavos    BIGINT      NOT NULL DEFAULT 0 CHECK (amount_paid_centavos >= 0),
    status                  TEXT        NOT NULL DEFAULT 'OPEN'
                                        CHECK (status IN ('OPEN','PARTIALLY_PAID','PAID','PAST_DUE','VOID')),
    center_name_snapshot    TEXT        NOT NULL,
    billing_timezone        TEXT        NOT NULL DEFAULT 'Asia/Manila',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_end > period_start),
    UNIQUE (tenant_id, period_start, period_end)
);

CREATE TABLE billing_invoice_lines (
    id                  BIGSERIAL   PRIMARY KEY,
    invoice_id          UUID        NOT NULL REFERENCES billing_invoices(id),
    description         TEXT        NOT NULL,
    quantity            INT         NOT NULL CHECK (quantity >= 0),
    unit_amount_centavos BIGINT,
    amount_centavos     BIGINT      NOT NULL CHECK (amount_centavos >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE billing_payments (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenants(id),
    invoice_id          UUID        NOT NULL REFERENCES billing_invoices(id),
    amount_centavos     BIGINT      NOT NULL CHECK (amount_centavos > 0),
    method              TEXT        NOT NULL,
    external_reference  TEXT        NOT NULL,
    recorded_by         TEXT        NOT NULL,
    paid_at             TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, external_reference)
);

CREATE TABLE billing_usage (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenants(id),
    submission_id       UUID        NOT NULL REFERENCES submissions(id),
    acceptance_seq      INT         NOT NULL CHECK (acceptance_seq > 0),
    billing_mode        TEXT        NOT NULL CHECK (billing_mode IN ('PREPAID','POSTPAID')),
    amount_centavos     BIGINT      NOT NULL CHECK (amount_centavos >= 0),
    accepted_at         TIMESTAMPTZ NOT NULL,
    invoice_id          UUID        REFERENCES billing_invoices(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (submission_id, acceptance_seq)
);

CREATE TABLE payment_topups (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID        NOT NULL REFERENCES tenants(id),
    client_request_id           UUID        NOT NULL,
    provider                    TEXT        NOT NULL DEFAULT 'PAYMONGO',
    provider_payment_intent_id  TEXT        UNIQUE,
    provider_payment_method_id  TEXT,
    provider_payment_id         TEXT        UNIQUE,
    create_idempotency_key      TEXT        NOT NULL UNIQUE,
    amount_centavos             BIGINT      NOT NULL CHECK (amount_centavos > 0),
    currency                    TEXT        NOT NULL DEFAULT 'PHP' CHECK (currency = 'PHP'),
    status                      TEXT        NOT NULL DEFAULT 'CREATING'
                                            CHECK (status IN ('CREATING','AWAITING_PAYMENT','PAID','EXPIRED','FAILED','CANCELLED')),
    livemode                    BOOLEAN,
    qr_image                    TEXT,
    test_url                    TEXT,
    expires_at                  TIMESTAMPTZ,
    paid_at                     TIMESTAMPTZ,
    failure_code                TEXT,
    failure_message             TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, client_request_id)
);

CREATE TABLE payment_webhook_events (
    provider_event_id   TEXT        PRIMARY KEY,
    event_type          TEXT        NOT NULL,
    livemode            BOOLEAN     NOT NULL,
    processing_status   TEXT        NOT NULL DEFAULT 'RECEIVED'
                                    CHECK (processing_status IN ('RECEIVED','PROCESSING','PROCESSED','IGNORED','FAILED')),
    payload_hash        TEXT        NOT NULL,
    raw_payload         JSONB       NOT NULL,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at          TIMESTAMPTZ,
    processed_at        TIMESTAMPTZ,
    last_error          TEXT
);

ALTER TABLE wallet_ledger
    ADD COLUMN provider TEXT,
    ADD COLUMN external_reference TEXT;

CREATE UNIQUE INDEX idx_wallet_ledger_external_topup_once
    ON wallet_ledger(provider, external_reference)
    WHERE entry_type = 'TOPUP' AND external_reference IS NOT NULL;

CREATE INDEX idx_billing_usage_uninvoiced
    ON billing_usage(tenant_id, accepted_at)
    WHERE billing_mode = 'POSTPAID' AND invoice_id IS NULL;
CREATE INDEX idx_billing_invoices_tenant_status
    ON billing_invoices(tenant_id, status, due_at DESC);
CREATE INDEX idx_billing_payments_invoice
    ON billing_payments(invoice_id, paid_at);
CREATE INDEX idx_payment_topups_tenant_time
    ON payment_topups(tenant_id, created_at DESC);
CREATE INDEX idx_payment_topups_reconcile
    ON payment_topups(updated_at)
    WHERE status IN ('CREATING', 'AWAITING_PAYMENT');
CREATE INDEX idx_payment_webhook_unprocessed
    ON payment_webhook_events(received_at)
    WHERE processing_status = 'RECEIVED';

ALTER TABLE billing_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_profiles
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_invoices
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

ALTER TABLE billing_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_invoice_lines
    USING (invoice_id IN (
        SELECT id FROM billing_invoices
         WHERE tenant_id = current_tenant_id() OR current_tenant_id() IS NULL
    ));

ALTER TABLE billing_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_payments
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

ALTER TABLE billing_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_usage
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);

ALTER TABLE payment_topups ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_topups
    USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);
