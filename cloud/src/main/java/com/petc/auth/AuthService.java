package com.petc.auth;

import com.petc.auth.AuthController.TokenResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    /** Role claim carried by cross-tenant operator-portal tokens. */
    public static final String SUPER_ADMIN_ROLE = "super_admin";

    private final UserRepository userRepo;
    private final SuperAdminUserRepository superAdminRepo;
    private final RefreshTokenRepository tokenRepo;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;

    public AuthService(
            UserRepository userRepo,
            SuperAdminUserRepository superAdminRepo,
            RefreshTokenRepository tokenRepo,
            JwtService jwtService,
            PasswordEncoder passwordEncoder
    ) {
        this.userRepo = userRepo;
        this.superAdminRepo = superAdminRepo;
        this.tokenRepo = tokenRepo;
        this.jwtService = jwtService;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * Operator-portal login.  Super admins are not tenant-scoped, so the
     * portal sends no tenantSlug and the resulting token carries a null
     * tenantId.
     */
    @Transactional
    public TokenResponse loginSuperAdmin(String email, String password) {
        var admin = superAdminRepo.findByEmail(email)
                .orElseThrow(() -> new AuthException("Invalid credentials"));

        if (!passwordEncoder.matches(password, admin.getPasswordHash())) {
            throw new AuthException("Invalid credentials");
        }

        String access = jwtService.generateAccessToken(
                admin.getId().toString(), null, admin.getEmail(), SUPER_ADMIN_ROLE);
        String refresh = jwtService.generateRefreshToken(admin.getId().toString(), null);

        tokenRepo.saveSuperAdminRefreshToken(admin.getId(), refresh);
        return new TokenResponse(access, refresh, superAdminSummary(admin));
    }

    @Transactional
    public TokenResponse login(String email, String password, String tenantSlug) {
        var user = userRepo.findByEmailAndTenantSlug(email, tenantSlug)
                .orElseThrow(() -> new AuthException("Invalid credentials"));

        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new AuthException("Invalid credentials");
        }
        if (!user.isActive()) {
            throw new AuthException("Account disabled");
        }

        String primaryRole = user.getPrimaryRole();
        String access = jwtService.generateAccessToken(
                user.getId().toString(), user.getTenantId().toString(),
                user.getEmail(), primaryRole);
        String refresh = jwtService.generateRefreshToken(
                user.getId().toString(), user.getTenantId().toString());

        tokenRepo.saveRefreshToken(user.getId(), user.getTenantId(), refresh);
        return new TokenResponse(access, refresh, userSummary(user, primaryRole));
    }

    @Transactional
    public TokenResponse refresh(String rawRefreshToken) {
        var stored = tokenRepo.findByRawToken(rawRefreshToken)
                .orElseThrow(() -> new AuthException("Invalid refresh token"));

        if (stored.isRevoked() || stored.isExpired()) {
            throw new AuthException("Refresh token expired or revoked");
        }

        if (stored.isSuperAdmin()) {
            var admin = superAdminRepo.findById(stored.getSuperAdminId())
                    .orElseThrow(() -> new AuthException("User not found"));

            tokenRepo.revoke(stored.getId());

            String adminAccess = jwtService.generateAccessToken(
                    admin.getId().toString(), null, admin.getEmail(), SUPER_ADMIN_ROLE);
            String adminRefresh = jwtService.generateRefreshToken(admin.getId().toString(), null);

            tokenRepo.saveSuperAdminRefreshToken(admin.getId(), adminRefresh);
            return new TokenResponse(adminAccess, adminRefresh, superAdminSummary(admin));
        }

        var user = userRepo.findById(stored.getUserId())
                .orElseThrow(() -> new AuthException("User not found"));

        tokenRepo.revoke(stored.getId());

        String primaryRole = user.getPrimaryRole();
        String access = jwtService.generateAccessToken(
                user.getId().toString(), user.getTenantId().toString(),
                user.getEmail(), primaryRole);
        String newRefresh = jwtService.generateRefreshToken(
                user.getId().toString(), user.getTenantId().toString());

        tokenRepo.saveRefreshToken(user.getId(), user.getTenantId(), newRefresh);
        return new TokenResponse(access, newRefresh, userSummary(user, primaryRole));
    }

    @Transactional
    public void revoke(String rawRefreshToken) {
        tokenRepo.findByRawToken(rawRefreshToken)
                .ifPresent(t -> tokenRepo.revoke(t.getId()));
    }

    // ---------------------------------------------------------------- helpers

    private static AuthController.UserSummary userSummary(User user, String role) {
        return new AuthController.UserSummary(
                user.getId().toString(),
                user.getEmail(),
                user.getFullName(),
                role,
                user.getTenantId().toString()
        );
    }

    /** Super admins have no tenant and no stored display name. */
    private static AuthController.UserSummary superAdminSummary(SuperAdminUser admin) {
        return new AuthController.UserSummary(
                admin.getId().toString(),
                admin.getEmail(),
                "Super Admin",
                SUPER_ADMIN_ROLE,
                null
        );
    }
}
