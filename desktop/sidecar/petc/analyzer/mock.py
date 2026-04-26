"""Deterministic mock analyzer for development and testing."""
from __future__ import annotations

import time
import uuid

from .base import (
    Analyzer,
    AnalyzerConnectionError,
    AnalyzerResult,
    AnalyzerTimeoutError,
    DieselReading,
    FuelType,
    GasReading,
)


class MockAnalyzer(Analyzer):
    """
    Returns fixed, passing readings regardless of vehicle.
    Controlled via config: fuel_type, simulate_failure, result_delay_s.
    """

    def __init__(
        self,
        fuel_type: FuelType = FuelType.GAS,
        simulate_failure: bool = False,
        result_delay_s: float = 1.5,
    ) -> None:
        self._fuel_type = fuel_type
        self._simulate_failure = simulate_failure
        self._result_delay_s = result_delay_s
        self._connected = False
        self._sessions: dict[str, FuelType] = {}

    def connect(self) -> None:
        if self._simulate_failure:
            raise AnalyzerConnectionError("MockAnalyzer: simulated connection failure")
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    def start_test(self, fuel_type: FuelType | None = None) -> str:
        self._assert_connected()
        token = str(uuid.uuid4())
        self._sessions[token] = fuel_type or self._fuel_type
        return token

    def read_result(self, session_token: str) -> AnalyzerResult:
        self._assert_connected()
        if session_token not in self._sessions:
            raise AnalyzerTimeoutError(f"Unknown session: {session_token}")
        time.sleep(self._result_delay_s)
        fuel = self._sessions.pop(session_token)
        reading: GasReading | DieselReading
        if fuel is FuelType.GAS:
            reading = GasReading(
                co_pct=0.12, hc_ppm=85, co2_pct=14.2, o2_pct=0.4, lambda_value=1.001, rpm=2500
            )
        else:
            reading = DieselReading(opacity_pct=12.5, k_value=0.8, rpm=2000)
        return AnalyzerResult(
            fuel_type=fuel,
            reading=reading,
            raw_bytes=b"MOCK:OK",
            serial_no="MOCK-0001",
            pass_fail=True,
        )

    def abort_test(self, session_token: str) -> None:
        self._sessions.pop(session_token, None)

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def firmware_version(self) -> str:
        return "MOCK-1.0.0"

    def _assert_connected(self) -> None:
        if not self._connected:
            raise AnalyzerConnectionError("MockAnalyzer is not connected")
