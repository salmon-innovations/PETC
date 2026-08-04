import pytest
from datetime import datetime, timedelta, timezone
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
def wire_dependencies(tmp_path, monkeypatch):
    monkeypatch.setenv("PETC_PROFILE", "dev")
    # This suite exercises local analyzer/API behavior. Commissioning is
    # covered separately and the shipped app never sets this test-only flag.
    monkeypatch.setenv("PETC_TEST_ALLOW_UNCONFIGURED", "1")
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


def test_commissioning_rejects_calls_without_electron_capability(client):
    response = client.post("/commissioning/validate", json={
        "cloud_url": "http://cloud.test", "cloud_key": "issued-key",
        "expected_center": "CENTER-1", "expected_lane": "1",
    })
    assert response.status_code == 403


def test_reconfiguration_requires_manager_but_initial_commissioning_does_not(client, monkeypatch, tmp_path):
    from petc.config import write_config
    from petc.api import server
    monkeypatch.setenv("PETC_COMMISSIONING_TOKEN", "capability")
    monkeypatch.setenv("PETC_CONFIG_PATH", str(tmp_path / "missing.properties"))
    headers = {"X-PETC-Commissioning-Token": "capability"}
    body = {"cloud_url": "http://cloud.test", "cloud_key": "issued-key", "expected_center": "CENTER-1", "expected_lane": "1"}
    # It reaches live validation (503), rather than an authorization denial.
    assert client.post("/commissioning/validate", json=body, headers=headers).status_code == 503
    config_path = tmp_path / "configured.properties"
    write_config(cloud_url="http://cloud.test", cloud_key="issued-key", expected_center="CENTER-1", expected_lane=1, profile="dev", path=config_path)
    monkeypatch.setenv("PETC_CONFIG_PATH", str(config_path))
    from petc.submissions import reconciler
    monkeypatch.setattr(reconciler, "get_cached_lane_status", lambda: {"center_id": "CENTER-1", "lane_number": 1, "active": True, "identity_conflict": False})
    server._local_sessions["operator-token"] = "operator"
    denied = client.post("/commissioning/validate", json=body, headers={**headers, "Authorization": "Bearer operator-token"})
    assert denied.status_code == 403
    server._local_sessions["manager-token"] = "manager"
    allowed = client.post("/commissioning/validate", json=body, headers={**headers, "Authorization": "Bearer manager-token"})
    assert allowed.status_code == 503


def test_restart_does_not_submit_previous_manila_day(client):
    from petc.db.models import EmissionTest, LtmsSubmission, User
    from petc.db.session import SessionLocal
    from petc.submissions.reconciler import SubmissionReconciler
    old = datetime.now(timezone.utc) - timedelta(days=1)
    with SessionLocal() as session:
        session.add(User(id="op1", email="op1@test", password_hash="x", full_name="Operator", role="operator"))
        session.flush()
        test = EmissionTest(id="old-test", operator_id="op1", plate_number="OLD123", fuel_type="GAS", session_token="old", tested_at=old)
        session.add(test)
        session.add(LtmsSubmission(id="old-sub", test_id="old-test", payload_json="{}", state="PENDING"))
        session.commit()

    class NoCloud:
        def presign_photo(self, *args):
            raise AssertionError("expired work must never call cloud")

    SubmissionReconciler()._dispatch_pending(NoCloud(), "old-sub")
    with SessionLocal() as session:
        assert session.get(LtmsSubmission, "old-sub").state == "EXPIRED"


