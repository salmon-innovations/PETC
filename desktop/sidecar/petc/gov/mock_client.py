"""Deterministic mock gov client for development and CI."""
from __future__ import annotations

import uuid
from datetime import date
from typing import Optional

from .base import (
    DriverInfo, EmissionPayload, GovRegistryClient,
    SubmissionResult, VehicleInfo,
)


class MockGovRegistryClient(GovRegistryClient):

    def find_vehicle(self, plate_number: str) -> Optional[VehicleInfo]:
        plate = plate_number.upper().replace(" ", "")
        if plate == "NOTFOUND":
            return None
        if plate.startswith("DSL"):
            return VehicleInfo(
                plate_number=plate,
                mv_no=f"MV-{plate}-D",
                or_type="MVRR",
                cr_date=date(2024, 5, 12),
                cr_no=f"CR-{plate}",
                district_office="1368 - PASAY CITY DISTRICT OFFICE",
                make="ISUZU",
                series="NPR",
                vehicle_type="TRUCK",
                year_model=2018,
                color="WHITE",
                transmission="M/T",
                fuel_type="DIESEL",
                engine_no=f"ENG-{plate}",
                chassis_no=f"CHS-{plate}",
                owner_type="ORGANIZATION",
                organization="JUAN LOGISTICS CORP.",
                address="EDSA Extension",
                city="Pasay City",
            )
        if plate.startswith("MC"):
            return VehicleInfo(
                plate_number=plate,
                mv_no=f"MV-{plate}-M",
                or_type="MVRS",
                cr_date=date(2025, 2, 3),
                cr_no=f"CR-{plate}",
                district_office="1301 - QUEZON CITY DISTRICT OFFICE",
                make="HONDA",
                series="CLICK 125",
                vehicle_type="MOTORCYCLE",
                year_model=2022,
                color="BLACK",
                transmission="A/T",
                fuel_type="MOTORCYCLE",
                engine_no=f"ENG-{plate}",
                chassis_no=f"CHS-{plate}",
                owner_type="INDIVIDUAL",
                last_name="SANTOS",
                first_name="MARIA",
                middle_name="REYES",
                address="Commonwealth Avenue",
                city="Quezon City",
            )
        return VehicleInfo(
            plate_number=plate,
            mv_no=f"MV-{plate}",
            or_type="MVRR",
            cr_date=date(2025, 1, 18),
            cr_no=f"CR-{plate}",
            district_office="1368 - PASAY CITY DISTRICT OFFICE",
            make="TOYOTA",
            series="VIOS",
            vehicle_type="CAR",
            year_model=2020,
            color="SILVER",
            transmission="A/T",
            fuel_type="GAS",
            engine_no=f"ENG-{plate}",
            chassis_no=f"CHS-{plate}",
            owner_type="INDIVIDUAL",
            last_name="DELA CRUZ",
            first_name="JUAN",
            middle_name="SANTOS",
            address="Roxas Boulevard",
            city="Pasay City",
        )

    def find_driver(self, license_no: str) -> Optional[DriverInfo]:
        if license_no.upper() == "NOTFOUND":
            return None
        return DriverInfo(
            license_no=license_no,
            full_name="Juan dela Cruz",
            license_type="Non-Professional",
            expiry_date=date(2027, 12, 31),
        )

    def submit_emission_result(self, payload: EmissionPayload) -> SubmissionResult:
        if payload.plate_number.upper().startswith("FAIL"):
            return SubmissionResult(state="REJECTED", rejection_reason="Mock rejection")
        return SubmissionResult(
            state="ACCEPTED",
            certificate_no=f"CERT-{uuid.uuid4().hex[:8].upper()}",
        )
