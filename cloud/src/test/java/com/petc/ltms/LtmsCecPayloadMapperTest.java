package com.petc.ltms;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class LtmsCecPayloadMapperTest {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final LtmsCecPayloadMapper payloadMapper = new LtmsCecPayloadMapper(objectMapper);

    @Test
    void mapsGasPayloadWithPhilippineInspectionTimeAndExplicitNullReadings() throws Exception {
        JsonNode payload = payloadMapper.map(canonical("""
                {
                  "testDatetime": "2026-08-11T00:30:45Z",
                  "inspection": { "purpose": "FOR_RENEWAL" },
                  "vehicle": {
                    "plateNo": "ABC1234", "mvNo": "020400002073574",
                    "engineNo": "ENGINE-1", "chassisNo": "CHASSIS-1",
                    "fuelType": "GAS", "vehicleType": "CAR", "classification": "PUBLIC"
                  },
                  "owner": {
                    "ownerType": "INDIVIDUAL", "firstName": "Ana", "middleName": "M", "lastName": "Santos",
                    "address": "Quezon City"
                  },
                  "technician": { "technicianName": "Juan Dela Cruz" },
                  "readings": { "co_pct": 0.32, "hc_ppm": 123, "co2_pct": 12.5, "o2_pct": 0.5, "rpm": 2500 }
                }
                """), "202612345000001").payload();

        assertThat(payload.at("/vehicle/fuel_type").asText()).isEqualTo("GAS");
        assertThat(payload.at("/vehicle/dotr_vehicle_group").asText()).isEqualTo("LIGHT");
        assertThat(payload.at("/vehicle/classification").asText()).isEqualTo("FOR_HIRE");
        assertThat(payload.at("/inspection/inspection_date").asText()).isEqualTo("2026-08-11T08:30:45");
        assertThat(payload.at("/inspection/co").decimalValue()).isEqualByComparingTo("0.32");
        assertThat(payload.at("/inspection/hc").intValue()).isEqualTo(123);
        assertThat(payload.at("/inspection/ave_d").isNull()).isTrue();
        assertThat(payload.at("/inspection/nox").isNull()).isTrue();
        assertThat(payload.at("/inspection/temperature").isNull()).isTrue();
        assertThat(payload.at("/inspection/lambda").isNull()).isTrue();
    }

    @Test
    void mapsMotorcycleToGasAndDieselToOpacityWithNonApplicableReadingsNull() throws Exception {
        JsonNode motorcycle = payloadMapper.map(canonical("""
                {
                  "testDatetime": "2026-08-11T08:30:45",
                  "inspection": { "purpose": "FOR_RENEWAL" },
                  "vehicle": {
                    "mvNo": "MV-1", "engineNo": "ENGINE-1", "chassisNo": "CHASSIS-1",
                    "fuelType": "MOTORCYCLE", "vehicleType": "MOTORCYCLE"
                  },
                  "owner": { "ownerType": "ORGANIZATION", "organization": "Acme Corp", "address": "Makati" },
                  "technician": { "technicianName": "Tech" }, "readings": {}
                }
                """), "CEC-MOTORCYCLE").payload();
        assertThat(motorcycle.at("/vehicle/fuel_type").asText()).isEqualTo("GAS");
        assertThat(motorcycle.at("/vehicle/dotr_vehicle_group").asText()).isEqualTo("MOTORCYCLE");
        assertThat(motorcycle.at("/vehicle/classification").asText()).isEqualTo("PRIVATE");

        JsonNode diesel = payloadMapper.map(canonical("""
                {
                  "testDatetime": "2026-08-11T08:30:45+08:00",
                  "inspection": { "purpose": "FOR_RENEWAL" },
                  "vehicle": {
                    "mvNo": "MV-2", "engineNo": "ENGINE-2", "chassisNo": "CHASSIS-2",
                    "fuelType": "DIESEL", "vehicleType": "TRUCK"
                  },
                  "engineFlags": { "turbo": "NON_TURBO" },
                  "owner": { "ownerType": "ORGANIZATION", "organization": "Acme Corp", "address": "Makati" },
                  "technician": { "technicianName": "Tech" },
                  "readings": { "opacity_pct": 12.3, "rpm": 1800 }
                }
                """), "CEC-DIESEL").payload();
        assertThat(diesel.at("/vehicle/dotr_vehicle_group").asText()).isEqualTo("HEAVY");
        assertThat(diesel.at("/vehicle/diesel_type").asText()).isEqualTo("NATURAL");
        assertThat(diesel.at("/inspection/ave_d").decimalValue()).isEqualByComparingTo("12.3");
        assertThat(diesel.at("/inspection/rpm").intValue()).isEqualTo(1800);
        assertThat(diesel.at("/inspection/co").isNull()).isTrue();
        assertThat(diesel.at("/inspection/hc").isNull()).isTrue();
        assertThat(diesel.at("/inspection/nox").isNull()).isTrue();
    }

    @Test
    void validatesCecInitialRegistrationOwnerAndReadingTypesBeforeTransport() throws Exception {
        JsonNode initialWithoutChassis = canonical("""
                {
                  "testDatetime": "2026-08-11T08:30:45+08:00",
                  "inspection": { "purpose": "FOR_INIT_REG" },
                  "vehicle": { "mvNo": "MANUAL-MV", "engineNo": "ENGINE", "fuelType": "GAS" },
                  "owner": { "ownerType": "INDIVIDUAL", "firstName": "Ana", "lastName": "Santos", "address": "Quezon City" },
                  "technician": { "technicianName": "Tech" }, "readings": {}
                }
                """);
        assertThatIllegalArgumentException().isThrownBy(() -> payloadMapper.map(initialWithoutChassis, "CEC-1"))
                .withMessageContaining("vehicle.chassisNo");

        JsonNode badReading = canonical("""
                {
                  "testDatetime": "2026-08-11T08:30:45+08:00",
                  "inspection": { "purpose": "FOR_RENEWAL" },
                  "vehicle": { "mvNo": "MV", "fuelType": "GAS" },
                  "owner": { "ownerType": "INDIVIDUAL", "firstName": "Ana", "lastName": "Santos", "address": "Quezon City" },
                  "technician": { "technicianName": "Tech" }, "readings": { "co_pct": "0.3" }
                }
                """);
        assertThatIllegalArgumentException().isThrownBy(() -> payloadMapper.map(badReading, "CEC-1"))
                .withMessageContaining("readings.co_pct");
        assertThatIllegalArgumentException().isThrownBy(() -> payloadMapper.map(badReading, " "))
                .withMessageContaining("cecNumber");
    }

    private JsonNode canonical(String json) throws Exception {
        return objectMapper.readTree(json);
    }
}
