package com.petc.auth;

import com.petc.auth.AuthController.TokenResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private final UserRepository userRepo;
    private final RefreshTokenRepository tokenRepo;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;

    public AuthService(
            UserRepository userRepo,
            RefreshTokenRepository tokenRepo,
            JwtService jwtService,
            PasswordEncoder passwordEncoder
    ) {
        this.userRepo = userRepo;
        this.tokenRepo = tokenRepo;
        this.jwtService = jwtService;
        this.passwordEncoder = passwordEncoder;
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
        return new TokenResponse(access, refresh);
    }

    @Transactional
    public TokenResponse refresh(String rawRefreshToken) {
        var stored = tokenRepo.findByTokenHash(rawRefreshToken)
                .orElseThrow(() -> new AuthException("Invalid refresh token"));

        if (stored.isRevoked() || stored.isExpired()) {
            throw new AuthException("Refresh token expired or revoked");
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
        return new TokenResponse(access, newRefresh);
    }

    @Transactional
    public void revoke(String rawRefreshToken) {
        tokenRepo.findByTokenHash(rawRefreshToken)
                .ifPresent(t -> tokenRepo.revoke(t.getId()));
    }
}
