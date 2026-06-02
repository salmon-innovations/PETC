package com.petc.gov;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

/**
 * Deterministic mock gov client — Java port of desktop/sidecar/petc/gov/mock_client.py.
 * Plate behaviours are identical to the Python mock so dev plate numbers work against
 * both the desktop-only path and the cloud submission path.
 *
 * Active when petc.gov.mock=true (the default).
 */
@Component
@ConditionalOnProperty(name = "petc.gov.mock", havingValue = "true", matchIfMissing = true)
public class MockGovRegistryClient implements GovRegistryClient {

    @Override
    public Optional<VehicleInfo> findVehicle(String plateNumber) {
        String plate = plateNumber.toUpperCase().replace(" ", "");
        if ("NOTFOUND".equals(plate)) {
            return Optional.empty();
        }
        if (plate.startsWith("DSL")) {
            return Optional.of(new VehicleInfo(
                    plate, "MV-" + plate + "-D", "MVRR",
                    LocalDate.of(2024, 5, 12), "CR-" + plate,
                    "1368 - PASAY CITY DISTRICT OFFICE",
                    "ISUZU", "NPR", "TRUCK", 2018, "WHITE", "M/T", "DIESEL",
                    "ENG-" + plate, "CHS-" + plate,
                    "ORGANIZATION", "", "", "", "JUAN LOGISTICS CORP.",
                    "EDSA Extension", "Pasay City"
            ));
        }
        if (plate.startsWith("MC")) {
            return Optional.of(new VehicleInfo(
                    plate, "MV-" + plate + "-M", "MVRS",
                    LocalDate.of(2025, 2, 3), "CR-" + plate,
                    "1301 - QUEZON CITY DISTRICT OFFICE",
                    "HONDA", "CLICK 125", "MOTORCYCLE", 2022, "BLACK", "A/T", "MOTORCYCLE",
                    "ENG-" + plate, "CHS-" + plate,
                    "INDIVIDUAL", "SANTOS", "MARIA", "REYES", "",
                    "Commonwealth Avenue", "Quezon City"
            ));
        }
        // Default: generic gas car (covers ABC1234 and any other plate)
        return Optional.of(new VehicleInfo(
                plate, "MV-" + plate, "MVRR",
                LocalDate.of(2025, 1, 18), "CR-" + plate,
                "1368 - PASAY CITY DISTRICT OFFICE",
                "TOYOTA", "VIOS", "CAR", 2020, "SILVER", "A/T", "GAS",
                "ENG-" + plate, "CHS-" + plate,
                "INDIVIDUAL", "DELA CRUZ", "JUAN", "SANTOS", "",
                "Roxas Boulevard", "Pasay City"
        ));
    }

    @Override
    public Optional<DriverInfo> findDriver(String licenseNumber) {
        if ("NOTFOUND".equalsIgnoreCase(licenseNumber)) {
            return Optional.empty();
        }
        return Optional.of(new DriverInfo(
                licenseNumber,
                "Juan dela Cruz",
                "Non-Professional",
                LocalDate.of(2027, 12, 31)
        ));
    }

    @Override
    public SubmissionResult submitEmissionResult(EmissionPayload payload) {
        if (payload.plateNumber().toUpperCase().startsWith("FAIL")) {
            return SubmissionResult.rejected("Mock rejection: plate starts with FAIL");
        }
        String hex = UUID.randomUUID().toString().replace("-", "").toUpperCase();
        String certNo = "CERT-" + hex.substring(0, 8);
        // OR No on the LTMS receipt: 17-digit numeric in real LTMS; mock uses a deterministic stand-in.
        String orNo = "2026" + String.format("%013d", Math.abs(payload.plateNumber().hashCode() % 10_000_000_000_000L));
        // DERMALOG seal: 32-char hex in real LTMS; mock reuses the cert UUID hex.
        String dermalogToken = hex;
        LocalDate validFrom = LocalDate.now();
        LocalDate validUntil = validFrom.plusDays(60);
        return SubmissionResult.accepted(certNo, orNo, dermalogToken, validFrom, validUntil);
    }
}
