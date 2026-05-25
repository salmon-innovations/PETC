"""
SerialAnalyzer — base class for all physical serial/USB analyzer adapters.

Subclasses implement:
  - parse_frame(raw: bytes) -> AnalyzerResult | None
      Return a result when a complete frame is ready, None to keep reading.
  - poll_command() -> bytes | None  (optional)
      Return bytes to write each poll interval, or None for passive/push devices.

The read loop runs in a daemon thread so FastAPI's event loop is never blocked.
capture() blocks the caller until a result arrives or the timeout elapses.
"""
from __future__ import annotations

import abc
import logging
import threading
import time
from typing import Optional

import serial
import serial.tools.list_ports

from .base import (
    Analyzer,
    AnalyzerConnectionError,
    AnalyzerResult,
    AnalyzerTimeoutError,
    FuelType,
)

logger = logging.getLogger(__name__)

_DEFAULT_BAUD = 9600
_DEFAULT_TIMEOUT_S = 30.0
_DEFAULT_POLL_INTERVAL_S = 0.5
_DEFAULT_DATA_BITS = 8
_DEFAULT_PARITY = "N"  # N | E | O
_DEFAULT_STOP_BITS = 1
_DEFAULT_ADDRESS = 0x01

_PARITY_MAP = {
    "N": serial.PARITY_NONE,
    "E": serial.PARITY_EVEN,
    "O": serial.PARITY_ODD,
}
_STOP_BITS_MAP = {
    1: serial.STOPBITS_ONE,
    2: serial.STOPBITS_TWO,
}


