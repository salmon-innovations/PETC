package com.petc.billing;

import com.petc.audit.AuditService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Accepted-CEC usage, center billing profiles, and semi-monthly invoices. */
@Service
public class BillingService {

    public static final ZoneId DEFAULT_ZONE = ZoneId.of("Asia/Manila");

    private final JdbcTemplate jdbc;
    private final AuditService audit;
    private final Clock clock;

    @Autowired
    public BillingService(JdbcTemplate jdbc, AuditService audit) {
        this(jdbc, audit, Clock.systemUTC());
    }

    BillingService(JdbcTemplate jdbc, AuditService audit, Clock clock) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional
    public BillingProfile profileFor(String tenantId) {
        jdbc.update("""
                INSERT INTO billing_profiles (tenant_id, updated_by)
                SELECT id, 'system' FROM tenants WHERE id = ?::uuid
                ON CONFLICT (tenant_id) DO NOTHING
                """, tenantId);
        return jdbc.queryForObject("""
                SELECT mode, revision, timezone, payment_terms_days, credit_limit_centavos,
                       effective_at, updated_at, updated_by
                  FROM billing_profiles WHERE tenant_id = ?::uuid
                """, (rs, rowNum) -> new BillingProfile(
                        BillingMode.valueOf(rs.getString("mode")),
                        rs.getLong("revision"),
                        rs.getString("timezone"),
                        rs.getInt("payment_terms_days"),
                        (Long) rs.getObject("credit_limit_centavos"),
                        rs.getTimestamp("effective_at").toInstant(),
                        rs.getTimestamp("updated_at").toInstant(),
                        rs.getString("updated_by")
                ), tenantId);
    }

    public BillingSnapshot snapshotFor(String tenantId) {
        BillingProfile profile = profileFor(tenantId);
        return new BillingSnapshot(profile.mode(), profile.revision());
    }

    @Transactional
    public BillingProfile setMode(
            String tenantId,
            BillingMode mode,
            int paymentTermsDays,
            Long creditLimitCentavos,
            String superAdminId,
            String actorLabel
    ) {
        if (paymentTermsDays < 0 || paymentTermsDays > 365) {
            throw new IllegalArgumentException("Payment terms must be between 0 and 365 days");
        }
        BillingProfile before = profileFor(tenantId);
        if (before.mode() == BillingMode.PREPAID && mode == BillingMode.POSTPAID) {
            Integer blocked = jdbc.queryForObject("""
                    SELECT count(*) FROM submissions
                     WHERE tenant_id = ?::uuid AND state = 'BLOCKED'
                    """, Integer.class, tenantId);
            if (blocked != null && blocked > 0) {
                throw new IllegalStateException(
                        "Resolve the center's blocked prepaid submissions before switching to postpaid");
            }
        }
        jdbc.update("""
                UPDATE billing_profiles
                   SET mode = ?, payment_terms_days = ?, credit_limit_centavos = ?,
                       revision = revision + 1, effective_at = now(), updated_at = now(), updated_by = ?
                 WHERE tenant_id = ?::uuid
                """, mode.name(), paymentTermsDays, creditLimitCentavos, actorLabel, tenantId);
        BillingProfile after = profileFor(tenantId);
        audit.recordSuperAdmin(superAdminId, actorLabel, tenantId,
                "CENTER_BILLING_PROFILE_CHANGED", "tenant", tenantId,
                Map.of("beforeMode", before.mode().name(),
                       "afterMode", after.mode().name(),
                       "revision", after.revision(),
                       "paymentTermsDays", after.paymentTermsDays()));
        return after;
    }

