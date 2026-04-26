package com.petc.gov;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Deterministic in-memory implementation used in development and CI.
 * Activated when petc.gov.mock=true (the default).
 */
@Component
@ConditionalOnProperty(name = "petc.gov.mock", havingValue = "true", matchIfMissing = true)
public class MockGovRegistryClient implements GovRegistryClient {

    @Override
    public VehicleInfo findVehicle(String plateNumber) {
        if ("NOTFOUND".equalsIgnoreCase(plateNumber)) return null;
        return new VehicleInfo(
                plateNumber,
                "Toyota", "Vios", 2020,
                "GAS",
                "ENG-" + plateNumber,
                "CHS-" + plateNumber,
                "Juan dela Cruz"
        );
    }

    @Override
    public DriverInfo findDriver(String licenseNumber) {
        if ("NOTFOUND".equalsIgnoreCase(licenseNumber)) return null;
        return new DriverInfo(
                licenseNumber,
                "Juan dela Cruz",
                "Non-Professional",
                LocalDate.now().plusYears(3)
        );
    }

    @Override
    public SubmissionResult submitEmissionResult(EmissionPayload payload) {
        if (payload.plateNumber().startsWith("FAIL")) {
            return new SubmissionResult("REJECTED", null, "Mock rejection: plate starts with FAIL");
        }
        return new SubmissionResult("ACCEPTED", "CERT-" + UUID.randomUUID(), null);
    }
}
