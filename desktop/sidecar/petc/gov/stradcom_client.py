"""
Stradcom / LTMS client stub.
TODO: implement once accreditation sandbox credentials and API docs are received.
"""
from __future__ import annotations

from typing import Optional

import httpx

from .base import (
    DriverInfo, EmissionPayload, GovRegistryClient,
    SubmissionResult, VehicleInfo,
)


class StradcomGovRegistryClient(GovRegistryClient):
    """
    Real LTMS / Stradcom adapter.
    Activated when config.gov.mock = false.
    """

    def __init__(self, base_url: str, api_key: str, timeout_s: float = 30.0) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            headers={"X-API-Key": api_key},
            timeout=timeout_s,
        )

    def find_vehicle(self, plate_number: str) -> Optional[VehicleInfo]:
        # TODO: implement once API contract is documented
        raise NotImplementedError("StradcomGovRegistryClient.find_vehicle not yet implemented")

    def find_driver(self, license_no: str) -> Optional[DriverInfo]:
        raise NotImplementedError("StradcomGovRegistryClient.find_driver not yet implemented")

    def submit_emission_result(self, payload: EmissionPayload) -> SubmissionResult:
        raise NotImplementedError("StradcomGovRegistryClient.submit_emission_result not yet implemented")

    def close(self) -> None:
        self._client.close()
