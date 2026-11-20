from types import SimpleNamespace

from .test_api import client, wire_dependencies  # noqa: F401; isolated API fixtures
from petc.analyzer import mock


def test_mock_diesel_is_rejected_before_creating_session(client):
    from petc.api import server
    for sequence in (False, True):
        response = client.post("/test/start", json={
            "operator_id": "op1", "plate_number": "DSL1234",
            "fuel_type": "DIESEL", "diesel_sequence": sequence,
        })
        assert response.status_code == 503
        assert "real analyzer" in response.json()["detail"]
        assert not server._analyzer._sessions


def test_missing_serial_port_is_rejected(client, monkeypatch):
    from petc.api import server
    from petc.analyzer.cartesykj_desiel import CartesykjDieselAnalyzer
    analyzer = CartesykjDieselAnalyzer(port="COM99")
    monkeypatch.setattr(server, "_analyzer", analyzer)
    monkeypatch.setattr("petc.analyzer.serial_base.list_serial_ports", lambda: [])
    response = client.post("/test/start", json={
        "operator_id": "op1", "plate_number": "DSL1234", "fuel_type": "DIESEL",
    })
    assert response.status_code == 503
    assert "serial port is unavailable" in response.json()["detail"]
    assert analyzer._token is None


def test_mock_live_cancel_removes_session():
    analyzer = mock.MockAnalyzer()
    analyzer.connect()
    token = analyzer.start_diesel_sequence()
    assert analyzer.has_capture_sequence(token)
    analyzer.abort_test(token)
    assert not analyzer.has_capture_sequence(token)
    assert token not in analyzer._sessions
