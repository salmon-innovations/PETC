import pytest
from fastapi.testclient import TestClient

from petc.analyzer.mock import MockAnalyzer
from petc.api.server import app, init
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
def wire_dependencies(tmp_path):
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


def test_start_and_get_result(client):
    start = client.post(
        "/test/start",
        json={"operator_id": "op1", "plate_number": "ABC123", "fuel_type": "GAS"},
    )
    assert start.status_code == 200
    token = start.json()["session_token"]

    result = client.get(f"/test/{token}/result")
    assert result.status_code == 200
    assert result.json()["pass_fail"] is True
    assert result.json()["fuel_type"] == "GAS"
    assert result.json()["test_id"]


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
        "centerId": "dev-center",
        "centerName": "PETC Center",
        "testId": test_id,
        "testDatetime": detail["testedAt"],
        "vehicle": {
            "plateNo": lookup["vehicle"]["plateNo"],
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

    submitted = client.post("/api/v1/upload/submit", json={"payload": payload})
    assert submitted.status_code == 200
    assert submitted.json()["state"] == "ACCEPTED"
    assert submitted.json()["certificateNo"].startswith("CERT-")


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
