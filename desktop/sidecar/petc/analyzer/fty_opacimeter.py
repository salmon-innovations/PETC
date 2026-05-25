"""
FtyOpacimeterAnalyzer — adapter for the Foshan Analytical FTY-100 diesel opacimeter
running the "FOFEN SINGLE" protocol over RS232.

Typical wire settings observed on a live FTY-100 unit:
    19200 baud, 8N1, RS232, device address 0x01.

The request/response frame layout has not yet been finalized — pending vendor
protocol documentation. Until then `poll_command()` and `parse_frame()` raise
NotImplementedError so the operator gets a clear error instead of silent garbage
data. The adapter is wired through service.py/settings so the UI plumbing is ready
the moment the frame spec lands.
"""
from __future__ import annotations

import logging

from .base import AnalyzerResult
from .serial_base import SerialAnalyzer

logger = logging.getLogger(__name__)


class FtyOpacimeterAnalyzer(SerialAnalyzer):
    def poll_command(self) -> bytes | None:
        raise NotImplementedError(
            "FOFEN SINGLE request frame not yet implemented — "
            "finalize protocol spec with vendor before enabling this analyzer."
        )

    def parse_frame(self, raw: bytes) -> AnalyzerResult | None:
        raise NotImplementedError(
            "FOFEN SINGLE response parser not yet implemented — "
            "finalize protocol spec with vendor before enabling this analyzer."
        )
