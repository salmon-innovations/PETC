package com.petc.ltms.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;

/**
 * Platform-level LTMS safety switches.  Per-center credentials live in the
 * database and secret manager; they are intentionally not configuration
 * properties and are never available to desktop clients.
 */
@ConfigurationProperties(prefix = "petc.ltms")
public class LtmsSafetyProperties {

    private LtmsMode mode = LtmsMode.MOCK;
    private boolean outboundEnabled;
    private boolean uploadEnabled;
    private boolean commissioningApproved;
    private List<String> allowedHosts = new ArrayList<>();

    public LtmsMode getMode() {
        return mode;
    }

    public void setMode(LtmsMode mode) {
        this.mode = mode;
    }

    public boolean isOutboundEnabled() {
        return outboundEnabled;
    }

    public void setOutboundEnabled(boolean outboundEnabled) {
        this.outboundEnabled = outboundEnabled;
    }

    public boolean isUploadEnabled() {
        return uploadEnabled;
    }

    public void setUploadEnabled(boolean uploadEnabled) {
        this.uploadEnabled = uploadEnabled;
    }

    public boolean isCommissioningApproved() {
        return commissioningApproved;
    }

    public void setCommissioningApproved(boolean commissioningApproved) {
        this.commissioningApproved = commissioningApproved;
    }

    public List<String> getAllowedHosts() {
        return allowedHosts;
    }

    public void setAllowedHosts(List<String> allowedHosts) {
        this.allowedHosts = allowedHosts == null ? new ArrayList<>() : new ArrayList<>(allowedHosts);
    }
}
