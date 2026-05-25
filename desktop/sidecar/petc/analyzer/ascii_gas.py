"""
AsciiGasAnalyzer — adapter for ASCII-delimited gas emission analyzers.

Expected frame format (one line, CR+LF terminated):
    CO=0.12,HC=85,CO2=14.2,O2=0.4,LAM=1.001,RPM=2500,TEMP=85.3,SN=A12345,PF=1\r\n

Fields:
    CO    — CO %
    HC    — HC ppm
    CO2   — CO2 %
    O2    — O2 %
    LAM   — lambda value
    RPM   — engine RPM (optional)
    TEMP  — oil temperature °C (optional)
    SN    — analyzer serial number (optional)
    PF    — 1=pass, 0=fail (optional, omit = unknown)

Brands that commonly use this pattern: many generic OBD/benchtop gas analyzers.
To add a new brand: subclass and override _TERMINATOR, _ENCODING, or parse_frame()
if the field names differ.
"""
from __future__ import annotations

import logging

from .base import AnalyzerResult, FuelType, GasReading
from .serial_base import SerialAnalyzer

logger = logging.getLogger(__name__)

_TERMINATOR_CRLF = b"\r\n"
_TERMINATOR_LF = b"\n"


class AsciiGasAnalyzer(SerialAnalyzer):
    """
    Passive push adapter: the analyzer sends a line each measurement cycle.
    poll_command() returns None — no polling needed.
    Accepts both CRLF and bare LF line endings.
    """

    _ENCODING = "ascii"

    def parse_frame(self, raw: bytes) -> AnalyzerResult | None:
        # Accept CRLF (real devices) or LF (test fixtures / virtual ports).
        if _TERMINATOR_CRLF in raw:
            line_bytes, _ = raw.split(_TERMINATOR_CRLF, 1)
        elif _TERMINATOR_LF in raw:
            line_bytes, _ = raw.split(_TERMINATOR_LF, 1)
        else:
            return None
        try:
            line = line_bytes.decode(self._ENCODING).strip()
        except UnicodeDecodeError:
            logger.warning("AsciiGasAnalyzer: non-ASCII frame, skipping: %r", line_bytes)
            return None

        fields = _parse_kv_line(line)
        if not fields:
            return None

        try:
            co = float(fields["CO"])
            hc = float(fields["HC"])
            co2 = float(fields["CO2"])
            o2 = float(fields["O2"])
            lam = float(fields["LAM"])
        except (KeyError, ValueError) as exc:
            logger.warning("AsciiGasAnalyzer: missing required field — %s in %r", exc, line)
            return None

        rpm = _optional_int(fields.get("RPM"))
        oil_temp = _optional_float(fields.get("TEMP"))
        serial_no = fields.get("SN", "")
        pf_raw = fields.get("PF")
        pass_fail: bool | None = None
        if pf_raw is not None:
            pass_fail = pf_raw.strip() == "1"

        return AnalyzerResult(
            fuel_type=FuelType.GAS,
            reading=GasReading(
                co_pct=co,
                hc_ppm=hc,
                co2_pct=co2,
                o2_pct=o2,
                lambda_value=lam,
                rpm=rpm,
                oil_temp_c=oil_temp,
            ),
            raw_bytes=line_bytes,
            serial_no=serial_no,
            pass_fail=pass_fail,
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_kv_line(line: str) -> dict[str, str]:
    """Parse 'K=V,K=V,...' into a dict. Returns {} on malformed input."""
    result: dict[str, str] = {}
    for pair in line.split(","):
        pair = pair.strip()
        if "=" not in pair:
            continue
        k, _, v = pair.partition("=")
        result[k.strip().upper()] = v.strip()
    return result


def _optional_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _optional_float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None
