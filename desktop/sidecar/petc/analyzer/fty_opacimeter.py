"""
FtyOpacimeterAnalyzer — adapter for the Foshan Analytical FTY-100 diesel
opacimeter running the "FOFEN SINGLE" protocol over RS232.

Typical wire settings observed on a live FTY-100 unit:
    19200 baud, 8N1, RS232, device address 0x01.

Two output modes are expected (mirroring the petrol gas unit from the same
vendor):
  * Continuous binary push using the 62 24 ... 63 f3 envelope handled by
    fofen_framing.find_frame()
  * ASCII receipt emitted when the operator presses PRINT

Until we have a labelled capture pairing bytes to displayed opacity / k-value,
parse_frame() recognises both formats but only logs the decoded contents and
returns a zero-valued DieselReading so the test flow runs end-to-end and the
operator can correlate the log output with what's on the FTY display.
"""
from __future__ import annotations

import logging
import re

from .base import AnalyzerResult, DieselReading, FuelType
from .fofen_framing import find_frame, strip_high_bit
from .serial_base import SerialAnalyzer

logger = logging.getLogger(__name__)

_ASCII_HEADER = b"*" * 6
_PRINTER_CTRL = re.compile(rb"\x1b\x31\x03|\xff\xff")

# FTY-100 prints a 3-pulse free-acceleration test result. The receipt has both
# the averages (k, Ns, RPM) and the three individual pulses (k1/k2/k3, Ns1/2/3,
# RPM1/2/3). We extract the averages for the test record and keep pulse data
# in the raw bytes for audit.
_FIELD_PATTERNS = {
    "k_value":     re.compile(r"^k\s*=\s*([0-9.]+)", re.IGNORECASE),
    "opacity_pct": re.compile(r"^Ns\s*=\s*([0-9.]+)", re.IGNORECASE),
    "rpm":         re.compile(r"^RPM\s*=\s*([0-9.]+)", re.IGNORECASE),
}


class FtyOpacimeterAnalyzer(SerialAnalyzer):
    def poll_command(self) -> bytes | None:
        return None

    def parse_frame(self, raw: bytes) -> AnalyzerResult | None:
        # Try ASCII receipt format first (cheap detection)
        ascii_result = self._try_parse_ascii(raw)
        if ascii_result is not None:
            return ascii_result

        # Fall back to the binary FOFEN envelope
        frame = find_frame(raw)
        if frame is None:
            return None

        stripped_rows = [strip_high_bit(r) for r in frame.rows]
        logger.info(
            "FTY binary frame: header=%s rows=%s",
            frame.header.hex(),
            [r.hex() for r in stripped_rows],
        )

        # TODO: map stripped_rows -> opacity / k-value once a labelled capture is available.
        return AnalyzerResult(
            fuel_type=FuelType.DIESEL,
            reading=DieselReading(
                opacity_pct=0.0,
                k_value=0.0,
                rpm=None,
                boost_kpa=None,
            ),
            raw_bytes=frame.raw,
            serial_no="",
            pass_fail=None,
        )

    def _try_parse_ascii(self, raw: bytes) -> AnalyzerResult | None:
        clean = _PRINTER_CTRL.sub(b"", raw)
        # Anchor on the literal start marker rather than the asterisk row, since
        # the receipt's footer and the next receipt's header are both asterisks
        # and would otherwise match as a pair with an empty body between them.
        start = clean.find(b"CAR REG NO:")
        if start < 0:
            return None
        end = clean.find(_ASCII_HEADER, start)
        if end < 0:
            return None

        body = clean[start:end]
        try:
            text = body.decode("ascii", errors="replace")
        except UnicodeDecodeError:
            return None
        if not text.strip():
            return None

        fields: dict[str, float] = {}
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            for key, pattern in _FIELD_PATTERNS.items():
                match = pattern.match(stripped)
                if match:
                    try:
                        fields[key] = float(match.group(1))
                    except ValueError:
                        pass
                    break

        # Even if we couldn't recognise specific fields, log the full text so we
        # can see what an FTY-100 receipt actually looks like.
        logger.info("FTY ASCII receipt: text=%r parsed=%s", text, fields)

        opacity = fields.get("opacity_pct", 0.0)
        k_value = fields.get("k_value", 0.0)
        rpm_value = fields.get("rpm")

        return AnalyzerResult(
            fuel_type=FuelType.DIESEL,
            reading=DieselReading(
                opacity_pct=opacity,
                k_value=k_value,
                rpm=int(rpm_value) if rpm_value is not None else None,
                boost_kpa=None,
            ),
            raw_bytes=clean[start : end + len(_ASCII_HEADER)],
            serial_no="",
            pass_fail=None,
        )
