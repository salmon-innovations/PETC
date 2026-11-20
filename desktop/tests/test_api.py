import pytest
from fastapi.testclient import TestClient

from petc.analyzer.mock import MockAnalyzer
from fastapi import HTTPException

from petc.api.server import (
    _canonical_submission_payload,
    _validate_machine_readings,
    _validate_readings_for_do,
    app,
    init,
)
from petc.camera.capture import MockCameraCapture
from petc.db import models  # noqa: F401
from petc.db.session import Base, engine
from petc.gov.mock_client import MockGovRegistryClient
from petc.printer.mock import MockPrinter


class DummyCloudSync:
    def __init__(self):
        self.events = []

    def enqueue(self, entity_type, entity_id, payload):
        self.events.append((entity_type, entity_id, payload))


@pytest.fixture(autouse=True)
def wire_dependencies(tmp_path, monkeypatch):
    monkeypatch.setenv("PETC_PROFILE", "dev")
    monkeypatch.setenv("PETC_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("PETC_CLOUD_URL", raising=False)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    analyzer = MockAnalyzer(result_delay_s=0)
    analyzer.connect()
    camera = MockCameraCapture()
    camera.open()
    printer = MockPrinter()
    init(analyzer, camera, printer, MockGovRegistryClient(), DummyCloudSync())


@pytest.fixture
def client():
    return TestClient(app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_status(client):
    r = client.get("/status")
    assert r.status_code == 200
    data = r.json()
    assert data["analyzer_connected"] is False
    assert data["printer_status"]["online"] is True


def test_machine_capture_accepts_zero_gas_values_without_rpm():
    _validate_machine_readings("GAS", {
        "co_pct": 0.0,
        "hc_ppm": 44.0,
        "co2_pct": 0.0,
        "o2_pct": 20.72,
        "lambda_value": 2.0,
        "rpm": None,
    })


def test_do_submission_still_requires_positive_rpm():
    readings = {
        "co_pct": 0.0,
        "hc_ppm": 44.0,
        "co2_pct": 0.0,
        "o2_pct": 20.72,
        "lambda_value": 2.0,
        "rpm": None,
    }
    with pytest.raises(HTTPException, match="reading rpm is required"):
        _validate_readings_for_do("GAS", readings)

    readings["rpm"] = 900
    _validate_readings_for_do("GAS", readings)


def test_start_and_get_result(client):
    start = client.post(
        "/test/start",
        json={
            "operator_id": "op1",
            "plate_number": "ABC123",
            "fuel_type": "GAS",
            "inspection_purpose": "FOR_COMPLIANCE",
        },
    )
    assert start.status_code == 200
    token = start.json()["session_token"]

    result = client.get(f"/test/{token}/result")
    assert result.status_code == 200
    assert result.json()["pass_fail"] is True
    assert result.json()["fuel_type"] == "GAS"
    assert result.json()["test_id"]
    detail = client.get(f"/tests/{result.json()['test_id']}")
    assert detail.json()["inspectionPurpose"] == "FOR_COMPLIANCE"


def test_live_result_peeks_without_consuming_session(client):
    start = client.post(
        "/test/start",
        json={
            "operator_id": "op1",
            "plate_number": "ABC123",
            "fuel_type": "GAS",
            "inspection_purpose": "FOR_COMPLIANCE",
        },
    )
    assert start.status_code == 200
    token = start.json()["session_token"]

    live = client.get(f"/test/{token}/live")
    assert live.status_code == 200
    assert live.json()["state"] == "ready"
    assert live.json()["readings"]["co_pct"] is not None

    result = client.get(f"/test/{token}/result")
    assert result.status_code == 200
    assert result.json()["readings"]["co_pct"] == 0.12

def test_start_rejects_unknown_inspection_purpose(client):
    start = client.post(
        "/test/start",
        json={
            "operator_id": "op1",
            "plate_number": "ABC123",
            "fuel_type": "GAS",
            "inspection_purpose": "OTHER",
        },
    )
    assert start.status_code == 422


def test_vehicle_lookup_uses_mock_and_cache(client):
    first = client.post("/api/v1/vehicle/lookup", json={"plate": "DSL1234"})
    assert first.status_code == 200
    assert first.json()["found"] is True
    assert first.json()["source"] == "LTMS"
    assert first.json()["vehicle"]["fuelType"] == "DIESEL"
    assert first.json()["owner"]["ownerType"] == "ORGANIZATION"

    second = client.post("/api/v1/vehicle/lookup", json={"plate": "DSL1234"})
    assert second.status_code == 200
    assert second.json()["source"] == "LTMS_CACHE"


def test_upload_submit_accepts_full_wizard_payload(client):
    start = client.post(
        "/test/start",
        json={"operator_id": "op1", "plate_number": "ABC1234", "fuel_type": "GAS"},
    )
    token = start.json()["session_token"]
    result = client.get(f"/test/{token}/result").json()
    test_id = result["test_id"]
    client.post("/camera/capture", json={"test_id": test_id, "photo_type": "FRONT"})
    client.post("/camera/capture", json={"test_id": test_id, "photo_type": "REAR"})
    detail = client.get(f"/tests/{test_id}").json()

    lookup = client.post("/api/v1/vehicle/lookup", json={"plate": "ABC1234"}).json()
    payload = {
        "centerName": "PETC Center",
        "testId": test_id,
        "testDatetime": detail["testedAt"],
        "inspection": {"purpose": detail["inspectionPurpose"]},
        "vehicle": {
            "plateNo": lookup["vehicle"]["plateNo"],
            "mvNo": lookup["vehicle"]["mvNo"],
            "fuelType": lookup["vehicle"]["fuelType"],
            "make": lookup["vehicle"]["make"],
            "series": lookup["vehicle"]["series"],
            "yearModel": lookup["vehicle"]["yearModel"],
        },
        "owner": lookup["owner"],
        "engineFlags": {"turbo": "NON_TURBO", "aspiration": "N_ASPIRATED", "condition": "CONVENTIONAL"},
        "readings": detail["readings"],
        "verdict": {"pass": True, "label": "PASS", "reasons": []},
        "technician": {
            "technicianName": "Mock PETC Operator",
            "tesdaCertNo": "TESDA-MOCK-001",
            "certificationNo": "PETC-CERT-MOCK",
        },
        "photos": detail["photos"],
    }

    wrong_purpose = {
        **payload,
        "inspection": {"purpose": "FOR_COMPLIANCE"},
    }
    rejected = client.post("/api/v1/upload/submit", json={"payload": wrong_purpose})
    assert rejected.status_code == 409

    submitted = client.post("/api/v1/upload/submit", json={"payload": payload})
    assert submitted.status_code == 200
    assert submitted.json()["state"] == "ACCEPTED"
    assert submitted.json()["certificateNo"].startswith("CERT-")


def test_canonical_submission_payload_uses_commissioned_center_in_production(monkeypatch):
    monkeypatch.setenv("PETC_PROFILE", "production")
    monkeypatch.setenv("PETC_CENTER_ID", "PETC-001")

    canonical, center_id = _canonical_submission_payload({"testId": "test-1"})

    assert center_id == "PETC-001"
    assert canonical["centerId"] == "PETC-001"


def test_canonical_submission_payload_rejects_production_center_override(monkeypatch):
    monkeypatch.setenv("PETC_PROFILE", "production")
    monkeypatch.setenv("PETC_CENTER_ID", "PETC-001")

    with pytest.raises(HTTPException) as exc:
        _canonical_submission_payload({"centerId": "another-center"})

    assert exc.value.status_code == 403


def test_canonical_submission_payload_keeps_dev_mock_center_fallback(monkeypatch):
    monkeypatch.setenv("PETC_PROFILE", "dev")
    monkeypatch.delenv("PETC_CENTER_ID", raising=False)

    canonical, center_id = _canonical_submission_payload({"centerId": "legacy-dev-center"})

    assert center_id == "legacy-dev-center"
    assert canonical["centerId"] == "legacy-dev-center"


def test_abort(client):
    start = client.post(
        "/test/start",
        json={"operator_id": "op1", "plate_number": "XYZ999", "fuel_type": "GAS"},
    )
    token = start.json()["session_token"]
    abort = client.post(f"/test/{token}/abort")
    assert abort.status_code == 200

    result = client.get(f"/test/{token}/result")
    assert result.status_code == 408


def test_print_receipt(client):
    r = client.post(
        "/print/receipt",
        json={
            "test_id": "t-001",
            "plate_number": "ABC123",
            "vehicle_make": "Toyota",
            "vehicle_model": "Vios",
            "year": 2019,
            "fuel_type": "GAS",
            "pass_fail": True,
            "operator_name": "Juan dela Cruz",
            "center_name": "Makati ETC",
            "copies": 2,
        },
    )
    assert r.status_code == 200
    assert r.json()["printed"] is True


def test_mqy200_waits_for_explicit_result_acceptance(client, monkeypatch):
    from petc.analyzer.cartesykj_desiel import CartesykjDieselAnalyzer
    from petc.analyzer.base import AnalyzerResult, DieselReading, FuelType
    from .test_cartesykj_desiel import FakeSerial, frame

    analyzer = CartesykjDieselAnalyzer(port="FAKE")
    analyzer._serial = FakeSerial([frame(1)])
    monkeypatch.setattr("petc.analyzer.serial_base.list_serial_ports", lambda: [{"device": "FAKE"}])
    monkeypatch.setattr(analyzer, "_run", lambda: None)
    camera = MockCameraCapture()
    camera.open()
    sync = DummyCloudSync()
    init(analyzer, camera, MockPrinter(), MockGovRegistryClient(), sync)
    start = client.post("/test/start", json={
        "operator_id": "op1", "plate_number": "DSL1234", "fuel_type": "DIESEL",
    })
    assert start.status_code == 200
    token = start.json()["session_token"]
    running = client.get(f"/test/{token}/result")
    assert running.status_code == 202
    assert running.json()["capture_sequence"]["average"] is None
    analyzer._progress.update(state="complete", peaks=[1, 2, 3, 4, 5, 6])
    analyzer._result = AnalyzerResult(
        fuel_type=FuelType.DIESEL, reading=DieselReading(opacity_pct=None, k_value=3.5),
        raw_bytes=b"".join(frame(k) for k in range(1, 7)),
    )
    ready = client.get(f"/test/{token}/result")
    assert ready.status_code == 202
    assert ready.json()["capture_sequence"]["peaks"] == [1, 2, 3, 4, 5, 6]
    assert ready.json()["capture_sequence"]["average"] is None
    assert not any(e[0] == "emission_test_result" for e in sync.events)
    accepted = client.get(f"/test/{token}/result?accept_result=true")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["readings"]["k_value"] == 3.5
    assert accepted.json()["readings"]["opacity_pct"] is None
    assert accepted.json()["capture_sequence"]["average"] == 3.5
    assert any(e[0] == "emission_test_result" for e in sync.events)


def test_analyzer_settings_unchanged_connected_reuses_existing_analyzer(client, monkeypatch):
    from petc.api import server
    from petc.db.models import AppSetting
    from petc.db.session import SessionLocal

    class ConnectedAnalyzer:
        is_connected = True

        def disconnect(self):
            raise AssertionError("unchanged settings should not disconnect")

    with SessionLocal() as session:
        session.add_all([
            AppSetting(key="analyzer.type", value="cartesykj_diesel"),
            AppSetting(key="analyzer.port", value="COM9"),
            AppSetting(key="analyzer.baud", value="9600"),
            AppSetting(key="analyzer.data_bits", value="8"),
            AppSetting(key="analyzer.parity", value="N"),
            AppSetting(key="analyzer.stop_bits", value="1"),
            AppSetting(key="analyzer.address", value="01"),
            AppSetting(key="analyzer.serial_no", value="MQY-001"),
        ])
        session.commit()

    monkeypatch.setattr(server, "_analyzer", ConnectedAnalyzer())
    monkeypatch.setattr(
        "petc.analyzer.builder.build_analyzer_from_settings",
        lambda: pytest.fail("unchanged connected settings should not build another analyzer"),
    )

    response = client.put("/api/v1/settings/analyzer", json={
        "type": "cartesykj_diesel",
        "port": "COM9",
        "baud": 9600,
        "dataBits": 8,
        "parity": "N",
        "stopBits": 1,
        "address": "01",
        "serialNo": "MQY-001",
    })

    assert response.status_code == 200
    assert response.json() == {"applied": True, "connected": True}


def test_analyzer_settings_same_port_releases_old_handle_before_new_connect(client, monkeypatch):
    from petc.api import server
    from petc.db.models import AppSetting
    from petc.db.session import SessionLocal

    events = []

    class FakeAnalyzer:
        def __init__(self, name):
            self.name = name
            self.connected = True

        @property
        def is_connected(self):
            return self.connected

        def connect(self):
            events.append(f"{self.name}:connect")
            self.connected = True

        def disconnect(self):
            events.append(f"{self.name}:disconnect")
            self.connected = False

    old = FakeAnalyzer("old")
    new = FakeAnalyzer("new")
    new.connected = False

    with SessionLocal() as session:
        session.add_all([
            AppSetting(key="analyzer.type", value="cartesykj_diesel"),
            AppSetting(key="analyzer.port", value="COM9"),
            AppSetting(key="analyzer.baud", value="9600"),
            AppSetting(key="analyzer.data_bits", value="8"),
            AppSetting(key="analyzer.parity", value="N"),
            AppSetting(key="analyzer.stop_bits", value="1"),
            AppSetting(key="analyzer.address", value="01"),
            AppSetting(key="analyzer.serial_no", value="OLD"),
        ])
        session.commit()

    monkeypatch.setattr(server, "_analyzer", old)
    monkeypatch.setattr("petc.analyzer.builder.build_analyzer_from_settings", lambda: new)

    response = client.put("/api/v1/settings/analyzer", json={
        "type": "cartesykj_diesel",
        "port": "COM9",
        "baud": 9600,
        "dataBits": 8,
        "parity": "N",
        "stopBits": 1,
        "address": "01",
        "serialNo": "NEW",
    })

    assert response.status_code == 200
    assert response.json() == {"applied": True, "connected": True}
    assert events[:2] == ["old:disconnect", "new:connect"]
    assert server._analyzer is new