    /** Must commit in the same transaction as the accepted submission state. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordUsage(
            String tenantId,
            String submissionId,
            int acceptanceSeq,
            BillingMode mode,
            long amountCentavos,
            Instant acceptedAt
    ) {
        jdbc.update("""
                INSERT INTO billing_usage
                    (tenant_id, submission_id, acceptance_seq, billing_mode,
                     amount_centavos, accepted_at)
                VALUES (?::uuid, ?::uuid, ?, ?, ?, ?)
                ON CONFLICT (submission_id, acceptance_seq) DO NOTHING
                """, tenantId, submissionId, acceptanceSeq, mode.name(), amountCentavos,
                Timestamp.from(acceptedAt));
    }

    public PostpaidSummary postpaidSummary(String tenantId, BillingProfile profile) {
        BillingWindow window = containing(clock.instant(), ZoneId.of(profile.timezone()));
        Map<String, Object> usage = jdbc.queryForMap("""
                SELECT count(*) AS usage_count, COALESCE(sum(amount_centavos), 0) AS estimate
                  FROM billing_usage
                 WHERE tenant_id = ?::uuid AND billing_mode = 'POSTPAID'
                   AND accepted_at >= ? AND accepted_at < ?
                """, tenantId, Timestamp.from(window.start()), Timestamp.from(window.end()));
        Map<String, Object> exposure = jdbc.queryForMap("""
                SELECT COALESCE(sum(total_centavos - amount_paid_centavos)
                        FILTER (WHERE status IN ('OPEN','PARTIALLY_PAID','PAST_DUE')), 0) AS open_total,
                       COALESCE(sum(total_centavos - amount_paid_centavos)
                        FILTER (WHERE status = 'PAST_DUE'), 0) AS past_due_total,
                       count(*) FILTER (WHERE status = 'PAST_DUE') AS past_due_count
                  FROM billing_invoices WHERE tenant_id = ?::uuid
                """, tenantId);
        return new PostpaidSummary(
                ((Number) usage.get("usage_count")).intValue(),
                ((Number) usage.get("estimate")).longValue(),
                window.start(), window.end(),
                ((Number) exposure.get("open_total")).longValue(),
                ((Number) exposure.get("past_due_total")).longValue(),
                ((Number) exposure.get("past_due_count")).intValue());
    }

    public List<Map<String, Object>> invoicesFor(String tenantId, int limit) {
        return jdbc.queryForList("""
                SELECT id::text, invoice_number, period_start, period_end, issued_at, due_at,
                       subtotal_centavos, adjustment_centavos, total_centavos,
                       amount_paid_centavos, status, center_name_snapshot
                  FROM billing_invoices
                 WHERE tenant_id = ?::uuid
                 ORDER BY period_end DESC LIMIT ?
                """, tenantId, Math.clamp(limit, 1, 100));
    }

    public List<Map<String, Object>> unbilledUsageFor(String tenantId, int limit) {
        return jdbc.queryForList("""
                SELECT u.id::text, u.submission_id::text, s.test_id, s.cec_number,
                       u.acceptance_seq, u.amount_centavos, u.accepted_at
                  FROM billing_usage u
                  JOIN submissions s ON s.id = u.submission_id
                 WHERE u.tenant_id = ?::uuid AND u.billing_mode = 'POSTPAID'
                   AND u.invoice_id IS NULL
                 ORDER BY u.accepted_at DESC LIMIT ?
                """, tenantId, Math.clamp(limit, 1, 200));
    }

    public Map<String, Object> invoiceFor(String tenantId, String invoiceId) {
        var invoices = jdbc.queryForList("""
                SELECT id::text, invoice_number, period_start, period_end, issued_at, due_at,
                       subtotal_centavos, adjustment_centavos, total_centavos,
                       amount_paid_centavos, status, center_name_snapshot, billing_timezone
                  FROM billing_invoices
                 WHERE tenant_id = ?::uuid AND id = ?::uuid
                """, tenantId, invoiceId);
        if (invoices.isEmpty()) return Map.of();
        Map<String, Object> result = new LinkedHashMap<>(invoices.getFirst());
        result.put("lines", jdbc.queryForList("""
                SELECT description, quantity, unit_amount_centavos, amount_centavos
                  FROM billing_invoice_lines WHERE invoice_id = ?::uuid ORDER BY id
                """, invoiceId));
        result.put("usage", jdbc.queryForList("""
                SELECT u.submission_id::text, s.test_id, s.cec_number, u.acceptance_seq,
                       u.amount_centavos, u.accepted_at
                  FROM billing_usage u
                  JOIN submissions s ON s.id = u.submission_id
                 WHERE u.invoice_id = ?::uuid ORDER BY u.accepted_at, u.id
                """, invoiceId));
        result.put("payments", jdbc.queryForList("""
                SELECT id::text, amount_centavos, method, external_reference,
                       recorded_by, paid_at, created_at
                  FROM billing_payments WHERE invoice_id = ?::uuid ORDER BY paid_at, id
                """, invoiceId));
        return result;
    }

    /** Find closed windows containing uninvoiced postpaid usage. */
    public Set<TenantWindow> closedUsageWindows() {
        Instant now = clock.instant();
        Set<TenantWindow> windows = new LinkedHashSet<>();
        jdbc.query("""
                SELECT u.tenant_id::text, u.accepted_at,
                       COALESCE(p.timezone, 'Asia/Manila') AS timezone
                  FROM billing_usage u
                  LEFT JOIN billing_profiles p ON p.tenant_id = u.tenant_id
                 WHERE u.billing_mode = 'POSTPAID' AND u.invoice_id IS NULL
                 ORDER BY u.accepted_at
                """, rs -> {
            ZoneId zone = ZoneId.of(rs.getString("timezone"));
            BillingWindow window = containing(rs.getTimestamp("accepted_at").toInstant(), zone);
            if (!window.end().isAfter(now)) {
                windows.add(new TenantWindow(rs.getString("tenant_id"), zone.getId(), window));
            }
        });
        return windows;
    }

