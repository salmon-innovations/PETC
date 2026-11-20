"""CARTESYKJ MQY-200 six-cycle capture ported from CartesySource/app.py.

The requested filename retains the `desiel` spelling. Only K is decoded by the
reference program; opacity and RPM remain unknown. See docs/mqy200-recovery.
"""
from __future__ import annotations

import copy
import threading
import time
import uuid
from datetime import date

import serial

from .base import (
    Analyzer, AnalyzerConnectionError, AnalyzerResult, AnalyzerTimeoutError,
    DieselReading, FuelType,
)

SET_REALTIME = bytes.fromhex("A0 01 5F")
START_CALIBRATION = bytes.fromhex("A2 5E")
GET_DATA = bytes.fromhex("A6 5A")
FRAME_LENGTH = 10


def parse_k_response(data: bytes) -> float | None:
    """V12 parser: 10 bytes, A6 header, big-endian bytes 3:5 / 100.

    V12 has no response checksum validation. Other bytes are unknown.
    """
    if len(data) != FRAME_LENGTH or data[0] != 0xA6:
        return None
    return int.from_bytes(data[3:5], "big") / 100.0


class _Cancelled(Exception):
    pass


class CartesykjDieselAnalyzer(Analyzer):
    """One serial owner and one cancellable six-cycle session at a time."""

    def __init__(self, *, port: str, serial_no: str = "", **_kwargs) -> None:
        self._port = port
        self._serial_no = serial_no.strip()
        self._serial = None
        self._lock = threading.RLock()
        self._cancel = threading.Event()
        self._worker: threading.Thread | None = None
        self._token: str | None = None
        self._result: AnalyzerResult | None = None
        self._progress: dict = {}
        self._cycle_start: float | None = None
        self._accepted_results: list[tuple[date, float]] = []

    @property
    def is_connected(self) -> bool:
        return bool(self._serial and self._serial.is_open)

    @property
    def firmware_version(self) -> str:
        return ""  # V12 does not query firmware.

    def connect(self) -> None:
        with self._lock:
            if self.is_connected:
                return
            try:
                self._serial = serial.Serial(
                    port=self._port, baudrate=9600, bytesize=serial.EIGHTBITS,
                    parity=serial.PARITY_NONE, stopbits=serial.STOPBITS_ONE,
                    timeout=0.25, write_timeout=1,
                )
            except serial.SerialException as exc:
                raise AnalyzerConnectionError(str(exc)) from exc

    def disconnect(self) -> None:
        with self._lock:
            self._cancel.set()
            worker = self._worker
        if worker and worker is not threading.current_thread():
            worker.join(timeout=2)
            if worker.is_alive():
                raise AnalyzerConnectionError("MQY-200 capture is still stopping")
        with self._lock:
            if self._serial:
                self._serial.close()
            self._serial = None
            self._result = None
            if self._token:
                self._progress.update(state="cancelled", message="Disconnected")

    def start_test(self, fuel_type: FuelType | None = None) -> str:
        with self._lock:
            if fuel_type not in (None, FuelType.DIESEL):
                raise AnalyzerConnectionError("MQY-200 requires Diesel fuel type")
            if not self.is_connected:
                raise AnalyzerConnectionError(f"Analyzer not connected on {self._port}")
            if self._worker and self._worker.is_alive():
                raise AnalyzerConnectionError("MQY-200 test already running")
            if self._result is not None:
                raise AnalyzerConnectionError("Retrieve or cancel the completed MQY-200 test first")
            self._cancel.clear()
            try:
                if parse_k_response(self._request()) is None:
                    raise AnalyzerConnectionError(f"No valid MQY-200 response on {self._port}. Check the analyzer and serial cable.")
            except serial.SerialException as exc:
                raise AnalyzerConnectionError(str(exc)) from exc
            self._token = str(uuid.uuid4())
            self._result = None
            self._cycle_start = None
            self._progress = {
                "state": "running", "message": "Real-time mode / calibrating",
                "cycle": 0, "countdown": None, "current_k": None,
                "peaks": [], "cycles": [], "average": None,
                "sample_count": 0, "invalid_count": 0, "simulated": False,
            }
            self._worker = threading.Thread(target=self._run, daemon=True, name="mqy200-capture")
            self._worker.start()
            return self._token

    def capture_progress(self, session_token: str) -> dict:
        with self._lock:
            if session_token != self._token:
                raise AnalyzerTimeoutError("Unknown MQY-200 session")
            return copy.deepcopy(self._progress)

    def read_result(self, session_token: str) -> AnalyzerResult:
        with self._lock:
            progress = self.capture_progress(session_token)
            if progress["state"] != "complete" or self._result is None:
                raise AnalyzerTimeoutError(progress["message"])
            value = self._result.reading.k_value
            today = date.today()
            self._accepted_results = [(d, v) for d, v in self._accepted_results if d == today]
            if value <= 0 or any(v == value for _, v in self._accepted_results):
                message = (
                    "Final average is zero; repeat six tests"
                    if value <= 0 else "Same final result already accepted today; repeat six tests"
                )
                self._result = None
                self._progress.update(state="error", message=message)
                raise AnalyzerTimeoutError(message)
            self._accepted_results.append((today, value))
            self._progress.update(average=value, message="Test result accepted")
            self._result.capture_sequence = copy.deepcopy(self._progress)
            result, self._result = self._result, None
            return result

    def abort_test(self, session_token: str) -> None:
        with self._lock:
            self.capture_progress(session_token)
            self._cancel.set()
            self._result = None
            self._progress.update(state="cancelled", message="Cancelled - repeat six tests")
            worker = self._worker
        if worker and worker is not threading.current_thread():
            worker.join(timeout=2)

    def _check_cancel(self) -> None:
        if self._cancel.is_set():
            raise _Cancelled()

    def _update_countdown(self) -> None:
        if self._cycle_start is not None:
            remaining = max(0, 10 - int(time.monotonic() - self._cycle_start))
            with self._lock:
                self._progress.update(
                    countdown=remaining,
                    message="Accelerate pedal" if remaining >= 6 else "Release pedal",
                )

    def _wait(self, seconds: float) -> None:
        deadline = time.monotonic() + max(0, seconds)
        while time.monotonic() < deadline:
            self._check_cancel()
            self._update_countdown()
            self._cancel.wait(min(0.05, max(0, deadline - time.monotonic())))
        self._check_cancel()
        self._update_countdown()

    def _request(self) -> bytes:
        self._check_cancel()
        # A late reply must not become the next request's measurement.
        self._serial.reset_input_buffer()
        self._serial.write(GET_DATA)
        self._serial.flush()
        deadline = time.monotonic() + 0.45
        raw = bytearray()
        while time.monotonic() < deadline:
            self._check_cancel()
            available = self._serial.in_waiting
            if available:
                raw.extend(self._serial.read(available))
                if len(raw) >= FRAME_LENGTH:
                    break
            self._wait(0.01)
        return bytes(raw)

    def _run(self) -> None:
        try:
            self._check_cancel()
            self._serial.write(SET_REALTIME)
            self._wait(2)
            with self._lock:
                self._progress["message"] = "Calibrating"
            self._serial.reset_input_buffer()
            self._serial.write(START_CALIBRATION)
            self._wait(5)
            self._serial.reset_input_buffer()
            frames: list[bytes] = []
            cycles: list[dict] = []
            for cycle in range(1, 7):
                self._check_cancel()
                self._cycle_start = time.monotonic()
                with self._lock:
                    self._progress.update(cycle=cycle, current_k=None, sample_count=0, invalid_count=0)
                self._update_countdown()
                samples: list[float] = []
                responses: list[str] = []
                # Five groups of five requests; 0.2s after each request,
                # with a minimum one second per group, exactly as in V12.
                for _ in range(5):
                    second_start = time.monotonic()
                    for _ in range(5):
                        raw = self._request()
                        responses.append(raw.hex())
                        k = parse_k_response(raw)
                        if k is not None:
                            samples.append(k)
                            frames.append(raw)
                            with self._lock:
                                self._progress["current_k"] = k
                                self._progress["sample_count"] = len(samples)
                        else:
                            with self._lock:
                                self._progress["invalid_count"] = self._progress.get("invalid_count", 0) + 1
                        self._wait(0.2)
                    self._wait(1 - (time.monotonic() - second_start))
                # Inclusive 10..0 countdown is eleven seconds.
                self._wait(11 - (time.monotonic() - self._cycle_start))
                if not samples:
                    raise AnalyzerTimeoutError(f"Cycle {cycle}: no valid MQY-200 samples; repeat test")
                cycles.append({"cycle": cycle, "samples": samples, "responses": responses, "peak": max(samples)})
                with self._lock:
                    self._progress["cycles"] = copy.deepcopy(cycles)
                    self._progress["peaks"] = [c["peak"] for c in cycles]
            average = round(sum(c["peak"] for c in cycles) / 6.0, 2)
            with self._lock:
                self._check_cancel()
                self._progress.update(state="complete", message="Six tests complete - press Get Test Result", countdown=None, current_k=None)
                self._result = AnalyzerResult(
                    fuel_type=FuelType.DIESEL,
                    reading=DieselReading(opacity_pct=None, k_value=average),
                    raw_bytes=b"".join(frames), serial_no=self._serial_no,
                    capture_sequence=copy.deepcopy(self._progress),
                )
        except _Cancelled:
            with self._lock:
                self._progress.update(state="cancelled", message="Cancelled - repeat six tests")
        except Exception as exc:
            with self._lock:
                self._result = None
                self._progress.update(state="error", message=str(exc))
        finally:
            self._cycle_start = None
