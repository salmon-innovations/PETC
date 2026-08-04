"""
Digiflash cloud client — submission and photo presign calls.

Used by the sidecar's upload route to:
  1. Presign + upload photos to S3 before submission.
  2. POST a test bundle to /api/submissions for cloud-side LTMS processing.
  3. Poll /api/submissions/{id} for the LTMS result.

All outbound calls go through the AWS NAT gateway; the desktop never
contacts LTMS / IRDS directly.

When PETC_CLOUD_URL is unset the module raises CloudUnavailableError on
any call — callers should fall back to the local mock gov client instead.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import httpx


# Set once by the sidecar after it loads petc.properties.  The legacy
# environment lookup below is retained only for unit-test/dev invocation of
# this module; the packaged service never supplies cloud identity by env var.
_configured_identity: tuple[str, str] | None = None


def configure_identity(cloud_url: str, cloud_key: str) -> None:
    global _configured_identity
    _configured_identity = (cloud_url.rstrip("/"), cloud_key)


def clear_configured_identity() -> None:
    """Test helper; production callers should configure rather than clear."""
    global _configured_identity
    _configured_identity = None


class CloudUnavailableError(Exception):
    """Raised when the cloud URL is not configured."""


class DailyUploadLimitError(Exception):
    """The lane has no remaining capacity for a new test/CEC today."""

    def __init__(self, detail: str, quota: Optional["LaneQuota"] = None) -> None:
        super().__init__(detail)
        self.quota = quota


@dataclass
class PresignResult:
    s3_key: str
    upload_url: str


@dataclass
class SubmissionCreated:
    submission_id: str
    state: str


@dataclass
class SubmissionStatus:
    # PENDING | IN_FLIGHT | BLOCKED | ACCEPTED | REJECTED | DEAD
    state: str
    certificate_no: Optional[str]
    ltms_ref_no: Optional[str]
    rejection_reason: Optional[str]
    or_no: Optional[str] = None
    dermalog_token: Optional[str] = None
    valid_from: Optional[str] = None    # ISO date string
    valid_until: Optional[str] = None   # ISO date string

    @property
    def is_terminal(self) -> bool:
        # BLOCKED is deliberately NOT terminal: the cloud is holding the filing
        # for want of wallet funds and will dispatch it on top-up or on grace
        # expiry, so the reconciler must keep polling it.
        return self.state in ("ACCEPTED", "REJECTED", "DEAD")


@dataclass
class WalletStatus:
    """This center's prepaid balance, as last seen from the cloud."""
    tenant_id: str
    balance_centavos: int
    low: bool
    negative: bool
    blocked_count: int
    charge_per_upload_centavos: int
    low_balance_threshold_centavos: int
    pricing_updated_at: Optional[str]


@dataclass
class LaneProfile:
    """The center/lane identity bound to this desktop credential."""
    tenant_id: str
    # A tenant is the authorization/billing boundary; centerId is the issued
    # operational center identifier printed in CEC-facing payloads.
    center_id: Optional[str]
    center_name: Optional[str]
    lane_id: str
    lane_number: int
    active: bool = True


@dataclass
class LaneQuota:
    """Cloud-authoritative daily lane capacity (Asia/Manila business day)."""
    used: int
    reserved: int
    limit: int
    remaining: int
    business_date: str
    resets_at: Optional[str]


