package com.petc.gov;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class MockGovRegistryClientTest {

    private MockGovRegistryClient client;

    @BeforeEach
    void setUp() {
        client = new MockGovRegistryClient();
    }

    // ── findVehicle ───────────────────────────────────────────────────────

    @Test
    void findVehicle_notFound_returnsEmpty() {
        assertThat(client.findVehicle("NOTFOUND")).isEmpty();
    }

    @Test
    void findVehicle_dslPrefix_returnsDieselTruck() {
        Optional<VehicleInfo> result = client.findVehicle("DSL1234");
        assertThat(result).isPresent();
        assertThat(result.get().fuelType()).isEqualTo("DIESEL");
        assertThat(result.get().vehicleType()).isEqualTo("TRUCK");
        assertThat(result.get().ownerType()).isEqualTo("ORGANIZATION");
    }

    @Test
    void findVehicle_mcPrefix_returnsMotorcycle() {
        Optional<VehicleInfo> result = client.findVehicle("MC1234");
        assertThat(result).isPresent();
        assertThat(result.get().fuelType()).isEqualTo("MOTORCYCLE");
        assertThat(result.get().ownerType()).isEqualTo("INDIVIDUAL");
    }

    @Test
    void findVehicle_genericPlate_returnsGasCar() {
        Optional<VehicleInfo> result = client.findVehicle("ABC1234");
        assertThat(result).isPresent();
        assertThat(result.get().fuelType()).isEqualTo("GAS");
        assertThat(result.get().vehicleType()).isEqualTo("CAR");
        assertThat(result.get().ownerType()).isEqualTo("INDIVIDUAL");
    }

    @Test
    void findVehicle_plateNormalisedToUppercase() {
        assertThat(client.findVehicle("abc1234")).isPresent();
        assertThat(client.findVehicle("dsl1234").get().fuelType()).isEqualTo("DIESEL");
    }

    // ── findDriver ────────────────────────────────────────────────────────

    @Test
    void findDriver_notFound_returnsEmpty() {
        assertThat(client.findDriver("NOTFOUND")).isEmpty();
    }

    @Test
    void findDriver_anyOtherLicense_returnsDriver() {
        Optional<DriverInfo> result = client.findDriver("N01-23-456789");
        assertThat(result).isPresent();
        assertThat(result.get().fullName()).isEqualTo("Juan dela Cruz");
    }

    // ── submitEmissionResult ──────────────────────────────────────────────

    @Test
    void submit_failPrefix_returnsRejected() {
        EmissionPayload payload = new EmissionPayload(
                "test-1", "FAIL1234", "N01-00-000000",
                "GAS", false, Map.of(), List.of(),
                "operator-1", "tenant-1", Instant.now()
        );
        SubmissionResult result = client.submitEmissionResult(payload);
        assertThat(result.isAccepted()).isFalse();
        assertThat(result.rejectionReason()).isNotBlank();
    }

    @Test
    void submit_normalPlate_returnsAccepted() {
        EmissionPayload payload = new EmissionPayload(
                "test-2", "ABC1234", "N01-00-000000",
                "GAS", true, Map.of(), List.of(),
                "operator-1", "tenant-1", Instant.now()
        );
        SubmissionResult result = client.submitEmissionResult(payload);
        assertThat(result.isAccepted()).isTrue();
        assertThat(result.certificateNo()).startsWith("CERT-");
    }

    @Test
    void submit_dslPlate_returnsAccepted() {
        EmissionPayload payload = new EmissionPayload(
                "test-3", "DSL1234", "N01-00-000000",
                "DIESEL", true, Map.of(), List.of(),
                "operator-1", "tenant-1", Instant.now()
        );
        assertThat(client.submitEmissionResult(payload).isAccepted()).isTrue();
    }

    @Test
    void submit_eachCallProducesUniqueCertNo() {
        EmissionPayload p1 = new EmissionPayload("t1", "ABC1234", "", "GAS", true,
                Map.of(), List.of(), "op", "tenant", Instant.now());
        EmissionPayload p2 = new EmissionPayload("t2", "XYZ9999", "", "GAS", true,
                Map.of(), List.of(), "op", "tenant", Instant.now());
        assertThat(client.submitEmissionResult(p1).certificateNo())
                .isNotEqualTo(client.submitEmissionResult(p2).certificateNo());
    }
}
