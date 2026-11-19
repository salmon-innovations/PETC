package com.petc.billing;

import com.petc.auth.JwtAuthFilter.PetcUserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin/billing")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public class BillingAdminController {
    private final BillingService billing;
    private final JdbcTemplate jdbc;

    public BillingAdminController(BillingService billing, JdbcTemplate jdbc) {
        this.billing = billing;
        this.jdbc = jdbc;
    }

    @GetMapping("/centers/{tenantId}/profile")
    public BillingService.BillingProfile profile(@PathVariable String tenantId) {
        requireTenant(tenantId);
        return billing.profileFor(tenantId);
    }

    @PutMapping("/centers/{tenantId}/profile")
    public BillingService.BillingProfile updateProfile(
            @PathVariable String tenantId,
            @Valid @RequestBody UpdateProfileRequest request,
            @AuthenticationPrincipal PetcUserPrincipal principal
    ) {
        requireTenant(tenantId);
        try {
            return billing.setMode(tenantId, request.mode(), request.paymentTermsDays(),
                    request.creditLimitCentavos(), id(principal), actor(principal));
        } catch (IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, e.getMessage());
        }
    }

    @GetMapping("/centers/{tenantId}/invoices")
    public List<Map<String, Object>> invoices(@PathVariable String tenantId,
                                               @RequestParam(defaultValue = "50") int limit) {
        requireTenant(tenantId);
        return billing.invoicesFor(tenantId, limit);
    }

    @GetMapping("/centers/{tenantId}/usage")
    public List<Map<String, Object>> unbilledUsage(@PathVariable String tenantId,
                                                   @RequestParam(defaultValue = "100") int limit) {
        requireTenant(tenantId);
        return billing.unbilledUsageFor(tenantId, limit);
    }

    @GetMapping("/centers/{tenantId}/invoices/{invoiceId}")
    public Map<String, Object> invoice(@PathVariable String tenantId, @PathVariable String invoiceId) {
        requireTenant(tenantId);
        requireUuid(invoiceId, "invoiceId");
        Map<String, Object> result = billing.invoiceFor(tenantId, invoiceId);
        if (result.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such invoice");
        return result;
    }

    @PostMapping("/centers/{tenantId}/invoices/{invoiceId}/payments")
    public BillingService.PaymentResult recordPayment(
            @PathVariable String tenantId,
            @PathVariable String invoiceId,
            @Valid @RequestBody RecordPaymentRequest request,
            @AuthenticationPrincipal PetcUserPrincipal principal
    ) {
        requireTenant(tenantId);
        requireUuid(invoiceId, "invoiceId");
        try {
            return billing.recordPayment(tenantId, invoiceId, request.amountCentavos(),
                    request.method(), request.externalReference(),
                    request.paidAt() == null ? Instant.now() : request.paidAt(),
                    id(principal), actor(principal));
        } catch (IllegalArgumentException | IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, e.getMessage());
        }
    }

    private void requireTenant(String tenantId) {
        requireUuid(tenantId, "tenantId");
        Integer found = jdbc.queryForObject("SELECT count(*) FROM tenants WHERE id = ?::uuid",
                Integer.class, tenantId);
        if (found == null || found == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such center");
    }

    private static void requireUuid(String value, String name) {
        try { UUID.fromString(value); }
        catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Malformed " + name);
        }
    }

    private static String id(PetcUserPrincipal principal) { return principal == null ? null : principal.userId(); }
    private static String actor(PetcUserPrincipal principal) { return principal == null ? "unknown" : principal.email(); }

    public record UpdateProfileRequest(@NotNull BillingMode mode,
                                       @Min(0) @Max(365) int paymentTermsDays,
                                       Long creditLimitCentavos) {}
    public record RecordPaymentRequest(@Positive long amountCentavos,
                                       @NotBlank String method,
                                       @NotBlank String externalReference,
                                       Instant paidAt) {}
}
