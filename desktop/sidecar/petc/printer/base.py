"""Printer ABC and shared types."""
from __future__ import annotations

import abc
from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class ReceiptData:
    test_id: str
    plate_number: str
    vehicle_make: str
    vehicle_model: str
    year: int
    fuel_type: str
    pass_fail: bool
    operator_name: str
    center_name: str
    printed_at: datetime
    certificate_no: Optional[str] = None
    raw_readings: Optional[dict] = None


class Printer(abc.ABC):
    """One instance per physical printer; selected per-center via config."""

    @abc.abstractmethod
    def print_receipt(self, data: ReceiptData, copies: int = 2) -> None:
        """Print `copies` copies of the emission test receipt."""

    @abc.abstractmethod
    def check_status(self) -> dict:
        """Return a dict with at least {'online': bool, 'paper_ok': bool}."""

    @property
    @abc.abstractmethod
    def printer_type(self) -> str:
        """e.g. 'escpos', 'dotmatrix', 'pdf'"""


class PrinterError(Exception):
    """Base for all printer errors."""


class PrinterOfflineError(PrinterError):
    pass


class PrinterPaperError(PrinterError):
    pass