def test_restart_expires_previous_day_foreign_lane_cloud_submission_without_poll(client, monkeypatch):
    from petc.db.models import EmissionTest, LtmsSubmission, User
    from petc.db.session import SessionLocal
    from petc.submissions import reconciler
    from petc.submissions.reconciler import SubmissionReconciler
    old = datetime.now(timezone.utc) - timedelta(days=1)
    with SessionLocal() as session:
        session.add(User(id="op-old", email="old@test", password_hash="x", full_name="Operator", role="operator")); session.flush()
        session.add(EmissionTest(id="foreign-test", operator_id="op-old", plate_number="OLD999", fuel_type="GAS", session_token="old", lane_id="old-lane", center_id="old-center", tested_at=old))
        session.add(LtmsSubmission(id="foreign-sub", test_id="foreign-test", state="WAITING_FOR_LTMS", cloud_submission_id="foreign-cloud"))
        session.commit()
    monkeypatch.setattr(reconciler, "get_cached_lane_status", lambda: {"lane_id": "new-lane", "center_id": "new-center"})
    class NoPoll:
        def get_submission(self, _id): raise AssertionError("expired foreign work must not be polled")
    SubmissionReconciler()._reconcile_once(NoPoll())
    with SessionLocal() as session:
        assert session.get(LtmsSubmission, "foreign-sub").state == "EXPIRED"


def test_conflict_cache_expires_prior_day_old_lane_without_poll(client, monkeypatch):
    """Exercise the real retained-old-cache credential-change path."""
    from petc.cloud_client import LaneProfile, LaneQuota
    from petc.db.models import EmissionTest, LtmsSubmission, User
    from petc.db.session import SessionLocal
    from petc.submissions import reconciler
    from petc.submissions.reconciler import SubmissionReconciler
    with SessionLocal() as session:
        session.add(User(id="op-conflict", email="conflict@test", password_hash="x", full_name="Operator", role="operator")); session.flush()
        session.add(EmissionTest(id="conflict-test", operator_id="op-conflict", plate_number="OLD111", fuel_type="GAS", session_token="old", lane_id="old-lane", center_id="old-center", tested_at=datetime.now(timezone.utc) - timedelta(days=1)))
        session.add(LtmsSubmission(id="conflict-sub", test_id="conflict-test", state="WAITING_FOR_LTMS", cloud_submission_id="old-cloud"))
        session.commit()
    monkeypatch.setattr(reconciler, "_lane_cache", {"lane_id": "old-lane", "center_id": "old-center", "active": True})
    reconciler._store_lane_status(
        LaneProfile(tenant_id="new-center", center_id="new-center", center_name="New", lane_id="new-lane", lane_number=1),
        LaneQuota(used=0, reserved=0, limit=80, remaining=80, business_date=datetime.now().date().isoformat(), resets_at=None),
    )
    class NoPoll:
        def get_submission(self, _id): raise AssertionError("expired conflict work must not be polled")
    SubmissionReconciler()._reconcile_once(NoPoll())
    with SessionLocal() as session:
        assert session.get(LtmsSubmission, "conflict-sub").state == "EXPIRED"


def test_same_day_foreign_lane_cloud_submission_remains_for_manual_recovery(client, monkeypatch):
    from petc.db.models import EmissionTest, LtmsSubmission, User
    from petc.db.session import SessionLocal
    from petc.submissions import reconciler
    from petc.submissions.reconciler import SubmissionReconciler
    with SessionLocal() as session:
        session.add(User(id="op-today", email="today@test", password_hash="x", full_name="Operator", role="operator")); session.flush()
        session.add(EmissionTest(id="today-test", operator_id="op-today", plate_number="TODAY1", fuel_type="GAS", session_token="today", lane_id="old-lane", center_id="old-center", tested_at=datetime.now(timezone.utc)))
        session.add(LtmsSubmission(id="today-sub", test_id="today-test", state="WAITING_FOR_LTMS", cloud_submission_id="foreign-cloud"))
        session.commit()
    monkeypatch.setattr(reconciler, "get_cached_lane_status", lambda: {"lane_id": "new-lane", "center_id": "new-center"})
    assert SubmissionReconciler()._expire_previous_day_other_lane("today-sub") is False
    with SessionLocal() as session:
        assert session.get(LtmsSubmission, "today-sub").state == "WAITING_FOR_LTMS"


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


