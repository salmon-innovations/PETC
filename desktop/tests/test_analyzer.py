import pytest

from petc.analyzer import (
    AnalyzerConnectionError,
    FuelType,
    GasReading,
    MockAnalyzer,
)


def test_mock_analyzer_gas_happy_path():
    a = MockAnalyzer(fuel_type=FuelType.GAS, result_delay_s=0)
    a.connect()
    assert a.is_connected
    token = a.start_test()
    result = a.read_result(token)
    assert result.fuel_type is FuelType.GAS
    assert isinstance(result.reading, GasReading)
    assert result.pass_fail is True


def test_mock_analyzer_simulate_failure():
    a = MockAnalyzer(simulate_failure=True)
    with pytest.raises(AnalyzerConnectionError):
        a.connect()


def test_mock_analyzer_abort():
    a = MockAnalyzer(result_delay_s=0)
    a.connect()
    token = a.start_test()
    a.abort_test(token)
    from petc.analyzer import AnalyzerTimeoutError
    with pytest.raises(AnalyzerTimeoutError):
        a.read_result(token)
