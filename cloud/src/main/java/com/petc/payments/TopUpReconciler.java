package com.petc.payments;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class TopUpReconciler {
    private final TopUpService topups;

    public TopUpReconciler(TopUpService topups) { this.topups = topups; }

    @Scheduled(fixedDelayString = "${petc.paymongo.reconcile-delay-ms:30000}")
    public void reconcile() { topups.reconcilePending(); }
}
