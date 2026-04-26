"""Gov registry adapter ABC — LTMS / Stradcom / Dermalog."""
from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional


@dataclass
class VehicleInfo:
    plate_number: str
    mv_no: str
    or_type: str
    cr_date: date
    cr_no: str
    district_office: str
    make: str
    series: str
    vehicle_type: str
    year_model: int
    color: str
    transmission: str
    fuel_type: str          # "GAS" | "DIESEL" | "MOTORCYCLE"
    engine_no: str
    chassis_no: str
    owner_type: str         # "INDIVIDUAL" | "ORGANIZATION"
    last_name: str = ""
    first_name: str = ""
    middle_name: str = ""
    organization: str = ""
    address: str = ""
    city: str = ""


@dataclass
class DriverInfo:
    license_no: str
    full_name: str
    license_type: str
    expiry_date: date


@dataclass
class EmissionPayload:
    test_id: str
    plate_number: str
    license_no: str
    fuel_type: str
    pass_fail: bool
    readings: dict
    photo_paths: list[str]      # local disk paths; upload happens before calling this
    operator_id: str
    center_id: str
    tested_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class SubmissionResult:
    state: str                  # "ACCEPTED" | "REJECTED"
    certificate_no: Optional[str] = None
    rejection_reason: Optional[str] = None


class GovRegistryClient(abc.ABC):
    """
    Adapter interface for LTMS / Stradcom calls.
    The sidecar calls these; all calls are also written to the gov_outbox
    SQLite table for replay and audit.
    """

    @abc.abstractmethod
    def find_vehicle(self, plate_number: str) -> Optional[VehicleInfo]:
        """Returns None if plate not found in registry."""

    @abc.abstractmethod
    def find_driver(self, license_no: str) -> Optional[DriverInfo]:
        """Returns None if license not found in registry."""

    @abc.abstractmethod
    def submit_emission_result(self, payload: EmissionPayload) -> SubmissionResult:
        """Upload a completed test to LTMS for the official certificate."""


class GovError(Exception):
    """Raised when a gov API call fails with a non-retryable error."""
