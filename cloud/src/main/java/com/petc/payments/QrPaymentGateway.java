package com.petc.payments;

import java.time.Instant;

public interface QrPaymentGateway {
    boolean available();

    CreatedQr create(String localTopupId, long amountCentavos);

    PaymentState retrieve(String paymentIntentId);

    record CreatedQr(String paymentIntentId, String paymentMethodId, String qrImage,
                     String testUrl, Instant expiresAt, boolean liveMode) {}

    record PaymentState(String paymentIntentId, String paymentId, String status,
                        long amountCentavos, String currency, String sourceType,
                        boolean liveMode) {
        public boolean succeeded() { return "succeeded".equalsIgnoreCase(status); }
    }
}
