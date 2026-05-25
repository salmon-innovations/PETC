"""
Build an analyzer instance from the app_settings table.

Used by:
  - service.py at sidecar startup
  - api/server.py when the user updates settings (hot reconnect)

Keys read:
  analyzer.type        mock | serial_gas | serial_diesel | fty_opacimeter
  analyzer.port        e.g. "COM3" or "/dev/ttyUSB0"
  analyzer.baud        e.g. "19200"
  analyzer.data_bits   "7" or "8"
  analyzer.parity      "N" | "E" | "O"
  analyzer.stop_bits   "1" or "2"
  analyzer.address     hex string, e.g. "01"
"""
from __future__ import annotations

import logging

from .base import Analyzer

logger = logging.getLogger(__name__)


def _read_settings() -> dict[str, str]:
    from ..db.models import AppSetting
    from ..db.session import SessionLocal

    with SessionLocal() as session:
        rows = session.query(AppSetting).filter(AppSetting.key.like("analyzer.%")).all()
        return {r.key: (r.value or "") for r in rows}


def _parse_address(raw: str) -> int:
    try:
        return int(raw, 16)
    except (TypeError, ValueError):
        return 0x01


def build_analyzer_from_settings() -> Analyzer:
    settings = _read_settings()
    kind = settings.get("analyzer.type", "mock")

    if kind == "mock":
        from .mock import MockAnalyzer
        return MockAnalyzer()

    common = {
        "port": settings.get("analyzer.port", "COM1"),
        "baud_rate": int(settings.get("analyzer.baud", "9600")),
        "data_bits": int(settings.get("analyzer.data_bits", "8")),
        "parity": settings.get("analyzer.parity", "N"),
        "stop_bits": int(settings.get("analyzer.stop_bits", "1")),
        "address": _parse_address(settings.get("analyzer.address", "01")),
    }

    if kind == "serial_gas":
        from .ascii_gas import AsciiGasAnalyzer
        return AsciiGasAnalyzer(**common)
    if kind == "serial_diesel":
        from .binary_diesel import BinaryDieselAnalyzer
        return BinaryDieselAnalyzer(**common)
    if kind == "fty_opacimeter":
        from .fty_opacimeter import FtyOpacimeterAnalyzer
        return FtyOpacimeterAnalyzer(**common)
    if kind == "fofen_gas":
        from .fofen_gas import FofenGasAnalyzer
        return FofenGasAnalyzer(**common)
    if kind == "fofen_ascii":
        from .fofen_ascii import FofenAsciiReceiptAnalyzer
        return FofenAsciiReceiptAnalyzer(**common)

    logger.warning("Unknown analyzer.type=%r — falling back to MockAnalyzer", kind)
    from .mock import MockAnalyzer
    return MockAnalyzer()
