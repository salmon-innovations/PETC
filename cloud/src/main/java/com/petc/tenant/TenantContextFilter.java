package com.petc.tenant;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Runs after JWT authentication.  Reads the tenantId claim from the
 * authenticated principal and writes it into the Postgres session via
 * SET LOCAL so RLS policies can read it.
 *
 * The SET LOCAL is automatically rolled back when the connection is
 * returned to the HikariCP pool (each request uses its own transaction).
 */
@Component
@Order(10)
public class TenantContextFilter extends OncePerRequestFilter {

    private final JdbcTemplate jdbc;

    public TenantContextFilter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain
    ) throws ServletException, IOException {

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof TenantAwarePrincipal principal) {
            String tenantId = principal.tenantId();
            if (tenantId != null && !tenantId.isBlank()) {
                // set_config(key, value, is_local=true) — scoped to current transaction
                jdbc.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
            }
        }

        try {
            chain.doFilter(request, response);
        } finally {
            // Defensive clear — HikariCP resets the session, but be explicit.
            jdbc.execute("SELECT set_config('app.tenant_id', '', true)");
        }
    }
}
