package com.petc.gov;

import java.time.LocalDate;

public record VehicleInfo(
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
