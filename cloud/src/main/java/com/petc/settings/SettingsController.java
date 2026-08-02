package com.petc.settings;

import com.petc.auth.JwtAuthFilter.PetcUserPrincipal;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Platform configuration for the operator portal: billing rates and the
 * submission retry policy.
 *
 * Values here drive the dispatch loop, so writes are validated before they are
 * persisted (see PlatformSettingsService.update) rather than trusted from the
 * form.
 */
@RestController
@RequestMapping("/api/settings")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public class SettingsController {

    private final PlatformSettingsService settings;

    public SettingsController(PlatformSettingsService settings) {
        this.settings = settings;
    }

    @GetMapping
    public Map<String, Object> get() {
        return settings.asMap();
    }

    /** Partial update: only the keys present in the body are changed. */
    @PutMapping
    public Map<String, Object> update(
            @RequestBody Map<String, Object> updates,
            @AuthenticationPrincipal PetcUserPrincipal principal
    ) {
        settings.update(
                updates,
                principal == null ? null : principal.userId(),
                principal == null ? "unknown" : principal.email()
        );
        return settings.asMap();
    }
}
