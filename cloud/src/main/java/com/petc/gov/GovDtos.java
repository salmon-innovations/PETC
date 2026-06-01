package com.petc.gov;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Shared data objects for the gov registry adapter. */
public final class GovDtos {
    private GovDtos() {}
}

record VehicleInfo(
        String plateNumber,
        String mvNo,
        String orType,
        LocalDate crDate,
        String crNo,
        String districtOffice,
        String make,
        String series,
        String vehicleType,
        int yearModel,
        String color,
        String transmission,
        String fuelType,        // "GAS" | "DIESEL" | "MOTORCYCLE"
        String engineNo,
        String chassisNo,
        String ownerType,       // "INDIVIDUAL" | "ORGANIZATION"
        String lastName,
        String firstName,
        String middleName,
        String organization,
        String address,
        String city
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
        List<PhotoRef> photos,
        String operatorId,
        String tenantId,
        Instant testedAt
) {
    record PhotoRef(String photoId, String s3Key, String photoType, String sha256) {}
}

record SubmissionResult(
        String state,           // ACCEPTED | REJECTED
        String certificateNo,   // non-null when ACCEPTED
        String rejectionReason  // non-null when REJECTED
) {
    static SubmissionResult accepted(String certNo) {
        return new SubmissionResult("ACCEPTED", certNo, null);
    }

    static SubmissionResult rejected(String reason) {
        return new SubmissionResult("REJECTED", null, reason);
    }

    boolean isAccepted() { return "ACCEPTED".equals(state); }
}
