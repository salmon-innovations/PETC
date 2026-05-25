package com.petc.licensing;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/licenses")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public class LicensesController {

    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;
    private final SecureRandom rng = new SecureRandom();

    public LicensesController(JdbcTemplate jdbc, PasswordEncoder encoder) {
        this.jdbc = jdbc;
        this.encoder = encoder;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return jdbc.queryForList("""
            SELECT l.id::text AS "id",
                   t.name AS "centerName",
                   l.tenant_id::text AS "tenantId",
                   l.active AS "active",
                   l.issued_at AS "issuedAt",
                   l.expires_at AS "expiresAt"
            FROM licenses l
            JOIN tenants t ON t.id = l.tenant_id
            ORDER BY l.issued_at DESC
            """);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> issue(@Valid @RequestBody IssueRequest req) {
        // Generate a 32-byte random key, base64url-encoded
        byte[] raw = new byte[32];
        rng.nextBytes(raw);
        String rawKey  = "petc_" + Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        String keyHash = encoder.encode(rawKey);

        String centerName = jdbc.queryForObject(
                "SELECT name FROM tenants WHERE id = ?::uuid", String.class, req.tenantId()
        );

        var row = jdbc.queryForMap("""
                INSERT INTO licenses (tenant_id, center_name, key_hash)
                VALUES (?::uuid, ?, ?)
                RETURNING id
                """, req.tenantId(), centerName, keyHash);

        return ResponseEntity.status(201).body(Map.of(
                "id", row.get("id"),
                "rawKey", rawKey   // shown once, never stored in plaintext
        ));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> revoke(@PathVariable String id) {
        int updated = jdbc.update(
                "UPDATE licenses SET active = false WHERE id = ?::uuid AND active = true",
                id
        );
        return updated > 0 ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    record IssueRequest(@NotBlank String tenantId) {}
}
