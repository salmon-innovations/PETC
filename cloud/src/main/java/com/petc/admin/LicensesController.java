package com.petc.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

/**
 * Operator-portal center API-key administration.
 *
 * The raw key is returned exactly once, at issue time, and only its bcrypt hash
 * is stored — matching how {@link com.petc.ingest.CenterKeyValidator} verifies
 * the X-Center-Key header. A lost key cannot be recovered, only re-issued.
 */
@RestController
@RequestMapping("/api/licenses")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public class LicensesController {

    /** Prefix makes an issued key recognisable in logs and support tickets. */
    private static final String KEY_PREFIX = "petc_";
    private static final int KEY_BYTES = 32;

    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;
    private final SecureRandom random = new SecureRandom();

    public LicensesController(JdbcTemplate jdbc, PasswordEncoder encoder) {
        this.jdbc = jdbc;
        this.encoder = encoder;
    }

    @GetMapping
    public List<LicenseResponse> list() {
        return jdbc.query(
                """
                SELECT cl.id::text        AS id,
                       cl.tenant_id::text AS tenant_id,
                       t.name             AS center_name,
                       cl.active          AS active,
                       cl.created_at      AS issued_at,
                       cl.authorization_expires_at AS expires_at
                FROM center_licenses cl
                JOIN tenants t ON t.id = cl.tenant_id
                ORDER BY cl.created_at DESC
                """,
                (rs, rowNum) -> new LicenseResponse(
                        rs.getString("id"),
                        rs.getString("center_name"),
                        rs.getString("tenant_id"),
                        rs.getBoolean("active"),
                        rs.getObject("issued_at", OffsetDateTime.class),
                        rs.getObject("expires_at", OffsetDateTime.class)
                )
        );
    }

    /**
     * Issues a new key for a center. Any existing active key is revoked first:
     * center_licenses has a UNIQUE (tenant_id) WHERE active partial index, so a
     * center holds at most one usable key, and re-issuing rotates it.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public IssuedLicenseResponse issue(@Valid @RequestBody IssueLicenseRequest req) {
        UUID tenantId;
        try {
            tenantId = UUID.fromString(req.tenantId());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Malformed tenantId");
        }

        var centerSlug = jdbc.query(
                "SELECT slug FROM tenants WHERE id = ?",
                rs -> rs.next() ? rs.getString("slug") : null,
                tenantId
        );
        if (centerSlug == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such center");
        }

        jdbc.update(
                "UPDATE center_licenses SET active = false WHERE tenant_id = ? AND active = true",
                tenantId
        );

        String rawKey = generateKey();
        var id = jdbc.queryForObject(
                """
                INSERT INTO center_licenses (tenant_id, key_hash, center_id, active)
                VALUES (?, ?, ?, true)
                RETURNING id::text
                """,
                String.class, tenantId, encoder.encode(rawKey), centerSlug
        );

        // rawKey is returned here and never persisted in plain text.
        return new IssuedLicenseResponse(id, rawKey, tenantId.toString(), centerSlug);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@PathVariable String id) {
        UUID licenseId;
        try {
            licenseId = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Malformed license id");
        }
        int updated = jdbc.update(
                "UPDATE center_licenses SET active = false WHERE id = ? AND active = true",
                licenseId
        );
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No active license with that id");
        }
    }

    private String generateKey() {
        byte[] bytes = new byte[KEY_BYTES];
        random.nextBytes(bytes);
        return KEY_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    // ---------------------------------------------------------------- schema

    public record LicenseResponse(
            String id,
            String centerName,
            String tenantId,
            boolean active,
            OffsetDateTime issuedAt,
            OffsetDateTime expiresAt
    ) {}

    /** rawKey is shown once by the portal and cannot be retrieved again. */
    public record IssuedLicenseResponse(String id, String rawKey, String tenantId, String centerId) {}

    public record IssueLicenseRequest(@NotBlank String tenantId) {}
}
