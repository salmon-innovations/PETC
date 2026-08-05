package com.petc.auth;

import com.petc.tenant.TenantAwarePrincipal;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwtService;

    public JwtAuthFilter(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain
    ) throws ServletException, IOException {

        String token = extractToken(request);
        if (token != null) {
            try {
                Claims claims = jwtService.parseToken(token);
                if (jwtService.isAccessToken(claims)) {
                    String userId = claims.getSubject();
                    // Null for super admins — TenantContextFilter leaves
                    // app.tenant_id unset, which RLS reads as cross-tenant.
                    String tenantId = claims.get("tenantId", String.class);
                    String role = claims.get("role", String.class);
                    String email = claims.get("email", String.class);

                    if (role != null) {
                        var principal = new PetcUserPrincipal(userId, tenantId, email, role);
                        var auth = new UsernamePasswordAuthenticationToken(
                                principal, null,
                                List.of(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase()))
                        );
                        SecurityContextHolder.getContext().setAuthentication(auth);
                    }
                }
            } catch (JwtException ignored) {
                // Invalid token — let Spring Security reject as 401
            }
        }
        chain.doFilter(request, response);
    }

    private static String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (StringUtils.hasText(header) && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        return null;
    }

    // ---------------------------------------------------------------- inner

    /**
     * @param tenantId null for super admins, who are not tenant-scoped. For
     *                 them userId is the super_admin_users id, which is what
     *                 audit rows record as the acting party.
     */
    public record PetcUserPrincipal(String userId, String tenantId, String email, String role)
            implements TenantAwarePrincipal {}
}