def test_start_is_blocked_when_current_lane_has_no_remaining_capacity(client, monkeypatch):
    from petc.submissions import reconciler

    monkeypatch.setattr(reconciler, "get_cached_lane_status", lambda: {
        "tenant_id": "center-1", "lane_id": "lane-1", "lane_number": 1,
        "active": True, "used": 78, "reserved": 2, "limit": 80,
        "remaining": 0, "business_date": datetime.now().date().isoformat(),
        "resets_at": "2026-08-04T00:00:00+08:00",
    })
    response = client.post("/test/start", json={
        "operator_id": "op1", "plate_number": "CAP123", "fuel_type": "GAS",
    })

    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "LANE_DAILY_UPLOAD_LIMIT_REACHED"
    assert response.json()["detail"]["reserved"] == 2


def test_start_snapshots_authenticated_lane_on_local_test(client, monkeypatch):
    from petc.db.models import EmissionTest
    from petc.db.session import SessionLocal
    from petc.submissions import reconciler

    monkeypatch.setattr(reconciler, "get_cached_lane_status", lambda: {
        "tenant_id": "tenant-1", "center_id": "center-1", "lane_id": "lane-2", "lane_number": 2,
        "active": True, "used": 12, "reserved": 1, "limit": 80,
        "remaining": 67, "business_date": datetime.now().date().isoformat(),
    })
    response = client.post("/test/start", json={
        "operator_id": "op1", "plate_number": "LANE123", "fuel_type": "GAS",
    })
    assert response.status_code == 200
    with SessionLocal() as session:
        test = session.get(EmissionTest, response.json()["test_id"])
        assert (test.center_id, test.lane_id, test.lane_number) == ("center-1", "lane-2", 2)


def test_submission_payload_identity_is_replaced_with_lane_profile():
    from petc.api.server import _apply_authoritative_lane_identity

    payload = _apply_authoritative_lane_identity({
        "centerId": "dev-center", "centerName": "PETC Center", "testId": "test-1",
    }, {
        "tenant_id": "tenant-1", "center_id": "center-1", "center_name": "Makati PETC",
        "lane_id": "lane-2", "lane_number": 2,
    })

    assert payload["centerId"] == "center-1"
    assert payload["centerName"] == "Makati PETC"
    assert payload["laneId"] == "lane-2"
    assert payload["laneNumber"] == 2


def test_production_requires_current_lane_quota_before_start(client, monkeypatch):
    from petc.submissions import reconciler

    monkeypatch.setenv("PETC_PROFILE", "production")
    monkeypatch.setattr(reconciler, "get_cached_lane_status", lambda: None)
    response = client.post("/test/start", json={
        "operator_id": "op1", "plate_number": "NOQUOTA", "fuel_type": "GAS",
    })
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "LANE_QUOTA_UNAVAILABLE"


def test_upload_rejects_test_from_a_prior_manila_date(client):
    from petc.db.models import EmissionTest
    from petc.db.session import SessionLocal

    start = client.post("/test/start", json={
        "operator_id": "op1", "plate_number": "LATE123", "fuel_type": "GAS",
    })
    token = start.json()["session_token"]
    test_id = client.get(f"/test/{token}/result").json()["test_id"]
    with SessionLocal() as session:
        test = session.get(EmissionTest, test_id)
        test.tested_at = datetime.now(timezone.utc) - timedelta(days=1)
        session.commit()

    response = client.post("/api/v1/upload/submit", json={"payload": {"testId": test_id}})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "LATE_TEST_SUBMISSION_NOT_ALLOWED"


def test_test_datetime_is_explicit_utc_at_manila_midnight_boundary(client):
    from petc.db.models import EmissionTest
    from petc.db.session import SessionLocal

    start = client.post("/test/start", json={
        "operator_id": "op1", "plate_number": "TZ1234", "fuel_type": "GAS",
    })
    test_id = start.json()["test_id"]
    # 00:30 in Manila on 4 Aug, but still 3 Aug in UTC. A naive value would
    # otherwise be incorrectly interpreted as 16:30 Manila by the cloud.
    with SessionLocal() as session:
        test = session.get(EmissionTest, test_id)
        test.tested_at = datetime(2026, 8, 3, 16, 30)  # SQLite's naive UTC form
        session.commit()

    detail = client.get(f"/tests/{test_id}").json()
    assert detail["testedAt"] == "2026-08-03T16:30:00+00:00"


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