class CloudClient:
    """Thin HTTP client for the Digiflash cloud API."""

    def __init__(
        self,
        base_url: str,
        center_key: str,
        timeout: float = 15.0,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._headers = {"X-Center-Key": center_key}
        self._timeout = timeout

    # ── photos ────────────────────────────────────────────────────────────

    def presign_photo(
        self,
        test_id: str,
        photo_id: str,
        photo_type: str,
        content_type: str = "image/jpeg",
        sha256: Optional[str] = None,
    ) -> PresignResult:
        """Request a presigned S3 PUT URL for one photo."""
        if not sha256:
            raise ValueError("sha256 is required for DO 2023-008 photo upload evidence")
        resp = self._post("/api/photos/presign", {
            "testId": test_id,
            "photoId": photo_id,
            "photoType": photo_type,
            "contentType": content_type,
            "sha256": sha256,
        })
        return PresignResult(s3_key=resp["s3Key"], upload_url=resp["uploadUrl"])

    def upload_photo(self, upload_url: str, data: bytes, content_type: str = "image/jpeg") -> None:
        """PUT photo bytes directly to S3 using the presigned URL."""
        with httpx.Client(timeout=60.0) as client:
            r = client.put(upload_url, content=data, headers={"Content-Type": content_type})
            r.raise_for_status()

    # ── submissions ───────────────────────────────────────────────────────

    def create_submission(self, center_id: str, test_id: str, payload: dict) -> SubmissionCreated:
        """Enqueue the test bundle for cloud-side LTMS submission."""
        # The authenticated lane credential is authoritative.  centerId is
        # retained only for pre-lane cloud compatibility and omitted for a
        # lane-aware installation.
        body = {
            "testId": test_id,
            "payload": payload,
        }
        if center_id:
            body["centerId"] = center_id
        try:
            resp = self._post("/api/submissions", body)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code not in (409, 422, 429):
                raise
            try:
                error = exc.response.json()
            except ValueError:
                error = {}
            if error.get("code") != "LANE_DAILY_UPLOAD_LIMIT_REACHED":
                raise
            quota_data = error.get("quota") or error
            quota = _lane_quota_from_body(quota_data) if quota_data else None
            raise DailyUploadLimitError(
                error.get("message") or "This lane has reached its daily upload limit.", quota
            ) from exc
        return SubmissionCreated(
            submission_id=resp["submissionId"],
            state=resp["state"],
        )

    def get_submission(self, submission_id: str) -> SubmissionStatus:
        """Poll the current state of a queued submission."""
        with httpx.Client(timeout=self._timeout) as client:
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

    # ── wallet ───────────────────────────────────────────────────────────

    def get_wallet(self) -> "WalletStatus":
        """This center's prepaid balance. The cloud scopes it by our API key."""
        with httpx.Client(timeout=self._timeout) as client:
            r = client.get(f"{self._base}/api/wallet/me", headers=self._headers)
            r.raise_for_status()
            body = r.json()
        return WalletStatus(
            tenant_id=body["tenantId"],
            balance_centavos=body["balanceCentavos"],
            low=body["low"],
            negative=body["negative"],
            blocked_count=body["blockedCount"],
            charge_per_upload_centavos=body["chargePerUploadCentavos"],
            low_balance_threshold_centavos=body["lowBalanceThresholdCentavos"],
            pricing_updated_at=body.get("pricingUpdatedAt"),
        )

    # ── lane identity and daily capacity ─────────────────────────────────

    def get_lane_profile(self) -> LaneProfile:
        """Authenticated center/lane identity for this desktop installation."""
        with httpx.Client(timeout=self._timeout) as client:
            r = client.get(f"{self._base}/api/lanes/me", headers=self._headers)
            r.raise_for_status()
            body = r.json()
        return LaneProfile(
            tenant_id=body["tenantId"],
            center_id=body.get("centerId"),
            center_name=body.get("centerName"),
            lane_id=body["laneId"],
            lane_number=int(body["laneNumber"]),
            active=body.get("active", True),
        )

    def get_lane_quota(self) -> LaneQuota:
        """Today's capacity after accepted CECs and active reservations."""
        with httpx.Client(timeout=self._timeout) as client:
            r = client.get(f"{self._base}/api/lanes/me/quota", headers=self._headers)
            r.raise_for_status()
            body = r.json()
        return _lane_quota_from_body(body)

    # ── registry ─────────────────────────────────────────────────────────

    def lookup_vehicle(self, plate: str) -> Optional[dict]:
        """Returns vehicle dict or None if not found."""
        with httpx.Client(timeout=self._timeout) as client:
            r = client.get(
                f"{self._base}/api/registry/vehicle/{plate}",
                headers=self._headers,
            )
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()

    def lookup_driver(self, license_no: str) -> Optional[dict]:
        """Returns driver dict or None if not found."""
        with httpx.Client(timeout=self._timeout) as client:
            r = client.get(
                f"{self._base}/api/registry/driver/{license_no}",
                headers=self._headers,
            )
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()

    # ── internal ─────────────────────────────────────────────────────────

    def _post(self, path: str, body: dict) -> dict:
        with httpx.Client(timeout=self._timeout) as client:
            r = client.post(
                f"{self._base}{path}",
                json=body,
                headers=self._headers,
            )
            r.raise_for_status()
            return r.json()


def get_client() -> CloudClient:
    """
    Build a CloudClient from environment variables.
    Raises CloudUnavailableError if PETC_CLOUD_URL is not set.
    """
    if _configured_identity is not None:
        url, key = _configured_identity
        if not url or not key:
            raise CloudUnavailableError("PETC commissioning is required")
        return CloudClient(base_url=url, center_key=key)
    url = os.environ.get("PETC_CLOUD_URL", "").strip()
    if not url:
        raise CloudUnavailableError(
            "PETC_CLOUD_URL is not set — cloud submission unavailable"
        )
    key = os.environ.get("PETC_CLOUD_KEY", "dev-insecure-key")
    return CloudClient(base_url=url, center_key=key)


def is_available() -> bool:
    """True when PETC_CLOUD_URL is configured."""
    if _configured_identity is not None:
        return bool(_configured_identity[0] and _configured_identity[1])
    return bool(os.environ.get("PETC_CLOUD_URL", "").strip())


def _lane_quota_from_body(body: dict) -> LaneQuota:
    """Accept both the new reservation-aware shape and older quota payloads."""
    used = int(body.get("used", body.get("accepted", 0)))
    reserved = int(body.get("reserved", 0))
    limit = int(body["limit"])
    # The server's remaining value is already after reservations.  Older
    # servers did not expose it, so calculate the conservative equivalent.
    remaining = int(body.get("remaining", max(0, limit - used - reserved)))
    return LaneQuota(
        used=used,
        reserved=reserved,
        limit=limit,
        remaining=remaining,
        business_date=body.get("businessDate", ""),
        resets_at=body.get("resetsAt"),
    )
