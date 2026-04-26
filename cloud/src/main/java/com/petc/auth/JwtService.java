package com.petc.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Map;
import java.util.UUID;

@Service
public class JwtService {

    private final SecretKey key;
    private final long accessExpiryMs;
    private final long refreshExpiryMs;

    public JwtService(
            @Value("${petc.jwt.secret}") String secret,
            @Value("${petc.jwt.access-token-expiry-minutes:15}") int accessMinutes,
            @Value("${petc.jwt.refresh-token-expiry-days:30}") int refreshDays
    ) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessExpiryMs = (long) accessMinutes * 60 * 1000;
        this.refreshExpiryMs = (long) refreshDays * 24 * 60 * 60 * 1000;
    }

    public String generateAccessToken(String userId, String tenantId, String email, String role) {
        return Jwts.builder()
                .subject(userId)
                .claims(Map.of(
                        "tenantId", tenantId,
                        "email", email,
                        "role", role,
                        "type", "access"
                ))
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + accessExpiryMs))
                .signWith(key)
                .compact();
    }

    public String generateRefreshToken(String userId, String tenantId) {
        return Jwts.builder()
                .subject(userId)
                .claims(Map.of("tenantId", tenantId, "type", "refresh"))
                .id(UUID.randomUUID().toString())
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + refreshExpiryMs))
                .signWith(key)
                .compact();
    }

    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public boolean isAccessToken(Claims claims) {
        return "access".equals(claims.get("type", String.class));
    }
}
