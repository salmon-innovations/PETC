"""Analyzer ABC and shared data types."""
from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class FuelType(str, Enum):
    GAS = "GAS"
    DIESEL = "DIESEL"


@dataclass
class GasReading:
    co_pct: float
    hc_ppm: float
    co2_pct: float
    o2_pct: float
    lambda_value: float
    rpm: Optional[int] = None
    oil_temp_c: Optional[float] = None


@dataclass
class DieselReading:
    opacity_pct: float
    k_value: float
    rpm: Optional[int] = None
    boost_kpa: Optional[float] = None


@dataclass
class AnalyzerResult:
    fuel_type: FuelType
    reading: GasReading | DieselReading
    raw_bytes: bytes
    captured_at: datetime = field(default_factory=datetime.utcnow)
    serial_no: str = ""
    pass_fail: Optional[bool] = None


class Analyzer(abc.ABC):
    """
    Hardware-agnostic interface every analyzer adapter must implement.
    One instance per physical analyzer; lifecycle matches the Windows Service.
    """

    @abc.abstractmethod
    def connect(self) -> None:
        """Open serial/USB connection.  Raises AnalyzerConnectionError on failure."""

    @abc.abstractmethod
    def disconnect(self) -> None:
        """Release the port cleanly."""

    @abc.abstractmethod
    def start_test(self, fuel_type: FuelType | None = None) -> str:
        """Instruct the analyzer to begin a test cycle.  Returns a session token."""

    @abc.abstractmethod
    def read_result(self, session_token: str) -> AnalyzerResult:
        """
        Block until the analyzer returns a complete reading.
        Raises AnalyzerTimeoutError if no result within the adapter's timeout.
        """

    @abc.abstractmethod
    def abort_test(self, session_token: str) -> None:
        """Cancel an in-progress test."""

    @property
    @abc.abstractmethod
    def is_connected(self) -> bool:
        """True if the serial/USB link is open and the device is responding."""

    @property
    @abc.abstractmethod
    def firmware_version(self) -> str:
        """Return the analyzer's firmware version string."""


class AnalyzerError(Exception):
    """Base for all analyzer errors."""


class AnalyzerConnectionError(AnalyzerError):
    """Raised when the serial/USB connection cannot be established or is lost."""


class AnalyzerTimeoutError(AnalyzerError):
    """Raised when a result is not received within the expected window."""
