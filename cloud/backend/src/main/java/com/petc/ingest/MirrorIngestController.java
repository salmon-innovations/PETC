package com.petc.ingest;

import com.petc.audit.AuditService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Receives opportunistic mirror pushes from desktop apps.
 * The desktop is canonical — we only persist, never reject on business logic.
 * Authentication: per-center API key in X-Center-Key header.
 */
@RestController
@RequestMapping("/api/ingest")
public class MirrorIngestController {

    private static final Logger log = LoggerFactory.getLogger(MirrorIngestController.class);

    private final MirrorIngestService ingestService;
    private final CenterKeyValidator keyValidator;
    private final AuditService auditService;

    public MirrorIngestController(
            MirrorIngestService ingestService,
            CenterKeyValidator keyValidator,
            AuditService auditService
    ) {
        this.ingestService = ingestService;
        this.keyValidator = keyValidator;
        this.auditService = auditService;
    }

    @PostMapping("/mirror")
    public ResponseEntity<Void> mirror(
            @RequestHeader("X-Center-Key") String centerKey,
            @Valid @RequestBody MirrorPayload payload
    ) {
        String tenantId = keyValidator.validate(centerKey);

        log.debug("Mirror event center={} entity={} id={}",
                payload.centerId(), payload.entityType(), payload.entityId());

        ingestService.ingest(tenantId, payload);

        auditService.record(tenantId, null, "MIRROR_INGEST",
                payload.entityType(), payload.entityId());

        return ResponseEntity.accepted().build();
    }

    // ── schema ────────────────────────────────────────────────────────────
    record MirrorPayload(
            @NotBlank String centerId,
            @NotBlank String entityType,
            @NotBlank String entityId,
            @NotNull Map<String, Object> payload
    ) {}
}
