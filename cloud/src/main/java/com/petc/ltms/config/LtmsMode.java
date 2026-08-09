package com.petc.ltms.config;

/**
 * Deployment target for the LTMS integration.  A target alone never permits
 * network traffic; {@code petc.ltms.outbound-enabled} is a second, explicit
 * gate checked by {@link LtmsSafetyGuard}.
 */
public enum LtmsMode {
    MOCK,
    QA_DISABLED,
    QA_ENABLED,
    PRODUCTION
}
