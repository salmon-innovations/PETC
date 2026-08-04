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
 * Legacy Lane 1 credential administration.
 *
 * The raw key is returned exactly once, at issue time, and only its bcrypt hash
 * is stored — matching how {@link com.petc.ingest.CenterKeyValidator} verifies
 * the X-Center-Key header. New integrations should use the lane endpoints;
 * this surface remains so an older portal cannot issue a credential ignored by
 * the lane-aware validator.
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
                SELECT lc.id::text        AS id,
                       l.tenant_id::text  AS tenant_id,
                       t.name             AS center_name,
                       lc.active          AS active,
                       lc.created_at      AS issued_at,
                       ca.authorization_expires_at AS expires_at
                FROM lane_credentials lc
                JOIN lanes l ON l.id = lc.lane_id
                JOIN tenants t ON t.id = l.tenant_id
                JOIN center_authorizations ca ON ca.tenant_id = l.tenant_id
                WHERE l.lane_number = 1
                ORDER BY lc.created_at DESC
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
     * Issues/rotates Lane 1's credential.  This is compatibility behavior for
     * the historical one-workstation portal; it never writes center_licenses.
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

        String laneId = jdbc.queryForObject("""
                SELECT id::text FROM lanes WHERE tenant_id = ? AND lane_number = 1
                """, String.class, tenantId);
        jdbc.update("""
                UPDATE lane_credentials SET active = false, revoked_at = now()
                 WHERE lane_id = ?::uuid AND active = true
                """, laneId);

        String rawKey = generateKey();
        var id = jdbc.queryForObject(
                """
                INSERT INTO lane_credentials (lane_id, key_hash, active)
                VALUES (?::uuid, ?, true)
                RETURNING id::text
                """, String.class, laneId, encoder.encode(rawKey)
        );

        // rawKey is returned here and never persisted in plain text.
        return new IssuedLicenseResponse(id, rawKey);
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
                "UPDATE lane_credentials SET active = false, revoked_at = now() WHERE id = ? AND active = true",
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
    public record IssuedLicenseResponse(String id, String rawKey) {}

    public record IssueLicenseRequest(@NotBlank String tenantId) {}
}
