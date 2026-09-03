package com.petc.billing;

import com.petc.ingest.CenterKeyValidator;
import com.petc.payments.TopUpService;
import com.petc.wallet.WalletService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/billing/me")
public class CenterBillingController {
    private final CenterKeyValidator keyValidator;
    private final BillingService billing;
    private final WalletService wallet;
    private final TopUpService topups;

    public CenterBillingController(CenterKeyValidator keyValidator, BillingService billing,
                                   WalletService wallet, TopUpService topups) {
        this.keyValidator = keyValidator;
        this.billing = billing;
        this.wallet = wallet;
        this.topups = topups;
    }

    @GetMapping
    public BillingSummary summary(@RequestHeader("X-Center-Key") String centerKey) {
        String tenantId = keyValidator.validateContext(centerKey).tenantId();
        BillingService.BillingProfile profile = billing.profileFor(tenantId);
        if (profile.mode() == BillingMode.PREPAID) {
            WalletService.WalletSummary summary = wallet.summaryFor(tenantId);
            return BillingSummary.prepaid(profile, summary);
        }
        return BillingSummary.postpaid(profile, billing.postpaidSummary(tenantId, profile),
                wallet.chargePerUploadCentavos(tenantId));
    }

    @PostMapping("/topups")
    @ResponseStatus(HttpStatus.CREATED)
    public TopUpService.TopUpView createTopUp(
            @RequestHeader("X-Center-Key") String centerKey,
            @Valid @RequestBody CreateTopUpRequest request
    ) {
        String tenantId = keyValidator.validateContext(centerKey).tenantId();
        try {
            return topups.create(tenantId, request.amountCentavos(), request.clientRequestId());
        } catch (IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, e.getMessage());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    @GetMapping("/topups/{topupId}")
    public TopUpService.TopUpView topUp(
            @RequestHeader("X-Center-Key") String centerKey,
            @PathVariable String topupId
    ) {
        requireUuid(topupId, "topupId");
        String tenantId = keyValidator.validateContext(centerKey).tenantId();
        TopUpService.TopUpView result = topups.get(tenantId, topupId);
        if (result == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such top-up");
        return result;
    }

    @GetMapping("/topups")
    public List<TopUpService.TopUpView> topUps(
            @RequestHeader("X-Center-Key") String centerKey,
            @RequestParam(defaultValue = "10") int limit
    ) {
        String tenantId = keyValidator.validateContext(centerKey).tenantId();
        return topups.recent(tenantId, limit);
    }

    @GetMapping("/invoices")
    public List<Map<String, Object>> invoices(
            @RequestHeader("X-Center-Key") String centerKey,
            @RequestParam(defaultValue = "20") int limit
    ) {
        String tenantId = keyValidator.validateContext(centerKey).tenantId();
        return billing.invoicesFor(tenantId, limit);
    }

    @GetMapping("/invoices/{invoiceId}")
    public Map<String, Object> invoice(
            @RequestHeader("X-Center-Key") String centerKey,
            @PathVariable String invoiceId
    ) {
        requireUuid(invoiceId, "invoiceId");
        String tenantId = keyValidator.validateContext(centerKey).tenantId();
        Map<String, Object> result = billing.invoiceFor(tenantId, invoiceId);
        if (result.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such invoice");
        return result;
    }

    private static void requireUuid(String value, String name) {
        try { UUID.fromString(value); }
        catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Malformed " + name);
        }
    }

    public record CreateTopUpRequest(@Positive long amountCentavos, @NotNull UUID clientRequestId) {}

    public record BillingSummary(
            BillingMode mode, long profileRevision, long chargePerUploadCentavos,
            Long balanceCentavos, Boolean low, Boolean negative, Integer blockedCount,
            Integer currentUsageCount, Long currentEstimateCentavos,
            java.time.Instant periodStart, java.time.Instant nextCutoff,
            Long openTotalCentavos, Long pastDueTotalCentavos, Integer pastDueInvoiceCount
    ) {
        static BillingSummary prepaid(BillingService.BillingProfile profile,
                                      WalletService.WalletSummary wallet) {
            return new BillingSummary(BillingMode.PREPAID, profile.revision(),
                    wallet.chargePerUploadCentavos(), wallet.balanceCentavos(), wallet.low(),
                    wallet.negative(), wallet.blockedCount(), null, null, null, null,
                    null, null, null);
        }

        static BillingSummary postpaid(BillingService.BillingProfile profile,
                                       BillingService.PostpaidSummary summary, long rate) {
            return new BillingSummary(BillingMode.POSTPAID, profile.revision(), rate,
                    null, null, null, null, summary.currentUsageCount(),
                    summary.currentEstimateCentavos(), summary.periodStart(), summary.nextCutoff(),
                    summary.openTotalCentavos(), summary.pastDueTotalCentavos(),
                    summary.pastDueInvoiceCount());
        }
    }
}
