package com.petc.ingest;

import com.petc.auth.AuthException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.time.Instant;

/**
 * Validates X-Center-Key against the center_licenses table and returns the tenant ID.
 * Keys are stored as bcrypt hashes; we iterate active licenses to find the match.
 *
 * Dev mode: a hardcoded insecure key automatically creates/reuses a dev tenant so
 * the developer workflow in the README works without a real issued key.
 */
@Component
public class CenterKeyValidator {

    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;
    private final boolean devKeyEnabled;
    private final String devKey;
    private final String devTenantSlug;
    private final String devTenantName;

    public CenterKeyValidator(
            JdbcTemplate jdbc,
            PasswordEncoder encoder,
            @Value("${petc.ingest.dev-key-enabled:true}") boolean devKeyEnabled,
            @Value("${petc.ingest.dev-key:dev-insecure-key}") String devKey,
            @Value("${petc.ingest.dev-tenant-slug:dev-center}") String devTenantSlug,
            @Value("${petc.ingest.dev-tenant-name:Mock PETC Center}") String devTenantName
    ) {
        this.jdbc = jdbc;
        this.encoder = encoder;
        this.devKeyEnabled = devKeyEnabled;
        this.devKey = devKey;
        this.devTenantSlug = devTenantSlug;
        this.devTenantName = devTenantName;
    }

    public record CenterContext(
            String tenantId,
            String centerId,
            String authorizationStatus,
            Instant authorizationExpiresAt
    ) {}

    /** Returns the tenant UUID (as String) for the given raw center API key. */
    public String validate(String rawKey) {
        return validateContext(rawKey).tenantId();
    }

    /** Returns the authorized center context for the given raw center API key. */
    public CenterContext validateContext(String rawKey) {
        if (rawKey == null || rawKey.isBlank()) {
            throw new AuthException("Missing X-Center-Key");
        }
        if (devKeyEnabled && !devKey.isBlank() && rawKey.equals(devKey)) {
            return new CenterContext(ensureDevTenant(), devTenantSlug, "ACTIVE", null);
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
                """
                SELECT tenant_id::text, center_id, key_hash, authorization_status, authorization_expires_at
                FROM center_licenses
                WHERE active = true
                """
        );
        for (var row : rows) {
            String hash = (String) row.get("key_hash");
            if (encoder.matches(rawKey, hash)) {
                Object rawStatus = row.get("authorization_status");
                String status = rawStatus == null ? "ACTIVE" : rawStatus.toString();
                Instant expiresAt = toInstant(row.get("authorization_expires_at"));
                if (!"ACTIVE".equals(status)) {
                    throw new AuthException("PETC authorization is " + status.toLowerCase());
                }
                if (expiresAt != null && expiresAt.isBefore(Instant.now())) {
                    throw new AuthException("PETC authorization is expired");
                }
                return new CenterContext(
                        (String) row.get("tenant_id"),
                        (String) row.get("center_id"),
                        status,
                        expiresAt
                );
            }
        }
        throw new AuthException("Invalid X-Center-Key");
    }

    /**
     * Rejects a desktop-supplied center ID that does not match its authenticated
     * X-Center-Key.  Callers must persist {@link CenterContext#centerId()} —
     * never the submitted value — after this check succeeds.
     */
    public void requireMatchingCenter(CenterContext authenticatedCenter, String submittedCenterId) {
        if (submittedCenterId == null || !authenticatedCenter.centerId().equals(submittedCenterId)) {
            throw new AuthException("Submitted centerId does not match X-Center-Key");
        }
    }

    private Instant toInstant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof java.sql.Timestamp timestamp) {
            return timestamp.toInstant();
        }
        if (value instanceof java.time.OffsetDateTime offsetDateTime) {
            return offsetDateTime.toInstant();
        }
        if (value instanceof java.time.LocalDateTime localDateTime) {
            return localDateTime.atZone(java.time.ZoneOffset.UTC).toInstant();
        }
        return Instant.parse(value.toString());
    }

    private String ensureDevTenant() {
        return jdbc.queryForObject("""
                INSERT INTO tenants (slug, name)
                VALUES (?, ?)
                ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                RETURNING id::text
                """, String.class, devTenantSlug, devTenantName);
    }
}
