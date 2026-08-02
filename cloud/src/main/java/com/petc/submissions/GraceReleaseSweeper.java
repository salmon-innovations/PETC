package com.petc.submissions;

import com.petc.audit.AuditService;
import com.petc.settings.PlatformSettingsService;
import com.petc.wallet.WalletService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

/**
 * DO 2023-008 escape hatch for submissions held on insufficient funds.
 *
 * A test has already been performed on a real vehicle by the time its
 * submission is blocked, and the emission result still has to reach LTMS. A
 * billing shortfall must not become a regulatory breach, so rows held past the
 * grace window are force-released and dispatched even though the wallet cannot
 * cover them — the balance simply goes negative and the debt is recovered on
 * the next top-up.
 *
 * The one exception is the debt floor. Below it, releases stop and holds stand:
 * that is a deliberate trade-off in which performed tests can be stranded from
 * LTMS, so those centers are surfaced as an explicit dashboard alarm rather
 * than left to accumulate silently.
 *
 * This is a separate sweep rather than a condition inside claimPending() so
 * that each release carries its own audit action and its own timestamp — the
 * artifact an audit would ask to see.
 */
@Component
public class GraceReleaseSweeper {

    private static final Logger log = LoggerFactory.getLogger(GraceReleaseSweeper.class);

    private final JdbcTemplate jdbc;
    private final PlatformSettingsService settings;
    private final WalletService wallet;
    private final AuditService audit;

    public GraceReleaseSweeper(
            JdbcTemplate jdbc,
            PlatformSettingsService settings,
            WalletService wallet,
            AuditService audit
    ) {
        this.jdbc = jdbc;
        this.settings = settings;
        this.wallet = wallet;
        this.audit = audit;
    }

    @Scheduled(fixedDelay = 60_000)
    @Transactional
    public void sweep() {
        int graceMinutes = settings.graceReleaseMinutes();
        long debtFloor = settings.debtFloorCentavos();

        var overdue = jdbc.queryForList("""
                SELECT id::text AS id, tenant_id::text AS tenant_id
                  FROM submissions
                 WHERE state = 'BLOCKED'
                   AND blocked_at < now() - make_interval(mins => ?)
                 ORDER BY blocked_at
                """, graceMinutes);

        for (var row : overdue) {
            String id = (String) row.get("id");
            String tenantId = (String) row.get("tenant_id");
            long balance = wallet.getBalance(tenantId);

            if (balance <= debtFloor) {
                // Hold stands. Logged at warn because a stranded filing needs a
                // human to act on it commercially.
                log.warn("Submission {} past grace but tenant {} is below the debt floor "
                                + "({} <= {}) — hold stands",
                        id, tenantId, balance, debtFloor);
                continue;
            }

            int updated = jdbc.update("""
                    UPDATE submissions
                       SET state = 'PENDING',
                           blocked_at = NULL,
                           grace_released_at = now(),
                           next_attempt_at = now()
                     WHERE id = ?::uuid AND state = 'BLOCKED'
                    """, id);

            if (updated > 0) {
                audit.recordSystem(tenantId, "SUBMISSION_GRACE_RELEASED", "submission", id,
                        Map.of("balanceCentavos", balance,
                               "graceMinutes", graceMinutes));
                log.info("Submission {} force-released after {}min grace (tenant {} balance {})",
                        id, graceMinutes, tenantId, balance);
            }
        }
    }
}
