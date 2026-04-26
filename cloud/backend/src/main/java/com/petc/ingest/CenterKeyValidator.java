package com.petc.ingest;

import com.petc.auth.AuthException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * Validates X-Center-Key against the licenses table and returns the tenant ID.
 * Keys are stored as bcrypt hashes; we iterate active licenses for the matching hash.
 */
@Component
public class CenterKeyValidator {

    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;

    public CenterKeyValidator(JdbcTemplate jdbc, PasswordEncoder encoder) {
        this.jdbc = jdbc;
        this.encoder = encoder;
    }

    public String validate(String rawKey) {
        if (rawKey == null || rawKey.isBlank()) {
            throw new AuthException("Missing X-Center-Key");
        }

        // Load candidate hashes (active licenses); bcrypt comparison is the bottleneck,
        // so limit to active=true to keep the set small.
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT tenant_id::text, key_hash FROM licenses WHERE active = true"
        );

        for (var row : rows) {
            String hash = (String) row.get("key_hash");
            if (encoder.matches(rawKey, hash)) {
                return (String) row.get("tenant_id");
            }
        }

        throw new AuthException("Invalid X-Center-Key");
    }
}
