package com.petc.ltms.config;

import com.petc.audit.AuditService;
import com.petc.ingest.CenterKeyValidator;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/** Super-admin provisioning service; all credential material remains write-only. */
@Service
public class LtmsCenterConfigService {

    private final LtmsCenterConfigRepository repository;
    private final AuditService audit;

    public LtmsCenterConfigService(LtmsCenterConfigRepository repository, AuditService audit) {
        this.repository = repository;
        this.audit = audit;
    }

    public LtmsCenterConfigRepository.LtmsCenterConfig get(String tenantId) {
        return repository.findByTenantId(requireTenantId(tenantId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "LTMS configuration not found"));
    }

    /** Future LTMS code must only obtain a config through this validated-key path. */
    public LtmsCenterConfigRepository.LtmsCenterConfig getEnabledFor(CenterKeyValidator.CenterContext center) {
        return repository.findEnabledFor(center)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN,
                        "LTMS is not enabled and credential-verified for this center"));
    }

    @Transactional
    public LtmsCenterConfigRepository.LtmsCenterConfig provision(
            String tenantId,
            LtmsCenterConfigRepository.Provisioning provisioning,
            AdminActor actor
    ) {
        tenantId = requireTenantId(tenantId);
        String centerId = repository.resolveCenterId(tenantId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No such center"));
        var result = repository.upsert(tenantId, centerId, provisioning);
        audit.recordSuperAdmin(actor.id(), actor.label(), tenantId,
                "LTMS_CENTER_PROVISIONED", "ltms_center_config", tenantId,
                Map.of("centerId", centerId, "environment", result.environment().name(),
                        "enabled", result.enabled(), "secretReferenceStored", true));
        return result;
    }

    @Transactional
    public LtmsCenterConfigRepository.LtmsCenterConfig disable(String tenantId, AdminActor actor) {
        tenantId = requireTenantId(tenantId);
        var result = repository.disable(tenantId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "LTMS configuration not found"));
        audit.recordSuperAdmin(actor.id(), actor.label(), tenantId,
                "LTMS_CENTER_DISABLED", "ltms_center_config", tenantId,
                Map.of("centerId", result.centerId()));
        return result;
    }

    @Transactional
    public LtmsCenterConfigRepository.LtmsCenterConfig rotateSecretReference(
            String tenantId, String secretReference, AdminActor actor
    ) {
        tenantId = requireTenantId(tenantId);
        var result = repository.rotateSecretReference(tenantId, secretReference)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "LTMS configuration not found"));
        audit.recordSuperAdmin(actor.id(), actor.label(), tenantId,
                "LTMS_SECRET_REFERENCE_ROTATED", "ltms_center_config", tenantId,
                Map.of("centerId", result.centerId(), "secretReferenceStored", true));
        return result;
    }

    private static String requireTenantId(String tenantId) {
        try {
            java.util.UUID.fromString(tenantId);
            return tenantId;
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Malformed tenantId");
        }
    }

    public record AdminActor(String id, String label) {}
}
