package com.petc.wallet;

import com.petc.audit.AuditService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Map;

/** Per-center billing configuration. Money is always integer centavos. */
@Service
public class CenterPricingService {

    public static final long DEFAULT_CHARGE_CENTAVOS = 8_000L;
    public static final long DEFAULT_LOW_BALANCE_CENTAVOS = 40_000L;

    private final JdbcTemplate jdbc;
    private final AuditService audit;

    public CenterPricingService(JdbcTemplate jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    /**
     * Creates a config for a newly-created tenant. The legacy platform values
     * are defaults only; all live billing reads come back to this tenant row.
     */
    public void ensureDefault(String tenantId) {
        jdbc.update("""
                INSERT INTO tenant_billing_configs
                    (tenant_id, charge_per_upload_centavos,
                     low_balance_threshold_centavos, updated_by)
                VALUES (
                    ?::uuid,
                    COALESCE((SELECT (value #>> '{}')::bigint FROM platform_settings
                               WHERE key = 'wallet.charge_per_upload_centavos'), ?),
                    COALESCE((SELECT (value #>> '{}')::bigint FROM platform_settings
                               WHERE key = 'wallet.low_balance_threshold_centavos'), ?),
                    'system'
                )
                ON CONFLICT (tenant_id) DO NOTHING
                """, tenantId, DEFAULT_CHARGE_CENTAVOS, DEFAULT_LOW_BALANCE_CENTAVOS);
    }

    public PricingConfig getFor(String tenantId) {
        ensureDefault(tenantId);
        return queryFor(tenantId, false);
    }

    @Transactional
    public PricingConfig update(
            String tenantId,
            long chargePerUploadCentavos,
            long lowBalanceThresholdCentavos,
            String superAdminId,
            String actorLabel
    ) {
        ensureDefault(tenantId);
        PricingConfig before = queryFor(tenantId, true);
        PricingConfig after = jdbc.queryForObject("""
                UPDATE tenant_billing_configs
                   SET charge_per_upload_centavos = ?,
                       low_balance_threshold_centavos = ?,
                       updated_at = now(),
                       updated_by = ?
                 WHERE tenant_id = ?::uuid
             RETURNING charge_per_upload_centavos,
                       low_balance_threshold_centavos,
                       updated_at,
                       updated_by
                """, (rs, rowNum) -> map(rs),
                chargePerUploadCentavos, lowBalanceThresholdCentavos,
                actorLabel, tenantId);

        audit.recordSuperAdmin(superAdminId, actorLabel, tenantId,
                "CENTER_PRICING_CHANGED", "tenant_billing_config", tenantId,
                Map.of(
                        "beforeChargePerUploadCentavos", before.chargePerUploadCentavos(),
                        "afterChargePerUploadCentavos", after.chargePerUploadCentavos(),
                        "beforeLowBalanceThresholdCentavos", before.lowBalanceThresholdCentavos(),
                        "afterLowBalanceThresholdCentavos", after.lowBalanceThresholdCentavos()
                ));
        return after;
    }

    private PricingConfig queryFor(String tenantId, boolean lock) {
        return jdbc.queryForObject("""
                SELECT charge_per_upload_centavos,
                       low_balance_threshold_centavos,
                       updated_at,
                       updated_by
                  FROM tenant_billing_configs
                 WHERE tenant_id = ?::uuid
                """ + (lock ? " FOR UPDATE" : ""),
                (rs, rowNum) -> map(rs), tenantId);
    }

    private static PricingConfig map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new PricingConfig(
                rs.getLong("charge_per_upload_centavos"),
                rs.getLong("low_balance_threshold_centavos"),
                rs.getObject("updated_at", OffsetDateTime.class),
                rs.getString("updated_by")
        );
    }

    public record PricingConfig(
            long chargePerUploadCentavos,
            long lowBalanceThresholdCentavos,
            OffsetDateTime updatedAt,
            String updatedBy
    ) {}
}
