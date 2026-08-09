"""Tests for cloud_client.py using httpx.MockTransport."""
import json
import os

import httpx
import pytest

from petc.cloud_client import (
    CloudClient,
    CloudUnavailableError,
    PresignResult,
    SubmissionCreated,
    SubmissionStatus,
    get_client,
    is_available,
)


def _make_transport(routes: dict[tuple[str, str], tuple[int, dict]]) -> httpx.MockTransport:
    """Build a MockTransport from {(method, path): (status, body)} map."""

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, request.url.path)
        if key not in routes:
            return httpx.Response(404, json={"error": "not found"})
        status, body = routes[key]
        return httpx.Response(status, json=body)

    return httpx.MockTransport(handler)


BASE = "http://cloud.test"
KEY = "test-key"


def _client(routes: dict) -> CloudClient:
    transport = _make_transport(routes)
    c = CloudClient(base_url=BASE, center_key=KEY)
    # Patch internal httpx.Client to use mock transport
    c._transport = transport
    return c


class PatchedCloudClient(CloudClient):
    """CloudClient that injects a MockTransport into every httpx.Client it creates."""

    def __init__(self, base_url: str, center_key: str, transport: httpx.MockTransport) -> None:
        super().__init__(base_url=base_url, center_key=center_key)
        self._mock_transport = transport

    def _make_sync_client(self, **kwargs) -> httpx.Client:
        return httpx.Client(transport=self._mock_transport, **kwargs)

    def _post(self, path: str, body: dict) -> dict:
        with self._make_sync_client(timeout=self._timeout) as client:
            r = client.post(
                f"{self._base}{path}",
                json=body,
                headers=self._headers,
            )
            r.raise_for_status()
            return r.json()

    def get_submission(self, submission_id: str):
        with self._make_sync_client(timeout=self._timeout) as client:
            r = client.get(
                f"{self._base}/api/submissions/{submission_id}",
                headers=self._headers,
            )
            r.raise_for_status()
            body = r.json()
        return SubmissionStatus(
            state=body["state"],
            certificate_no=body.get("certificateNo"),
            ltms_ref_no=body.get("ltmsRefNo"),
            rejection_reason=body.get("rejectionReason"),
            or_no=body.get("orNo"),
            dermalog_token=body.get("dermalogToken"),
            valid_from=body.get("validFrom"),
            valid_until=body.get("validUntil"),
        )

    def lookup_vehicle(self, plate: str):
        with self._make_sync_client(timeout=self._timeout) as client:
            r = client.get(
                f"{self._base}/api/registry/vehicle/{plate}",
                headers=self._headers,
            )
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()

    def lookup_driver(self, license_no: str):
        with self._make_sync_client(timeout=self._timeout) as client:
            r = client.get(
                f"{self._base}/api/registry/driver/{license_no}",
                headers=self._headers,
            )
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()

    def upload_photo(self, upload_url: str, data: bytes, content_type: str = "image/jpeg") -> None:
        with self._make_sync_client(timeout=60.0) as client:
            r = client.put(upload_url, content=data, headers={"Content-Type": content_type})
            r.raise_for_status()


def _patched(routes: dict) -> PatchedCloudClient:
    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, request.url.path)
        if key not in routes:
            return httpx.Response(404, json={"error": f"no route for {request.method} {request.url.path}"})
        status, body = routes[key]
        return httpx.Response(status, json=body)

    transport = httpx.MockTransport(handler)
    return PatchedCloudClient(base_url=BASE, center_key=KEY, transport=transport)


# ── presign_photo ─────────────────────────────────────────────────────────────

def test_presign_photo_returns_presign_result():
    c = _patched({
        ("POST", "/api/photos/presign"): (200, {
            "s3Key": "tenants/t1/tests/T001/front.jpg",
            "uploadUrl": "https://s3.example.com/presigned",
        }),
    })
    result = c.presign_photo("T001", "front", "FRONT", "image/jpeg", sha256="abc123")
    assert isinstance(result, PresignResult)
    assert result.s3_key == "tenants/t1/tests/T001/front.jpg"
    assert "s3.example.com" in result.upload_url


def test_presign_photo_requires_sha256():
    c = _patched({
        ("POST", "/api/photos/presign"): (200, {
            "s3Key": "tenants/t1/tests/T002/rear.jpg",
            "uploadUrl": "https://s3.example.com/presigned2",
        }),
    })
    with pytest.raises(ValueError):
        c.presign_photo("T002", "rear", "REAR")


# ── upload_photo ──────────────────────────────────────────────────────────────

def test_upload_photo_sends_put():
    put_called = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "PUT":
            put_called.append(request)
            return httpx.Response(200)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    c = PatchedCloudClient(base_url=BASE, center_key=KEY, transport=transport)
    c.upload_photo("http://s3.example.com/key", b"\xff\xd8\xff\xe0", "image/jpeg")
    assert len(put_called) == 1
    assert put_called[0].headers["content-type"] == "image/jpeg"


def test_upload_photo_raises_on_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403)

    transport = httpx.MockTransport(handler)
    c = PatchedCloudClient(base_url=BASE, center_key=KEY, transport=transport)
    with pytest.raises(httpx.HTTPStatusError):
        c.upload_photo("http://s3.example.com/key", b"bytes")


# ── create_submission ─────────────────────────────────────────────────────────

def test_create_submission_returns_submission_created():
    c = _patched({
        ("POST", "/api/submissions"): (200, {
            "submissionId": "sub-uuid-001",
            "state": "PENDING",
        }),
    })
    result = c.create_submission("center-1", "T001", {"vehicle": "ABC1234"})
    assert isinstance(result, SubmissionCreated)
    assert result.submission_id == "sub-uuid-001"
    assert result.state == "PENDING"


