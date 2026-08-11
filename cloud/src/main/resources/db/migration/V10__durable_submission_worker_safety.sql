-- Durable LTMS submission workflow. V7 and V8 are reserved by the center
-- pricing and multi-lane migrations; V9 contains LTMS center configuration.

ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_state_check;
ALTER TABLE submissions
    ADD CONSTRAINT submissions_state_check CHECK (state IN (
        -- Legacy values are retained so existing rows and API consumers remain readable.
        'PENDING', 'IN_FLIGHT', 'ACCEPTED', 'REJECTED', 'BLOCKED', 'DEAD',
        -- LTMS v2 outcomes.
        'RECONCILING', 'PASSED', 'FAILED_EVALUATION', 'ACTION_REQUIRED',
        'DEFERRED', 'AUTH_BLOCKED'
    ));

ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS operation                    TEXT NOT NULL DEFAULT 'UPLOAD'
                                                        CHECK (operation IN ('UPLOAD', 'REPLACEMENT')),
    ADD COLUMN IF NOT EXISTS cec_number                   TEXT,
    ADD COLUMN IF NOT EXISTS ltms_inbox_id                TEXT,
    ADD COLUMN IF NOT EXISTS ltms_evaluation              TEXT,
    ADD COLUMN IF NOT EXISTS ltms_expiry_date             TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ltms_error_code              INTEGER,
    ADD COLUMN IF NOT EXISTS ltms_error_message           TEXT,
    ADD COLUMN IF NOT EXISTS ltms_reasons                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS next_permitted_action_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reconciliation_status        TEXT NOT NULL DEFAULT 'NOT_REQUIRED'
                                                        CHECK (reconciliation_status IN
                                                            ('NOT_REQUIRED', 'REQUIRED', 'IN_PROGRESS', 'RESOLVED')),
    ADD COLUMN IF NOT EXISTS claim_lease_until            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS claimed_at                   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS attempt_sequence             INT NOT NULL DEFAULT 0;

-- An attempt captures the exact queued request at claim time.  Its request
-- snapshot is never sourced from the mutable submissions.payload column.
CREATE TABLE IF NOT EXISTS submission_attempts (
    id                  BIGSERIAL PRIMARY KEY,
    submission_id       UUID NOT NULL REFERENCES submissions(id),
    attempt_no          INT NOT NULL,
    operation           TEXT NOT NULL CHECK (operation IN ('UPLOAD', 'REPLACEMENT')),
    request_payload     JSONB NOT NULL,
    state               TEXT NOT NULL,
    ltms_inbox_id       TEXT,
    ltms_error_code     INTEGER,
    ltms_error_message  TEXT,
    response_payload    JSONB,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    UNIQUE (submission_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_submissions_dispatch_due
    ON submissions(next_attempt_at, id)
    WHERE state IN ('PENDING', 'DEFERRED');
CREATE INDEX IF NOT EXISTS idx_submissions_in_flight_lease
    ON submissions(claim_lease_until)
    WHERE state = 'IN_FLIGHT';
CREATE INDEX IF NOT EXISTS idx_submission_attempts_submission
    ON submission_attempts(submission_id, attempt_no DESC);

-- The captured request is evidence, not a working buffer.  An attempt may be
-- completed once, but neither its request snapshot nor any completed attempt
-- can be changed or deleted afterwards.
CREATE OR REPLACE FUNCTION guard_submission_attempt_history()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'submission attempt history is immutable';
    END IF;
    IF NEW.submission_id IS DISTINCT FROM OLD.submission_id
       OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no
       OR NEW.operation IS DISTINCT FROM OLD.operation
       OR NEW.request_payload IS DISTINCT FROM OLD.request_payload THEN
        RAISE EXCEPTION 'submission attempt request evidence is immutable';
    END IF;
    IF OLD.finished_at IS NOT NULL THEN
        RAISE EXCEPTION 'completed submission attempt history is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS submission_attempt_history_immutable ON submission_attempts;
CREATE TRIGGER submission_attempt_history_immutable
    BEFORE UPDATE OR DELETE ON submission_attempts
    FOR EACH ROW EXECUTE FUNCTION guard_submission_attempt_history();
