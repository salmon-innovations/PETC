package com.petc.lanes;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;

/**
 * Quota accounting for a lane.  A RESERVED slot protects capacity while LTMS
 * is processing.  It only becomes consumed when LTMS returns ACCEPTED, so
 * retries and corrected rejected tests can never be counted twice.
 */
@Service
public class LaneQuotaService {
    public static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Manila");

    private final JdbcTemplate jdbc;

    public LaneQuotaService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public record Quota(String laneId, LocalDate businessDate, int accepted, int reserved,
                        int limit, int remaining, Instant resetsAt) {}

    @Transactional
    public void reserve(String tenantId, String laneId, String submissionId) {
        var submissions = jdbc.queryForList("""
                SELECT state FROM submissions
                 WHERE id = ?::uuid AND tenant_id = ?::uuid AND lane_id = ?::uuid FOR UPDATE
                """, submissionId, tenantId, laneId);
        if (submissions.isEmpty()) throw new IllegalArgumentException("Submission does not belong to this lane");
        // A migrated or already-finalized accepted test has already consumed
        // its CEC slot; a status/retry POST must not reserve another one.
        if ("ACCEPTED".equals(submissions.getFirst().get("state"))) return;
        LocalDate today = LocalDate.now(BUSINESS_ZONE);
        // The INSERT is intentionally separate from the lock.  ON CONFLICT
        // makes creation safe under concurrent desktop requests; SELECT FOR
        // UPDATE then serializes the actual capacity decision.
        jdbc.update("""
                INSERT INTO lane_daily_quota (lane_id, business_date, limit_snapshot)
                SELECT id, ?, daily_upload_limit FROM lanes
                 WHERE id = ?::uuid AND tenant_id = ?::uuid AND active = true
                ON CONFLICT (lane_id, business_date) DO NOTHING
                """, Date.valueOf(today), laneId, tenantId);
        var quota = jdbc.queryForList("""
                SELECT accepted_count, reserved_count, limit_snapshot
                  FROM lane_daily_quota
                 WHERE lane_id = ?::uuid AND business_date = ?
                 FOR UPDATE
                """, laneId, Date.valueOf(today));
        if (quota.isEmpty()) {
            throw new IllegalArgumentException("Lane is inactive or does not belong to this center");
        }
        var reservation = jdbc.queryForList("""
                SELECT state, business_date FROM submission_quota_reservations
                 WHERE submission_id = ?::uuid FOR UPDATE
                """, submissionId);
        if (!reservation.isEmpty()) {
            String state = (String) reservation.getFirst().get("state");
            if ("RESERVED".equals(state) || "CONSUMED".equals(state)) return;
            // A corrected rejected/dead filing reuses its test/submission id.
            // It gets a fresh reservation only after the old one was released.
        }
        Map<String, Object> row = quota.getFirst();
        int accepted = ((Number) row.get("accepted_count")).intValue();
        int reserved = ((Number) row.get("reserved_count")).intValue();
        int limit = ((Number) row.get("limit_snapshot")).intValue();
        if (accepted + reserved >= limit) {
            throw new LaneQuotaExceededException(laneId, accepted, reserved, limit, resetAt(today));
        }
        if (reservation.isEmpty()) {
            jdbc.update("""
                    INSERT INTO submission_quota_reservations
                        (submission_id, lane_id, business_date, state)
                    VALUES (?::uuid, ?::uuid, ?, 'RESERVED')
                    """, submissionId, laneId, Date.valueOf(today));
        } else {
            jdbc.update("""
                    UPDATE submission_quota_reservations
                       SET lane_id = ?::uuid, business_date = ?, state = 'RESERVED',
                           created_at = now(), finalized_at = NULL
                     WHERE submission_id = ?::uuid AND state = 'RELEASED'
                    """, laneId, Date.valueOf(today), submissionId);
        }
        jdbc.update("""
                UPDATE lane_daily_quota
                   SET reserved_count = reserved_count + 1, updated_at = now()
                 WHERE lane_id = ?::uuid AND business_date = ?
                """, laneId, Date.valueOf(today));
    }

