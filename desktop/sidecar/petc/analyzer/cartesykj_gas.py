"""CARTESYKJ MQ-550 automotive gas analyzer adapter.

Protocol recovered from a physical MQ-550 on 2026-08-05.

Serial configuration: 9600 baud, 8 data bits, no parity, 1 stop bit.

The analyzer is queried with a single ``0x03`` byte. A measurement response is
17 bytes: ``ACK`` (``0x06``), seven unsigned big-endian 16-bit measurements,
and an unsigned big-endian 16-bit checksum. ``0x15`` is returned when the
analyzer is busy or cannot satisfy the request.

The tested MQ-550 accepts one measurement transaction per serial connection.
Keeping the connection open and sending another request produces ``0x15``
indefinitely, so every test starts with a fresh connection and sends exactly
one request.
"""
from __future__ import annotations

import threading
import time

from .base import AnalyzerResult, FuelType, GasReading
from .serial_base import SerialAnalyzer

CURRENT_ANALYSIS_REQUEST = b"\x03"
ACK = 0x06
BUSY = 0x15
FRAME_LENGTH = 17
PORT_RESET_DELAY_SECONDS = 0.25


def measurement_checksum(values: tuple[int, ...]) -> int:
    """Return the checksum used by a verified MQ-550 measurement frame."""
    return (ACK + sum(values)) & 0xFFFF


def parse_measurement_frame(frame: bytes) -> GasReading | None:
    """Decode one complete 17-byte MQ-550 measurement frame."""
    if len(frame) != FRAME_LENGTH or frame[0] != ACK:
        return None

    values = tuple(
        int.from_bytes(frame[offset : offset + 2], "big")
        for offset in range(1, 15, 2)
    )
    received_checksum = int.from_bytes(frame[15:17], "big")
    if received_checksum != measurement_checksum(values):
        return None

    hc_raw, co_raw, co2_raw, o2_raw, no_raw, rpm_raw, lambda_raw = values
    return GasReading(
        co_pct=co_raw / 100.0,
        hc_ppm=float(hc_raw),
        co2_pct=co2_raw / 100.0,
        o2_pct=o2_raw / 100.0,
        lambda_value=lambda_raw / 100.0,
        no_ppm=float(no_raw),
        rpm=rpm_raw,
        oil_temp_c=None,
    )


def iter_measurement_frames(raw: bytes):
    """Yield checksum-valid MQ-550 measurement frames from a raw buffer."""
    last_start = len(raw) - FRAME_LENGTH
    for start in range(last_start + 1):
        if raw[start] != ACK:
            continue
        frame = raw[start : start + FRAME_LENGTH]
        if parse_measurement_frame(frame) is None:
            continue
        yield frame


class CartesykjGasAnalyzer(SerialAnalyzer):
    """Polled adapter for the CARTESYKJ MQ-550 gas analyzer."""

    def __init__(self, *, port: str, serial_no: str = "", **kwargs) -> None:
        kwargs.update(baud_rate=9600, data_bits=8, parity="N", stop_bits=1)
        super().__init__(port=port, **kwargs)
        self._configured_serial_no = serial_no.strip()
        self._protocol_lock = threading.Lock()
        self._transaction_lock = threading.Lock()
        self._test_active = False

    def start_test(self, fuel_type: FuelType | None = None) -> str:
        """Start one MQ-550 transaction on a freshly opened serial port."""
        with self._transaction_lock:
            # A verified physical MQ-550 returns one valid frame after opening
            # COM3, then replies BUSY (0x15) to every later request on that
            # connection. Cycling the port here reproduces the reliable
            # transaction boundary used during direct terminal testing.
            self.disconnect()
            time.sleep(PORT_RESET_DELAY_SECONDS)
            self.connect()
            if self._serial is not None:
                self._serial.reset_input_buffer()
            return super().start_test(fuel_type)

    def start_command(self) -> bytes | None:
        with self._protocol_lock:
            self._test_active = True
        return CURRENT_ANALYSIS_REQUEST

    def poll_command(self) -> bytes | None:
        # start_command() sends the sole request for this connection. Repeating
        # it makes the physical MQ-550 answer 0x15 until the port is reopened.
        return None

    def parse_frame(self, raw: bytes) -> AnalyzerResult | None:
        with self._protocol_lock:
            if not self._test_active:
                return None

        for frame in iter_measurement_frames(raw):
            reading = parse_measurement_frame(frame)
            if reading is None:
                continue
            self._stop_polling()
            return AnalyzerResult(
                fuel_type=FuelType.GAS,
                reading=reading,
                raw_bytes=frame,
                serial_no=self._configured_serial_no,
                pass_fail=None,
            )
        return None

    def read_result(self, session_token: str) -> AnalyzerResult:
        try:
            return super().read_result(session_token)
        finally:
            self._stop_polling()

    def abort_test(self, session_token: str) -> None:
        self._stop_polling()
        super().abort_test(session_token)

    def disconnect(self) -> None:
        self._stop_polling()
        super().disconnect()

    def _stop_polling(self) -> None:
        with self._protocol_lock:
            self._test_active = False