    @Transactional
    public String finalizeWindow(TenantWindow target) {
        List<String> usageIds = jdbc.query("""
                SELECT id::text FROM billing_usage
                 WHERE tenant_id = ?::uuid AND billing_mode = 'POSTPAID' AND invoice_id IS NULL
                   AND accepted_at >= ? AND accepted_at < ?
                 ORDER BY accepted_at, id
                 FOR UPDATE
                """, (rs, rowNum) -> rs.getString(1), target.tenantId(),
                Timestamp.from(target.window().start()), Timestamp.from(target.window().end()));
        if (usageIds.isEmpty()) return null;

        Map<String, Object> tenant = jdbc.queryForMap("""
                SELECT t.slug, t.name, COALESCE(p.payment_terms_days, 7) AS terms
                  FROM tenants t LEFT JOIN billing_profiles p ON p.tenant_id = t.id
                 WHERE t.id = ?::uuid
                """, target.tenantId());
        ZoneId zone = ZoneId.of(target.timezone());
        LocalDate statementDate = target.window().end().atZone(zone).toLocalDate().minusDays(1);
        String invoiceNumber = "INV-" + statementDate.toString().replace("-", "") + "-"
                + tenant.get("slug").toString().toUpperCase();
        Instant issuedAt = clock.instant();
        Instant dueAt = issuedAt.plusSeconds(((Number) tenant.get("terms")).longValue() * 86_400L);

        List<String> inserted = jdbc.query("""
                    INSERT INTO billing_invoices
                        (tenant_id, invoice_number, period_start, period_end, issued_at, due_at,
                         center_name_snapshot, billing_timezone)
                    VALUES (?::uuid, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (tenant_id, period_start, period_end) DO NOTHING
                    RETURNING id::text
                    """, (rs, rowNum) -> rs.getString(1), target.tenantId(), invoiceNumber,
                    Timestamp.from(target.window().start()), Timestamp.from(target.window().end()),
                    Timestamp.from(issuedAt), Timestamp.from(dueAt), tenant.get("name"), target.timezone());
        if (inserted.isEmpty()) {
            return jdbc.queryForObject("""
                    SELECT id::text FROM billing_invoices
                     WHERE tenant_id = ?::uuid AND period_start = ? AND period_end = ?
                    """, String.class, target.tenantId(), Timestamp.from(target.window().start()),
                    Timestamp.from(target.window().end()));
        }
        String invoiceId = inserted.getFirst();

        jdbc.update("""
                UPDATE billing_usage SET invoice_id = ?::uuid
                 WHERE tenant_id = ?::uuid AND billing_mode = 'POSTPAID' AND invoice_id IS NULL
                   AND accepted_at >= ? AND accepted_at < ?
                """, invoiceId, target.tenantId(), Timestamp.from(target.window().start()),
                Timestamp.from(target.window().end()));

        List<Map<String, Object>> groups = jdbc.queryForList("""
                SELECT amount_centavos AS unit_amount, count(*) AS quantity,
                       sum(amount_centavos) AS line_total
                  FROM billing_usage WHERE invoice_id = ?::uuid
                 GROUP BY amount_centavos ORDER BY amount_centavos
                """, invoiceId);
        long subtotal = 0;
        for (Map<String, Object> group : groups) {
            long unit = ((Number) group.get("unit_amount")).longValue();
            int quantity = ((Number) group.get("quantity")).intValue();
            long lineTotal = ((Number) group.get("line_total")).longValue();
            subtotal += lineTotal;
            jdbc.update("""
                    INSERT INTO billing_invoice_lines
                        (invoice_id, description, quantity, unit_amount_centavos, amount_centavos)
                    VALUES (?::uuid, 'LTMS-accepted CEC uploads', ?, ?, ?)
                    """, invoiceId, quantity, unit, lineTotal);
        }
        jdbc.update("""
                UPDATE billing_invoices
                   SET subtotal_centavos = ?, total_centavos = ? + adjustment_centavos,
                       updated_at = now()
                 WHERE id = ?::uuid
                """, subtotal, subtotal, invoiceId);
        audit.recordSystem(target.tenantId(), "POSTPAID_INVOICE_FINALIZED", "invoice", invoiceId,
                Map.of("invoiceNumber", invoiceNumber, "usageCount", usageIds.size(),
                       "subtotalCentavos", subtotal));
        return invoiceId;
    }

