package com.petc.lanes;

import com.petc.ingest.CenterKeyValidator;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.dao.DuplicateKeyException;
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

/** Center-lane administration and authenticated lane self-service endpoints. */
@RestController
public class LanesController {
    private static final String KEY_PREFIX = "petc_";
    private static final int KEY_BYTES = 32;

    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;
    private final LaneQuotaService quota;
    private final CenterKeyValidator keyValidator;
    private final SecureRandom random = new SecureRandom();

    public LanesController(JdbcTemplate jdbc, PasswordEncoder encoder, LaneQuotaService quota,
                           CenterKeyValidator keyValidator) {
        this.jdbc = jdbc;
        this.encoder = encoder;
        this.quota = quota;
        this.keyValidator = keyValidator;
    }

    @GetMapping("/api/lanes/me")
    public LaneSelfResponse me(@RequestHeader("X-Center-Key") String centerKey) {
        var ctx = keyValidator.validateContext(centerKey);
        return new LaneSelfResponse(ctx.tenantId(), ctx.centerId(), ctx.centerName(), ctx.laneId(), ctx.laneNumber(),
                ctx.laneActive(), ctx.dailyUploadLimit(), ctx.authorizationStatus(), ctx.authorizationExpiresAt(),
                quota.current(ctx.tenantId(), ctx.laneId()));
    }

    @GetMapping("/api/lanes/me/quota")
    public LaneQuotaService.Quota myQuota(@RequestHeader("X-Center-Key") String centerKey) {
        var ctx = keyValidator.validateContext(centerKey);
        return quota.current(ctx.tenantId(), ctx.laneId());
    }

    @GetMapping("/api/tenants/{tenantId}/lanes")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public List<LaneResponse> list(@PathVariable String tenantId) {
        requireTenant(tenantId);
        return jdbc.query("""
                SELECT l.id::text AS id, l.tenant_id::text AS tenant_id, l.lane_number, l.active,
                       l.daily_upload_limit, l.created_at, l.updated_at,
                       c.id::text AS credential_id, c.last_used_at AS credential_last_used_at
                  FROM lanes l
             LEFT JOIN LATERAL (
                    SELECT id, last_used_at FROM lane_credentials
                     WHERE lane_id = l.id AND active = true
                     ORDER BY created_at DESC LIMIT 1
                ) c ON true
                 WHERE l.tenant_id = ?::uuid
                 ORDER BY l.lane_number
                """, (rs, row) -> response(
                rs.getString("id"), rs.getString("tenant_id"), rs.getInt("lane_number"),
                rs.getBoolean("active"), rs.getInt("daily_upload_limit"),
                rs.getObject("created_at", OffsetDateTime.class), rs.getObject("updated_at", OffsetDateTime.class),
                rs.getString("credential_id"), rs.getObject("credential_last_used_at", OffsetDateTime.class)
        ), tenantId);
    }

    @PostMapping("/api/tenants/{tenantId}/lanes")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public LaneResponse create(@PathVariable String tenantId, @Valid @RequestBody CreateLaneRequest req) {
        requireTenant(tenantId);
        try {
            String laneId = jdbc.queryForObject("""
                    INSERT INTO lanes (tenant_id, lane_number, daily_upload_limit)
                    VALUES (?::uuid, ?, COALESCE(?, 80)) RETURNING id::text
                    """, String.class, tenantId, req.laneNumber(), req.dailyUploadLimit());
            return single(laneId, tenantId);
        } catch (DuplicateKeyException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Lane number already exists for this center");
        }
    }

