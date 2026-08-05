"""
BinaryDieselAnalyzer — adapter for binary-framed diesel opacity analyzers.

Frame layout (little-endian):
    Offset  Len  Type    Field
    0       1    uint8   SOH (0x01)
    1       1    uint8   payload length (N bytes)
    2       N    bytes   payload
    2+N     2    uint16  CRC-16/MODBUS of bytes[0..2+N-1]

Payload layout (all little-endian floats / uint16):
    0       4    float32  opacity %
    4       4    float32  k-value (m⁻¹)
    8       2    uint16   RPM (0 = not available)
    10      4    float32  boost pressure kPa (0.0 = not available)
    14      1    uint8    pass/fail (1=pass, 0=fail, 0xFF=unknown)
    15      6    char[6]  serial number (ASCII, null-padded)

Total payload = 21 bytes → frame = 1+1+21+2 = 25 bytes.

Brands that commonly use binary framed protocols: AVL DiSmoke, Bosch ETT 8.55x.
To add a new brand: subclass and override PAYLOAD_FMT, _PAYLOAD_LEN, or parse_frame().
"""
from __future__ import annotations

import logging
import struct

from .base import AnalyzerResult, DieselReading, FuelType
from .serial_base import SerialAnalyzer

logger = logging.getLogger(__name__)

_SOH = 0x01
_HEADER_LEN = 2       # SOH + length byte
_CRC_LEN = 2
_PAYLOAD_LEN = 21
_FRAME_LEN = _HEADER_LEN + _PAYLOAD_LEN + _CRC_LEN  # 25 bytes

# struct format for the 21-byte payload (little-endian)
_PAYLOAD_FMT = "<ffHfB6s"


class BinaryDieselAnalyzer(SerialAnalyzer):
    """
    Poll-driven adapter: sends a 1-byte trigger command (0x05) every poll interval,
    then parses the binary response frame.
    """

    _TRIGGER = b"\x05"

    def poll_command(self) -> bytes:
        return self._TRIGGER

    def parse_frame(self, raw: bytes) -> AnalyzerResult | None:
        # Find the SOH start byte
        soh_idx = raw.find(_SOH)
        if soh_idx == -1:
            return None

        frame_candidate = raw[soh_idx:]
        if len(frame_candidate) < _FRAME_LEN:
            return None

        frame = frame_candidate[:_FRAME_LEN]
        payload_len = frame[1]
        if payload_len != _PAYLOAD_LEN:
            logger.warning("BinaryDieselAnalyzer: unexpected payload length %d", payload_len)
            return None

        payload = frame[_HEADER_LEN : _HEADER_LEN + _PAYLOAD_LEN]
        received_crc = struct.unpack_from("<H", frame, _HEADER_LEN + _PAYLOAD_LEN)[0]
        computed_crc = _crc16_modbus(frame[: _HEADER_LEN + _PAYLOAD_LEN])

        if received_crc != computed_crc:
            logger.warning(
                "BinaryDieselAnalyzer: CRC mismatch (got 0x%04X expected 0x%04X), dropping frame",
                received_crc, computed_crc,
            )
            return None

        opacity, k_value, rpm_raw, boost_kpa, pf_byte, sn_bytes = struct.unpack(_PAYLOAD_FMT, payload)

        pass_fail: bool | None = None
        if pf_byte == 0x01:
            pass_fail = True
        elif pf_byte == 0x00:
            pass_fail = False

        serial_no = sn_bytes.rstrip(b"\x00").decode("ascii", errors="replace")
        rpm: int | None = rpm_raw if rpm_raw > 0 else None
        boost: float | None = boost_kpa if boost_kpa > 0.0 else None

        return AnalyzerResult(
            fuel_type=FuelType.DIESEL,
            reading=DieselReading(
                opacity_pct=round(opacity, 2),
                k_value=round(k_value, 3),
                rpm=rpm,
                boost_kpa=boost,
            ),
            raw_bytes=bytes(frame),
            serial_no=serial_no,
            pass_fail=pass_fail,
        )


# ---------------------------------------------------------------------------
# CRC-16/MODBUS
# ---------------------------------------------------------------------------

def _crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x0001:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc
