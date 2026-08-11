package com.petc.ltms.config;

import com.petc.ingest.CenterKeyValidator;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Database access for LTMS center identity.  Passwords are not loaded here:
 * only a secret-manager reference is retained for a later cloud-only resolver.
 */
@Repository
public class LtmsCenterConfigRepository {

    private final JdbcTemplate jdbc;

    public LtmsCenterConfigRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<LtmsCenterConfig> findByTenantId(String tenantId) {
        List<LtmsCenterConfig> rows = jdbc.query("""
                SELECT tenant_id::text, center_id, ltms_username, ltms_business_id,
                       petc_code, password_secret_ref, environment, enabled,
                       credential_verification_state, credential_verified_at, updated_at
                FROM ltms_center_configs
                WHERE tenant_id = ?::uuid
                """, (rs, rowNum) -> map(rs), tenantId);
        return rows.stream().findFirst();
    }

    /**
     * Cloud-only lookup for a request already authenticated with X-Center-Key.
     * Matching both values prevents a tenant's config being accidentally reused
     * after a center identity is changed or a query is incorrectly scoped.
     */
    public Optional<LtmsCenterConfig> findEnabledFor(CenterKeyValidator.CenterContext center) {
        return findEnabledFor(center.tenantId(), center.centerId());
    }

    /** Worker-side equivalent after tenant/center ownership was fixed at enqueue time. */
    public Optional<LtmsCenterConfig> findEnabledFor(String tenantId, String centerId) {
        List<LtmsCenterConfig> rows = jdbc.query("""
                SELECT tenant_id::text, center_id, ltms_username, ltms_business_id,
                       petc_code, password_secret_ref, environment, enabled,
                       credential_verification_state, credential_verified_at, updated_at
                FROM ltms_center_configs
                WHERE tenant_id = ?::uuid
                  AND center_id = ?
                  AND enabled = true
                  AND credential_verification_state IN ('UNVERIFIED', 'VERIFIED')
                """, (rs, rowNum) -> map(rs), tenantId, centerId);
        return rows.stream().findFirst();
    }

    /** Server-derived center identity; callers must never provide this value. */
    public Optional<String> resolveCenterId(String tenantId) {
        List<String> rows = jdbc.query("""
                SELECT COALESCE(
                    (SELECT center_id FROM center_licenses
                      WHERE tenant_id = ?::uuid AND active = true
                      ORDER BY created_at DESC LIMIT 1),
                    (SELECT slug FROM tenants WHERE id = ?::uuid)
                ) AS center_id
                """, (rs, rowNum) -> rs.getString("center_id"), tenantId, tenantId);
        return rows.stream().filter(value -> value != null && !value.isBlank()).findFirst();
    }

    public LtmsCenterConfig upsert(String tenantId, String centerId, Provisioning provisioning) {
        return jdbc.queryForObject("""
                INSERT INTO ltms_center_configs (
                    tenant_id, center_id, ltms_username, ltms_business_id, petc_code,
                    password_secret_ref, environment, enabled, updated_at
                ) VALUES (?::uuid, ?, ?, ?, ?, ?, ?, ?, now())
                ON CONFLICT (tenant_id) DO UPDATE SET
                    center_id = EXCLUDED.center_id,
                    ltms_username = EXCLUDED.ltms_username,
                    ltms_business_id = EXCLUDED.ltms_business_id,
                    petc_code = EXCLUDED.petc_code,
                    password_secret_ref = EXCLUDED.password_secret_ref,
                    environment = EXCLUDED.environment,
                    enabled = EXCLUDED.enabled,
                    credential_verification_state = 'UNVERIFIED',
                    credential_verified_at = NULL,
                    updated_at = now()
                RETURNING tenant_id::text, center_id, ltms_username, ltms_business_id,
                          petc_code, password_secret_ref, environment, enabled,
                          credential_verification_state, credential_verified_at, updated_at
                """, (rs, rowNum) -> map(rs),
                tenantId, centerId, provisioning.ltmsUsername(), provisioning.ltmsBusinessId(),
                provisioning.petcCode(), provisioning.passwordSecretReference(),
                provisioning.environment().name(), provisioning.enabled());
    }

    public Optional<LtmsCenterConfig> disable(String tenantId) {
        List<LtmsCenterConfig> rows = jdbc.query("""
                UPDATE ltms_center_configs
                   SET enabled = false, updated_at = now()
                 WHERE tenant_id = ?::uuid
                 RETURNING tenant_id::text, center_id, ltms_username, ltms_business_id,
                           petc_code, password_secret_ref, environment, enabled,
                           credential_verification_state, credential_verified_at, updated_at
                """, (rs, rowNum) -> map(rs), tenantId);
        return rows.stream().findFirst();
    }

    public Optional<LtmsCenterConfig> rotateSecretReference(String tenantId, String secretReference) {
        List<LtmsCenterConfig> rows = jdbc.query("""
                UPDATE ltms_center_configs
                   SET password_secret_ref = ?,
                       credential_verification_state = 'UNVERIFIED',
                       credential_verified_at = NULL,
                       updated_at = now()
                 WHERE tenant_id = ?::uuid
                 RETURNING tenant_id::text, center_id, ltms_username, ltms_business_id,
                           petc_code, password_secret_ref, environment, enabled,
                           credential_verification_state, credential_verified_at, updated_at
                """, (rs, rowNum) -> map(rs), secretReference, tenantId);
        return rows.stream().findFirst();
    }

    private static LtmsCenterConfig map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new LtmsCenterConfig(
                rs.getString("tenant_id"),
                rs.getString("center_id"),
                rs.getString("ltms_username"),
                rs.getString("ltms_business_id"),
                rs.getString("petc_code"),
                rs.getString("password_secret_ref"),
                LtmsEnvironment.valueOf(rs.getString("environment")),
                rs.getBoolean("enabled"),
                CredentialVerificationState.valueOf(rs.getString("credential_verification_state")),
                rs.getObject("credential_verified_at", OffsetDateTime.class),
                rs.getObject("updated_at", OffsetDateTime.class)
        );
    }

    public record Provisioning(
            String ltmsUsername,
            String ltmsBusinessId,
            String petcCode,
            String passwordSecretReference,
            LtmsEnvironment environment,
            boolean enabled
    ) {}

    public record LtmsCenterConfig(
            String tenantId,
            String centerId,
            String ltmsUsername,
            String ltmsBusinessId,
            String petcCode,
            String passwordSecretReference,
            LtmsEnvironment environment,
            boolean enabled,
            CredentialVerificationState credentialVerificationState,
            OffsetDateTime credentialVerifiedAt,
            OffsetDateTime updatedAt
    ) {}

    public enum LtmsEnvironment { PRODUCTION }

    public enum CredentialVerificationState {
        UNVERIFIED, VERIFIED, INVALID_CREDENTIALS, ACCOUNT_LOCKED, MISSING_PRIVILEGE
    }
}
