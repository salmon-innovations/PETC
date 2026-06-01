package com.petc.registry;

import com.petc.gov.DriverInfo;
import com.petc.gov.GovRegistryClient;
import com.petc.gov.VehicleInfo;
import com.petc.ingest.CenterKeyValidator;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * Proxies vehicle and driver lookups from desktop apps to the gov registry.
 * Calls go out through the AWS NAT gateway — the desktop never contacts
 * LTMS / Stradcom directly.
 *
 * Authentication: X-Center-Key.
 */
@RestController
@RequestMapping("/api/registry")
public class RegistryController {

    private final CenterKeyValidator keyValidator;
    private final GovRegistryClient govClient;

    public RegistryController(CenterKeyValidator keyValidator, GovRegistryClient govClient) {
        this.keyValidator = keyValidator;
        this.govClient = govClient;
    }

    @GetMapping("/vehicle/{plate}")
    public ResponseEntity<VehicleInfo> vehicle(
            @RequestHeader("X-Center-Key") String centerKey,
            @PathVariable String plate
    ) {
        keyValidator.validate(centerKey);
        return govClient.findVehicle(plate)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/driver/{licenseNo}")
    public ResponseEntity<DriverInfo> driver(
            @RequestHeader("X-Center-Key") String centerKey,
            @PathVariable String licenseNo
    ) {
        keyValidator.validate(centerKey);
        return govClient.findDriver(licenseNo)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
