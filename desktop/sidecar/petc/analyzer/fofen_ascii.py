"""
FofenAsciiReceiptAnalyzer — adapter for the Foshan petrol gas analyzer's
ASCII receipt-printer output mode (RS232).

When the operator presses the PRINT button on the analyzer, it emits a
receipt-formatted ASCII report on the serial line. Layout observed:

    ****************
    CAR REG NO:
    C-5555-DEF-666
    2031/19/11 10:24
    HC ppm        932
    CO  %        1.91
    CO^ %         1.9
    O^  %        0.00
    NO ppm          0
    λ            0.00
    RPM             0
    T oil        544
    ****************

Each line is terminated by 0x0A and may be followed by Epson-style printer
control bytes (0x1b 0x31 0x03) that we strip. The frame begins and ends with
a row of 16 asterisks.

This adapter is push-only (no poll command). The operator triggers each
reading by pressing PRINT on the analyzer's keypad.
"""
from __future__ import annotations

import logging
import re

from .base import AnalyzerResult, FuelType, GasReading
from .serial_base import SerialAnalyzer

logger = logging.getLogger(__name__)

_HEADER_MARKER = b"*" * 10  # use a short prefix — actual rows are 16 asterisks
_LINE_END = b"\n"
_PRINTER_CTRL = re.compile(rb"\x1b\x31\x03|\xff\xff")

_FIELD_PATTERNS = {
    "hc_ppm":       re.compile(r"^HC\s+ppm\s+([0-9.]+)", re.IGNORECASE),
    "co_pct":       re.compile(r"^CO\s+%\s+([0-9.]+)", re.IGNORECASE),
    "co_corr_pct":  re.compile(r"^CO\^\s+%\s+([0-9.]+)", re.IGNORECASE),
    "o_pct":        re.compile(r"^O\^?\s+%\s+([0-9.]+)", re.IGNORECASE),
    "co2_pct":      re.compile(r"^CO2\s+%\s+([0-9.]+)", re.IGNORECASE),
    "no_ppm":       re.compile(r"^NO\s+ppm\s+([0-9.]+)", re.IGNORECASE),
    "lambda":       re.compile(r"^(?:λ|&|LAMBDA)\s+([0-9.]+)", re.IGNORECASE),
    "rpm":          re.compile(r"^RPM\s+([0-9.]+)", re.IGNORECASE),
    "t_oil":        re.compile(r"^T\s*oil\s+([0-9.]+)", re.IGNORECASE),
}


class FofenAsciiReceiptAnalyzer(SerialAnalyzer):
    def poll_command(self) -> bytes | None:
        return None

    def parse_frame(self, raw: bytes) -> AnalyzerResult | None:
        # Strip printer control sequences before searching for the markers
        clean = _PRINTER_CTRL.sub(b"", raw)

        first = clean.find(_HEADER_MARKER)
        if first < 0:
            return None
        # Look for the closing asterisk row after the header
        second = clean.find(_HEADER_MARKER, first + len(_HEADER_MARKER))
        if second < 0:
            return None

        body = clean[first + len(_HEADER_MARKER) : second]
        try:
            text = body.decode("ascii", errors="replace")
        except UnicodeDecodeError:
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

        if not fields:
            logger.warning("FofenAscii: header/footer present but no fields parsed: %r", text[:200])
            return None

        logger.info("FofenAscii receipt parsed: %s", fields)

        # The receipt format prints O^ (oxygen corrected) and CO^ (CO corrected);
        # prefer the corrected values when present, fall back to raw.
        co_pct = fields.get("co_corr_pct", fields.get("co_pct", 0.0))
        o2_pct = fields.get("o_pct", 0.0)
        co2_pct = fields.get("co2_pct", 0.0)
        hc_ppm = fields.get("hc_ppm", 0.0)
        lam = fields.get("lambda", 0.0)
        rpm_value = fields.get("rpm")
        t_oil_value = fields.get("t_oil")

        reading = GasReading(
            co_pct=co_pct,
            hc_ppm=hc_ppm,
            co2_pct=co2_pct,
            o2_pct=o2_pct,
            lambda_value=lam,
            rpm=int(rpm_value) if rpm_value is not None else None,
            oil_temp_c=t_oil_value / 10.0 if t_oil_value is not None else None,
        )

        return AnalyzerResult(
            fuel_type=FuelType.GAS,
            reading=reading,
            raw_bytes=clean[first : second + len(_HEADER_MARKER)],
            serial_no="",
            pass_fail=None,
        )
