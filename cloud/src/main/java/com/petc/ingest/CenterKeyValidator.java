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
 * Validates X-Center-Key against a lane credential and returns trusted center/lane
 * context. The request body must never be trusted for either identity.
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
            String centerName,
            String laneId,
            int laneNumber,
            boolean laneActive,
            int dailyUploadLimit,
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
            return devContext();
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
                """
                SELECT l.tenant_id::text, t.slug AS center_id, t.name AS center_name, l.id::text AS lane_id,
                       l.lane_number, l.active AS lane_active, l.daily_upload_limit, lc.id::text AS credential_id,
                       lc.key_hash, ca.authorization_status, ca.authorization_expires_at
                  FROM lane_credentials lc
                  JOIN lanes l ON l.id = lc.lane_id
                  JOIN tenants t ON t.id = l.tenant_id
                  JOIN center_authorizations ca ON ca.tenant_id = l.tenant_id
                 WHERE lc.active = true AND l.active = true
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
                jdbc.update("UPDATE lane_credentials SET last_used_at = now() WHERE id = ?::uuid",
                        row.get("credential_id"));
                return new CenterContext(
                        (String) row.get("tenant_id"),
                        (String) row.get("center_id"),
                        (String) row.get("center_name"),
                        (String) row.get("lane_id"),
                        ((Number) row.get("lane_number")).intValue(),
                        (Boolean) row.get("lane_active"),
                        ((Number) row.get("daily_upload_limit")).intValue(),
                        status,
                        expiresAt
                );
            }
        }
        throw new AuthException("Invalid X-Center-Key");
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

    private CenterContext devContext() {
        String tenantId = ensureDevTenant();
        String laneId = jdbc.queryForObject("""
                INSERT INTO lanes (tenant_id, lane_number)
                VALUES (?::uuid, 1)
                ON CONFLICT (tenant_id, lane_number) DO UPDATE SET updated_at = now()
                RETURNING id::text
                """, String.class, tenantId);
        jdbc.update("""
                INSERT INTO center_authorizations (tenant_id)
                VALUES (?::uuid) ON CONFLICT (tenant_id) DO NOTHING
                """, tenantId);
        return new CenterContext(tenantId, devTenantSlug, devTenantName, laneId, 1, true, 80, "ACTIVE", null);
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
