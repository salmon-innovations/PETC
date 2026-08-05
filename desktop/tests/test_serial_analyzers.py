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
from petc.analyzer.koeng_gas import (
    CURRENT_ANALYSIS_REQUEST,
    MEASURE_REQUEST,
    STANDBY_REQUEST,
    STATUS_REQUEST,
    KoengGasAnalyzer,
    parse_measurement_frame,
)
from petc.analyzer.koeng_diesel import (
    KoengDieselAnalyzer,
    parse_measurement_frame as parse_koeng_diesel_frame,
)
from petc.analyzer.cartesykj_gas import (
    CURRENT_ANALYSIS_REQUEST as CARTESYKJ_CURRENT_ANALYSIS_REQUEST,
    CartesykjGasAnalyzer,
    measurement_checksum as cartesykj_checksum,
    parse_measurement_frame as parse_cartesykj_frame,
)

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
# KOENG KEG-500 CE — recovered 9600/8N1 command/response protocol
# ---------------------------------------------------------------------------

def test_koeng_parses_27_byte_afr_frame():
    frame = b"\x1bC00120085014200401001A147\r"
    reading = parse_measurement_frame(frame)
    assert reading is not None
    assert reading.co_pct == pytest.approx(0.12)
    assert reading.hc_ppm == pytest.approx(85)
    assert reading.co2_pct == pytest.approx(14.2)
    assert reading.o2_pct == pytest.approx(0.4)
    assert reading.lambda_value == pytest.approx(1.001)
    assert reading.rpm is None


def test_koeng_parses_28_byte_five_digit_hc_frame():
    frame = b"\x1bC0123123450135005009980123\r"
    reading = parse_measurement_frame(frame)
    assert reading is not None
    assert reading.co_pct == pytest.approx(1.23)
    assert reading.hc_ppm == pytest.approx(12345)
    assert reading.co2_pct == pytest.approx(13.5)
    assert reading.o2_pct == pytest.approx(0.5)
    assert reading.lambda_value == pytest.approx(0.998)


def test_koeng_rejects_incomplete_or_nonnumeric_frame():
    assert parse_measurement_frame(b"\x1bC0012\r") is None
    assert parse_measurement_frame(b"\x1bCXXXX0085014200401001A147\r") is None


def test_koeng_command_flow_and_configured_serial_number():
    analyzer = KoengGasAnalyzer(port="STUB", serial_no="PGA-TEST-001")
    assert analyzer._baud_rate == 9600
    assert analyzer._data_bits == 8
    assert analyzer._parity == "N"
    assert analyzer._stop_bits == 1
    assert analyzer.poll_command() is None
    assert analyzer.start_command() == MEASURE_REQUEST
    assert analyzer.poll_command() == STATUS_REQUEST

    assert analyzer.parse_frame(b"\x1bS030\r") is None
    assert analyzer.poll_command() == CURRENT_ANALYSIS_REQUEST

    frame = b"\x1bC00120085014200401001A147\r"
    result = analyzer.parse_frame(b"\x1bS030\r\n" + frame)
    assert result is not None
    assert result.fuel_type is FuelType.GAS
    assert result.serial_no == "PGA-TEST-001"
    assert result.raw_bytes == frame
    assert analyzer.poll_command() is None


def test_koeng_restore_standby_is_sent_once():
    class _FakeSerial:
        is_open = True

        def __init__(self):
            self.writes = []

        def write(self, value):
            self.writes.append(value)

        def flush(self):
            pass

    analyzer = KoengGasAnalyzer(port="STUB")
    fake = _FakeSerial()
    analyzer._serial = fake
    analyzer.start_command()
    analyzer._restore_standby()
    analyzer._restore_standby()
    assert fake.writes == [STANDBY_REQUEST]


# ---------------------------------------------------------------------------
# CARTESYKJ MQ-550 — recovered 9600/8N1 polled binary protocol
# ---------------------------------------------------------------------------

MQ550_CAPTURE = bytes.fromhex(
    "06 00 FC 00 0E 02 6A 00 02 00 00 00 00 00 60 03 DC"
)


def test_cartesykj_parses_verified_live_capture():
    reading = parse_cartesykj_frame(MQ550_CAPTURE)
    assert reading is not None
    assert reading.hc_ppm == pytest.approx(252)
    assert reading.co_pct == pytest.approx(0.14)
    assert reading.co2_pct == pytest.approx(6.18)
    assert reading.o2_pct == pytest.approx(0.02)
    assert reading.no_ppm == pytest.approx(0)
    assert reading.rpm == 0
    assert reading.lambda_value == pytest.approx(0.96)
    assert reading.oil_temp_c is None


def test_cartesykj_checksum_matches_verified_capture():
    values = (252, 14, 618, 2, 0, 0, 96)
    assert cartesykj_checksum(values) == 0x03DC


def test_cartesykj_rejects_bad_checksum_or_incomplete_frame():
    corrupt = MQ550_CAPTURE[:-1] + bytes([MQ550_CAPTURE[-1] ^ 0x01])
    assert parse_cartesykj_frame(corrupt) is None
    assert parse_cartesykj_frame(MQ550_CAPTURE[:-1]) is None


