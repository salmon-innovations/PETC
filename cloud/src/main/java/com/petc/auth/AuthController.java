package com.petc.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public ResponseEntity<TokenResponse> login(@Valid @RequestBody LoginRequest req) {
        return ResponseEntity.ok(authService.login(req.email(), req.password(), req.tenantSlug()));
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(@Valid @RequestBody RefreshRequest req) {
        return ResponseEntity.ok(authService.refresh(req.refreshToken()));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@Valid @RequestBody RefreshRequest req) {
        authService.revoke(req.refreshToken());
        return ResponseEntity.noContent().build();
    }

    // ---------------------------------------------------------------- schema
    record LoginRequest(
            @NotBlank @Email String email,
            @NotBlank String password,
            @NotBlank String tenantSlug
    ) {}

    record RefreshRequest(@NotBlank String refreshToken) {}

    record TokenResponse(String accessToken, String refreshToken) {}
}
