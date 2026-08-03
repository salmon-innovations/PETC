package com.petc.wallet;

import com.petc.audit.AuditService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.time.OffsetDateTime;

/**
 * Prepaid wallet: balances, the immutable ledger, and the charge applied when
 * LTMS accepts a submission.
 *
 * The ledger is the source of truth. wallet_accounts.balance_centavos is a
 * cached projection kept in step inside the same transaction as each ledger
 * insert, so the hot paths (per-tick dispatch check, desktop status poll) cost
 * one indexed read. recomputeBalance() re-derives from the ledger and is
 * surfaced on the dashboard so drift is visible rather than silent.
 *
 * Money is integer centavos throughout.
 */
@Service
public class WalletService {

    private static final Logger log = LoggerFactory.getLogger(WalletService.class);

    private final JdbcTemplate jdbc;
    private final CenterPricingService pricing;
    private final AuditService audit;

    public WalletService(JdbcTemplate jdbc, CenterPricingService pricing, AuditService audit) {
        this.jdbc = jdbc;
        this.pricing = pricing;
        this.audit = audit;
    }

    // ---------------------------------------------------------------- reads

    /** Current projected balance. Zero if the center has no wallet row yet. */
    public long getBalance(String tenantId) {
        Long balance = jdbc.query(
                "SELECT balance_centavos FROM wallet_accounts WHERE tenant_id = ?::uuid",
                rs -> rs.next() ? rs.getLong(1) : null,
                tenantId);
        return balance == null ? 0L : balance;
    }

    /** Re-derives the balance from the ledger. Disagreement with the projection is a bug. */
    public long recomputeBalance(String tenantId) {
        Long sum = jdbc.queryForObject(
                "SELECT COALESCE(SUM(amount_centavos), 0) FROM wallet_ledger WHERE tenant_id = ?::uuid",
                Long.class, tenantId);
        return sum == null ? 0L : sum;
    }

    public WalletSummary summaryFor(String tenantId) {
        long balance = getBalance(tenantId);
        var config = pricing.getFor(tenantId);
        Integer blocked = jdbc.queryForObject(
                "SELECT count(*) FROM submissions WHERE tenant_id = ?::uuid AND state = 'BLOCKED'",
                Integer.class, tenantId);
        return new WalletSummary(
                tenantId,
                balance,
                balance < config.lowBalanceThresholdCentavos(),
                balance < 0,
                blocked == null ? 0 : blocked,
                config.chargePerUploadCentavos(),
                config.lowBalanceThresholdCentavos(),
                config.updatedAt()
        );
    }

    public List<Map<String, Object>> ledgerFor(String tenantId, int limit) {
        return jdbc.queryForList("""
                SELECT id, entry_type, amount_centavos, balance_after,
                       submission_id::text, acceptance_seq, created_by, note, created_at
                  FROM wallet_ledger
                 WHERE tenant_id = ?::uuid
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?
                """, tenantId, limit);
    }

    // ---------------------------------------------------------------- writes

