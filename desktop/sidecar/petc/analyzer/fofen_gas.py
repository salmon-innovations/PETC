"""
FofenGasAnalyzer — adapter for the Foshan Analytical petrol/gas analyzer
running the same 62-24/63-f3 framed protocol as the FTY-100 opacimeter.

The analyzer pushes a complete frame approximately every measurement cycle;
no poll command appears to be required (observed in passive sniffing).

The payload decoding (mapping bytes -> CO/HC/CO2/O2/NO/lambda) is still being
finalized — we have a partial mapping from one known capture but need a second
high-spike capture to disambiguate the digit-encoding scheme. Until then this
adapter logs every decoded frame's row contents so the operator can correlate
displayed values with bytes, and returns a placeholder GasReading with all
zeros so the test flow stays functional in test/dev environments.
"""
from __future__ import annotations

import logging

from .base import AnalyzerResult, FuelType, GasReading
from .fofen_framing import find_frame, strip_high_bit
from .serial_base import SerialAnalyzer

logger = logging.getLogger(__name__)


class FofenGasAnalyzer(SerialAnalyzer):
    def poll_command(self) -> bytes | None:
        return None

    def parse_frame(self, raw: bytes) -> AnalyzerResult | None:
        frame = find_frame(raw)
        if frame is None:
            return None

        stripped_rows = [strip_high_bit(r) for r in frame.rows]
        logger.info(
            "FofenGas frame: header=%s rows=%s",
            frame.header.hex(),
            [r.hex() for r in stripped_rows],
        )

        # TODO: map stripped_rows -> GasReading once payload encoding is locked.
        # Current known mapping (partial, from one capture):
        #   row 1 bytes 6-7  ← HC (ppm)
        #   row 2 bytes 5-6  ← CO (%vol)
        #   row 2 byte 7     ← CO2 (%vol)
        # Awaiting second high-spike capture to confirm and extract O2 / NO /
        # lambda / RPM / oil temp byte positions.
        reading = GasReading(
            co_pct=0.0,
            hc_ppm=0.0,
            co2_pct=0.0,
            o2_pct=0.0,
            lambda_value=0.0,
            rpm=None,
            oil_temp_c=None,
        )

        return AnalyzerResult(
            fuel_type=FuelType.GAS,
            reading=reading,
            raw_bytes=frame.raw,
            serial_no="",
            pass_fail=None,
        )