    /**
     * dailyUploadLimit takes effect immediately, including today's quota row.
     * It cannot be reduced below already accepted plus reserved work, avoiding
     * a limit change that would make the accounting invariant impossible.
     */
    @PatchMapping("/api/tenants/{tenantId}/lanes/{laneId}")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public LaneResponse update(@PathVariable String tenantId, @PathVariable String laneId,
                               @Valid @RequestBody UpdateLaneRequest req) {
        requireLane(tenantId, laneId);
        if (req.dailyUploadLimit() != null) {
            jdbc.update("""
                    INSERT INTO lane_daily_quota (lane_id, business_date, limit_snapshot)
                    SELECT id, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, daily_upload_limit
                      FROM lanes WHERE id = ?::uuid AND tenant_id = ?::uuid
                    ON CONFLICT (lane_id, business_date) DO NOTHING
                    """, laneId, tenantId);
            var usage = jdbc.queryForList("""
                    SELECT accepted_count, reserved_count FROM lane_daily_quota
                     WHERE lane_id = ?::uuid AND business_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
                     FOR UPDATE
                    """, laneId);
            int committed = ((Number) usage.getFirst().get("accepted_count")).intValue()
                    + ((Number) usage.getFirst().get("reserved_count")).intValue();
            if (req.dailyUploadLimit() < committed) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Daily limit cannot be below today's accepted plus reserved uploads (" + committed + ")");
            }
            jdbc.update("""
                    UPDATE lane_daily_quota SET limit_snapshot = ?, updated_at = now()
                     WHERE lane_id = ?::uuid AND business_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
                    """, req.dailyUploadLimit(), laneId);
            jdbc.update("UPDATE lanes SET daily_upload_limit = ?, updated_at = now() WHERE id = ?::uuid",
                    req.dailyUploadLimit(), laneId);
        }
        if (req.active() != null) {
            jdbc.update("UPDATE lanes SET active = ?, updated_at = now() WHERE id = ?::uuid AND tenant_id = ?::uuid",
                    req.active(), laneId, tenantId);
        }
        return single(laneId, tenantId);
    }

    /** Rotates the one usable desktop credential for this lane. */
    @PostMapping("/api/tenants/{tenantId}/lanes/{laneId}/credentials")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public IssuedCredentialResponse issueCredential(@PathVariable String tenantId, @PathVariable String laneId) {
        requireLane(tenantId, laneId);
        jdbc.update("""
                UPDATE lane_credentials SET active = false, revoked_at = now()
                 WHERE lane_id = ?::uuid AND active = true
                """, laneId);
        String rawKey = generateKey();
        String credentialId = jdbc.queryForObject("""
                INSERT INTO lane_credentials (lane_id, key_hash) VALUES (?::uuid, ?) RETURNING id::text
                """, String.class, laneId, encoder.encode(rawKey));
        return new IssuedCredentialResponse(credentialId, rawKey);
    }

    @DeleteMapping("/api/tenants/{tenantId}/lanes/{laneId}/credentials/{credentialId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public void revokeCredential(@PathVariable String tenantId, @PathVariable String laneId,
                                 @PathVariable String credentialId) {
        int changed = jdbc.update("""
                UPDATE lane_credentials c SET active = false, revoked_at = now()
                  FROM lanes l
                 WHERE c.id = ?::uuid AND c.lane_id = ?::uuid AND c.lane_id = l.id
                   AND l.tenant_id = ?::uuid AND c.active = true
                """, credentialId, laneId, tenantId);
        if (changed == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No active credential for this lane");
    }

    private LaneResponse single(String laneId, String tenantId) {
        var rows = jdbc.query("""
                SELECT l.id::text AS id, l.tenant_id::text AS tenant_id, l.lane_number, l.active,
                       l.daily_upload_limit, l.created_at, l.updated_at,
                       c.id::text AS credential_id, c.last_used_at AS credential_last_used_at
                  FROM lanes l LEFT JOIN LATERAL (
                    SELECT id, last_used_at FROM lane_credentials
                     WHERE lane_id = l.id AND active = true ORDER BY created_at DESC LIMIT 1
                  ) c ON true
                 WHERE l.id = ?::uuid AND l.tenant_id = ?::uuid
                """, (rs, row) -> response(rs.getString("id"), rs.getString("tenant_id"), rs.getInt("lane_number"),
                rs.getBoolean("active"), rs.getInt("daily_upload_limit"),
                rs.getObject("created_at", OffsetDateTime.class), rs.getObject("updated_at", OffsetDateTime.class),
                rs.getString("credential_id"), rs.getObject("credential_last_used_at", OffsetDateTime.class)), laneId, tenantId);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such lane");
        return rows.getFirst();
    }

    private LaneResponse response(String id, String tenantId, int number, boolean active, int limit,
                                  OffsetDateTime createdAt, OffsetDateTime updatedAt,
                                  String credentialId, OffsetDateTime lastUsedAt) {
        return new LaneResponse(id, tenantId, number, active, limit, createdAt, updatedAt,
                credentialId, lastUsedAt, quota.current(tenantId, id));
    }

    private void requireTenant(String tenantId) {
        try { UUID.fromString(tenantId); } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Malformed tenantId");
        }
        Integer found = jdbc.queryForObject("SELECT count(*) FROM tenants WHERE id = ?::uuid", Integer.class, tenantId);
        if (found == null || found == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such center");
    }

    private void requireLane(String tenantId, String laneId) {
        requireTenant(tenantId);
        Integer found;
        try { found = jdbc.queryForObject("SELECT count(*) FROM lanes WHERE id = ?::uuid AND tenant_id = ?::uuid", Integer.class, laneId, tenantId); }
        catch (Exception e) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Malformed laneId"); }
        if (found == null || found == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such lane");
    }

    private String generateKey() {
        byte[] bytes = new byte[KEY_BYTES]; random.nextBytes(bytes);
        return KEY_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public record LaneSelfResponse(String tenantId, String centerId, String centerName, String laneId, int laneNumber,
                                   boolean active, int dailyUploadLimit, String authorizationStatus,
                                   java.time.Instant authorizationExpiresAt, LaneQuotaService.Quota quota) {}
    public record LaneResponse(String id, String tenantId, int laneNumber, boolean active,
                               int dailyUploadLimit, OffsetDateTime createdAt, OffsetDateTime updatedAt,
                               String credentialId, OffsetDateTime credentialLastUsedAt,
                               LaneQuotaService.Quota today) {}
    public record CreateLaneRequest(@NotNull @Min(1) Integer laneNumber, @Min(0) Integer dailyUploadLimit) {}
    public record UpdateLaneRequest(Boolean active, @Min(0) Integer dailyUploadLimit) {}
    public record IssuedCredentialResponse(String id, String rawKey) {}
}
