package com.petc.submissions;

import com.petc.ingest.CenterKeyValidator;
import com.petc.lanes.LaneQuotaService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.Map;

/**
 * Receives emission test bundles from desktop apps and queues them for
 * cloud-side LTMS / IRDS submission.  All outbound gov calls go through
 * the AWS NAT gateway — the desktop never contacts LTMS directly.
 *
 * Authentication: X-Center-Key (per-center API key, bcrypt-matched).
 */
@RestController
@RequestMapping("/api/submissions")
public class SubmissionsController {

    private final SubmissionService service;
    private final CenterKeyValidator keyValidator;
    private final LaneQuotaService quota;

    public SubmissionsController(SubmissionService service, CenterKeyValidator keyValidator, LaneQuotaService quota) {
        this.service = service;
        this.keyValidator = keyValidator;
        this.quota = quota;
    }

    /**
     * Enqueue a new submission.
     * Idempotent: re-posting with the same (centerId, testId) is safe.
     */
    @PostMapping
    public ResponseEntity<SubmitResponse> submit(
            @RequestHeader("X-Center-Key") String centerKey,
            @Valid @RequestBody SubmitRequest req
    ) {
        var ctx = keyValidator.validateContext(centerKey);
        // centerId is deliberately ignored: the lane credential is the only
        // authority for the center/lane that receives this test.
        String submissionId = service.enqueue(ctx.tenantId(), ctx.laneId(), ctx.centerId(), req.testId(), req.payload());
        var usage = quota.current(ctx.tenantId(), ctx.laneId());
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(new SubmitResponse(submissionId, "PENDING", ctx.laneId(), usage));
    }

    /**
     * Poll for the result of a queued submission.
     * The desktop short-polls this every 1s for up to 60s.
     */
    @GetMapping("/{submissionId}")
    public ResponseEntity<StatusResponse> status(
            @RequestHeader("X-Center-Key") String centerKey,
            @PathVariable String submissionId
    ) {
        // Explicit tenant predicate — NOT RLS. Center-key requests carry no JWT,
        // so TenantContextFilter never sets app.tenant_id, current_tenant_id()
        // is NULL, and every tenant_isolation policy falls through to its
        // "OR current_tenant_id() IS NULL" branch. Without the tenantId below,
        // any valid center key could read any other center's submission.
        var ctx = keyValidator.validateContext(centerKey);
        return service.getStatus(submissionId, ctx.tenantId(), ctx.laneId())
                .map(s -> ResponseEntity.ok(new StatusResponse(
                        submissionId,
                        s.state(),
                        s.certificateNo(),
                        s.ltmsRefNo(),
                        s.rejectionReason(),
                        s.orNo(),
                        s.dermalogToken(),
                        s.validFrom(),
                        s.validUntil(),
                        ctx.laneId(),
                        quota.current(ctx.tenantId(), ctx.laneId())
                )))
                .orElse(ResponseEntity.notFound().build());
    }

    // ── request / response records ────────────────────────────────────────

    record SubmitRequest(
            String centerId,
            @NotBlank String testId,
            @NotNull Map<String, Object> payload
    ) {}

    record SubmitResponse(String submissionId, String state, String laneId, LaneQuotaService.Quota quota) {}

    record StatusResponse(
            String submissionId,
            String state,
            String certificateNo,
            String ltmsRefNo,
            String rejectionReason,
            String orNo,
            String dermalogToken,
            LocalDate validFrom,
            LocalDate validUntil,
            String laneId,
            LaneQuotaService.Quota quota
    ) {}
}
