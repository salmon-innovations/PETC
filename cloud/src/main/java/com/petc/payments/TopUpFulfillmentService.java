package com.petc.payments;

import com.petc.wallet.WalletService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;

@Service
public class TopUpFulfillmentService {
    private final JdbcTemplate jdbc;
    private final WalletService wallet;

    public TopUpFulfillmentService(JdbcTemplate jdbc, WalletService wallet) {
        this.jdbc = jdbc;
        this.wallet = wallet;
    }

    @Transactional
    public void fulfill(QrPaymentGateway.PaymentState provider) {
        var rows = jdbc.queryForList("""
                SELECT id::text, tenant_id::text, amount_centavos, currency, status, livemode
                  FROM payment_topups
                 WHERE provider_payment_intent_id = ?
                 FOR UPDATE
                """, provider.paymentIntentId());
        if (rows.isEmpty()) return;
        Map<String, Object> topup = rows.getFirst();
        if ("PAID".equals(topup.get("status"))) return;

        long expectedAmount = ((Number) topup.get("amount_centavos")).longValue();
        boolean expectedLive = Boolean.TRUE.equals(topup.get("livemode"));
        boolean valid = provider.succeeded()
                && provider.paymentId() != null
                && provider.amountCentavos() == expectedAmount
                && "PHP".equalsIgnoreCase(provider.currency())
                && "qrph".equalsIgnoreCase(provider.sourceType())
                && provider.liveMode() == expectedLive;
        if (!valid) {
            jdbc.update("""
                    UPDATE payment_topups
                       SET status = 'FAILED', failure_code = 'verification_failed',
                           failure_message = 'Provider payment did not match the requested QR top-up',
                           qr_image = NULL, test_url = NULL, updated_at = now()
                     WHERE id = ?::uuid
                    """, topup.get("id"));
            return;
        }

        jdbc.update("""
                UPDATE payment_topups
                   SET status = 'PAID', provider_payment_id = ?, paid_at = ?,
                       qr_image = NULL, test_url = NULL, failure_code = NULL,
                       failure_message = NULL, updated_at = now()
                 WHERE id = ?::uuid
                """, provider.paymentId(), Timestamp.from(Instant.now()), topup.get("id"));
        wallet.topUpFromProvider(topup.get("tenant_id").toString(), expectedAmount,
                "PAYMONGO", provider.paymentId());
    }
}