def test_cloud_upload_waits_for_acceptance_and_makes_cec_available(client, monkeypatch):
    """The normal cloud path must preserve the preview-first operator flow."""
    from petc import cloud_client as cc
    from petc.api import server
    from petc.cloud_client import PresignResult, SubmissionCreated, SubmissionStatus

    start = client.post(
        "/test/start",
        json={"operator_id": "op1", "plate_number": "SYNC123", "fuel_type": "GAS"},
    )
    token = start.json()["session_token"]
    result = client.get(f"/test/{token}/result").json()
    test_id = result["test_id"]
    client.post("/camera/capture", json={"test_id": test_id, "photo_type": "FRONT"})
    client.post("/camera/capture", json={"test_id": test_id, "photo_type": "REAR"})
    detail = client.get(f"/tests/{test_id}").json()
    lookup = client.post("/api/v1/vehicle/lookup", json={"plate": "SYNC123"}).json()
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

    class AcceptingCloud:
        def __init__(self):
            self.polls = 0

        def presign_photo(self, _test_id, photo_id, _photo_type, _mime_type, _sha256):
            return PresignResult(s3_key=f"mock/{photo_id}.jpg", upload_url="https://upload.invalid")

        def upload_photo(self, _upload_url, _data, _mime_type):
            return None

        def create_submission(self, _center_id, _test_id, _payload):
            return SubmissionCreated(submission_id="cloud-submission-1", state="PENDING")

        def get_submission(self, _submission_id):
            self.polls += 1
            if self.polls == 1:
                return SubmissionStatus("IN_FLIGHT", None, None, None)
            return SubmissionStatus(
                "ACCEPTED", "CERT-SYNC123", None, None,
                or_no="20260000000000001", dermalog_token="A" * 32,
                valid_from="2026-08-04", valid_until="2026-10-03",
            )

    cloud = AcceptingCloud()
    monkeypatch.setattr(cc, "is_available", lambda: True)
    monkeypatch.setattr(cc, "get_client", lambda: cloud)
    monkeypatch.setattr(server, "_FOREGROUND_SUBMISSION_POLL_S", 0)

    submitted = client.post("/api/v1/upload/submit", json={"payload": payload})

    assert submitted.status_code == 200
    assert submitted.json()["state"] == "ACCEPTED"
    assert submitted.json()["certificateNo"] == "CERT-SYNC123"
    assert submitted.json()["queued"] is False
    assert cloud.polls == 2
    pdf = client.get(f"/api/v1/cec/{submitted.json()['submissionId']}/pdf")
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"


def test_cloud_upload_timeout_returns_waiting_without_losing_durable_row(client, monkeypatch):
    from petc.api import server
    from petc.cloud_client import SubmissionCreated, SubmissionStatus
    from petc.db.models import EmissionTest, LtmsSubmission, User
    from petc.db.session import SessionLocal

    with SessionLocal() as session:
        session.add(User(id="op-wait", email="wait@test", password_hash="x", full_name="Operator", role="operator"))
        session.flush()
        session.add(EmissionTest(
            id="wait-test", operator_id="op-wait", plate_number="WAIT123",
            fuel_type="GAS", session_token="wait", tested_at=datetime.now(timezone.utc),
        ))
        session.add(LtmsSubmission(
            id="wait-sub", test_id="wait-test", payload_json="{}",
            state="PENDING", submitted_at=datetime.now(timezone.utc),
        ))
        session.commit()

    class PendingCloud:
        def create_submission(self, _center_id, _test_id, _payload):
            return SubmissionCreated(submission_id="cloud-wait", state="PENDING")

        def get_submission(self, _submission_id):
            return SubmissionStatus("PENDING", None, None, None)

    monkeypatch.setattr(server, "_FOREGROUND_SUBMISSION_TIMEOUT_S", 0)
    response = server._dispatch_and_wait_for_cloud("wait-sub", PendingCloud())

    assert response["state"] == "WAITING_FOR_LTMS"
    assert response["queued"] is True
    with SessionLocal() as session:
        row = session.get(LtmsSubmission, "wait-sub")
        assert row.state == "WAITING_FOR_LTMS"
        assert row.cloud_submission_id == "cloud-wait"


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
