package com.petc.ltms.config;

import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

class LtmsSafetyGuardTest {

    @Test
    void defaultsToMockWithNoPermittedOutboundTraffic() {
        var properties = new LtmsSafetyProperties();
        var guard = new LtmsSafetyGuard(properties);

        guard.validateStartup();

        assertThat(guard.outboundCallsPermitted()).isFalse();
        assertThat(guard.uploadCallsPermitted()).isFalse();
        assertThatIllegalStateException()
                .isThrownBy(() -> guard.requirePermittedDestination(URI.create("https://ltms.example.test")));
    }

    @Test
    void uploadsNeedASeparateExplicitGate() {
        var properties = new LtmsSafetyProperties();
        properties.setUploadEnabled(true);

        assertThatIllegalStateException()
                .isThrownBy(() -> new LtmsSafetyGuard(properties).validateStartup())
                .withMessageContaining("outbound-enabled=true");

        properties.setMode(LtmsMode.PRODUCTION);
        properties.setCommissioningApproved(true);
        properties.setOutboundEnabled(true);
        properties.setUploadEnabled(false);
        properties.setProductionUploadEnabled(true);
        properties.setAllowedHosts(java.util.List.of("production.ltms.example.test"));
        var readOnlyGuard = new LtmsSafetyGuard(properties);
        readOnlyGuard.validateStartup();

        assertThat(readOnlyGuard.outboundCallsPermitted()).isTrue();
        assertThat(readOnlyGuard.uploadCallsPermitted()).isFalse();
        assertThatIllegalStateException().isThrownBy(readOnlyGuard::requireUploadPermitted);

        properties.setUploadEnabled(true);
        var uploadGuard = new LtmsSafetyGuard(properties);
        uploadGuard.validateStartup();
        assertThat(uploadGuard.uploadCallsPermitted()).isTrue();
        assertThatCode(uploadGuard::requireUploadPermitted).doesNotThrowAnyException();
    }

    @Test
    void outboundNeedsAnEnabledModeAndAllowlistedHost() {
        var properties = new LtmsSafetyProperties();
        properties.setMode(LtmsMode.PRODUCTION);
        properties.setCommissioningApproved(true);
        properties.setOutboundEnabled(true);

        assertThatIllegalStateException().isThrownBy(() -> new LtmsSafetyGuard(properties).validateStartup())
                .withMessageContaining("configured HTTPS host");

        properties.setAllowedHosts(java.util.List.of("production.ltms.example.test"));
        var guard = new LtmsSafetyGuard(properties);
        guard.validateStartup();

        guard.requirePermittedDestination(URI.create("https://production.ltms.example.test/v2"));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> guard.requirePermittedDestination(URI.create("http://production.ltms.example.test")));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> guard.requirePermittedDestination(URI.create("https://other.example.test")));
    }

    @Test
    void disabledProductionModeStartsWithoutCommissioningButOutboundDoesNot() {
        var properties = new LtmsSafetyProperties();
        properties.setMode(LtmsMode.PRODUCTION);

        assertThatCode(() -> new LtmsSafetyGuard(properties).validateStartup()).doesNotThrowAnyException();

        properties.setOutboundEnabled(true);

        assertThatIllegalStateException().isThrownBy(() -> new LtmsSafetyGuard(properties).validateStartup())
                .withMessageContaining("commissioning-approved=true");
    }

    @Test
    void productionUploadsNeedTheirOwnExplicitDeploymentGate() {
        var properties = new LtmsSafetyProperties();
        properties.setMode(LtmsMode.PRODUCTION);
        properties.setCommissioningApproved(true);
        properties.setOutboundEnabled(true);
        properties.setUploadEnabled(true);
        properties.setAllowedHosts(java.util.List.of("production.ltms.example.test"));

        var productionReadOnlyGuard = new LtmsSafetyGuard(properties);
        productionReadOnlyGuard.validateStartup();

        assertThat(productionReadOnlyGuard.outboundCallsPermitted()).isTrue();
        assertThat(productionReadOnlyGuard.uploadCallsPermitted()).isFalse();
        assertThatIllegalStateException().isThrownBy(productionReadOnlyGuard::requireUploadPermitted);

        properties.setProductionUploadEnabled(true);
        var productionUploadGuard = new LtmsSafetyGuard(properties);
        productionUploadGuard.validateStartup();

        assertThat(productionUploadGuard.uploadCallsPermitted()).isTrue();
        assertThatCode(productionUploadGuard::requireUploadPermitted).doesNotThrowAnyException();
    }

    @Test
    void diagnosticsRedactCredentialsAndPii() {
        assertThat(LtmsDiagnosticSanitizer.redactHeaders(Map.of(
                "Authorization", "Bearer secret", "username", "center-user")))
                .containsEntry("Authorization", "[REDACTED]")
                .containsEntry("username", "center-user");
        assertThat(LtmsDiagnosticSanitizer.redactDiagnostic(Map.of(
                "password", "secret", "ownerName", "Jane Doe", "inbox_id", "abc")))
                .containsEntry("password", "[REDACTED]")
                .containsEntry("ownerName", "[REDACTED]")
                .containsEntry("inbox_id", "abc");
    }
}
