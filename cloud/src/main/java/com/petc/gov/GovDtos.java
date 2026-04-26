package com.petc.gov;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Shared data objects for the gov registry adapter. */
public final class GovDtos {
    private GovDtos() {}
}

record VehicleInfo(
        String plateNumber,
        String make,
        String model,
        int year,
        String fuelType,
        String engineNo,
        String chassisNo,
        String ownerName
) {}

record DriverInfo(
        String licenseNo,
        String fullName,
        String licenseType,
        LocalDate expiryDate
) {}

record EmissionPayload(
        String testId,
        String plateNumber,
        String licenseNo,
        String fuelType,
        boolean passFail,
        Map<String, Object> readings,
        List<String> photoS3Keys,
        String operatorId,
        String tenantId
) {}

record SubmissionResult(
        String state,           // ACCEPTED | REJECTED
        String certificateNo,   // non-null when ACCEPTED
        String rejectionReason  // non-null when REJECTED
) {}
