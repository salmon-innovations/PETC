package com.petc.payments;

final class DisabledQrPaymentGateway implements QrPaymentGateway {
    @Override public boolean available() { return false; }
    @Override public CreatedQr create(String localTopupId, long amountCentavos) {
        throw new PayMongoException("payments_disabled", "QR payments are not configured");
    }
    @Override public PaymentState retrieve(String paymentIntentId) {
        throw new PayMongoException("payments_disabled", "QR payments are not configured");
    }
}
