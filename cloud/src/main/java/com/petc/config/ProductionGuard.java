package com.petc.config;

import com.petc.settings.PlatformSettingsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Fails closed when the Spring production profile still points at demo services
 * or placeholder secrets.
 */
@Component
public class ProductionGuard implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ProductionGuard.class);

    private final Environment environment;
    private final boolean govMock;
    private final boolean requireLiveGovernment;
    private final boolean devKeyEnabled;
    private final String jwtSecret;
    private final String s3Endpoint;
    private final String s3AccessKey;
    private final String s3SecretKey;
    private final PlatformSettingsService settings;

    public ProductionGuard(
            Environment environment,
            @Value("${petc.gov.mock:true}") boolean govMock,
            @Value("${petc.gov.require-live:false}") boolean requireLiveGovernment,
            @Value("${petc.ingest.dev-key-enabled:true}") boolean devKeyEnabled,
            @Value("${petc.jwt.secret}") String jwtSecret,
            @Value("${petc.s3.endpoint}") String s3Endpoint,
            @Value("${petc.s3.access-key}") String s3AccessKey,
            @Value("${petc.s3.secret-key}") String s3SecretKey,
            PlatformSettingsService settings
    ) {
        this.environment = environment;
        this.govMock = govMock;
        this.requireLiveGovernment = requireLiveGovernment;
        this.devKeyEnabled = devKeyEnabled;
        this.jwtSecret = jwtSecret;
        this.s3Endpoint = s3Endpoint;
        this.s3AccessKey = s3AccessKey;
        this.s3SecretKey = s3SecretKey;
        this.settings = settings;
    }

    @Override
    public void run(ApplicationArguments args) {
        boolean production = Arrays.asList(environment.getActiveProfiles()).contains("production");
        if (!production) {
            return;
        }
        List<String> errors = new ArrayList<>();
        if (requireLiveGovernment && govMock) {
            errors.add("petc.gov.mock must be false");
        } else if (govMock) {
            log.warn("Production is running with the government mock adapter; set GOV_REQUIRE_LIVE=true when commissioning is complete");
        }
        if (devKeyEnabled) {
            errors.add("petc.ingest.dev-key-enabled must be false");
        }
        if (isPlaceholder(jwtSecret)) {
            errors.add("petc.jwt.secret must be a non-placeholder secret");
        }
        if (!s3Endpoint.isBlank() && isLocalEndpoint(s3Endpoint)) {
            errors.add("petc.s3.endpoint must point to the authorized object storage endpoint");
        }
        boolean hasAccessKey = s3AccessKey != null && !s3AccessKey.isBlank();
        boolean hasSecretKey = s3SecretKey != null && !s3SecretKey.isBlank();
        if (hasAccessKey != hasSecretKey) {
            errors.add("S3 access key and secret key must be provided together");
        } else if (hasAccessKey && (isPlaceholder(s3AccessKey) || isPlaceholder(s3SecretKey))) {
            errors.add("Configured S3 credentials must not be placeholders");
        }
        // Billing settings live in platform_settings and are mutable at runtime,
        // so this can only confirm they are present and sane AT STARTUP. A bad
        // value written later is caught by PlatformSettingsService.validate()
        // on the write path, with typed fallbacks as the last line of defence.
        if (settings.chargePerUploadCentavos() <= 0) {
            errors.add("wallet.charge_per_upload_centavos must be greater than zero in production");
        }
        if (settings.backoffSeconds().length == 0) {
            errors.add("submission.backoff_seconds must not be empty");
        }
        if (!errors.isEmpty()) {
            throw new IllegalStateException("Production profile is not compliant: " + String.join("; ", errors));
        }
    }

    private boolean isPlaceholder(String value) {
        if (value == null || value.isBlank()) {
            return true;
        }
        String normalized = value.trim().toLowerCase();
        return normalized.equals("changeme-at-least-32-chars-long!!!")
                || normalized.equals("changeme")
                || normalized.equals("dev-insecure-key")
                || normalized.equals("minioadmin")
                || normalized.equals("secret")
                || normalized.equals("placeholder");
    }

    private boolean isLocalEndpoint(String value) {
        if (value == null || value.isBlank()) {
            return true;
        }
        String normalized = value.toLowerCase();
        return normalized.contains("localhost") || normalized.contains("127.0.0.1");
    }
}
