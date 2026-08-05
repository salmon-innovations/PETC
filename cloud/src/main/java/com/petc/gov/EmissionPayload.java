package com.petc.gov;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record EmissionPayload(
        String testId,
        String plateNumber,
        String licenseNo,
        String fuelType,
        boolean passFail,
        Map<String, Object> readings,
        List<PhotoRef> photos,
        String operatorId,
        String tenantId,
        Instant testedAt
) {
    public record PhotoRef(String photoId, String s3Key, String photoType, String sha256) {}
}
