package com.petc.gov;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

/**
 * Real Stradcom / LTMS adapter.
 * TODO: fill in API details once accreditation sandbox credentials are received.
 *
 * Activated when petc.gov.mock=false.
 */
@Component
@ConditionalOnProperty(name = "petc.gov.mock", havingValue = "false")
public class StradcomGovRegistryClient implements GovRegistryClient {

    private static final Logger log = LoggerFactory.getLogger(StradcomGovRegistryClient.class);

    private final WebClient webClient;

    public StradcomGovRegistryClient(WebClient.Builder builder) {
        // TODO: configure base URL, auth headers from application.yml once sandbox docs arrive
        this.webClient = builder.baseUrl("https://api.stradcom.gov.ph").build();
    }

    @Override
    public VehicleInfo findVehicle(String plateNumber) {
        // TODO: implement once API contract is documented
        throw new UnsupportedOperationException("StradcomGovRegistryClient.findVehicle not yet implemented");
    }

    @Override
    public DriverInfo findDriver(String licenseNumber) {
        throw new UnsupportedOperationException("StradcomGovRegistryClient.findDriver not yet implemented");
    }

    @Override
    public SubmissionResult submitEmissionResult(EmissionPayload payload) {
        throw new UnsupportedOperationException("StradcomGovRegistryClient.submitEmissionResult not yet implemented");
    }
}
