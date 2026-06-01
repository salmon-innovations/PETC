package com.petc.ingest;

import com.petc.auth.AuthException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

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

    /** Returns the tenant UUID (as String) for the given raw center API key. */
    public String validate(String rawKey) {
        if (rawKey == null || rawKey.isBlank()) {
            throw new AuthException("Missing X-Center-Key");
        }
        if (devKeyEnabled && !devKey.isBlank() && rawKey.equals(devKey)) {
            return ensureDevTenant();
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT tenant_id::text, key_hash FROM center_licenses WHERE active = true"
        );
        for (var row : rows) {
            String hash = (String) row.get("key_hash");
            if (encoder.matches(rawKey, hash)) {
                return (String) row.get("tenant_id");
            }
        }
        throw new AuthException("Invalid X-Center-Key");
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
