"""CARTESYKJ MQY-200 diesel smoke-meter adapter.

The protocol and six-revolution workflow were recovered from the vendor-facing
MQY-200 integration utility:

* serial: 9600 baud, 8 data bits, no parity, 1 stop bit
* enter real-time mode: ``A0 01 5F``
* start calibration: ``A2 5E``
* request a reading: ``A6 5A``
* response: 10 bytes beginning with ``A6``; bytes 3-4 are an unsigned,
  big-endian K value scaled by 100

Each reported revolution value is the maximum valid K observed during its
sampling window.  The final K is the rounded average of six maxima.

The documented MQY-200 frame does not expose opacity percent or RPM.  Those
fields therefore remain unavailable and PETC's
submission validation will continue to block LTMS submission until a verified
source for the missing measurements is integrated.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

import serial

from .base import (
    Analyzer,
    AnalyzerConnectionError,
    AnalyzerResult,
    AnalyzerTimeoutError,
    DieselReading,
    FuelType,
)

logger = logging.getLogger(__name__)

SET_REALTIME = bytes.fromhex("A0 01 5F")
START_CALIBRATION = bytes.fromhex("A2 5E")
GET_DATA = bytes.fromhex("A6 5A")

RESPONSE_PREFIX = 0xA6
RESPONSE_LENGTH = 10
REVOLUTION_COUNT = 6
SAMPLES_PER_REVOLUTION = 25


@dataclass(frozen=True)
class Mqy200KReading:
    frame: bytes
    k_value: float


@dataclass
class Mqy200AnalyzerResult(AnalyzerResult):
    """Final analyzer result with the auditable six per-revolution maxima."""

    revolution_k_values: tuple[float, ...] = ()


def parse_k_frame(frame: bytes) -> Mqy200KReading | None:
    """Parse one complete MQY-200 real-time response frame."""
    if len(frame) != RESPONSE_LENGTH or frame[0] != RESPONSE_PREFIX:
        return None
    raw_k = int.from_bytes(frame[3:5], byteorder="big", signed=False)
    return Mqy200KReading(frame=bytes(frame), k_value=raw_k / 100.0)


def iter_k_frames(raw: bytes):
    """Yield complete MQY-200 frames while ignoring leading serial noise."""
    last_start = len(raw) - RESPONSE_LENGTH
    for start in range(last_start + 1):
        if raw[start] != RESPONSE_PREFIX:
            continue
        frame = raw[start : start + RESPONSE_LENGTH]
        if parse_k_frame(frame) is not None:
            yield frame


def compute_six_revolution_average(revolution_maxima: list[float] | tuple[float, ...]) -> float:
    """Return the two-decimal final K from exactly six revolution maxima."""
    if len(revolution_maxima) != REVOLUTION_COUNT:
        raise ValueError(f"Expected {REVOLUTION_COUNT} revolution values")
    return round(sum(revolution_maxima) / REVOLUTION_COUNT, 2)


class _TestCancelled(Exception):
    pass


class CartesykjDieselAnalyzer(Analyzer):
    """Stateful MQY-200 adapter that executes the complete six-revolution test."""

    def __init__(
        self,
        *,
        port: str,
        serial_no: str = "",
        result_timeout: float = 150.0,
        response_timeout: float = 0.45,
        realtime_delay: float = 2.0,
        calibration_delay: float = 5.0,
        sample_interval: float = 0.2,
        samples_per_revolution: int = SAMPLES_PER_REVOLUTION,
        release_delay: float = 6.0,
        serial_factory: Callable[..., serial.Serial] = serial.Serial,
    ) -> None:
        self._port = port
        self._configured_serial_no = serial_no.strip()
        self._result_timeout = result_timeout
        self._response_timeout = response_timeout
        self._realtime_delay = realtime_delay
        self._calibration_delay = calibration_delay
        self._sample_interval = sample_interval
        self._samples_per_revolution = samples_per_revolution
        self._release_delay = release_delay
        self._serial_factory = serial_factory

        self._serial: serial.Serial | None = None
        self._io_lock = threading.RLock()
        self._state_lock = threading.Lock()
        self._events: dict[str, threading.Event] = {}
        self._results: dict[str, AnalyzerResult] = {}
        self._errors: dict[str, Exception] = {}
        self._cancellations: dict[str, threading.Event] = {}
        self._workers: dict[str, threading.Thread] = {}
        self._active_token: str | None = None

    def connect(self) -> None:
        with self._io_lock:
            if self._serial is not None and self._serial.is_open:
                return
            try:
                self._serial = self._serial_factory(
                    port=self._port,
                    baudrate=9600,
                    bytesize=serial.EIGHTBITS,
                    parity=serial.PARITY_NONE,
                    stopbits=serial.STOPBITS_ONE,
                    timeout=0.05,
                    write_timeout=1.0,
                )
            except (OSError, serial.SerialException) as exc:
                raise AnalyzerConnectionError(str(exc)) from exc
        logger.info("Connected to CARTESYKJ MQY-200 on %s @ 9600 baud", self._port)

    def disconnect(self) -> None:
        with self._state_lock:
            cancellations = list(self._cancellations.values())
            workers = list(self._workers.values())
        for cancellation in cancellations:
            cancellation.set()
        for worker in workers:
            if worker is not threading.current_thread():
                worker.join(timeout=self._response_timeout + 1.0)

        with self._io_lock:
            if self._serial is not None and self._serial.is_open:
                try:
                    self._serial.close()
                except serial.SerialException:
                    logger.exception("Error closing MQY-200 serial port %s", self._port)
            self._serial = None
        logger.info("Disconnected from CARTESYKJ MQY-200 on %s", self._port)

    def start_test(self, fuel_type: FuelType | None = None) -> str:
        if fuel_type is not None and fuel_type is not FuelType.DIESEL:
            raise ValueError("CARTESYKJ MQY-200 supports DIESEL tests only")
        self._assert_connected()

        token = str(uuid.uuid4())
        event = threading.Event()
        cancellation = threading.Event()
        worker = threading.Thread(
            target=self._run_sequence,
            args=(token, cancellation),
            daemon=True,
            name=f"mqy200-test-{token[:8]}",
        )
        with self._state_lock:
            if self._active_token is not None:
                raise AnalyzerConnectionError("An MQY-200 test is already running")
            self._active_token = token
            self._events[token] = event
            self._cancellations[token] = cancellation
            self._workers[token] = worker
        worker.start()
        return token

    def read_result(self, session_token: str) -> AnalyzerResult:
        with self._state_lock:
            event = self._events.get(session_token)
        if event is None:
            raise AnalyzerTimeoutError(f"Unknown session: {session_token}")
        if not event.wait(timeout=self._result_timeout):
            self.abort_test(session_token)
            raise AnalyzerTimeoutError(
                f"MQY-200 test did not complete within {self._result_timeout}s"
            )

        with self._state_lock:
            error = self._errors.pop(session_token, None)
            result = self._results.pop(session_token, None)
            self._events.pop(session_token, None)
            self._cancellations.pop(session_token, None)
            self._workers.pop(session_token, None)
        if error is not None:
            raise error
        if result is None:
            raise AnalyzerTimeoutError(f"MQY-200 test {session_token} was aborted")
        return result

    def abort_test(self, session_token: str) -> None:
        with self._state_lock:
            cancellation = self._cancellations.get(session_token)
            event = self._events.get(session_token)
            if cancellation is not None:
                cancellation.set()
            if event is not None and session_token not in self._errors:
                self._errors[session_token] = AnalyzerTimeoutError("MQY-200 test was aborted")
                event.set()

    @property
    def is_connected(self) -> bool:
        return bool(self._serial is not None and self._serial.is_open)

    @property
    def firmware_version(self) -> str:
        return ""

    @property
    def result_wait_includes_test_cycle(self) -> bool:
        return True

    def _run_sequence(self, token: str, cancellation: threading.Event) -> None:
        try:
            self._write_command(SET_REALTIME)
            self._wait_or_cancel(self._realtime_delay, cancellation)
            self._discard_pending_input()

            self._write_command(START_CALIBRATION)
            self._wait_or_cancel(self._calibration_delay, cancellation)
            self._discard_pending_input()

            maxima: list[float] = []
            frames: list[bytes] = []
            for revolution in range(REVOLUTION_COUNT):
                readings: list[float] = []
                next_sample_at = time.monotonic()
                for _ in range(self._samples_per_revolution):
                    self._raise_if_cancelled(cancellation)
                    parsed = self._request_k_reading(cancellation)
                    if parsed is not None:
                        readings.append(parsed.k_value)
                        frames.append(parsed.frame)
                    next_sample_at += self._sample_interval
                    self._wait_or_cancel(max(0.0, next_sample_at - time.monotonic()), cancellation)

                if not readings:
                    raise AnalyzerTimeoutError(
                        f"MQY-200 revolution {revolution + 1} returned no valid K readings"
                    )
                maxima.append(max(readings))
                self._wait_or_cancel(self._release_delay, cancellation)

            final_k = compute_six_revolution_average(maxima)
            if final_k <= 0:
                raise AnalyzerTimeoutError("MQY-200 final six-revolution average is 0.00")

            result = Mqy200AnalyzerResult(
                fuel_type=FuelType.DIESEL,
                reading=DieselReading(
                    opacity_pct=None,
                    k_value=final_k,
                    rpm=None,
                    boost_kpa=None,
                ),
                raw_bytes=b"".join(frames),
                captured_at=datetime.utcnow(),
                serial_no=self._configured_serial_no,
                pass_fail=None,
                unavailable_reading_fields=("opacity_pct", "rpm"),
                revolution_k_values=tuple(maxima),
            )
            self._complete(token, result=result)
        except _TestCancelled:
            self._complete(token, error=AnalyzerTimeoutError("MQY-200 test was aborted"))
        except AnalyzerTimeoutError as exc:
            self._complete(token, error=exc)
        except (OSError, serial.SerialException) as exc:
            self._complete(token, error=AnalyzerConnectionError(str(exc)))
        except Exception as exc:  # defensive boundary around the hardware worker
            logger.exception("Unexpected MQY-200 workflow failure")
            self._complete(token, error=AnalyzerConnectionError(f"MQY-200 workflow failed: {exc}"))
        finally:
            with self._state_lock:
                if self._active_token == token:
                    self._active_token = None

    def _complete(
        self,
        token: str,
        *,
        result: AnalyzerResult | None = None,
        error: Exception | None = None,
    ) -> None:
        with self._state_lock:
            event = self._events.get(token)
            if event is None or event.is_set():
                return
            if result is not None:
                self._results[token] = result
            if error is not None:
                self._errors[token] = error
            event.set()

    def _write_command(self, command: bytes) -> None:
        with self._io_lock:
            self._assert_connected()
            assert self._serial is not None
            self._serial.write(command)
            self._serial.flush()

    def _request_k_reading(
        self,
        cancellation: threading.Event,
    ) -> Mqy200KReading | None:
        with self._io_lock:
            self._assert_connected()
            assert self._serial is not None
            self._serial.reset_input_buffer()
            self._serial.write(GET_DATA)
            self._serial.flush()

            deadline = time.monotonic() + self._response_timeout
            buffer = bytearray()
            while time.monotonic() < deadline:
                self._raise_if_cancelled(cancellation)
                waiting = self._serial.in_waiting
                chunk = self._serial.read(min(256, waiting) if waiting else 1)
                if chunk:
                    buffer.extend(chunk)
                    frame = next(iter_k_frames(bytes(buffer)), None)
                    if frame is not None:
                        return parse_k_frame(frame)
                    if len(buffer) > RESPONSE_LENGTH * 2:
                        del buffer[:-RESPONSE_LENGTH + 1]
                else:
                    cancellation.wait(0.005)
        return None

    def _discard_pending_input(self) -> None:
        with self._io_lock:
            if self._serial is not None and self._serial.is_open:
                self._serial.reset_input_buffer()

    @staticmethod
    def _raise_if_cancelled(cancellation: threading.Event) -> None:
        if cancellation.is_set():
            raise _TestCancelled

    def _wait_or_cancel(self, seconds: float, cancellation: threading.Event) -> None:
        if seconds > 0 and cancellation.wait(seconds):
            raise _TestCancelled
        self._raise_if_cancelled(cancellation)

    def _assert_connected(self) -> None:
        if not self.is_connected:
            raise AnalyzerConnectionError(f"Analyzer not connected on {self._port}")
