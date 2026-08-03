package com.petc.wallet;

import com.petc.auth.JwtAuthFilter.PetcUserPrincipal;
import com.petc.settings.PlatformSettingsService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Operator-portal wallet administration.
 *
 * Super-admin only: these endpoints read balances across every tenant and move
 * money, neither of which a tenant-scoped user may do.
 *
 * All amounts are integer centavos on the wire. The portal formats pesos for
 * display and converts at the boundary; no float ever touches a balance.
 */
@RestController
@RequestMapping("/api/wallet")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public class WalletController {

    private static final int MAX_LEDGER_PAGE = 200;

    private final WalletService wallet;
    private final CenterPricingService pricing;
    private final PlatformSettingsService settings;
    private final JdbcTemplate jdbc;

    public WalletController(
            WalletService wallet,
            CenterPricingService pricing,
            PlatformSettingsService settings,
            JdbcTemplate jdbc
    ) {
        this.wallet = wallet;
        this.pricing = pricing;
        this.settings = settings;
        this.jdbc = jdbc;
    }

    /** Balance and exposure for every center, for the dashboard and centers list. */
    @GetMapping("/centers")
    public List<CenterWalletResponse> listCenters() {
        long debtFloor = settings.debtFloorCentavos();
        return jdbc.query("""
                SELECT t.id::text AS tenant_id,
                       t.slug     AS slug,
                       t.name     AS name,
                       COALESCE(w.balance_centavos, 0) AS balance,
                       COALESCE(c.charge_per_upload_centavos, 8000) AS charge_per_upload,
                       COALESCE(c.low_balance_threshold_centavos, 40000) AS low_threshold,
                       (SELECT count(*) FROM submissions s
                         WHERE s.tenant_id = t.id AND s.state = 'BLOCKED') AS blocked_count
                  FROM tenants t
                  LEFT JOIN wallet_accounts w ON w.tenant_id = t.id
                  LEFT JOIN tenant_billing_configs c ON c.tenant_id = t.id
                 ORDER BY COALESCE(w.balance_centavos, 0) ASC, t.name
                """,
                (rs, i) -> {
                    long balance = rs.getLong("balance");
                    long lowThreshold = rs.getLong("low_threshold");
                    return new CenterWalletResponse(
                            rs.getString("tenant_id"),
                            rs.getString("slug"),
                            rs.getString("name"),
                            balance,
                            balance < lowThreshold,
                            balance < 0,
                            balance <= debtFloor,
                            rs.getInt("blocked_count"),
                            rs.getLong("charge_per_upload"),
                            lowThreshold
                    );
                });
    }

    /**
     * Detail for one center. Exposes the derived balance alongside the cached
     * projection so drift between the ledger and wallet_accounts is visible
     * rather than silent.
     */
    @GetMapping("/centers/{tenantId}")
    public CenterWalletDetail centerDetail(@PathVariable String tenantId) {
        requireTenant(tenantId);
        var summary = wallet.summaryFor(tenantId);
        long derived = wallet.recomputeBalance(tenantId);
        return new CenterWalletDetail(
                tenantId,
                summary.balanceCentavos(),
                derived,
                summary.balanceCentavos() == derived,
                summary.low(),
                summary.negative(),
                summary.blockedCount(),
                summary.chargePerUploadCentavos(),
                summary.lowBalanceThresholdCentavos(),
                summary.pricingUpdatedAt()
        );
    }

    /** Immediate per-center price/threshold edit. Existing submissions keep their quote. */
    @PutMapping("/centers/{tenantId}/pricing")
    public CenterPricingService.PricingConfig updatePricing(
            @PathVariable String tenantId,
            @Valid @RequestBody PricingUpdateRequest req,
            @AuthenticationPrincipal PetcUserPrincipal principal
    ) {
        requireTenant(tenantId);
        return pricing.update(
                tenantId,
                req.chargePerUploadCentavos(),
                req.lowBalanceThresholdCentavos(),
                principal == null ? null : principal.userId(),
                principal == null ? "unknown" : principal.email()
        );
    }

    @GetMapping("/centers/{tenantId}/ledger")
    public List<Map<String, Object>> ledger(
            @PathVariable String tenantId,
            @RequestParam(defaultValue = "50") int limit
    ) {
        requireTenant(tenantId);
        return wallet.ledgerFor(tenantId, Math.clamp(limit, 1, MAX_LEDGER_PAGE));
    }

    /**
     * Credits a center. Recorded as an immutable ledger row carrying the acting
     * super admin and an external payment reference — the balance itself is
     * never edited. Any submissions held for want of funds are released.
     */
    @PostMapping("/centers/{tenantId}/topup")
    @ResponseStatus(HttpStatus.CREATED)
    public WalletService.TopUpResult topUp(
            @PathVariable String tenantId,
            @Valid @RequestBody TopUpRequest req,
            @AuthenticationPrincipal PetcUserPrincipal principal
    ) {
        requireTenant(tenantId);
        return wallet.topUp(
                tenantId,
                req.amountCentavos(),
                req.reference(),
                principal == null ? null : principal.userId(),
                principal == null ? "unknown" : principal.email()
        );
    }

    private void requireTenant(String tenantId) {
        try {
            UUID.fromString(tenantId);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Malformed tenantId");
        }
        Integer found = jdbc.queryForObject(
                "SELECT count(*) FROM tenants WHERE id = ?::uuid", Integer.class, tenantId);
        if (found == null || found == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such center");
        }
    }

    // ---------------------------------------------------------------- schema

    public record CenterWalletResponse(
            String tenantId,
            String slug,
            String name,
            long balanceCentavos,
            boolean low,
            boolean negative,
            boolean belowDebtFloor,
            int blockedCount,
            long chargePerUploadCentavos,
            long lowBalanceThresholdCentavos
    ) {}

    /** balanceMatches false means the projection has drifted from the ledger — a bug. */
    public record CenterWalletDetail(
            String tenantId,
            long balanceCentavos,
            long derivedBalanceCentavos,
            boolean balanceMatches,
            boolean low,
            boolean negative,
            int blockedCount,
            long chargePerUploadCentavos,
            long lowBalanceThresholdCentavos,
            java.time.OffsetDateTime pricingUpdatedAt
    ) {}

    public record PricingUpdateRequest(
            @NotNull @PositiveOrZero Long chargePerUploadCentavos,
            @NotNull @PositiveOrZero Long lowBalanceThresholdCentavos
    ) {}

    /**
     * amountCentavos is a long, never a double: money does not survive binary
     * floating point. reference ties the credit to an external payment record.
     */
    public record TopUpRequest(
            @NotNull @Positive Long amountCentavos,
            @Size(max = 500) String reference
    ) {}
}
