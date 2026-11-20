"""Deterministic mock analyzer for development and testing."""
from __future__ import annotations

import math
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
        self._session_started: dict[str, float] = {}
        self._sequence_started: dict[str, float] = {}

    def connect(self) -> None:
        if self._simulate_failure:
            raise AnalyzerConnectionError("MockAnalyzer: simulated connection failure")
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False
        self._sessions.clear()
        self._session_started.clear()
        self._sequence_started.clear()

    def start_test(self, fuel_type: FuelType | None = None) -> str:
        self._assert_connected()
        token = str(uuid.uuid4())
        self._sessions[token] = fuel_type or self._fuel_type
        self._session_started[token] = time.monotonic()
        return token

    def start_diesel_sequence(self) -> str:
        """Opt-in six-cycle UI demonstration; never represents physical readings."""
        token = self.start_test(FuelType.DIESEL)
        self._sequence_started[token] = time.monotonic()
        return token

    def has_capture_sequence(self, token: str) -> bool:
        return token in self._sequence_started

    def capture_progress(self, token: str) -> dict:
        if token not in self._sequence_started or token not in self._sessions:
            raise AnalyzerTimeoutError("Unknown mock capture session")
        elapsed = max(0, time.monotonic() - self._sequence_started[token])
        active = max(0, elapsed - 7)
        completed = min(6, int(active // 11))
        cycle = 0 if elapsed < 7 else min(6, completed + 1)
        within = active % 11
        samples = [round(0.2 + 0.6 * i / 24, 2) for i in range(25)]
        count = min(25, int(within * 5) + 1) if cycle else 0
        ready = completed == 6
        return {
            "state": "complete" if ready else "running", "simulated": True,
            "message": (
                "Six simulated tests complete - press Get Test Result" if ready else
                "Real-time mode" if elapsed < 2 else "Calibrating" if elapsed < 7 else
                "Accelerate pedal" if within < 5 else "Release pedal"
            ),
            "cycle": cycle, "countdown": None if not cycle or ready else max(0, 10 - int(within)),
            "current_k": None if not count or ready else samples[count - 1],
            "sample_count": 0 if ready else count, "invalid_count": 0,
            "peaks": [0.8] * completed, "average": None,
            "cycles": [{"cycle": i + 1, "samples": samples, "responses": [], "peak": 0.8} for i in range(completed)],
        }

    def read_result(self, session_token: str) -> AnalyzerResult:
        self._assert_connected()
        if session_token not in self._sessions:
            raise AnalyzerTimeoutError(f"Unknown session: {session_token}")
        sequence = None
        if self.has_capture_sequence(session_token):
            sequence = self.capture_progress(session_token)
            if sequence["state"] != "complete":
                raise AnalyzerTimeoutError("Six simulated cycles are still running")
            sequence.update(average=0.8, message="Simulated result accepted")
            self._sequence_started.pop(session_token)
        else:
            time.sleep(self._result_delay_s)
        fuel = self._sessions.pop(session_token)
        self._session_started.pop(session_token, None)
        return self._build_result(fuel, capture_sequence=sequence)

    def live_result(self, session_token: str) -> AnalyzerResult | None:
        self._assert_connected()
        started_at = self._session_started.get(session_token)
        fuel = self._sessions.get(session_token)
        if fuel is None or started_at is None:
            return None
        if fuel is not FuelType.GAS and time.monotonic() - started_at < self._result_delay_s:
            return None
        if fuel is FuelType.GAS:
            return self._build_live_gas_result(time.monotonic() - started_at)
        return self._build_result(fuel)

    def abort_test(self, session_token: str) -> None:
        self._sessions.pop(session_token, None)
        self._session_started.pop(session_token, None)
        self._sequence_started.pop(session_token, None)

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def firmware_version(self) -> str:
        return "MOCK-1.0.0"

    def _assert_connected(self) -> None:
        if not self._connected:
            raise AnalyzerConnectionError("MockAnalyzer is not connected")

    def _build_result(
        self,
        fuel: FuelType,
        *,
        capture_sequence: dict | None = None,
    ) -> AnalyzerResult:
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
            capture_sequence=capture_sequence,
        )

    def _build_live_gas_result(self, elapsed_s: float) -> AnalyzerResult:
        pulse = max(0.0, math.sin(elapsed_s * 1.7))
        spike = 1.0 if int(elapsed_s * 2) % 9 in (0, 1) else 0.0
        ripple = math.sin(elapsed_s * 4.3)
        reading = GasReading(
            co_pct=round(0.08 + pulse * 0.05 + spike * 0.09, 2),
            hc_ppm=round(55 + pulse * 35 + spike * 95),
            co2_pct=round(13.4 + pulse * 0.9 + ripple * 0.2, 1),
            o2_pct=round(max(0.1, 0.9 - pulse * 0.35 - spike * 0.25), 1),
            lambda_value=round(0.992 + ripple * 0.012 - spike * 0.018, 3),
            no_ppm=round(spike * 18 + pulse * 5),
            rpm=round(850 + pulse * 850 + spike * 1250),
            oil_temp_c=round(78 + min(elapsed_s, 30) * 0.25 + pulse * 2, 1),
        )
        return AnalyzerResult(
            fuel_type=FuelType.GAS,
            reading=reading,
            raw_bytes=b"MOCK:LIVE",
            serial_no="MOCK-0001",
            pass_fail=True,
        )