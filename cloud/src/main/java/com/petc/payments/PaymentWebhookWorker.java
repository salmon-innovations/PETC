package com.petc.payments;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class PaymentWebhookWorker {
    private final PaymentWebhookService webhooks;
    private final TopUpService topups;

    public PaymentWebhookWorker(PaymentWebhookService webhooks, TopUpService topups) {
        this.webhooks = webhooks;
        this.topups = topups;
    }

    @Scheduled(fixedDelayString = "${petc.paymongo.webhook-worker-delay-ms:1000}")
    public void process() {
        for (PaymentWebhookService.ClaimedEvent event : webhooks.claim(20)) {
            try {
                String intentId = webhooks.paymentIntentId(event);
                if (intentId == null || !("payment.paid".equals(event.eventType())
                        || "payment_intent.succeeded".equals(event.eventType()))) {
                    webhooks.complete(event.eventId(), "IGNORED", null);
                    continue;
                }
                topups.reconcileIntent(intentId);
                webhooks.complete(event.eventId(), "PROCESSED", null);
            } catch (Exception e) {
                webhooks.complete(event.eventId(), "FAILED", "Payment reconciliation failed");
            }
        }
    }
}
