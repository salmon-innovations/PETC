package com.petc.admin;

import com.petc.auth.JwtAuthFilter;
import com.petc.ltms.config.LtmsCenterConfigRepository;
import com.petc.ltms.config.LtmsCenterConfigService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;

/**
 * Super-admin-only LTMS provisioning.  Password secret references are write
 * only: neither GET responses nor audit detail expose their identifier/value.
 */
@RestController
@RequestMapping("/api/ltms/centers")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public class LtmsCenterConfigsController {

    private final LtmsCenterConfigService service;

    public LtmsCenterConfigsController(LtmsCenterConfigService service) {
        this.service = service;
    }

    @GetMapping("/{tenantId}")
    public LtmsCenterConfigResponse get(@PathVariable String tenantId) {
        return response(service.get(tenantId));
    }

    @PutMapping("/{tenantId}")
    public LtmsCenterConfigResponse provision(
            @PathVariable String tenantId,
            @Valid @RequestBody ProvisionLtmsCenterRequest request,
            @AuthenticationPrincipal JwtAuthFilter.PetcUserPrincipal principal
    ) {
        var result = service.provision(tenantId, new LtmsCenterConfigRepository.Provisioning(
                request.ltmsUsername(), request.ltmsBusinessId(), request.petcCode(),
                request.passwordSecretReference(), request.environment(), request.enabled()), actor(principal));
        return response(result);
    }

    @PostMapping("/{tenantId}/disable")
    public LtmsCenterConfigResponse disable(
            @PathVariable String tenantId,
            @AuthenticationPrincipal JwtAuthFilter.PetcUserPrincipal principal
    ) {
        return response(service.disable(tenantId, actor(principal)));
    }

    @PostMapping("/{tenantId}/secret-reference")
    @ResponseStatus(HttpStatus.OK)
    public LtmsCenterConfigResponse rotateSecretReference(
            @PathVariable String tenantId,
            @Valid @RequestBody RotateSecretReferenceRequest request,
            @AuthenticationPrincipal JwtAuthFilter.PetcUserPrincipal principal
    ) {
        return response(service.rotateSecretReference(tenantId, request.passwordSecretReference(), actor(principal)));
    }

    private static LtmsCenterConfigService.AdminActor actor(JwtAuthFilter.PetcUserPrincipal principal) {
        // Method security guarantees the super-admin role; keep an explicit
        // failure here so an accidental security configuration change cannot
        // write an unaudited/anonymous provisioning event.
        if (principal == null || principal.userId() == null || principal.userId().isBlank()) {
            throw new IllegalStateException("Authenticated super-admin principal is required");
        }
        return new LtmsCenterConfigService.AdminActor(principal.userId(), principal.email());
    }

    private static LtmsCenterConfigResponse response(LtmsCenterConfigRepository.LtmsCenterConfig config) {
        return new LtmsCenterConfigResponse(
                config.tenantId(), config.centerId(), config.ltmsUsername(), config.ltmsBusinessId(),
                config.petcCode(), config.environment(), config.enabled(),
                config.credentialVerificationState().name(), config.credentialVerifiedAt(), config.updatedAt());
    }

    public record ProvisionLtmsCenterRequest(
            @NotBlank @Size(max = 256) String ltmsUsername,
            @NotBlank @Size(max = 256) String ltmsBusinessId,
            @NotBlank @Size(max = 256) String petcCode,
            @NotBlank @Size(max = 1024)
            @Pattern(regexp = "^[A-Za-z0-9/_+=.@:-]+$", message = "Invalid secret reference")
            String passwordSecretReference,
            @NotNull LtmsCenterConfigRepository.LtmsEnvironment environment,
            boolean enabled
    ) {}

    public record RotateSecretReferenceRequest(
            @NotBlank @Size(max = 1024)
            @Pattern(regexp = "^[A-Za-z0-9/_+=.@:-]+$", message = "Invalid secret reference")
            String passwordSecretReference
    ) {}

    /** Secret references and all password/JWT material are intentionally omitted. */
    public record LtmsCenterConfigResponse(
            String tenantId,
            String centerId,
            String ltmsUsername,
            String ltmsBusinessId,
            String petcCode,
            LtmsCenterConfigRepository.LtmsEnvironment environment,
            boolean enabled,
            String credentialVerificationState,
            OffsetDateTime credentialVerifiedAt,
            OffsetDateTime updatedAt
    ) {}
}
