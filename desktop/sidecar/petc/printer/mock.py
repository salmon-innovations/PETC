"""Mock printer — logs to stdout, no hardware required."""
from __future__ import annotations

import logging

from .base import Printer, ReceiptData

logger = logging.getLogger(__name__)


class MockPrinter(Printer):
    def print_receipt(self, data: ReceiptData, copies: int = 2) -> None:
        for i in range(1, copies + 1):
            logger.info(
                "[MockPrinter] copy %d/%d — test=%s plate=%s pass=%s",
                i, copies, data.test_id, data.plate_number, data.pass_fail,
            )

    def check_status(self) -> dict:
        return {"online": True, "paper_ok": True}

    @property
    def printer_type(self) -> str:
        return "mock"
