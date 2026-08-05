package com.petc.admin;

import com.petc.settings.PlatformSettingsService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Landing-page summary for the operator portal: upload health and wallet
 * exposure across every center.
 *
 * The stranded and blocked counts are not decoration. Holding a submission for
 * want of funds keeps an already-performed emission test from reaching LTMS, so
 * anything sitting below the debt floor needs a human to act on it commercially.
 */
@RestController
@RequestMapping("/api/dashboard")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public class DashboardController {

    private final JdbcTemplate jdbc;
    private final PlatformSettingsService settings;

    public DashboardController(JdbcTemplate jdbc, PlatformSettingsService settings) {
        this.jdbc = jdbc;
        this.settings = settings;
    }

    @GetMapping("/summary")
    public Map<String, Object> summary() {
        long lowThreshold = settings.lowBalanceThresholdCentavos();
        long debtFloor = settings.debtFloorCentavos();

        Map<String, Object> out = new LinkedHashMap<>();

        // ── submission health ───────────────────────────────────────────
        Map<String, Object> states = new LinkedHashMap<>();
        jdbc.queryForList("SELECT state, count(*) AS n FROM submissions GROUP BY state")
                .forEach(r -> states.put((String) r.get("state"), r.get("n")));
        out.put("submissionStates", states);

        out.put("submissionsToday", jdbc.queryForObject("""
                SELECT count(*) FROM submissions WHERE created_at >= date_trunc('day', now())
                """, Integer.class));
        out.put("acceptedToday", jdbc.queryForObject("""
                SELECT count(*) FROM submissions
                 WHERE accepted_at >= date_trunc('day', now())
                """, Integer.class));

        // Force-released filings: billing failed but compliance was preserved.
        out.put("graceReleasedCount", jdbc.queryForObject(
                "SELECT count(*) FROM submissions WHERE grace_released_at IS NOT NULL", Integer.class));

        // ── wallet exposure ─────────────────────────────────────────────
        out.put("totalFloatCentavos", jdbc.queryForObject(
                "SELECT COALESCE(SUM(balance_centavos), 0) FROM wallet_accounts", Long.class));
        out.put("chargePerUploadCentavos", settings.chargePerUploadCentavos());
        out.put("lowBalanceThresholdCentavos", lowThreshold);
        out.put("debtFloorCentavos", debtFloor);

        List<Map<String, Object>> attention = jdbc.queryForList("""
                SELECT t.id::text AS tenant_id, t.slug, t.name,
                       COALESCE(w.balance_centavos, 0) AS balance_centavos,
                       (SELECT count(*) FROM submissions s
                         WHERE s.tenant_id = t.id AND s.state = 'BLOCKED') AS blocked_count
                  FROM tenants t
                  LEFT JOIN wallet_accounts w ON w.tenant_id = t.id
                 WHERE COALESCE(w.balance_centavos, 0) < ?
                    OR EXISTS (SELECT 1 FROM submissions s
                                WHERE s.tenant_id = t.id AND s.state = 'BLOCKED')
                 ORDER BY COALESCE(w.balance_centavos, 0) ASC
                """, lowThreshold);
        // Centers at or past the debt floor have submissions that will NOT be
        // grace-released — those filings are stranded until someone intervenes.
        attention.forEach(row -> {
            long balance = ((Number) row.get("balance_centavos")).longValue();
            row.put("belowDebtFloor", balance <= debtFloor);
            row.put("negative", balance < 0);
        });
        out.put("centersNeedingAttention", attention);

        out.put("recentTopUps", jdbc.queryForList("""
                SELECT l.tenant_id::text AS tenant_id, t.name AS center_name,
                       l.amount_centavos, l.balance_after, l.created_by, l.note, l.created_at
                  FROM wallet_ledger l
                  JOIN tenants t ON t.id = l.tenant_id
                 WHERE l.entry_type = 'TOPUP'
                 ORDER BY l.created_at DESC
                 LIMIT 10
                """));

        return out;
    }
}
