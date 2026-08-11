package com.petc.ltms;

import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.net.URI;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * Transport-only LTMS settings.  A live mode is deliberately opt-in: merely
 * configuring an endpoint never enables outbound LTMS traffic.
 */
@Validated
@ConfigurationProperties(prefix = "petc.ltms")
public class LtmsTransportProperties {

    public enum Mode {
        MOCK, PRODUCTION;

        public boolean permitsOutboundCalls() {
            return this == PRODUCTION;
        }
    }

    @NotNull
    private Mode mode = Mode.MOCK;
    private URI petcBaseUrl;
    private URI jwtBaseUrl;
    private Set<String> allowedHosts = new LinkedHashSet<>();
    @NotNull
    private Duration connectTimeout = Duration.ofSeconds(5);
    @NotNull
    private Duration readTimeout = Duration.ofSeconds(15);
    @NotNull
    private Duration totalTimeout = Duration.ofSeconds(20);

    public Mode getMode() { return mode; }
    public void setMode(Mode mode) { this.mode = mode; }
    public URI getPetcBaseUrl() { return petcBaseUrl; }
    public void setPetcBaseUrl(URI petcBaseUrl) { this.petcBaseUrl = petcBaseUrl; }
    public URI getJwtBaseUrl() { return jwtBaseUrl; }
    public void setJwtBaseUrl(URI jwtBaseUrl) { this.jwtBaseUrl = jwtBaseUrl; }
    public Set<String> getAllowedHosts() { return Set.copyOf(allowedHosts); }
    public void setAllowedHosts(Set<String> allowedHosts) {
        this.allowedHosts = allowedHosts == null ? new LinkedHashSet<>() : new LinkedHashSet<>(allowedHosts);
    }
    public Duration getConnectTimeout() { return connectTimeout; }
    public void setConnectTimeout(Duration connectTimeout) { this.connectTimeout = connectTimeout; }
    public Duration getReadTimeout() { return readTimeout; }
    public void setReadTimeout(Duration readTimeout) { this.readTimeout = readTimeout; }
    public Duration getTotalTimeout() { return totalTimeout; }
    public void setTotalTimeout(Duration totalTimeout) { this.totalTimeout = totalTimeout; }

    /** Fail closed before a live HTTP client is constructed. */
    public void requireValidLiveConfiguration() {
        if (!mode.permitsOutboundCalls()) return;
        if (allowedHosts.isEmpty()) {
            throw new IllegalStateException("Live LTMS mode requires an explicit allowed-hosts allowlist");
        }
        validateEndpoint("petc-base-url", petcBaseUrl);
        validateEndpoint("jwt-base-url", jwtBaseUrl);
        if (connectTimeout.isNegative() || connectTimeout.isZero()
                || readTimeout.isNegative() || readTimeout.isZero()
                || totalTimeout.isNegative() || totalTimeout.isZero()) {
            throw new IllegalStateException("LTMS timeouts must be positive");
        }
    }

    public URI petcEndpoint(String path) {
        requireValidLiveConfiguration();
        return resolve(petcBaseUrl, path);
    }

    public URI jwtEndpoint(String path) {
        requireValidLiveConfiguration();
        return resolve(jwtBaseUrl, path);
    }

    private void validateEndpoint(String name, URI endpoint) {
        if (endpoint == null || !endpoint.isAbsolute() || endpoint.getHost() == null
                || endpoint.getUserInfo() != null || endpoint.getRawQuery() != null || endpoint.getRawFragment() != null
                || !"https".equalsIgnoreCase(endpoint.getScheme())) {
            throw new IllegalStateException("LTMS " + name + " must be an absolute HTTPS URL without credentials, query, or fragment");
        }
        String host = endpoint.getHost().toLowerCase(Locale.ROOT);
        boolean allowed = allowedHosts.stream().filter(Objects::nonNull)
                .map(value -> value.toLowerCase(Locale.ROOT)).anyMatch(host::equals);
        if (!allowed) {
            throw new IllegalStateException("LTMS " + name + " host is not allowlisted");
        }
    }

    private static URI resolve(URI base, String path) {
        if (path == null || !path.startsWith("/")) {
            throw new IllegalArgumentException("LTMS endpoint path must begin with '/'");
        }
        // URI.resolve("/v2/...") discards /ords/dl_interfaces from the
        // documented server URL. Append the operation path so a configured
        // LTMS base path is preserved.
        String baseValue = base.toString();
        return URI.create((baseValue.endsWith("/")
                ? baseValue.substring(0, baseValue.length() - 1)
                : baseValue) + path);
    }
}
