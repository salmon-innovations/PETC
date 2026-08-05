package com.petc.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    /**
     * Two login shapes share this endpoint:
     * <ul>
     *   <li>with tenantSlug — a center user, scoped to that tenant;</li>
     *   <li>without — the cross-tenant operator portal, authenticated
     *       against super_admin_users.</li>
     * </ul>
     * The slug is what disambiguates them: {@code users} is unique on
     * (tenant_id, email), so an email alone cannot identify a center user.
     */
    @PostMapping("/login")
    public ResponseEntity<TokenResponse> login(@Valid @RequestBody LoginRequest req) {
        if (req.tenantSlug() == null || req.tenantSlug().isBlank()) {
            return ResponseEntity.ok(authService.loginSuperAdmin(req.email(), req.password()));
        }
        return ResponseEntity.ok(authService.login(req.email(), req.password(), req.tenantSlug()));
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(@Valid @RequestBody RefreshRequest req) {
        return ResponseEntity.ok(authService.refresh(req.refreshToken()));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@Valid @RequestBody RefreshRequest req) {
        authService.revoke(req.refreshToken());
        return ResponseEntity.noContent().build();
    }

    // ---------------------------------------------------------------- schema
    record LoginRequest(
            @NotBlank @Email String email,
            @NotBlank String password,
            // Optional: absent means a super-admin (operator portal) login.
            String tenantSlug
    ) {}

    record RefreshRequest(@NotBlank String refreshToken) {}

    /** tenantId is null for super admins, who are not tenant-scoped. */
    record TokenResponse(String accessToken, String refreshToken, UserSummary user) {}

    record UserSummary(String id, String email, String fullName, String role, String tenantId) {}
}