class SerialAnalyzer(Analyzer):
    """
    Thread-safe serial port analyzer base.

    Constructor args (all keyword):
        port            COM port name, e.g. "COM3" or "/dev/ttyUSB0"
        baud_rate       default 9600
        data_bits       7 or 8 (default 8)
        parity          "N" | "E" | "O" (default "N")
        stop_bits       1 or 2 (default 1)
        address         device address for multi-drop protocols (default 0x01)
        result_timeout  seconds to wait in capture() before raising AnalyzerTimeoutError
        poll_interval   seconds between poll_command() writes (ignored when None)
    """

    def __init__(
        self,
        port: str,
        baud_rate: int = _DEFAULT_BAUD,
        data_bits: int = _DEFAULT_DATA_BITS,
        parity: str = _DEFAULT_PARITY,
        stop_bits: int = _DEFAULT_STOP_BITS,
        address: int = _DEFAULT_ADDRESS,
        result_timeout: float = _DEFAULT_TIMEOUT_S,
        poll_interval: float = _DEFAULT_POLL_INTERVAL_S,
    ) -> None:
        self._port = port
        self._baud_rate = baud_rate
        self._data_bits = data_bits
        self._parity = parity.upper()
        self._stop_bits = stop_bits
        self._address = address
        self._result_timeout = result_timeout
        self._poll_interval = poll_interval

        self._serial: Optional[serial.Serial] = None
        self._fw_version: str = ""

        # pending sessions: token -> threading.Event, result
        self._lock = threading.Lock()
        self._pending: dict[str, threading.Event] = {}
        self._results: dict[str, AnalyzerResult] = {}

        self._read_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    # ------------------------------------------------------------------
    # Analyzer ABC
    # ------------------------------------------------------------------

    def connect(self) -> None:
        if self._serial and self._serial.is_open:
            return
        try:
            self._serial = serial.Serial(
                port=self._port,
                baudrate=self._baud_rate,
                bytesize=serial.EIGHTBITS if self._data_bits == 8 else serial.SEVENBITS,
                parity=_PARITY_MAP.get(self._parity, serial.PARITY_NONE),
                stopbits=_STOP_BITS_MAP.get(self._stop_bits, serial.STOPBITS_ONE),
                timeout=0.1,
            )
        except serial.SerialException as exc:
            raise AnalyzerConnectionError(str(exc)) from exc

        self._stop_event.clear()
        self._read_thread = threading.Thread(
            target=self._read_loop, daemon=True, name=f"serial-reader-{self._port}"
        )
        self._read_thread.start()
        logger.info("Connected to analyzer on %s @ %d baud", self._port, self._baud_rate)

    def disconnect(self) -> None:
        self._stop_event.set()
        if self._read_thread:
            self._read_thread.join(timeout=3.0)
            self._read_thread = None
        if self._serial and self._serial.is_open:
            self._serial.close()
        self._serial = None
        logger.info("Disconnected from analyzer on %s", self._port)

    def start_test(self, fuel_type: FuelType | None = None) -> str:
        self._assert_connected()
        import uuid
        token = str(uuid.uuid4())
        with self._lock:
            self._pending[token] = threading.Event()
        cmd = self.poll_command()
        if cmd is not None:
            self._serial.write(cmd)  # type: ignore[union-attr]
        return token

    def read_result(self, session_token: str) -> AnalyzerResult:
        self._assert_connected()
        with self._lock:
            event = self._pending.get(session_token)
        if event is None:
            raise AnalyzerTimeoutError(f"Unknown session: {session_token}")

        if not event.wait(timeout=self._result_timeout):
            with self._lock:
                self._pending.pop(session_token, None)
            raise AnalyzerTimeoutError(
                f"No result from analyzer within {self._result_timeout}s"
            )

        with self._lock:
            self._pending.pop(session_token, None)
            return self._results.pop(session_token)

    def abort_test(self, session_token: str) -> None:
        with self._lock:
            event = self._pending.pop(session_token, None)
            self._results.pop(session_token, None)
        if event is not None:
            event.set()

    @property
    def is_connected(self) -> bool:
        return bool(self._serial and self._serial.is_open)

    @property
    def firmware_version(self) -> str:
        return self._fw_version

    # ------------------------------------------------------------------
    # Subclass contract
    # ------------------------------------------------------------------

    @abc.abstractmethod
    def parse_frame(self, raw: bytes) -> AnalyzerResult | None:
        """
        Called with raw bytes accumulated since the last complete frame.
        Return an AnalyzerResult when a complete reading is ready.
        Return None to keep accumulating bytes.
        """

    def poll_command(self) -> bytes | None:
        """Override to send a command to trigger a reading. Return None for push devices."""
        return None

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _read_loop(self) -> None:
        buf = bytearray()
        next_poll = time.monotonic() + self._poll_interval

        while not self._stop_event.is_set():
            try:
                chunk = self._serial.read(256)  # type: ignore[union-attr]
                if chunk:
                    buf.extend(chunk)
                    result = self.parse_frame(bytes(buf))
                    if result is not None:
                        buf.clear()
                        self._deliver(result)

                now = time.monotonic()
                cmd = self.poll_command()
                if cmd is not None and now >= next_poll:
                    try:
                        self._serial.write(cmd)  # type: ignore[union-attr]
                    except serial.SerialException:
                        pass
                    next_poll = now + self._poll_interval

            except serial.SerialException as exc:
                logger.error("Serial read error on %s: %s", self._port, exc)
                self._stop_event.set()
                break

    def _deliver(self, result: AnalyzerResult) -> None:
        """Fan-out a result to all waiting sessions (typically exactly one)."""
        with self._lock:
            for token, event in list(self._pending.items()):
                if token not in self._results:
                    self._results[token] = result
                    event.set()
                    break  # deliver to the oldest waiting session only

    def _assert_connected(self) -> None:
        if not self.is_connected:
            raise AnalyzerConnectionError(f"Analyzer not connected on {self._port}")


# ---------------------------------------------------------------------------
# Port discovery helper — used by the /api/v1/ports endpoint
# ---------------------------------------------------------------------------

def list_serial_ports() -> list[dict]:
    """Return available COM/tty ports suitable for display in the settings screen."""
    ports = []
    for p in serial.tools.list_ports.comports():
        ports.append({
            "device": p.device,
            "description": p.description or "",
            "hwid": p.hwid or "",
            "manufacturer": p.manufacturer or "",
        })
    return sorted(ports, key=lambda x: x["device"])
