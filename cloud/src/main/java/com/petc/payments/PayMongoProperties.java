package com.petc.payments;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;

@ConfigurationProperties(prefix = "petc.paymongo")
public class PayMongoProperties {
    private boolean enabled;
    private URI baseUrl = URI.create("https://api.paymongo.com");
    private String secretKey = "";
    private String webhookSecret = "";
    private boolean liveMode;
    private boolean exposeTestUrl;
    private int qrExpirySeconds = 1800;
    private long minimumTopupCentavos = 10_000;
    private long maximumTopupCentavos = 5_000_000;
    private Duration connectTimeout = Duration.ofSeconds(5);
    private Duration requestTimeout = Duration.ofSeconds(20);
    private Duration webhookTolerance = Duration.ofMinutes(5);

    public void validateEnabled() {
        if (!enabled) return;
        if (!"https".equalsIgnoreCase(baseUrl.getScheme()) || !"api.paymongo.com".equalsIgnoreCase(baseUrl.getHost())) {
            throw new IllegalStateException("PayMongo base URL must be https://api.paymongo.com");
        }
        String expectedPrefix = liveMode ? "sk_live_" : "sk_test_";
        if (secretKey == null || !secretKey.startsWith(expectedPrefix)) {
            throw new IllegalStateException("PayMongo secret key does not match the configured mode");
        }
        if (webhookSecret == null || webhookSecret.isBlank()) {
            throw new IllegalStateException("PayMongo webhook secret is required when payments are enabled");
        }
        if (qrExpirySeconds < 60 || qrExpirySeconds > 9000) {
            throw new IllegalStateException("PayMongo QR expiry must be between 60 and 9000 seconds");
        }
        if (minimumTopupCentavos <= 0 || maximumTopupCentavos < minimumTopupCentavos) {
            throw new IllegalStateException("Invalid PayMongo top-up bounds");
        }
    }

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public URI getBaseUrl() { return baseUrl; }
    public void setBaseUrl(URI baseUrl) { this.baseUrl = baseUrl; }
    public String getSecretKey() { return secretKey; }
    public void setSecretKey(String secretKey) { this.secretKey = secretKey; }
    public String getWebhookSecret() { return webhookSecret; }
    public void setWebhookSecret(String webhookSecret) { this.webhookSecret = webhookSecret; }
    public boolean isLiveMode() { return liveMode; }
    public void setLiveMode(boolean liveMode) { this.liveMode = liveMode; }
    public boolean isExposeTestUrl() { return exposeTestUrl; }
    public void setExposeTestUrl(boolean exposeTestUrl) { this.exposeTestUrl = exposeTestUrl; }
    public int getQrExpirySeconds() { return qrExpirySeconds; }
    public void setQrExpirySeconds(int qrExpirySeconds) { this.qrExpirySeconds = qrExpirySeconds; }
    public long getMinimumTopupCentavos() { return minimumTopupCentavos; }
    public void setMinimumTopupCentavos(long value) { this.minimumTopupCentavos = value; }
    public long getMaximumTopupCentavos() { return maximumTopupCentavos; }
    public void setMaximumTopupCentavos(long value) { this.maximumTopupCentavos = value; }
    public Duration getConnectTimeout() { return connectTimeout; }
    public void setConnectTimeout(Duration connectTimeout) { this.connectTimeout = connectTimeout; }
    public Duration getRequestTimeout() { return requestTimeout; }
    public void setRequestTimeout(Duration requestTimeout) { this.requestTimeout = requestTimeout; }
    public Duration getWebhookTolerance() { return webhookTolerance; }
    public void setWebhookTolerance(Duration webhookTolerance) { this.webhookTolerance = webhookTolerance; }
}
