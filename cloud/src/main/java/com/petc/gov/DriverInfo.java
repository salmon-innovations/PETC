package com.petc.gov;

import java.time.LocalDate;

public record DriverInfo(
        String licenseNo,
        String fullName,
        String licenseType,
        LocalDate expiryDate
) {}
