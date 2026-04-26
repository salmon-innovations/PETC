package com.petc.tenant;

/**
 * Implemented by the JWT-derived UserDetails so the TenantContextFilter
 * can extract the tenant without depending on the auth module internals.
 */
public interface TenantAwarePrincipal {
    String tenantId();
    String userId();
}
