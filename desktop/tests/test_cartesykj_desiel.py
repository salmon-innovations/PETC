"""MQY-200 source parity tests; all serial responses are simulated."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

from petc.analyzer import cartesykj_desiel as mq
from petc.analyzer.base import AnalyzerConnectionError, AnalyzerTimeoutError, FuelType


def frame(k):
    return b"\xa6\x00\x00" + round(k * 100).to_bytes(2, "big") + b"\x00" * 5


class FakeSerial:
    is_open = True

    def __init__(self, responses):
        self.responses = iter(responses)
        self.chunks = []
        self.writes = []

    def write(self, command):
        self.writes.append(command)
        if command == mq.GET_DATA:
            raw = next(self.responses)
            self.chunks = [raw[:4], raw[4:]] if raw else []

    @property
    def in_waiting(self):
        return len(self.chunks[0]) if self.chunks else 0

    def read(self, size):
        return self.chunks.pop(0)

    def reset_input_buffer(self):
        self.chunks = []

    def flush(self):
        pass

    def close(self):
        self.is_open = False


@pytest.fixture
def capture(monkeypatch):
    clock = SimpleNamespace(now=0.0)
    monkeypatch.setattr(mq, "time", SimpleNamespace(monotonic=lambda: clock.now))
    analyzer = mq.CartesykjDieselAnalyzer(port="FAKE", serial_no="MQ123")
    analyzer._token = "test"
    analyzer._progress = {"state": "running", "peaks": [], "cycles": [], "average": None}

    def wait(seconds):
        analyzer._check_cancel()
        clock.now += max(0, seconds)
        analyzer._update_countdown()

    monkeypatch.setattr(analyzer, "_wait", wait)
    return analyzer, clock


def test_parser_matches_supplied_source():
    source = Path(__file__).resolve().parents[2] / "CartesySource/mqy200_protocol.py"
    if not source.exists():
        pytest.skip("Optional vendor source not present")
    spec = importlib.util.spec_from_file_location("vendor_protocol", source)
    vendor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(vendor)
    for k in (0, 0.01, 14.20, 655.35):
        assert mq.parse_k_response(frame(k)) == vendor.parse_k_response(frame(k)).k
    for raw in (b"", frame(1)[:-1], frame(1) + b"x", b"x" + frame(1)[1:]):
        assert mq.parse_k_response(raw) is None
    assert mq.parse_k_response(bytes.fromhex("A6 00 00 05 8C 00 00 00 00 00")) == 14.20


def test_six_maxima_then_average_matches_pdf(capture):
    analyzer, clock = capture
    peaks = [14.29, 13.85, 14.10, 13.72, 14.25, 13.95]
    analyzer._serial = FakeSerial([frame(k) for peak in peaks for k in ([1.0] * 24 + [peak])])
    analyzer._run()
    progress = analyzer.capture_progress("test")
    assert progress["state"] == "complete"
    assert progress["peaks"] == peaks
    assert progress["average"] is None
    assert clock.now == pytest.approx(73)  # 2 + 5 + six inclusive 10..0 countdowns
    assert analyzer._serial.writes == [mq.SET_REALTIME, mq.START_CALIBRATION] + [mq.GET_DATA] * 150
    assert all(len(c["samples"]) == 25 for c in progress["cycles"])
    result = analyzer.read_result("test")
    assert result.reading.k_value == 14.03
    assert result.reading.opacity_pct is None
    assert result.serial_no == "MQ123"
    assert len(result.raw_bytes) == 1500
    assert result.capture_sequence["average"] == 14.03
    with pytest.raises(AnalyzerTimeoutError):
        analyzer.read_result("test")


def test_zero_rejected_only_on_result_request(capture):
    analyzer, _ = capture
    analyzer._serial = FakeSerial([frame(0)] * 150)
    analyzer._run()
    assert analyzer.capture_progress("test")["state"] == "complete"
    assert analyzer.capture_progress("test")["peaks"] == [0] * 6
    with pytest.raises(AnalyzerTimeoutError, match="zero"):
        analyzer.read_result("test")


def test_duplicate_accepted_result_rejected_on_request(capture):
    analyzer, _ = capture
    for attempt in range(2):
        analyzer._serial = FakeSerial([frame(1)] * 150)
        analyzer._progress = {"state": "running", "average": None}
        analyzer._run()
        assert analyzer.capture_progress("test")["average"] is None
        if attempt == 0:
            assert analyzer.read_result("test").reading.k_value == 1
        else:
            with pytest.raises(AnalyzerTimeoutError, match="already accepted today"):
                analyzer.read_result("test")


def test_missing_responses_do_not_become_zero(capture):
    analyzer, _ = capture
    analyzer._serial = FakeSerial([b""] * 25)
    analyzer._run()
    assert analyzer.capture_progress("test")["state"] == "error"
    assert "no valid" in analyzer.capture_progress("test")["message"]
    assert analyzer._result is None


def test_invalid_replies_excluded_from_peak(capture):
    analyzer, _ = capture
    analyzer._serial = FakeSerial([raw for _ in range(6) for raw in [b"x" * 10] * 24 + [frame(2)]])
    analyzer._run()
    assert analyzer.read_result("test").reading.k_value == 2
    assert all(len(c["samples"]) == 1 for c in analyzer.capture_progress("test")["cycles"])


def test_cancelled_capture_cannot_publish_result(capture):
    analyzer, _ = capture
    analyzer._serial = FakeSerial([frame(1)] * 150)
    analyzer._cancel.set()
    analyzer._run()
    assert analyzer.capture_progress("test")["state"] == "cancelled"
    assert analyzer._result is None
    assert mq.GET_DATA not in analyzer._serial.writes


def test_port_settings_and_wrong_fuel(monkeypatch):
    seen = {}
    def serial_factory(**kwargs):
        seen.update(kwargs)
        return FakeSerial([])
    monkeypatch.setattr(mq.serial, "Serial", serial_factory)
    analyzer = mq.CartesykjDieselAnalyzer(port="FAKE", baud_rate=19200)
    analyzer.connect()
    assert seen["baudrate"] == 9600
    assert (seen["bytesize"], seen["parity"], seen["stopbits"]) == (8, "N", 1)
    with pytest.raises(AnalyzerConnectionError, match="Diesel"):
        analyzer.start_test(FuelType.GAS)
    analyzer.disconnect()
    assert not analyzer.is_connected


def test_start_requires_valid_device_response(capture):
    analyzer, _ = capture
    analyzer._serial = FakeSerial([b""])
    with pytest.raises(AnalyzerConnectionError, match="No valid MQY-200 response"):
        analyzer.start_test(FuelType.DIESEL)
    assert analyzer._worker is None
