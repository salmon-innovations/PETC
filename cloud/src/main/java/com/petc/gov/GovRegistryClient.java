package com.petc.gov;

import java.util.Optional;

/**
 * Adapter interface isolating the rest of the system from LTMS / Stradcom / Dermalog.
 *
 * Two implementations:
 *   - MockGovRegistryClient   (dev / CI — deterministic fixtures, petc.gov.mock=true)
 *   - StradcomGovRegistryClient (stub; filled once accreditation sandbox creds arrive)
 *
 * All implementations must be safe to call from a background thread.
 */
public interface GovRegistryClient {

    /** Returns empty if plate not found in registry (center should allow manual entry). */
    Optional<VehicleInfo> findVehicle(String plateNumber);

    /** Returns empty if license not found in registry. */
    Optional<DriverInfo> findDriver(String licenseNumber);

    /** Submit a completed emission test for the official certificate. */
    SubmissionResult submitEmissionResult(EmissionPayload payload);
}
