package com.petc.wallet;

import com.petc.ingest.CenterKeyValidator;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * A center's view of its own wallet, read by the desktop sidecar.
 *
 * Deliberately a separate controller from {@link WalletController}: this one is
 * X-Center-Key authenticated and must be exempted from JWT auth, while the
 * super-admin endpoints must not be. Keeping them apart means the exemption in
 * SecurityConfig can name this exact path — a blanket /api/wallet/** would have
 * opened the admin endpoints too.
 *
 * Returns only the calling center's own balance. No ledger, no other tenant.
 */
@RestController
@RequestMapping("/api/wallet/me")
public class CenterWalletController {

    private final WalletService wallet;
    private final CenterKeyValidator keyValidator;

    public CenterWalletController(WalletService wallet, CenterKeyValidator keyValidator) {
        this.wallet = wallet;
        this.keyValidator = keyValidator;
    }

    @GetMapping
    public WalletService.WalletSummary myWallet(@RequestHeader("X-Center-Key") String centerKey) {
        // The tenant comes from the validated key, never from the request, so a
        // center cannot ask for another center's balance. Center-key requests
        // carry no JWT, so app.tenant_id is unset and RLS would not scope this.
        var ctx = keyValidator.validateContext(centerKey);
        return wallet.summaryFor(ctx.tenantId());
    }
}
