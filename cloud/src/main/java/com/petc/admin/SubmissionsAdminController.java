package com.petc.admin;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Cross-center submission browsing for the operator portal.
 *
 * Separate from {@link com.petc.submissions.SubmissionsController}, which is the
 * center-facing ingest API authenticated by X-Center-Key. Mixing a JWT-scoped
 * admin view onto that path prefix would put two auth models on one surface,
 * and that prefix is permitAll'd in SecurityConfig.
 */
@RestController
@RequestMapping("/api/admin/submissions")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public class SubmissionsAdminController {

    private static final int MAX_PAGE = 200;

    private final JdbcTemplate jdbc;

    public SubmissionsAdminController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public List<Map<String, Object>> list(
            @RequestParam(required = false) String centerId,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "0") int offset
    ) {
        StringBuilder sql = new StringBuilder("""
                SELECT s.id::text        AS id,
                       s.test_id         AS test_id,
                       s.center_id       AS center_id,
                       t.name            AS center_name,
                       s.state           AS state,
                       s.attempts        AS attempts,
                       s.certificate_no  AS certificate_no,
                       s.or_no           AS or_no,
                       s.rejection_reason AS rejection_reason,
                       s.created_at      AS created_at,
                       s.accepted_at     AS accepted_at,
                       s.blocked_at      AS blocked_at,
                       s.grace_released_at AS grace_released_at,
                       s.acceptance_seq  AS acceptance_seq,
                       s.charge_snapshot_centavos AS charge_snapshot_centavos,
                       s.price_snapshotted_at AS price_snapshotted_at
                  FROM submissions s
                  JOIN tenants t ON t.id = s.tenant_id
                 WHERE 1 = 1
                """);
        List<Object> args = new ArrayList<>();

        if (centerId != null && !centerId.isBlank()) {
            sql.append(" AND s.center_id = ?");
            args.add(centerId);
        }
        if (state != null && !state.isBlank()) {
            sql.append(" AND s.state = ?");
            args.add(state);
        }
        if (from != null && !from.isBlank()) {
            sql.append(" AND s.created_at >= ?::timestamptz");
            args.add(from);
        }
        if (to != null && !to.isBlank()) {
            sql.append(" AND s.created_at <= ?::timestamptz");
            args.add(to);
        }
        sql.append(" ORDER BY s.created_at DESC LIMIT ? OFFSET ?");
        args.add(Math.clamp(limit, 1, MAX_PAGE));
        args.add(Math.max(0, offset));

        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    /** Full detail for one submission, including any wallet activity it caused. */
    @GetMapping("/{id}")
    public Map<String, Object> detail(@PathVariable String id) {
        try {
            UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Malformed submission id");
        }

        var rows = jdbc.queryForList("""
                SELECT s.id::text AS id, s.test_id, s.center_id, t.name AS center_name,
                       s.tenant_id::text AS tenant_id, s.state, s.attempts, s.payload::text AS payload,
                       s.certificate_no, s.ltms_ref_no, s.or_no, s.dermalog_token,
                       s.rejection_reason, s.valid_from, s.valid_until,
                       s.created_at, s.accepted_at, s.blocked_at, s.grace_released_at,
                       s.last_attempt_at, s.next_attempt_at, s.acceptance_seq,
                       s.charge_snapshot_centavos, s.price_snapshotted_at
                  FROM submissions s
                  JOIN tenants t ON t.id = s.tenant_id
                 WHERE s.id = ?::uuid
                """, id);
        if (rows.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such submission");
        }

        Map<String, Object> detail = new java.util.LinkedHashMap<>(rows.get(0));
        detail.put("ledger", jdbc.queryForList("""
                SELECT entry_type, amount_centavos, balance_after, acceptance_seq,
                       created_by, note, created_at
                  FROM wallet_ledger
                 WHERE submission_id = ?::uuid
                 ORDER BY id
                """, id));
        return detail;
    }
}
