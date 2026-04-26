package com.petc.gov;

/**
 * Adapter interface isolating the rest of the system from whatever LTMS /
 * Stradcom / Dermalog APIs ultimately look like.
 *
 * Two implementations ship from day one:
 *   - MockGovRegistryClient   (dev / CI — deterministic fixtures)
 *   - StradcomGovRegistryClient (stub; filled once accreditation lands)
 *
 * All gov-bound calls are also written to the gov_outbox table for replay
 * and audit (see GovOutboxService).
 */
public interface GovRegistryClient {

    /**
     * Look up a vehicle by plate number.
     * Returns null if not found (center should allow manual entry).
     */
    VehicleInfo findVehicle(String plateNumber);

    /**
     * Look up a driver by license number.
     * Returns null if not found.
     */
    DriverInfo findDriver(String licenseNumber);

    /**
     * Submit a completed emission test for the official certificate.
     * Returns the state of the submission (ACCEPTED or REJECTED with reason).
     */
    SubmissionResult submitEmissionResult(EmissionPayload payload);
}
