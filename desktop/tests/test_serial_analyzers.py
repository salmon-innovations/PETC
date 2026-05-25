"""
Tests for serial analyzer adapters.

No physical hardware needed:
- parse_frame() tests feed raw bytes directly — no COM port opened.
- The virtual loopback tests use a socketpair() to simulate a serial port.
  They only run when the 'loopback' pytest mark is requested or on platforms
  that support socketpair (all Unix; Windows requires socat/com0com instead).
"""
from __future__ import annotations

import struct
import threading
import time
from pathlib import Path

import pytest

from petc.analyzer.ascii_gas import AsciiGasAnalyzer, _parse_kv_line
from petc.analyzer.binary_diesel import BinaryDieselAnalyzer, _crc16_modbus
from petc.analyzer.base import FuelType, GasReading, DieselReading

FIXTURES = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# CRC helper
# ---------------------------------------------------------------------------

def make_diesel_frame(
    opacity: float = 18.7,
    k_value: float = 1.234,
    rpm: int = 2000,
    boost_kpa: float = 0.0,
    pf_byte: int = 0x01,
    serial_no: bytes = b"D00001",
    corrupt_crc: bool = False,
) -> bytes:
    PAYLOAD_FMT = "<ffHfB6s"
    payload = struct.pack(PAYLOAD_FMT, opacity, k_value, rpm, boost_kpa, pf_byte, serial_no)
    header = bytes([0x01, len(payload)])
    crc = _crc16_modbus(header + payload)
    if corrupt_crc:
        crc ^= 0xFFFF
    return header + payload + struct.pack("<H", crc)


# ---------------------------------------------------------------------------
# AsciiGasAnalyzer — parse_frame() unit tests (no serial port)
# ---------------------------------------------------------------------------

class _AsciiGasStub(AsciiGasAnalyzer):
    """Instantiated without opening a port — only parse_frame() is tested."""
    def __init__(self):
        # Bypass SerialAnalyzer.__init__ to avoid requiring a real port.
        self._port = "STUB"
        self._baud_rate = 9600
        self._result_timeout = 5.0
        self._poll_interval = 0.5
        self._serial = None
        self._fw_version = ""
        import threading
        self._lock = threading.Lock()
        self._pending = {}
        self._results = {}
        self._read_thread = None
        self._stop_event = threading.Event()


def test_ascii_gas_parses_fixture_file():
    raw = (FIXTURES / "gas_pass.txt").read_bytes()
    stub = _AsciiGasStub()
    result = stub.parse_frame(raw)
    assert result is not None
    assert result.fuel_type is FuelType.GAS
    assert isinstance(result.reading, GasReading)
    assert result.reading.co_pct == pytest.approx(0.12)
    assert result.reading.hc_ppm == pytest.approx(85)
    assert result.reading.co2_pct == pytest.approx(14.2)
    assert result.reading.o2_pct == pytest.approx(0.4)
    assert result.reading.lambda_value == pytest.approx(1.001)
    assert result.reading.rpm == 2500
    assert result.reading.oil_temp_c == pytest.approx(85.3)
    assert result.serial_no == "A12345"
    assert result.pass_fail is True


def test_ascii_gas_no_optional_fields():
    raw = (FIXTURES / "gas_no_optional.txt").read_bytes()
    stub = _AsciiGasStub()
    result = stub.parse_frame(raw)
    assert result is not None
    assert result.reading.rpm is None
    assert result.reading.oil_temp_c is None
    assert result.pass_fail is None
    assert result.serial_no == ""


def test_ascii_gas_incomplete_frame_returns_none():
    stub = _AsciiGasStub()
    # No \r\n terminator yet
    assert stub.parse_frame(b"CO=0.12,HC=85") is None


def test_ascii_gas_missing_required_field_returns_none():
    stub = _AsciiGasStub()
    # HC missing
    assert stub.parse_frame(b"CO=0.12,CO2=14.2,O2=0.4,LAM=1.001\r\n") is None


def test_ascii_gas_non_ascii_frame_returns_none():
    stub = _AsciiGasStub()
    assert stub.parse_frame(b"\xff\xfe CO=0.12\r\n") is None


def test_kv_parser_handles_spaces_and_uppercase():
    result = _parse_kv_line("co = 0.12 , HC=85 , CO2=14.2")
    assert result["CO"] == "0.12"
    assert result["HC"] == "85"
    assert result["CO2"] == "14.2"


