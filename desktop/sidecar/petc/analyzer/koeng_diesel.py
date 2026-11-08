"""KOENG diesel opacity analyzer adapter.

Protocol recovered from the locally installed Koeng Analyzer System v1.0 and
verified against a live KOENG diesel analyzer on 2026-08-04.

The analyzer continuously transmits fixed-width 27-byte ASCII frames at
9600 baud, 8 data bits, no parity, and 1 stop bit.  It does not require a poll
or start command::

    ESC OOO.O DDD.DD RRRRR XXX TTT CR

``OOO.O`` is opacity percent, ``DDD.DD`` is smoke density/K in m^-1,
``RRRRR`` is RPM, ``XXX`` is reserved by the vendor software, and ``TTT`` is
oil temperature in degrees C.  Unavailable RPM and temperature values are
represented by hyphens.  Oil temperature remains present in ``raw_bytes``;
the current PETC diesel result schema stores opacity, K, and RPM.
"""
from __future__ import annotations

from .base import AnalyzerResult, DieselReading, FuelType
from .serial_base import SerialAnalyzer

FRAME_LENGTH = 27


def _optional_int(field: bytes) -> int | None:
    stripped = field.strip()
    if stripped and set(stripped) == {ord("-")}:
        return None
    return int(stripped.decode("ascii"))


def parse_measurement_frame(frame: bytes) -> DieselReading | None:
    """Decode one complete KOENG diesel frame, including its trailing CR."""
    if (
        len(frame) != FRAME_LENGTH
        or frame[0] != 0x1B
        or frame[-1] != 0x0D
        or any(frame[index] != 0x20 for index in (6, 12, 18, 22))
    ):
        return None

    try:
        opacity = float(frame[1:6].decode("ascii").strip())
        k_value = float(frame[7:12].decode("ascii").strip())
        rpm = _optional_int(frame[13:18])
        # Validate the optional oil-temperature field even though the current
        # DieselReading schema does not expose it.  This prevents a corrupt
        # fixed-width frame from being accepted merely because its core fields
        # happen to be numeric.
        _optional_int(frame[23:26])
    except (UnicodeDecodeError, ValueError):
        return None

    if opacity < 0 or k_value < 0 or (rpm is not None and rpm < 0):
        return None

    return DieselReading(
        opacity_pct=opacity,
        k_value=k_value,
        rpm=rpm,
        boost_kpa=None,
    )


def iter_complete_frames(raw: bytes):
    """Yield complete fixed-width frames from a cumulative serial buffer."""
    cursor = 0
    while True:
        start = raw.find(b"\x1b", cursor)
        if start < 0:
            return
        end = raw.find(b"\r", start + 1)
        if end < 0:
            return
        yield raw[start : end + 1]
        cursor = end + 1


class KoengDieselAnalyzer(SerialAnalyzer):
    """Passive-stream adapter for the KOENG diesel opacity analyzer."""

    def __init__(self, *, port: str, serial_no: str = "", **kwargs) -> None:
        kwargs.update(baud_rate=9600, data_bits=8, parity="N", stop_bits=1)
        super().__init__(port=port, **kwargs)
        self._configured_serial_no = serial_no.strip()

    def poll_command(self) -> bytes | None:
        return None

    def parse_frame(self, raw: bytes) -> AnalyzerResult | None:
        for frame in iter_complete_frames(raw):
            reading = parse_measurement_frame(frame)
            if reading is None:
                continue
            return AnalyzerResult(
                fuel_type=FuelType.DIESEL,
                reading=reading,
                raw_bytes=frame,
                serial_no=self._configured_serial_no,
                pass_fail=None,
            )
        return None
