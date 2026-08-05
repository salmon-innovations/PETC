package com.petc.analytics;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/analytics")
public class AnalyticsController {

    private final JdbcTemplate jdbc;

    public AnalyticsController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Per-center summary: tests this month, pass rate, pending LTMS, last sync.
     * Used by CrossCenterDashboard.
     */
    @GetMapping("/centers")
    public List<Map<String, Object>> centers() {
        return jdbc.queryForList("""
            SELECT
                t.name                                                      AS "centerName",
                COUNT(DISTINCT me.id)                                       AS "totalTests",
                COUNT(DISTINCT me.id) FILTER (
                    WHERE date_trunc('month', me.captured_at) =
                          date_trunc('month', now())
                )                                                           AS "testsThisMonth",
                COALESCE(
                    AVG(me.pass_fail::int) FILTER (
                        WHERE date_trunc('month', me.captured_at) =
                              date_trunc('month', now())
                    ), 0
                )                                                           AS "passRate",
                COUNT(DISTINCT me.id) FILTER (WHERE ml.id IS NULL)         AS "pendingLtms",
                COUNT(DISTINCT me.id) FILTER (WHERE ml.state = 'ACCEPTED') AS "acceptedLtms",
                COUNT(DISTINCT me.id) FILTER (WHERE ml.state = 'REJECTED') AS "rejectedLtms",
                MAX(me.ingested_at)                                         AS "lastSync"
            FROM tenants t
            LEFT JOIN mirror_emission_tests me ON me.tenant_id = t.id
            LEFT JOIN mirror_ltms_submissions ml ON ml.test_id = me.id
            WHERE t.active = true
            GROUP BY t.id, t.name
            ORDER BY t.name
            """);
    }

    @GetMapping("/recent-events")
    public List<Map<String, Object>> recentEvents(
            @RequestParam(defaultValue = "25") int limit
    ) {
        return jdbc.queryForList("""
            SELECT
                e.received_at AS "receivedAt",
                t.name        AS "centerName",
                e.center_id   AS "centerId",
                e.entity_type AS "entityType",
                e.entity_id   AS "entityId"
            FROM mirror_events e
            JOIN tenants t ON t.id = e.tenant_id
            ORDER BY e.received_at DESC
            LIMIT ?
            """, Math.max(1, Math.min(limit, 100)));
    }

    /**
     * Daily rollup across all centers for the last N days.
     * Used by the 14-day line chart in CrossCenterDashboard.
     */
    @GetMapping("/daily-rollup")
    public List<Map<String, Object>> dailyRollup(
            @RequestParam(defaultValue = "14") int days
    ) {
        return jdbc.queryForList("""
            SELECT
                captured_at::date                        AS date,
                COUNT(*)                                 AS total,
                COUNT(*) FILTER (WHERE pass_fail = true) AS passed
            FROM mirror_emission_tests
            WHERE captured_at >= now() - (? || ' days')::interval
            GROUP BY captured_at::date
            ORDER BY date
            """, days);
    }
}