def test_kv_parser_ignores_malformed_pairs():
    result = _parse_kv_line("CO=0.12,JUNK,HC=85")
    assert "CO" in result
    assert "HC" in result
    assert "JUNK" not in result


# ---------------------------------------------------------------------------
# BinaryDieselAnalyzer — parse_frame() unit tests (no serial port)
# ---------------------------------------------------------------------------

class _BinaryDieselStub(BinaryDieselAnalyzer):
    def __init__(self):
        self._port = "STUB"
        self._baud_rate = 9600
        self._result_timeout = 5.0
        self._poll_interval = 0.5
        self._serial = None
        self._fw_version = ""
        import threading
        self._lock = threading.Lock()
        self._pending = {}
        self._results = {}
        self._read_thread = None
        self._stop_event = threading.Event()


def test_binary_diesel_parses_fixture_file():
    raw = (FIXTURES / "diesel_pass.bin").read_bytes()
    stub = _BinaryDieselStub()
    result = stub.parse_frame(raw)
    assert result is not None
    assert result.fuel_type is FuelType.DIESEL
    assert isinstance(result.reading, DieselReading)
    assert result.reading.opacity_pct == pytest.approx(18.7, abs=0.01)
    assert result.reading.k_value == pytest.approx(1.234, abs=0.001)
    assert result.reading.rpm == 2000
    assert result.reading.boost_kpa is None
    assert result.pass_fail is True
    assert result.serial_no == "D00001"


def test_binary_diesel_incomplete_frame_returns_none():
    stub = _BinaryDieselStub()
    assert stub.parse_frame(b"\x01\x15\x00") is None


def test_binary_diesel_bad_crc_returns_none():
    frame = make_diesel_frame(corrupt_crc=True)
    stub = _BinaryDieselStub()
    assert stub.parse_frame(frame) is None


def test_binary_diesel_fail_result():
    frame = make_diesel_frame(pf_byte=0x00)
    stub = _BinaryDieselStub()
    result = stub.parse_frame(frame)
    assert result is not None
    assert result.pass_fail is False


def test_binary_diesel_unknown_pf():
    frame = make_diesel_frame(pf_byte=0xFF)
    stub = _BinaryDieselStub()
    result = stub.parse_frame(frame)
    assert result is not None
    assert result.pass_fail is None


def test_binary_diesel_no_soh_returns_none():
    stub = _BinaryDieselStub()
    assert stub.parse_frame(b"\x00" * 25) is None


def test_binary_diesel_leading_garbage_before_soh():
    good_frame = make_diesel_frame()
    raw = b"\xAA\xBB" + good_frame  # two garbage bytes before SOH
    stub = _BinaryDieselStub()
    result = stub.parse_frame(raw)
    assert result is not None
    assert result.fuel_type is FuelType.DIESEL


def test_crc16_modbus_known_value():
    # MODBUS CRC of b"\x01\x03\x00\x00\x00\x02" == 0xC40B
    assert _crc16_modbus(b"\x01\x03\x00\x00\x00\x02") == 0x0BC4


# ---------------------------------------------------------------------------
# list_serial_ports — smoke test (no hardware needed)
# ---------------------------------------------------------------------------

def test_list_serial_ports_returns_list():
    from petc.analyzer.serial_base import list_serial_ports
    ports = list_serial_ports()
    assert isinstance(ports, list)
    for p in ports:
        assert "device" in p
        assert "description" in p


# ---------------------------------------------------------------------------
# API endpoint — GET /api/v1/ports
# ---------------------------------------------------------------------------

def test_ports_endpoint_returns_list(client_fixture):
    r = client_fixture.get("/api/v1/ports")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# Reuse the wired client from test_api.py via a conftest-style fixture here.
# We import the app directly so we don't need a separate conftest.py.

@pytest.fixture
def client_fixture():
    from fastapi.testclient import TestClient
    from petc.analyzer.mock import MockAnalyzer
    from petc.api.server import app, init
    from petc.camera.capture import MockCameraCapture
    from petc.db.models import Base  # noqa: F401
    from petc.db.session import engine
    from petc.gov.mock_client import MockGovRegistryClient
    from petc.printer.mock import MockPrinter

    class _DummySync:
        def enqueue(self, *a): pass

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    a = MockAnalyzer(result_delay_s=0)
    a.connect()
    cam = MockCameraCapture()
    cam.open()
    init(a, cam, MockPrinter(), MockGovRegistryClient(), _DummySync())
    return TestClient(app)
