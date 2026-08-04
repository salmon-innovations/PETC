package com.petc.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;
import com.petc.wallet.CenterPricingService;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * Operator-portal center (tenant) administration.
 *
 * Restricted to super admins: these endpoints read and create rows across every
 * tenant, which a tenant-scoped user must never be able to do.
 */
@RestController
@RequestMapping("/api/tenants")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public class TenantsController {

    private final JdbcTemplate jdbc;
    private final CenterPricingService pricing;

    public TenantsController(JdbcTemplate jdbc, CenterPricingService pricing) {
        this.jdbc = jdbc;
        this.pricing = pricing;
    }

    @GetMapping
    public List<CenterResponse> list() {
        return jdbc.query(
                """
                SELECT t.id::text          AS id,
                       t.slug              AS slug,
                       t.name              AS name,
                       (SELECT count(*) FROM lane_credentials lc
                         JOIN lanes l ON l.id = lc.lane_id
                         WHERE l.tenant_id = t.id AND l.active = true AND lc.active = true) AS active_licenses,
                       (SELECT count(*) FROM lanes l
                         WHERE l.tenant_id = t.id AND l.active = true) AS active_lane_count,
                       (SELECT max(s.created_at) FROM submissions s
                         WHERE s.tenant_id = t.id)                       AS last_sync
                FROM tenants t
                ORDER BY t.name
                """,
                (rs, rowNum) -> new CenterResponse(
                        rs.getString("id"),
                        rs.getString("slug"),
                        rs.getString("name"),
                        rs.getInt("active_licenses"),
                        rs.getInt("active_lane_count"),
                        rs.getObject("last_sync", OffsetDateTime.class)
                )
        );
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public CenterResponse create(@Valid @RequestBody CreateCenterRequest req) {
        try {
            var id = jdbc.queryForObject(
                    "INSERT INTO tenants (slug, name) VALUES (?, ?) RETURNING id::text",
                    String.class, req.slug(), req.name()
            );
            pricing.ensureDefault(id);
            jdbc.queryForObject("""
                    INSERT INTO lanes (tenant_id, lane_number) VALUES (?::uuid, 1) RETURNING id::text
                    """, String.class, id);
            jdbc.update("INSERT INTO center_authorizations (tenant_id) VALUES (?::uuid)", id);
            return new CenterResponse(id, req.slug(), req.name(), 0, 1, null);
        } catch (DuplicateKeyException e) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "A center with slug '" + req.slug() + "' already exists");
        }
    }

    // ---------------------------------------------------------------- schema

    /** lastSync is null until the center has submitted at least once. */
    public record CenterResponse(
            String id,
            String slug,
            String name,
            int activeLicenses,
            int activeLaneCount,
            OffsetDateTime lastSync
    ) {}

    public record CreateCenterRequest(
            @NotBlank @Size(min = 2) String name,
            @NotBlank @Size(min = 2)
            @Pattern(regexp = "^[a-z0-9-]+$", message = "Lowercase letters, numbers, hyphens only")
            String slug
    ) {}
}
