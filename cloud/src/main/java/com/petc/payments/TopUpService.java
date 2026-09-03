package com.petc.payments;

import com.petc.billing.BillingMode;
import com.petc.billing.BillingService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class TopUpService {
    private final JdbcTemplate jdbc;
    private final BillingService billing;
    private final QrPaymentGateway gateway;
    private final TopUpFulfillmentService fulfillment;
    private final PayMongoProperties properties;

    public TopUpService(JdbcTemplate jdbc, BillingService billing, QrPaymentGateway gateway,
                        TopUpFulfillmentService fulfillment, PayMongoProperties properties) {
        this.jdbc = jdbc;
        this.billing = billing;
        this.gateway = gateway;
        this.fulfillment = fulfillment;
        this.properties = properties;
    }

    public TopUpView create(String tenantId, long amountCentavos, UUID clientRequestId) {
        if (billing.profileFor(tenantId).mode() != BillingMode.PREPAID) {
            throw new IllegalStateException("Wallet reloads are available only to prepaid centers");
        }
        if (!gateway.available()) throw new PayMongoException("payments_disabled", "QR payments are not configured");
        if (amountCentavos < properties.getMinimumTopupCentavos()
                || amountCentavos > properties.getMaximumTopupCentavos()) {
            throw new IllegalArgumentException("Top-up amount is outside the configured limits");
        }
        List<TopUpView> existing = views("""
                WHERE tenant_id = ?::uuid AND client_request_id = ?::uuid
                """, tenantId, clientRequestId.toString());
        if (!existing.isEmpty()) return existing.getFirst();

        String id = UUID.randomUUID().toString();
        jdbc.update("""
                INSERT INTO payment_topups
                    (id, tenant_id, client_request_id, create_idempotency_key,
                     amount_centavos, currency, status)
                VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, 'PHP', 'CREATING')
                ON CONFLICT (tenant_id, client_request_id) DO NOTHING
                """, id, tenantId, clientRequestId.toString(), "topup-" + id, amountCentavos);
        TopUpView row = getByClientRequest(tenantId, clientRequestId);
        if (!id.equals(row.id())) return row;

        try {
            persistCreatedQr(tenantId, id, gateway.create(id, amountCentavos));
            return get(tenantId, id);
        } catch (PayMongoException e) {
            if (!"provider_unavailable".equals(e.code()) && !"provider_interrupted".equals(e.code())) {
                jdbc.update("""
                        UPDATE payment_topups
                           SET status = 'FAILED', failure_code = ?, failure_message = ?,
                               updated_at = now()
                         WHERE id = ?::uuid AND tenant_id = ?::uuid
                        """, e.code(), e.getMessage(), id, tenantId);
            }
            throw e;
        }
    }

    public TopUpView get(String tenantId, String topupId) {
        List<TopUpView> rows = views("WHERE tenant_id = ?::uuid AND id = ?::uuid", tenantId, topupId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public TopUpView getByClientRequest(String tenantId, UUID clientRequestId) {
        List<TopUpView> rows = views("WHERE tenant_id = ?::uuid AND client_request_id = ?::uuid",
                tenantId, clientRequestId.toString());
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public List<TopUpView> recent(String tenantId, int limit) {
        return views("WHERE tenant_id = ?::uuid ORDER BY created_at DESC LIMIT ?",
                tenantId, Math.clamp(limit, 1, 50));
    }

    public void reconcileIntent(String paymentIntentId) {
        QrPaymentGateway.PaymentState state = gateway.retrieve(paymentIntentId);
        if (state.succeeded()) fulfillment.fulfill(state);
    }

    public void reconcilePending() {
        if (!gateway.available()) return;
        List<CreatingTopUp> creating = jdbc.query("""
                SELECT id::text, tenant_id::text, amount_centavos
                  FROM payment_topups
                 WHERE status = 'CREATING'
                 ORDER BY created_at LIMIT 20
                """, (rs, rowNum) -> new CreatingTopUp(rs.getString("id"),
                rs.getString("tenant_id"), rs.getLong("amount_centavos")));
        for (CreatingTopUp topup : creating) {
            try {
                persistCreatedQr(topup.tenantId(), topup.id(), gateway.create(topup.id(), topup.amountCentavos()));
            } catch (PayMongoException ignored) {
                // Same persisted local ID produces the same PayMongo idempotency keys next pass.
            }
        }
        List<String> pending = jdbc.queryForList("""
                SELECT provider_payment_intent_id FROM payment_topups
                 WHERE status = 'AWAITING_PAYMENT' AND provider_payment_intent_id IS NOT NULL
                 ORDER BY updated_at LIMIT 50
                """, String.class);
        for (String intentId : pending) {
            try {
                reconcileIntent(intentId);
            } catch (PayMongoException ignored) {
                // Keep pending. The next pass or a webhook can repair it.
            }
        }
        jdbc.update("""
                UPDATE payment_topups
                   SET status = 'EXPIRED', qr_image = NULL, test_url = NULL, updated_at = now()
                 WHERE status = 'AWAITING_PAYMENT' AND expires_at < now()
                """);
    }

    private void persistCreatedQr(String tenantId, String id, QrPaymentGateway.CreatedQr created) {
        jdbc.update("""
                UPDATE payment_topups
                   SET provider_payment_intent_id = ?, provider_payment_method_id = ?,
                       status = 'AWAITING_PAYMENT', livemode = ?, qr_image = ?, test_url = ?,
                       expires_at = ?, failure_code = NULL, failure_message = NULL,
                       updated_at = now()
                 WHERE id = ?::uuid AND tenant_id = ?::uuid AND status = 'CREATING'
                """, created.paymentIntentId(), created.paymentMethodId(), created.liveMode(),
                created.qrImage(), properties.isExposeTestUrl() && !created.liveMode() ? created.testUrl() : null,
                Timestamp.from(created.expiresAt()), id, tenantId);
    }

    private List<TopUpView> views(String suffix, Object... args) {
        return jdbc.query("""
                SELECT id::text, client_request_id::text, amount_centavos, currency, status,
                       provider_payment_intent_id, provider_payment_id, livemode,
                       qr_image, test_url, expires_at, paid_at, failure_code,
                       failure_message, created_at, updated_at
                  FROM payment_topups
                """ + suffix, (rs, rowNum) -> new TopUpView(
                rs.getString("id"), rs.getString("client_request_id"),
                rs.getLong("amount_centavos"), rs.getString("currency"), rs.getString("status"),
                rs.getString("provider_payment_intent_id"), rs.getString("provider_payment_id"),
                (Boolean) rs.getObject("livemode"), rs.getString("qr_image"), rs.getString("test_url"),
                instant(rs.getTimestamp("expires_at")), instant(rs.getTimestamp("paid_at")),
                rs.getString("failure_code"), rs.getString("failure_message"),
                rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant()), args);
    }

    private static Instant instant(Timestamp value) { return value == null ? null : value.toInstant(); }

    public record TopUpView(String id, String clientRequestId, long amountCentavos, String currency,
                            String status, String paymentIntentId, String paymentId, Boolean liveMode,
                            String qrImage, String testUrl, Instant expiresAt, Instant paidAt,
                            String failureCode, String failureMessage, Instant createdAt, Instant updatedAt) {}
    private record CreatingTopUp(String id, String tenantId, long amountCentavos) {}
}