    /** Final acceptance consumes a reservation exactly once. */
    @Transactional
    public void consume(String submissionId, String tenantId) {
        var reservations = jdbc.queryForList("""
                SELECT r.lane_id::text, r.business_date, r.state
                  FROM submission_quota_reservations r
                  JOIN submissions s ON s.id = r.submission_id
                 WHERE r.submission_id = ?::uuid AND s.tenant_id = ?::uuid
                 FOR UPDATE OF r
                """, submissionId, tenantId);
        if (reservations.isEmpty()) throw new IllegalStateException("Submission has no quota reservation");
        var reservation = reservations.getFirst();
        if ("CONSUMED".equals(reservation.get("state"))) return;
        if (!"RESERVED".equals(reservation.get("state"))) {
            throw new IllegalStateException("Submission quota reservation is not active");
        }
        String laneId = (String) reservation.get("lane_id");
        Date date = (Date) reservation.get("business_date");
        int changed = jdbc.update("""
                UPDATE lane_daily_quota
                   SET reserved_count = reserved_count - 1,
                       accepted_count = accepted_count + 1,
                       updated_at = now()
                 WHERE lane_id = ?::uuid AND business_date = ? AND reserved_count > 0
                """, laneId, date);
        if (changed != 1) throw new IllegalStateException("Quota reservation accounting is inconsistent");
        jdbc.update("""
                UPDATE submission_quota_reservations
                   SET state = 'CONSUMED', finalized_at = now()
                 WHERE submission_id = ?::uuid AND state = 'RESERVED'
                """, submissionId);
    }

    /** A terminal LTMS rejection/dead retry releases the protected slot. */
    @Transactional
    public void release(String submissionId) {
        var reservations = jdbc.queryForList("""
                SELECT lane_id::text, business_date, state
                  FROM submission_quota_reservations
                 WHERE submission_id = ?::uuid FOR UPDATE
                """, submissionId);
        if (reservations.isEmpty() || !"RESERVED".equals(reservations.getFirst().get("state"))) return;
        var reservation = reservations.getFirst();
        jdbc.update("""
                UPDATE lane_daily_quota
                   SET reserved_count = reserved_count - 1, updated_at = now()
                 WHERE lane_id = ?::uuid AND business_date = ? AND reserved_count > 0
                """, reservation.get("lane_id"), reservation.get("business_date"));
        jdbc.update("""
                UPDATE submission_quota_reservations
                   SET state = 'RELEASED', finalized_at = now()
                 WHERE submission_id = ?::uuid AND state = 'RESERVED'
                """, submissionId);
    }

    public Quota current(String tenantId, String laneId) {
        LocalDate today = LocalDate.now(BUSINESS_ZONE);
        var rows = jdbc.queryForList("""
                SELECT l.daily_upload_limit, q.accepted_count, q.reserved_count, q.limit_snapshot
                  FROM lanes l
             LEFT JOIN lane_daily_quota q ON q.lane_id = l.id AND q.business_date = ?
                 WHERE l.id = ?::uuid AND l.tenant_id = ?::uuid
                """, Date.valueOf(today), laneId, tenantId);
        if (rows.isEmpty()) throw new IllegalArgumentException("No such lane");
        var row = rows.getFirst();
        int limit = row.get("limit_snapshot") == null
                ? ((Number) row.get("daily_upload_limit")).intValue()
                : ((Number) row.get("limit_snapshot")).intValue();
        int accepted = row.get("accepted_count") == null ? 0 : ((Number) row.get("accepted_count")).intValue();
        int reserved = row.get("reserved_count") == null ? 0 : ((Number) row.get("reserved_count")).intValue();
        return new Quota(laneId, today, accepted, reserved, limit,
                Math.max(0, limit - accepted - reserved), resetAt(today));
    }

    private Instant resetAt(LocalDate today) {
        return today.plusDays(1).atStartOfDay(BUSINESS_ZONE).toInstant();
    }
}
