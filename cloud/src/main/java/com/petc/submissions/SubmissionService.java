package com.petc.submissions;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

@Service
public class SubmissionService {

    private static final Logger log = LoggerFactory.getLogger(SubmissionService.class);

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public SubmissionService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    /**
     * Enqueue a new submission, idempotent on (tenantId, testId).
     * Returns the submission ID.
     */
    public String enqueue(String tenantId, String centerId, String testId, Map<String, Object> payload) {
        try {
            String payloadJson = mapper.writeValueAsString(payload);
            return jdbc.queryForObject("""
                    INSERT INTO submissions (tenant_id, center_id, test_id, payload)
                    VALUES (?::uuid, ?, ?, ?::jsonb)
                    ON CONFLICT (tenant_id, test_id) DO UPDATE
                        SET state = CASE
                                WHEN submissions.state IN ('REJECTED','DEAD') THEN 'PENDING'
                                ELSE submissions.state
                            END,
                            next_attempt_at = CASE
                                WHEN submissions.state IN ('REJECTED','DEAD') THEN now()
                                ELSE submissions.next_attempt_at
                            END
                    RETURNING id::text
                    """, String.class, tenantId, centerId, testId, payloadJson);
        } catch (Exception e) {
            throw new RuntimeException("Failed to enqueue submission for test " + testId, e);
        }
    }

    /** Returns the current status of a submission by its ID. */
    public Optional<SubmissionStatus> getStatus(String submissionId) {
        var rows = jdbc.queryForList("""
                SELECT state, certificate_no, ltms_ref_no, rejection_reason
                FROM submissions WHERE id = ?::uuid
                """, submissionId);
        if (rows.isEmpty()) return Optional.empty();
        var row = rows.get(0);
        return Optional.of(new SubmissionStatus(
                (String) row.get("state"),
                (String) row.get("certificate_no"),
                (String) row.get("ltms_ref_no"),
                (String) row.get("rejection_reason")
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

    /** Record a successful LTMS acceptance. */
    void markAccepted(String submissionId, String certificateNo, String ltmsRefNo) {
        jdbc.update("""
                UPDATE submissions
                SET state = 'ACCEPTED', certificate_no = ?, ltms_ref_no = ?,
                    accepted_at = now()
                WHERE id = ?::uuid
                """, certificateNo, ltmsRefNo, submissionId);
        log.info("Submission {} accepted cert={}", submissionId, certificateNo);
    }

    /** Record a definitive LTMS rejection (non-retryable). */
    void markRejected(String submissionId, String reason) {
        jdbc.update("""
                UPDATE submissions SET state = 'REJECTED', rejection_reason = ?
                WHERE id = ?::uuid
                """, reason, submissionId);
        log.info("Submission {} rejected reason={}", submissionId, reason);
    }

    /** Schedule a retry with exponential backoff. Marks DEAD after maxAttempts. */
    void markRetry(String submissionId, int attempts, int maxAttempts, int[] backoffSeconds) {
        if (attempts >= maxAttempts) {
            jdbc.update("UPDATE submissions SET state = 'DEAD' WHERE id = ?::uuid", submissionId);
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

    /** Return a batch of PENDING submissions due for processing. */
    java.util.List<PendingSubmission> claimPending(int batchSize) {
        return jdbc.query("""
                SELECT id::text, tenant_id::text, center_id, test_id, payload::text, attempts
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
                        rs.getInt("attempts")
                ),
                batchSize);
    }

    record SubmissionStatus(String state, String certificateNo, String ltmsRefNo, String rejectionReason) {}
    record PendingSubmission(String id, String tenantId, String centerId, String testId,
                             String payloadJson, int attempts) {}
}