    /**
     * Locks the tenant's wallet row for the remainder of the current
     * transaction and returns the balance.
     *
     * MANDATORY propagation: a FOR UPDATE outside a transaction releases its
     * lock immediately, so the read-modify-write below would race. Declaring
     * MANDATORY turns that mistake into a startup-visible failure instead of an
     * intermittent accounting bug.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public long lockAndGetBalance(String tenantId) {
        // A center that has never been topped up still needs a lockable row.
        jdbc.update("""
                INSERT INTO wallet_accounts (tenant_id) VALUES (?::uuid)
                ON CONFLICT (tenant_id) DO NOTHING
                """, tenantId);
        Long balance = jdbc.queryForObject(
                "SELECT balance_centavos FROM wallet_accounts WHERE tenant_id = ?::uuid FOR UPDATE",
                Long.class, tenantId);
        return balance == null ? 0L : balance;
    }

    /**
     * Debits the per-upload charge for one acceptance event.
     *
     * Must run inside the caller's transaction so the debit commits atomically
     * with the ACCEPTED state change — see SubmissionService.markAcceptedAndCharge.
     *
     * Idempotent per (submissionId, acceptanceSeq): a redelivery of the same
     * acceptance hits the partial unique index and is swallowed. A genuinely
     * new acceptance of the same submission (rejected, corrected, accepted
     * again) carries a higher acceptanceSeq and IS charged.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void chargeForAcceptance(String tenantId, String submissionId, int acceptanceSeq) {
        Long amountValue = jdbc.queryForObject("""
                SELECT charge_snapshot_centavos
                  FROM submissions
                 WHERE id = ?::uuid AND tenant_id = ?::uuid
                """, Long.class, submissionId, tenantId);
        if (amountValue == null) {
            throw new IllegalStateException("Submission price snapshot is missing: " + submissionId);
        }
        long amount = amountValue;
        if (amount <= 0) {
            return;
        }
        long balance = lockAndGetBalance(tenantId);
        long balanceAfter = balance - amount;

        try {
            jdbc.update("""
                    INSERT INTO wallet_ledger
                        (tenant_id, entry_type, amount_centavos, balance_after,
                         submission_id, acceptance_seq, created_by, note)
                    VALUES (?::uuid, 'CHARGE', ?, ?, ?::uuid, ?, 'system', ?)
                    """,
                    tenantId, -amount, balanceAfter, submissionId, acceptanceSeq,
                    "LTMS submission accepted");
        } catch (DuplicateKeyException e) {
            // Same acceptance already charged. Not an error: the acceptance
            // itself must still succeed, so swallow rather than propagate.
            log.debug("Charge already recorded for submission {} seq {} — skipping",
                    submissionId, acceptanceSeq);
            return;
        }

        applyBalance(tenantId, balanceAfter);
        audit.recordSystem(tenantId, "WALLET_CHARGE", "submission", submissionId,
                Map.of("amountCentavos", -amount,
                       "balanceAfter", balanceAfter,
                       "acceptanceSeq", acceptanceSeq));
    }

    /**
     * Credits a center and releases anything held for want of funds.
     *
     * The top-up is recorded as an immutable ledger row with the acting super
     * admin and an external payment reference; the balance is never edited
     * directly. Swapping a payment gateway in later changes only who writes
     * this row.
     */
    @Transactional
    public TopUpResult topUp(
            String tenantId, long amountCentavos, String reference,
            String superAdminId, String actorLabel
    ) {
        long balance = lockAndGetBalance(tenantId);
        long balanceAfter = balance + amountCentavos;

        jdbc.update("""
                INSERT INTO wallet_ledger
                    (tenant_id, entry_type, amount_centavos, balance_after, created_by, note)
                VALUES (?::uuid, 'TOPUP', ?, ?, ?, ?)
                """, tenantId, amountCentavos, balanceAfter, actorLabel, reference);

        applyBalance(tenantId, balanceAfter);
        audit.recordSuperAdmin(superAdminId, actorLabel, tenantId,
                "WALLET_TOPUP", "wallet", tenantId,
                Map.of("amountCentavos", amountCentavos,
                       "balanceAfter", balanceAfter,
                       "reference", reference == null ? "" : reference));

        int released = releaseBlocked(tenantId, balanceAfter);
        return new TopUpResult(balanceAfter, released);
    }

    /**
     * Returns held submissions to the dispatch queue, oldest first, while the
     * balance covers them. Rows beyond what the top-up affords stay BLOCKED.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public int releaseBlocked(String tenantId, long balance) {
        List<BlockedSubmission> blocked = jdbc.query("""
                SELECT id::text, charge_snapshot_centavos FROM submissions
                 WHERE tenant_id = ?::uuid AND state = 'BLOCKED'
                 ORDER BY blocked_at
                """, (rs, rowNum) -> new BlockedSubmission(
                        rs.getString(1), rs.getLong(2)), tenantId);

        int released = 0;
        long remaining = balance;
        for (BlockedSubmission sub : blocked) {
            // Preserve FIFO. A later cheaper quote must not jump an older held
            // filing merely because the newer one happens to fit.
            if (sub.chargeCentavos() > remaining) {
                break;
            }
            jdbc.update("""
                    UPDATE submissions
                       SET state = 'PENDING', blocked_at = NULL, next_attempt_at = now()
                     WHERE id = ?::uuid AND state = 'BLOCKED'
                    """, sub.id());
            remaining -= sub.chargeCentavos();
            released++;
            audit.recordSystem(tenantId, "SUBMISSION_RELEASED", "submission", sub.id(),
                    Map.of("reason", "wallet topped up",
                           "quotedChargeCentavos", sub.chargeCentavos()));
        }
        return released;
    }

    private void applyBalance(String tenantId, long balanceAfter) {
        jdbc.update("""
                UPDATE wallet_accounts
                   SET balance_centavos = ?, updated_at = now()
                 WHERE tenant_id = ?::uuid
                """, balanceAfter, tenantId);
    }

    // ---------------------------------------------------------------- schema

    public record WalletSummary(
            String tenantId,
            long balanceCentavos,
            boolean low,
            boolean negative,
            int blockedCount,
            long chargePerUploadCentavos,
            long lowBalanceThresholdCentavos,
            OffsetDateTime pricingUpdatedAt
    ) {}

    public record TopUpResult(long balanceCentavos, int releasedSubmissions) {}

    private record BlockedSubmission(String id, long chargeCentavos) {}
}
