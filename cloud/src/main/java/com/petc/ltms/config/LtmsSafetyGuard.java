package com.petc.ltms.config;

import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Single fail-closed boundary that a future LTMS transport must use before it
 * constructs a real request.  This class performs no network I/O.
 */
@Component
public class LtmsSafetyGuard implements InitializingBean {

    private final LtmsSafetyProperties properties;

    public LtmsSafetyGuard(LtmsSafetyProperties properties) {
        this.properties = properties;
    }

    @Override
    public void afterPropertiesSet() {
        validateStartup();
    }

    void validateStartup() {
        LtmsMode mode = Objects.requireNonNull(properties.getMode(), "petc.ltms.mode is required");
        if (mode == LtmsMode.PRODUCTION && !properties.isCommissioningApproved()) {
            throw new IllegalStateException(
                    "LTMS production mode requires petc.ltms.commissioning-approved=true");
        }
        if (properties.isOutboundEnabled()
                && (mode == LtmsMode.MOCK || mode == LtmsMode.QA_DISABLED)) {
            throw new IllegalStateException(
                    "LTMS outbound calls require mode QA_ENABLED or PRODUCTION");
        }
        if (properties.isUploadEnabled() && !properties.isOutboundEnabled()) {
            throw new IllegalStateException(
                    "LTMS upload requires petc.ltms.outbound-enabled=true");
        }
        if (properties.isOutboundEnabled() && allowedHosts().isEmpty()) {
            throw new IllegalStateException(
                    "LTMS outbound calls require at least one configured HTTPS host");
        }
    }

    /** True only when both the target and the explicit deployment gate allow egress. */
    public boolean outboundCallsPermitted() {
        return properties.isOutboundEnabled()
                && (properties.getMode() == LtmsMode.QA_ENABLED || properties.getMode() == LtmsMode.PRODUCTION);
    }

    /** Mutating CEC calls need their own explicit gate in addition to egress. */
    public boolean uploadCallsPermitted() {
        return outboundCallsPermitted() && properties.isUploadEnabled();
    }

    public void requireUploadPermitted() {
        if (!uploadCallsPermitted()) {
            throw new IllegalStateException("LTMS upload and replacement calls are disabled");
        }
    }

    /**
     * Guards a client destination.  Hosts are exact-match allowlisted and only
     * HTTPS is valid.  Calling this does not itself make a network request.
     */
    public void requirePermittedDestination(URI baseUri) {
        if (!outboundCallsPermitted()) {
            throw new IllegalStateException("LTMS outbound calls are disabled");
        }
        if (baseUri == null || !"https".equalsIgnoreCase(baseUri.getScheme())
                || baseUri.getHost() == null || !allowedHosts().contains(baseUri.getHost().toLowerCase(Locale.ROOT))) {
            throw new IllegalArgumentException("LTMS destination must be an allowlisted HTTPS host");
        }
    }

    private Set<String> allowedHosts() {
        return properties.getAllowedHosts().stream()
                .filter(Objects::nonNull)
                .map(host -> host.trim().toLowerCase(Locale.ROOT))
                .filter(host -> !host.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }
}
