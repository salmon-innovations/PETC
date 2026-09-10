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
    assert data["analyzer_connected"] is True
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


def test_machine_capture_can_preserve_documented_unavailable_fields():
    _validate_machine_readings(
        "DIESEL",
        {"opacity_pct": None, "k_value": 1.23, "rpm": None},
        unavailable_fields=("opacity_pct", "rpm"),
    )

    with pytest.raises(HTTPException, match="reading opacity_pct is required"):
        _validate_readings_for_do(
            "DIESEL",
            {"opacity_pct": None, "k_value": 1.23, "rpm": None},
        )


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
        json={"operator_id": "op1", "plate_number": "XYZ999", "fuel_type": "DIESEL"},
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