def test_cartesykj_command_flow_recovers_after_busy_byte():
    analyzer = CartesykjGasAnalyzer(port="STUB", serial_no="MQ550-TEST-001")
    assert analyzer._baud_rate == 9600
    assert analyzer._data_bits == 8
    assert analyzer._parity == "N"
    assert analyzer._stop_bits == 1
    assert analyzer.poll_command() is None
    assert analyzer.start_command() == CARTESYKJ_CURRENT_ANALYSIS_REQUEST
    assert analyzer.poll_command() is None

    result = analyzer.parse_frame(b"\x15" + MQ550_CAPTURE)
    assert result is not None
    assert result.fuel_type is FuelType.GAS
    assert result.serial_no == "MQ550-TEST-001"
    assert result.raw_bytes == MQ550_CAPTURE
    assert result.reading.hc_ppm == pytest.approx(252)
    assert analyzer.poll_command() is None


def test_cartesykj_reopens_port_and_sends_one_request_per_test(monkeypatch):
    class _FakeSerial:
        is_open = True

        def __init__(self):
            self.writes = []
            self.input_resets = 0

        def write(self, value):
            self.writes.append(value)

        def reset_input_buffer(self):
            self.input_resets += 1

    analyzer = CartesykjGasAnalyzer(port="STUB", serial_no="MQ550-TEST-001")
    fake = _FakeSerial()
    analyzer._serial = fake
    connection_events = []
    monkeypatch.setattr(analyzer, "disconnect", lambda: connection_events.append("disconnect"))
    monkeypatch.setattr(analyzer, "connect", lambda: connection_events.append("connect"))
    monkeypatch.setattr(
        "petc.analyzer.cartesykj_gas.time.sleep",
        lambda delay: connection_events.append(("sleep", delay)),
    )

    token = analyzer.start_test(FuelType.GAS)

    assert connection_events == ["disconnect", ("sleep", 0.25), "connect"]
    assert fake.input_resets == 1
    assert fake.writes == [CARTESYKJ_CURRENT_ANALYSIS_REQUEST]
    assert token in analyzer._pending
    assert analyzer.poll_command() is None


def test_cartesykj_accepts_valid_all_zero_measurement():
    zero_values = (0, 0, 0, 0, 0, 0, 0)
    frame = b"\x06" + (b"\x00\x00" * 7) + cartesykj_checksum(zero_values).to_bytes(2, "big")
    reading = parse_cartesykj_frame(frame)
    assert reading is not None
    assert reading.co_pct == 0
    assert reading.hc_ppm == 0
    assert reading.rpm == 0


def test_cartesykj_builder_selection(monkeypatch):
    from petc.analyzer import builder

    monkeypatch.setattr(builder, "_read_settings", lambda: {
        "analyzer.type": "cartesykj_gas",
        "analyzer.port": "COM3",
        "analyzer.serial_no": "MQ550-BUILDER-001",
    })
    analyzer = builder.build_analyzer_from_settings()
    assert isinstance(analyzer, CartesykjGasAnalyzer)
    assert analyzer._port == "COM3"
    assert analyzer._configured_serial_no == "MQ550-BUILDER-001"


# ---------------------------------------------------------------------------
# KOENG diesel opacity analyzer — verified 9600/8N1 passive ASCII stream
# ---------------------------------------------------------------------------

def test_koeng_diesel_parses_live_idle_frame():
    reading = parse_koeng_diesel_frame(b"\x1b000.0 00.00 ----- --- ---\r")
    assert reading is not None
    assert reading.opacity_pct == pytest.approx(0.0)
    assert reading.k_value == pytest.approx(0.0)
    assert reading.rpm is None


def test_koeng_diesel_parses_measurement_frame():
    reading = parse_koeng_diesel_frame(b"\x1b012.3 01.45 02500 --- 085\r")
    assert reading is not None
    assert reading.opacity_pct == pytest.approx(12.3)
    assert reading.k_value == pytest.approx(1.45)
    assert reading.rpm == 2500


def test_koeng_diesel_rejects_bad_width_or_fields():
    assert parse_koeng_diesel_frame(b"\x1b000.0 00.00 ----- --- --\r") is None
    assert parse_koeng_diesel_frame(b"\x1bBAD.0 00.00 ----- --- ---\r") is None
    assert parse_koeng_diesel_frame(b"\x1b000.0 00.00 ----- --- XXY\r") is None


def test_koeng_diesel_adapter_config_and_serial_number():
    analyzer = KoengDieselAnalyzer(port="STUB", serial_no="KOENG-D-001")
    assert analyzer._baud_rate == 9600
    assert analyzer._data_bits == 8
    assert analyzer._parity == "N"
    assert analyzer._stop_bits == 1
    assert analyzer.poll_command() is None

    frame = b"\x1b012.3 01.45 02500 --- 085\r"
    result = analyzer.parse_frame(b"garbage" + frame)
    assert result is not None
    assert result.fuel_type is FuelType.DIESEL
    assert result.serial_no == "KOENG-D-001"
    assert result.raw_bytes == frame
    assert result.reading.rpm == 2500


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
