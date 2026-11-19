package com.petc.billing;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Catch-up-safe invoice finalization; database constraints make every pass idempotent. */
@Component
public class BillingInvoiceScheduler {
    private static final Logger log = LoggerFactory.getLogger(BillingInvoiceScheduler.class);
    private final BillingService billing;

    public BillingInvoiceScheduler(BillingService billing) {
        this.billing = billing;
    }

    @Scheduled(fixedDelayString = "${petc.billing.finalizer-delay-ms:60000}")
    public void finalizeClosedUsage() {
        for (BillingService.TenantWindow window : billing.closedUsageWindows()) {
            try {
                String invoiceId = billing.finalizeWindow(window);
                if (invoiceId != null) log.info("Finalized postpaid invoice {}", invoiceId);
            } catch (Exception e) {
                log.error("Could not finalize postpaid window for tenant {}", window.tenantId(), e);
            }
        }
        billing.markPastDue();
    }
}
