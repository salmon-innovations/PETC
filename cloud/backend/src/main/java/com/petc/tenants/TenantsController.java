package com.petc.tenants;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tenants")
public class TenantsController {

    private final JdbcTemplate jdbc;

    public TenantsController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return jdbc.queryForList("""
            SELECT t.id, t.slug, t.name, t.created_at,
                   COUNT(l.id) FILTER (WHERE l.active = true) AS active_licenses,
                   MAX(me.ingested_at) AS last_sync
            FROM tenants t
            LEFT JOIN licenses l ON l.tenant_id = t.id
            LEFT JOIN mirror_emission_tests me ON me.tenant_id = t.id
            WHERE t.active = true
            GROUP BY t.id
            ORDER BY t.name
            """);
    }

    @PostMapping
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public ResponseEntity<Map<String, Object>> create(@Valid @RequestBody CreateRequest req) {
        var row = jdbc.queryForMap(
                "INSERT INTO tenants (slug, name) VALUES (?, ?) RETURNING id, slug, name, created_at",
                req.slug(), req.name()
        );
        return ResponseEntity.status(201).body(row);
    }

    record CreateRequest(
            @NotBlank @Pattern(regexp = "^[a-z0-9-]+$") String slug,
            @NotBlank String name
    ) {}
}