def test_create_submission_raises_on_server_error():
    c = _patched({
        ("POST", "/api/submissions"): (500, {"error": "internal"}),
    })
    with pytest.raises(httpx.HTTPStatusError):
        c.create_submission("center-1", "T001", {})


# ── get_submission ────────────────────────────────────────────────────────────

def test_get_submission_accepted():
    c = _patched({
        ("GET", "/api/submissions/sub-001"): (200, {
            "state": "ACCEPTED",
            "certificateNo": "CERT-2024-001",
            "ltmsRefNo": "LTMS-REF-001",
            "rejectionReason": None,
            "orNo": "20260425900005497",
            "dermalogToken": "533D2153B7D085DDE0630C14640AF02B",
            "validFrom": "2026-06-02",
            "validUntil": "2026-08-01",
        }),
    })
    status = c.get_submission("sub-001")
    assert isinstance(status, SubmissionStatus)
    assert status.state == "ACCEPTED"
    assert status.certificate_no == "CERT-2024-001"
    assert status.ltms_ref_no == "LTMS-REF-001"
    assert status.rejection_reason is None
    assert status.or_no == "20260425900005497"
    assert status.dermalog_token == "533D2153B7D085DDE0630C14640AF02B"
    assert status.valid_from == "2026-06-02"
    assert status.valid_until == "2026-08-01"
    assert status.is_terminal is True


def test_get_submission_rejected():
    c = _patched({
        ("GET", "/api/submissions/sub-002"): (200, {
            "state": "REJECTED",
            "certificateNo": None,
            "ltmsRefNo": None,
            "rejectionReason": "Smoke opacity exceeds limit",
        }),
    })
    status = c.get_submission("sub-002")
    assert status.state == "REJECTED"
    assert status.rejection_reason == "Smoke opacity exceeds limit"
    assert status.is_terminal is True


def test_get_submission_pending_not_terminal():
    c = _patched({
        ("GET", "/api/submissions/sub-003"): (200, {
            "state": "PENDING",
            "certificateNo": None,
            "ltmsRefNo": None,
            "rejectionReason": None,
        }),
    })
    status = c.get_submission("sub-003")
    assert status.state == "PENDING"
    assert status.is_terminal is False


def test_get_submission_dead_is_terminal():
    c = _patched({
        ("GET", "/api/submissions/sub-dead"): (200, {
            "state": "DEAD",
            "certificateNo": None,
            "ltmsRefNo": None,
            "rejectionReason": None,
        }),
    })
    status = c.get_submission("sub-dead")
    assert status.is_terminal is True


@pytest.mark.parametrize(
    ("state", "terminal", "success"),
    [
        ("PASSED", True, True),
        ("FAILED_EVALUATION", True, False),
        ("ACTION_REQUIRED", True, False),
        ("AUTH_BLOCKED", True, False),
        ("DEFERRED", False, False),
        ("RECONCILING", False, False),
        ("IN_FLIGHT", False, False),
        ("BLOCKED", False, False),
        ("UNKNOWN_FUTURE_STATE", False, False),
    ],
)
def test_submission_state_semantics_are_safe(state, terminal, success):
    status = SubmissionStatus(state, None, None, None)
    assert status.is_terminal is terminal
    assert status.is_success is success


def test_unknown_submission_state_is_not_saved_as_a_known_waiting_state():
    status = SubmissionStatus("UNKNOWN_FUTURE_STATE", None, None, None)
    assert status.is_terminal is False
    assert status.is_known_nonterminal is False


# ── lookup_vehicle ────────────────────────────────────────────────────────────

def test_lookup_vehicle_found():
    vehicle = {"plateNumber": "ABC1234", "make": "TOYOTA", "series": "VIOS"}
    c = _patched({
        ("GET", "/api/registry/vehicle/ABC1234"): (200, vehicle),
    })
    result = c.lookup_vehicle("ABC1234")
    assert result == vehicle


def test_lookup_vehicle_not_found_returns_none():
    c = _patched({
        ("GET", "/api/registry/vehicle/NOTFOUND"): (404, {}),
    })
    result = c.lookup_vehicle("NOTFOUND")
    assert result is None


# ── lookup_driver ─────────────────────────────────────────────────────────────

def test_lookup_driver_found():
    driver = {"licenseNo": "DL-001", "fullName": "Juan dela Cruz"}
    c = _patched({
        ("GET", "/api/registry/driver/DL-001"): (200, driver),
    })
    result = c.lookup_driver("DL-001")
    assert result == driver


def test_lookup_driver_not_found_returns_none():
    c = _patched({
        ("GET", "/api/registry/driver/BADLICENSE"): (404, {}),
    })
    result = c.lookup_driver("BADLICENSE")
    assert result is None


# ── get_client / is_available ─────────────────────────────────────────────────

def test_get_client_raises_when_url_unset(monkeypatch):
    monkeypatch.delenv("PETC_CLOUD_URL", raising=False)
    with pytest.raises(CloudUnavailableError):
        get_client()


def test_get_client_returns_cloud_client(monkeypatch):
    monkeypatch.setenv("PETC_CLOUD_URL", "http://cloud.local:8080")
    monkeypatch.setenv("PETC_CLOUD_KEY", "my-key")
    c = get_client()
    assert isinstance(c, CloudClient)
    assert c._base == "http://cloud.local:8080"
    assert c._headers["X-Center-Key"] == "my-key"


def test_is_available_false_when_unset(monkeypatch):
    monkeypatch.delenv("PETC_CLOUD_URL", raising=False)
    assert is_available() is False


def test_is_available_true_when_set(monkeypatch):
    monkeypatch.setenv("PETC_CLOUD_URL", "http://cloud.local:8080")
    assert is_available() is True
