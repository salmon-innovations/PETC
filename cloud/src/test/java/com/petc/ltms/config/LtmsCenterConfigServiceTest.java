package com.petc.ltms.config;

import com.petc.audit.AuditService;
import com.petc.ingest.CenterKeyValidator;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class LtmsCenterConfigServiceTest {

    @Mock private LtmsCenterConfigRepository repository;
    @Mock private AuditService audit;

    @Test
    void provisioningDerivesCenterIdAndNeverAuditsTheSecretReference() {
        String tenantId = "123e4567-e89b-12d3-a456-426614174000";
        var service = new LtmsCenterConfigService(repository, audit);
        var provisioning = new LtmsCenterConfigRepository.Provisioning(
                "ltms-user", "business-id", "petc-code", "arn:aws:secretsmanager:secret:ltms",
                LtmsCenterConfigRepository.LtmsEnvironment.PRODUCTION, true);
        var config = config(tenantId, "center-from-license", true);
        when(repository.resolveCenterId(tenantId)).thenReturn(Optional.of("center-from-license"));
        when(repository.upsert(eq(tenantId), eq("center-from-license"), eq(provisioning))).thenReturn(config);

        var result = service.provision(tenantId, provisioning,
                new LtmsCenterConfigService.AdminActor("admin-id", "admin@example.test"));

        assertThat(result.centerId()).isEqualTo("center-from-license");
        verify(repository).upsert(tenantId, "center-from-license", provisioning);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> detail = ArgumentCaptor.forClass(Map.class);
        verify(audit).recordSuperAdmin(eq("admin-id"), eq("admin@example.test"), eq(tenantId),
                eq("LTMS_CENTER_PROVISIONED"), eq("ltms_center_config"), eq(tenantId), detail.capture());
        assertThat(detail.getValue().values()).doesNotContain("arn:aws:secretsmanager:secret:ltms");
        assertThat(detail.getValue()).containsEntry("secretReferenceStored", true);
    }

    @Test
    void activeLookupUsesTheFullAuthenticatedCenterContext() {
        var service = new LtmsCenterConfigService(repository, audit);
        var center = new CenterKeyValidator.CenterContext("tenant-a", "center-a", "ACTIVE", null);
        when(repository.findEnabledFor(center)).thenReturn(Optional.of(config("tenant-a", "center-a", true)));

        assertThat(service.getEnabledFor(center).centerId()).isEqualTo("center-a");
        verify(repository).findEnabledFor(center);
    }

    private static LtmsCenterConfigRepository.LtmsCenterConfig config(
            String tenantId, String centerId, boolean enabled
    ) {
        return new LtmsCenterConfigRepository.LtmsCenterConfig(
                tenantId, centerId, "ltms-user", "business-id", "petc-code",
                "arn:aws:secretsmanager:secret:ltms", LtmsCenterConfigRepository.LtmsEnvironment.PRODUCTION,
                enabled, LtmsCenterConfigRepository.CredentialVerificationState.UNVERIFIED,
                null, OffsetDateTime.now());
    }
}
