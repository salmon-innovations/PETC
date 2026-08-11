package com.petc.submissions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.audit.AuditService;
import com.petc.wallet.WalletService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class SubmissionService {

    private static final Logger log = LoggerFactory.getLogger(SubmissionService.class);
    /** A timed-out claim is reconciled, never automatically re-submitted. */
    private static final int CLAIM_LEASE_SECONDS = 300;

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final WalletService wallet;
    private final AuditService audit;

    public SubmissionService(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            WalletService wallet,
            AuditService audit
    ) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.wallet = wallet;
        this.audit = audit;
    }

    /**
     * Enqueue a new submission, idempotent on (tenantId, testId).
     * Returns the submission ID.
     *
     * Re-posting a REJECTED or DEAD test requeues it and REPLACES the stored
     * payload. Refreshing the payload is the point of a resubmission: the
     * center is correcting whatever LTMS rejected, and keeping the original
     * would re-file the same bad data and collect the same rejection forever.
     *
     * attempts is reset so the corrected filing gets a full retry budget rather
     * than inheriting the exhausted one from the rejected attempt.
     */
    @Transactional
    public String enqueue(String tenantId, String centerId, String testId, Map<String, Object> payload) {
        try {
            String payloadJson = mapper.writeValueAsString(payload);
            long quotedCharge = wallet.chargePerUploadCentavos(tenantId);
            return jdbc.queryForObject("""
                    INSERT INTO submissions
                        (tenant_id, center_id, test_id, payload,
                         charge_snapshot_centavos, price_snapshotted_at)
                    VALUES (?::uuid, ?, ?, ?::jsonb, ?, now())
                    ON CONFLICT (tenant_id, test_id) DO UPDATE
                        SET state = CASE
                                WHEN submissions.state IN ('REJECTED','ACTION_REQUIRED','DEAD') THEN 'PENDING'
                                ELSE submissions.state
                            END,
                            payload = CASE
                                WHEN submissions.state IN ('REJECTED','ACTION_REQUIRED','DEAD') THEN EXCLUDED.payload
                                ELSE submissions.payload
                            END,
                            attempts = CASE
                                WHEN submissions.state IN ('REJECTED','ACTION_REQUIRED','DEAD') THEN 0
                                ELSE submissions.attempts
                            END,
                            rejection_reason = CASE
                                WHEN submissions.state IN ('REJECTED','ACTION_REQUIRED','DEAD') THEN NULL
                                ELSE submissions.rejection_reason
                            END,
                            next_attempt_at = CASE
                                WHEN submissions.state IN ('REJECTED','ACTION_REQUIRED','DEAD') THEN now()
                                ELSE submissions.next_attempt_at
                            END,
                            charge_snapshot_centavos = CASE
                                WHEN submissions.state IN ('REJECTED','ACTION_REQUIRED','DEAD')
                                    THEN EXCLUDED.charge_snapshot_centavos
                                ELSE submissions.charge_snapshot_centavos
                            END,
                            price_snapshotted_at = CASE
                                WHEN submissions.state IN ('REJECTED','ACTION_REQUIRED','DEAD')
                                    THEN EXCLUDED.price_snapshotted_at
                                ELSE submissions.price_snapshotted_at
                            END,
                            blocked_at = CASE
                                WHEN submissions.state IN ('REJECTED','ACTION_REQUIRED','DEAD') THEN NULL
                                ELSE submissions.blocked_at
                            END,
                            grace_released_at = CASE
                                WHEN submissions.state IN ('REJECTED','ACTION_REQUIRED','DEAD') THEN NULL
                                ELSE submissions.grace_released_at
                            END
                    RETURNING id::text
                    """, String.class, tenantId, centerId, testId, payloadJson, quotedCharge);
        } catch (Exception e) {
            throw new RuntimeException("Failed to enqueue submission for test " + testId, e);
        }
    }

    /**
     * Returns the current status of a submission by its ID, scoped to the
     * owning tenant.
     *
     * The tenantId predicate is mandatory, not defence in depth: callers on the
     * center-key path have no JWT, so app.tenant_id is unset and RLS is
     * permissive. Dropping it reopens a cross-tenant read of certificate and
     * DERMALOG data.
     */
    public Optional<SubmissionStatus> getStatus(String submissionId, String tenantId) {
        var rows = jdbc.queryForList("""
                SELECT state, certificate_no, ltms_ref_no, rejection_reason,
                       or_no, dermalog_token, valid_from, valid_until
                FROM submissions WHERE id = ?::uuid AND tenant_id = ?::uuid
                """, submissionId, tenantId);
        if (rows.isEmpty()) return Optional.empty();
        var row = rows.get(0);
        return Optional.of(new SubmissionStatus(
                (String) row.get("state"),
                (String) row.get("certificate_no"),
                (String) row.get("ltms_ref_no"),
                (String) row.get("rejection_reason"),
                (String) row.get("or_no"),
                (String) row.get("dermalog_token"),
                row.get("valid_from") instanceof Date d ? d.toLocalDate() : null,
                row.get("valid_until") instanceof Date d ? d.toLocalDate() : null
        ));
    }

    /** Record a successful LTMS acceptance with the CEC presentation fields. */
    void markAccepted(
            String submissionId,
            String certificateNo,
            String ltmsRefNo,
            String orNo,
            String dermalogToken,
            LocalDate validFrom,
            LocalDate validUntil
    ) {
        int updated = jdbc.update("""
                UPDATE submissions
                SET state = 'PASSED',
                    certificate_no = ?,
                    ltms_ref_no = ?,
                    or_no = ?,
                    dermalog_token = ?,
                    valid_from = ?,
                    valid_until = ?,
                    accepted_at = now()
                WHERE id = ?::uuid AND state = 'IN_FLIGHT'
                """,
                certificateNo,
                ltmsRefNo,
                orNo,
                dermalogToken,
                validFrom != null ? Date.valueOf(validFrom) : null,
                validUntil != null ? Date.valueOf(validUntil) : null,
                submissionId);
        if (updated > 0) {
            completeAttempt(submissionId, "PASSED", null);
            log.info("Submission {} accepted cert={}", submissionId, certificateNo);
        }
    }

    /**
     * Records LTMS acceptance and debits the center's wallet atomically.
     *
     * The ledger insert and the state change must commit together: a crash
     * between them would either charge for an unaccepted submission or file one
     * for free. @Transactional therefore sits HERE, on the service, not on
     * SubmissionJobRunner.process() — that method is private and calls across a
     * bean boundary, where Spring's proxy AOP silently ignores the annotation.
     *
     * The gov HTTP call deliberately stays outside this transaction: holding
     * one of only ten Hikari connections across an external call exhausts the
     * pool under load.
     *
     * acceptance_seq is incremented in the same UPDATE that sets ACCEPTED, so
     * the sequence and the state transition cannot diverge. It is what makes
     * charging per acceptance EVENT work: enqueue() recycles a rejected row, so
     * the same submission_id can legitimately be accepted more than once.
     */
    @Transactional
    public void markAcceptedAndCharge(
            String submissionId,
            String tenantId,
            String certificateNo,
            String ltmsRefNo,
            String orNo,
            String dermalogToken,
            LocalDate validFrom,
            LocalDate validUntil,
            long chargeCentavos
    ) {
        Integer seq = jdbc.queryForObject("""
                UPDATE submissions
                   SET state = 'PASSED',
                       certificate_no = ?,
                       ltms_ref_no = ?,
                       or_no = ?,
                       dermalog_token = ?,
                       valid_from = ?,
                       valid_until = ?,
                       accepted_at = now(),
                       acceptance_seq = acceptance_seq + 1
                 WHERE id = ?::uuid AND tenant_id = ?::uuid AND state = 'IN_FLIGHT'
             RETURNING acceptance_seq
                """,
                Integer.class,
                certificateNo,
                ltmsRefNo,
                orNo,
                dermalogToken,
                validFrom != null ? Date.valueOf(validFrom) : null,
                validUntil != null ? Date.valueOf(validUntil) : null,
                submissionId,
                tenantId);

        if (seq == null) {
            throw new IllegalStateException(
                    "Submission " + submissionId + " is not an in-flight claim for tenant " + tenantId);
        }

        completeAttempt(submissionId, "PASSED", null);
        wallet.chargeForAcceptance(tenantId, submissionId, seq, chargeCentavos);
        log.info("Submission {} accepted cert={} (acceptance #{})", submissionId, certificateNo, seq);
    }

    /**
     * Holds a submission that the center cannot currently afford to file.
     *
     * The upload was already accepted (202) and the record is safe in the
     * cloud; only the LTMS dispatch waits. Leaving PENDING means claimPending()
     * stops returning it, so it is not re-evaluated every two seconds — it
     * re-enters the queue on top-up or via the grace sweep.
     */
    @Transactional
    public void markBlocked(String submissionId, String tenantId, long balanceCentavos) {
        int updated = jdbc.update("""
                UPDATE submissions SET state = 'BLOCKED', blocked_at = now()
                 WHERE id = ?::uuid AND tenant_id = ?::uuid AND state = 'IN_FLIGHT'
                """, submissionId, tenantId);
        if (updated > 0) {
            completeAttempt(submissionId, "BLOCKED", null);
            audit.recordSystem(tenantId, "SUBMISSION_BLOCKED", "submission", submissionId,
                    Map.of("balanceCentavos", balanceCentavos));
            log.info("Submission {} blocked — insufficient wallet balance ({})",
                    submissionId, balanceCentavos);
        }
    }

    /** Record a definitive LTMS rejection (non-retryable). */
    void markRejected(String submissionId, String reason) {
        int updated = jdbc.update("""
                UPDATE submissions
                   SET state = 'ACTION_REQUIRED',
                       rejection_reason = ?,
                       ltms_error_message = ?,
                       claim_lease_until = NULL
                 WHERE id = ?::uuid AND state = 'IN_FLIGHT'
                """, reason, reason, submissionId);
        if (updated > 0) {
            completeAttempt(submissionId, "ACTION_REQUIRED", reason);
            log.info("Submission {} requires action reason={}", submissionId, reason);
        }
    }

    /** Schedule a retry with exponential backoff. Marks DEAD after maxAttempts. */
    void markRetry(String submissionId, int attempts, int maxAttempts, int[] backoffSeconds) {
        if (attempts >= maxAttempts) {
            int updated = jdbc.update("""
                    UPDATE submissions
                       SET state = 'DEAD', claim_lease_until = NULL
                     WHERE id = ?::uuid AND state = 'IN_FLIGHT'
                    """, submissionId);
            if (updated > 0) {
                completeAttempt(submissionId, "DEAD", "Retry budget exhausted");
                log.warn("Submission {} exhausted {} attempts — DEAD", submissionId, attempts);
            }
            return;
        }
        // claimPending increments attempts before returning the row. Convert
        // the one-based attempt count to the backoff array's zero-based index.
        int delaySec = backoffSeconds[Math.min(Math.max(attempts - 1, 0), backoffSeconds.length - 1)];
        Instant nextRetry = Instant.now().plusSeconds(delaySec);
        int updated = jdbc.update("""
                UPDATE submissions
                   SET state = 'DEFERRED', next_attempt_at = ?, claim_lease_until = NULL
                 WHERE id = ?::uuid AND state = 'IN_FLIGHT'
                """, Timestamp.from(nextRetry), submissionId);
        if (updated > 0) {
            completeAttempt(submissionId, "DEFERRED", null);
            log.debug("Submission {} deferred for {}s (attempt {})", submissionId, delaySec, attempts);
        }
    }

    /**
     * Return a batch of PENDING submissions due for processing.
     *
     * BLOCKED rows are excluded by the state predicate, so a held submission is
     * not re-examined on every two-second tick. grace_released_at rides along so
     * the runner can tell which rows have already escaped the wallet check.
     */
    @Transactional
    List<PendingSubmission> claimPending(int batchSize) {
        return jdbc.query("""
                WITH due AS (
                    SELECT id
                      FROM submissions
                     WHERE state IN ('PENDING', 'DEFERRED')
                       AND next_attempt_at <= now()
                     ORDER BY next_attempt_at, id
                     FOR UPDATE SKIP LOCKED
                     LIMIT ?
                ), claimed AS (
                    UPDATE submissions s
                       SET state = 'IN_FLIGHT',
                           last_attempt_at = now(),
                           claimed_at = now(),
                           claim_lease_until = now() + make_interval(secs => ?),
                           attempts = s.attempts + 1,
                           attempt_sequence = s.attempt_sequence + 1
                      FROM due
                     WHERE s.id = due.id
                 RETURNING s.id, s.tenant_id, s.center_id, s.test_id, s.payload,
                           s.attempts, s.attempt_sequence, s.operation, s.grace_released_at,
                           s.charge_snapshot_centavos
                ), recorded AS (
                    INSERT INTO submission_attempts
                        (submission_id, attempt_no, operation, request_payload, state)
                    SELECT id, attempt_sequence, operation, payload, 'IN_FLIGHT'
                      FROM claimed
                )
                SELECT id::text, tenant_id::text, center_id, test_id, payload::text, attempts,
                       grace_released_at, charge_snapshot_centavos
                  FROM claimed
                """,
                (rs, i) -> new PendingSubmission(
                        rs.getString("id"),
                        rs.getString("tenant_id"),
                        rs.getString("center_id"),
                        rs.getString("test_id"),
                        rs.getString("payload"),
                        rs.getInt("attempts"),
                        rs.getTimestamp("grace_released_at") != null,
                        rs.getLong("charge_snapshot_centavos")
                ),
                batchSize, CLAIM_LEASE_SECONDS);
    }

    /**
     * An expired worker lease has an unknown outbound outcome.  It must be
     * reconciled before another POST/PUT, never returned to the dispatch pool.
     */
    @Transactional
    public int moveExpiredClaimsToReconciling() {
        int updated = jdbc.update("""
                UPDATE submissions
                   SET state = 'RECONCILING',
                       reconciliation_status = 'REQUIRED',
                       claim_lease_until = NULL,
                       ltms_error_message = COALESCE(ltms_error_message,
                           'Worker claim expired; LTMS outcome must be reconciled')
                 WHERE state = 'IN_FLIGHT' AND claim_lease_until <= now()
                """);
        if (updated > 0) {
            jdbc.update("""
                    UPDATE submission_attempts a
                       SET state = 'RECONCILING',
                           ltms_error_message = COALESCE(a.ltms_error_message,
                               'Worker claim expired; LTMS outcome must be reconciled'),
                           finished_at = now()
                      FROM submissions s
                     WHERE s.id = a.submission_id
                       AND s.state = 'RECONCILING'
                       AND a.attempt_no = s.attempt_sequence
                       AND a.finished_at IS NULL
                    """);
        }
        return updated;
    }

    private void completeAttempt(String submissionId, String state, String errorMessage) {
        jdbc.update("""
                UPDATE submission_attempts a
                   SET state = ?,
                       ltms_error_message = COALESCE(?, ltms_error_message),
                       finished_at = now()
                  FROM submissions s
                 WHERE s.id = a.submission_id
                   AND a.submission_id = ?::uuid
                   AND a.attempt_no = s.attempt_sequence
                   AND a.finished_at IS NULL
                """, state, errorMessage, submissionId);
    }

    record SubmissionStatus(
            String state,
            String certificateNo,
            String ltmsRefNo,
            String rejectionReason,
            String orNo,
            String dermalogToken,
            LocalDate validFrom,
            LocalDate validUntil
    ) {}
    /**
     * @param graceReleased true once the DO 2023-008 sweep has force-released
     *                      this row; the runner then skips the wallet check,
     *                      which is how a balance is allowed to go negative.
     */
    record PendingSubmission(String id, String tenantId, String centerId, String testId,
                             String payloadJson, int attempts, boolean graceReleased,
                             long chargeSnapshotCentavos) {}
}
