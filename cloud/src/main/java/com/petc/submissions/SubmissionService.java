package com.petc.submissions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.petc.audit.AuditService;
import com.petc.lanes.LaneQuotaService;
import com.petc.lanes.LateSubmissionException;
import com.petc.wallet.CenterPricingService;
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
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Map;
import java.util.Optional;

@Service
public class SubmissionService {

    private static final Logger log = LoggerFactory.getLogger(SubmissionService.class);

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final CenterPricingService pricing;
    private final WalletService wallet;
    private final AuditService audit;
    private final LaneQuotaService quota;

    public SubmissionService(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            CenterPricingService pricing,
            WalletService wallet,
            AuditService audit,
            LaneQuotaService quota
    ) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.pricing = pricing;
        this.wallet = wallet;
        this.audit = audit;
        this.quota = quota;
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
    public String enqueue(String tenantId, String laneId, String centerId, String testId, Map<String, Object> payload) {
        try {
            requireTodayTest(payload);
            String payloadJson = mapper.writeValueAsString(payload);
            long quotedCharge = pricing.getFor(tenantId).chargePerUploadCentavos();
            String submissionId = jdbc.queryForObject("""
                    INSERT INTO submissions
                        (tenant_id, lane_id, center_id, test_id, payload,
                         charge_snapshot_centavos, price_snapshotted_at)
                    VALUES (?::uuid, ?::uuid, ?, ?, ?::jsonb, ?, now())
                    ON CONFLICT (lane_id, test_id) DO UPDATE
                        SET state = CASE
                                WHEN submissions.state IN ('REJECTED','DEAD') THEN 'PENDING'
                                ELSE submissions.state
                            END,
                            payload = CASE
                                WHEN submissions.state IN ('REJECTED','DEAD') THEN EXCLUDED.payload
                                ELSE submissions.payload
                            END,
                            attempts = CASE
                                WHEN submissions.state IN ('REJECTED','DEAD') THEN 0
                                ELSE submissions.attempts
                            END,
                            rejection_reason = CASE
                                WHEN submissions.state IN ('REJECTED','DEAD') THEN NULL
                                ELSE submissions.rejection_reason
                            END,
                            next_attempt_at = CASE
                                WHEN submissions.state IN ('REJECTED','DEAD') THEN now()
                                ELSE submissions.next_attempt_at
                            END,
                            charge_snapshot_centavos = CASE
                                WHEN submissions.state IN ('REJECTED','DEAD')
                                    THEN EXCLUDED.charge_snapshot_centavos
                                ELSE submissions.charge_snapshot_centavos
                            END,
                            price_snapshotted_at = CASE
                                WHEN submissions.state IN ('REJECTED','DEAD')
                                    THEN EXCLUDED.price_snapshotted_at
                                ELSE submissions.price_snapshotted_at
                            END,
                            blocked_at = CASE
                                WHEN submissions.state IN ('REJECTED','DEAD') THEN NULL
                                ELSE submissions.blocked_at
                            END,
                            grace_released_at = CASE
                                WHEN submissions.state IN ('REJECTED','DEAD') THEN NULL
                                ELSE submissions.grace_released_at
                            END
                    RETURNING id::text
                    """, String.class, tenantId, laneId, centerId, testId, payloadJson, quotedCharge);
            // Existing PENDING/ACCEPTED rows already have a RESERVED/CONSUMED
            // reservation and reserve() is a no-op.  A requeued REJECTED/DEAD
            // row has RELEASED its previous reservation and receives one anew.
            quota.reserve(tenantId, laneId, submissionId);
            return submissionId;
        } catch (Exception e) {
            if (e instanceof LateSubmissionException || e instanceof com.petc.lanes.LaneQuotaExceededException) {
                throw (RuntimeException) e;
            }
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
    public Optional<SubmissionStatus> getStatus(String submissionId, String tenantId, String laneId) {
        var rows = jdbc.queryForList("""
                SELECT state, certificate_no, ltms_ref_no, rejection_reason,
                       or_no, dermalog_token, valid_from, valid_until
                FROM submissions WHERE id = ?::uuid AND tenant_id = ?::uuid AND lane_id = ?::uuid
                """, submissionId, tenantId, laneId);
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

    /** Mark a submission IN_FLIGHT before calling the gov client. */
    void markInFlight(String submissionId) {
        jdbc.update("""
                UPDATE submissions SET state = 'IN_FLIGHT', last_attempt_at = now(),
                    attempts = attempts + 1
                WHERE id = ?::uuid
                """, submissionId);
    }

    /** Legacy acceptance helper; quota conversion remains transactionally coupled. */
    @Transactional
    public void markAccepted(
            String submissionId,
            String certificateNo,
            String ltmsRefNo,
            String orNo,
            String dermalogToken,
            LocalDate validFrom,
            LocalDate validUntil
    ) {
        String tenantId = jdbc.queryForObject("""
                UPDATE submissions
                SET state = 'ACCEPTED',
                    certificate_no = ?,
                    ltms_ref_no = ?,
                    or_no = ?,
                    dermalog_token = ?,
                    valid_from = ?,
                    valid_until = ?,
                    accepted_at = now()
                WHERE id = ?::uuid AND state IN ('PENDING', 'IN_FLIGHT')
                RETURNING tenant_id::text
                """,
                String.class, certificateNo,
                ltmsRefNo,
                orNo,
                dermalogToken,
                validFrom != null ? Date.valueOf(validFrom) : null,
                validUntil != null ? Date.valueOf(validUntil) : null,
                submissionId);
        if (tenantId != null) quota.consume(submissionId, tenantId);
        log.info("Submission {} accepted cert={}", submissionId, certificateNo);
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
            LocalDate validUntil
    ) {
        Integer seq = jdbc.queryForObject("""
                UPDATE submissions
                   SET state = 'ACCEPTED',
                       certificate_no = ?,
                       ltms_ref_no = ?,
                       or_no = ?,
                       dermalog_token = ?,
                       valid_from = ?,
                       valid_until = ?,
                       accepted_at = now(),
                       acceptance_seq = acceptance_seq + 1
                 WHERE id = ?::uuid AND tenant_id = ?::uuid AND state IN ('PENDING', 'IN_FLIGHT')
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
            var states = jdbc.queryForList("SELECT state FROM submissions WHERE id = ?::uuid AND tenant_id = ?::uuid",
                    submissionId, tenantId);
            if (!states.isEmpty() && "ACCEPTED".equals(states.getFirst().get("state"))) {
                // Duplicate LTMS success delivery after our transaction committed.
                // Its quota/wallet effect was already finalized atomically.
                return;
            }
            throw new IllegalStateException("Submission " + submissionId + " is not eligible for acceptance");
        }

        quota.consume(submissionId, tenantId);
        wallet.chargeForAcceptance(tenantId, submissionId, seq);
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
                 WHERE id = ?::uuid AND tenant_id = ?::uuid AND state IN ('PENDING', 'IN_FLIGHT')
                """, submissionId, tenantId);
        if (updated > 0) {
            audit.recordSystem(tenantId, "SUBMISSION_BLOCKED", "submission", submissionId,
                    Map.of("balanceCentavos", balanceCentavos));
            log.info("Submission {} blocked — insufficient wallet balance ({})",
                    submissionId, balanceCentavos);
        }
    }

    /** Record a definitive LTMS rejection (non-retryable). */
    @Transactional
    public void markRejected(String submissionId, String reason) {
        jdbc.update("""
                UPDATE submissions SET state = 'REJECTED', rejection_reason = ?
                WHERE id = ?::uuid
                """, reason, submissionId);
        quota.release(submissionId);
        log.info("Submission {} rejected reason={}", submissionId, reason);
    }

    /** Schedule a retry with exponential backoff. Marks DEAD after maxAttempts. */
    @Transactional
    public void markRetry(String submissionId, int attempts, int maxAttempts, int[] backoffSeconds) {
        if (attempts >= maxAttempts) {
            jdbc.update("UPDATE submissions SET state = 'DEAD' WHERE id = ?::uuid", submissionId);
            quota.release(submissionId);
            log.warn("Submission {} exhausted {} attempts — DEAD", submissionId, attempts);
            return;
        }
        int delaySec = backoffSeconds[Math.min(attempts, backoffSeconds.length - 1)];
        Instant nextRetry = Instant.now().plusSeconds(delaySec);
        jdbc.update("""
                UPDATE submissions SET state = 'PENDING', next_attempt_at = ?
                WHERE id = ?::uuid
                """, Timestamp.from(nextRetry), submissionId);
        log.debug("Submission {} retry in {}s (attempt {})", submissionId, delaySec, attempts);
    }

    /**
     * Return a batch of PENDING submissions due for processing.
     *
     * BLOCKED rows are excluded by the state predicate, so a held submission is
     * not re-examined on every two-second tick. grace_released_at rides along so
     * the runner can tell which rows have already escaped the wallet check.
     */
    java.util.List<PendingSubmission> claimPending(int batchSize) {
        return jdbc.query("""
                SELECT id::text, tenant_id::text, center_id, test_id, payload::text, attempts,
                       grace_released_at, charge_snapshot_centavos
                FROM submissions
                WHERE state = 'PENDING' AND next_attempt_at <= now()
                ORDER BY next_attempt_at
                LIMIT ?
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
                batchSize);
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

    private void requireTodayTest(Map<String, Object> payload) {
        Object raw = payload.get("testDatetime");
        if (!(raw instanceof String value) || value.isBlank()) {
            throw new LateSubmissionException("payload.testDatetime is required");
        }
        LocalDate testDate;
        try {
            testDate = Instant.parse(value).atZone(LaneQuotaService.BUSINESS_ZONE).toLocalDate();
        } catch (Exception ignored) {
            try {
                testDate = OffsetDateTime.parse(value).atZoneSameInstant(LaneQuotaService.BUSINESS_ZONE).toLocalDate();
            } catch (Exception ignoredAgain) {
                try {
                    testDate = ZonedDateTime.parse(value).withZoneSameInstant(LaneQuotaService.BUSINESS_ZONE).toLocalDate();
                } catch (Exception ignoredThird) {
                    try {
                        testDate = LocalDateTime.parse(value).atZone(LaneQuotaService.BUSINESS_ZONE).toLocalDate();
                    } catch (Exception invalid) {
                        throw new LateSubmissionException("payload.testDatetime must be an ISO-8601 datetime");
                    }
                }
            }
        }
        if (!LocalDate.now(LaneQuotaService.BUSINESS_ZONE).equals(testDate)) {
            throw new LateSubmissionException("Late submissions are not permitted; testDatetime must be today in Asia/Manila");
        }
    }
}
