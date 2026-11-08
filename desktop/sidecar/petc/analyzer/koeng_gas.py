"""KOENG KEG-500 CE gas analyzer adapter.

Protocol recovered from the locally installed Koeng Analyzer System v1.0 and
verified against a physical KEG-500 CE on 2026-08-04.

Serial configuration: 9600 baud, 8 data bits, no parity, 1 stop bit.

The analyzer is command/response. A test enters MEASURE mode, alternates a
status request with a current-analysis request, and returns to STANDBY after a
measurement is delivered or the session is aborted/times out.
"""
from __future__ import annotations

import logging
import threading

from .base import AnalyzerResult, FuelType, GasReading
from .serial_base import SerialAnalyzer

logger = logging.getLogger(__name__)

STATUS_REQUEST = b"\x1bST\r\n"
CURRENT_ANALYSIS_REQUEST = b"\x1bCA\r\n"
MEASURE_REQUEST = b"\x1b\x1bK5\r\n"
STANDBY_REQUEST = b"\x1b\x1bK2\r\n"

_MEASURING_CODES = {b"030", b"035"}


def _number(field: bytes) -> int:
    return int(field.decode("ascii"))


def parse_measurement_frame(frame: bytes) -> GasReading | None:
    """Decode a 27/28-byte CR-terminated KOENG current-analysis frame."""
    if (
        not frame.startswith(b"\x1bC")
        or not frame.endswith(b"\r")
        or len(frame) not in (27, 28)
    ):
        return None

    try:
        if len(frame) == 27:
            co_raw = frame[2:6]
            hc_raw = frame[6:10]
            co2_raw = frame[10:14]
            o2_raw = frame[14:18]
            lambda_raw = frame[18:22]
        else:
            co_raw = frame[2:6]
            hc_raw = frame[6:11]
            co2_raw = frame[11:15]
            o2_raw = frame[15:19]
            lambda_raw = frame[19:23]

        return GasReading(
            co_pct=_number(co_raw) / 100.0,
            hc_ppm=float(_number(hc_raw)),
            co2_pct=_number(co2_raw) / 10.0,
            o2_pct=_number(o2_raw) / 100.0,
            lambda_value=_number(lambda_raw) / 1000.0,
            # The recovered KOENG gas frame contains AFR or NOx in its final
            # field, but does not contain RPM or oil temperature.
            rpm=None,
            oil_temp_c=None,
        )
    except (UnicodeDecodeError, ValueError):
        return None


def iter_complete_frames(raw: bytes):
    """Yield ESC-prefixed, CR-terminated frames from a cumulative buffer."""
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


class KoengGasAnalyzer(SerialAnalyzer):
    """Stateful adapter for the KOENG KEG-500 CE gas analyzer."""

    def __init__(self, *, port: str, serial_no: str = "", **kwargs) -> None:
        # The vendor application fixes the gas interface at 9600/8N1.
        kwargs.update(baud_rate=9600, data_bits=8, parity="N", stop_bits=1)
        super().__init__(port=port, **kwargs)
        self._configured_serial_no = serial_no.strip()
        self._protocol_lock = threading.Lock()
        self._test_active = False
        self._request_current = False
        self._standby_required = False

    def start_command(self) -> bytes | None:
        with self._protocol_lock:
            self._test_active = True
            self._request_current = False
            self._standby_required = True
        return MEASURE_REQUEST

    def poll_command(self) -> bytes | None:
        with self._protocol_lock:
            if not self._test_active:
                return None
            if self._request_current:
                self._request_current = False
                return CURRENT_ANALYSIS_REQUEST
            return STATUS_REQUEST

    def parse_frame(self, raw: bytes) -> AnalyzerResult | None:
        with self._protocol_lock:
            active = self._test_active
        if not active:
            return None

        for frame in iter_complete_frames(raw):
            if frame.startswith(b"\x1bS") and len(frame) >= 6:
                if frame[2:5] in _MEASURING_CODES:
                    with self._protocol_lock:
                        self._request_current = True
                continue

            reading = parse_measurement_frame(frame)
            if reading is None:
                continue

            with self._protocol_lock:
                self._test_active = False
                self._request_current = False
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
            self._restore_standby()

    def abort_test(self, session_token: str) -> None:
        super().abort_test(session_token)
        self._restore_standby()

    def disconnect(self) -> None:
        self._restore_standby()
        super().disconnect()

    def _restore_standby(self) -> None:
        with self._protocol_lock:
            standby_required = self._standby_required
            self._test_active = False
            self._request_current = False
            self._standby_required = False
        connection = self._serial
        if connection is not None and connection.is_open and standby_required:
            try:
                connection.write(STANDBY_REQUEST)
                connection.flush()
            except Exception:  # serial errors are handled by the shared read loop
                logger.exception("Failed to return KOENG analyzer to STANDBY")