    @Transactional
    public PaymentResult recordPayment(
            String tenantId,
            String invoiceId,
            long amountCentavos,
            String method,
            String externalReference,
            Instant paidAt,
            String superAdminId,
            String actorLabel
    ) {
        List<Map<String, Object>> invoices = jdbc.queryForList("""
                SELECT total_centavos, amount_paid_centavos, status
                  FROM billing_invoices
                 WHERE id = ?::uuid AND tenant_id = ?::uuid FOR UPDATE
                """, invoiceId, tenantId);
        if (invoices.isEmpty()) throw new IllegalArgumentException("No such invoice");
        Map<String, Object> invoice = invoices.getFirst();
        if ("VOID".equals(invoice.get("status"))) throw new IllegalStateException("Cannot pay a void invoice");
        long total = ((Number) invoice.get("total_centavos")).longValue();
        long paid = ((Number) invoice.get("amount_paid_centavos")).longValue();
        long outstanding = total - paid;
        if (amountCentavos <= 0 || amountCentavos > outstanding) {
            throw new IllegalArgumentException("Payment must be positive and no greater than the outstanding total");
        }
        jdbc.update("""
                INSERT INTO billing_payments
                    (tenant_id, invoice_id, amount_centavos, method, external_reference,
                     recorded_by, paid_at)
                VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, ?)
                """, tenantId, invoiceId, amountCentavos, method, externalReference,
                actorLabel, Timestamp.from(paidAt));
        long paidAfter = paid + amountCentavos;
        String status = paidAfter == total ? "PAID"
                : "PAST_DUE".equals(invoice.get("status")) ? "PAST_DUE" : "PARTIALLY_PAID";
        jdbc.update("""
                UPDATE billing_invoices
                   SET amount_paid_centavos = ?, status = ?, updated_at = now()
                 WHERE id = ?::uuid
                """, paidAfter, status, invoiceId);
        audit.recordSuperAdmin(superAdminId, actorLabel, tenantId,
                "POSTPAID_PAYMENT_RECORDED", "invoice", invoiceId,
                Map.of("amountCentavos", amountCentavos, "externalReference", externalReference));
        return new PaymentResult(paidAfter, total - paidAfter, status);
    }

    @Transactional
    public int markPastDue() {
        return jdbc.update("""
                UPDATE billing_invoices SET status = 'PAST_DUE', updated_at = now()
                 WHERE status IN ('OPEN','PARTIALLY_PAID')
                   AND amount_paid_centavos < total_centavos AND due_at < now()
                """);
    }

    static BillingWindow containing(Instant instant, ZoneId zone) {
        ZonedDateTime local = instant.atZone(zone);
        LocalDate startDate;
        LocalDate endDate;
        if (local.getDayOfMonth() <= 15) {
            startDate = local.toLocalDate().withDayOfMonth(1);
            endDate = local.toLocalDate().withDayOfMonth(16);
        } else {
            startDate = local.toLocalDate().withDayOfMonth(16);
            endDate = local.toLocalDate().plusMonths(1).withDayOfMonth(1);
        }
        return new BillingWindow(startDate.atStartOfDay(zone).toInstant(),
                endDate.atStartOfDay(zone).toInstant());
    }

    public record BillingProfile(BillingMode mode, long revision, String timezone,
                                 int paymentTermsDays, Long creditLimitCentavos,
                                 Instant effectiveAt, Instant updatedAt, String updatedBy) {}
    public record BillingSnapshot(BillingMode mode, long revision) {}
    public record BillingWindow(Instant start, Instant end) {}
    public record TenantWindow(String tenantId, String timezone, BillingWindow window) {}
    public record PostpaidSummary(int currentUsageCount, long currentEstimateCentavos,
                                  Instant periodStart, Instant nextCutoff,
                                  long openTotalCentavos, long pastDueTotalCentavos,
                                  int pastDueInvoiceCount) {}
    public record PaymentResult(long amountPaidCentavos, long outstandingCentavos, String status) {}
}
