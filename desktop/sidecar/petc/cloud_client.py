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


# Keep legacy states during the cloud migration.  An unknown state is
# deliberately non-terminal: the sidecar must not print a CEC or stop polling
# merely because the cloud has introduced a state it does not yet understand.
SUBMISSION_SUCCESS_STATES = frozenset(("PASSED", "ACCEPTED"))
SUBMISSION_TERMINAL_STATES = frozenset((
    "PASSED", "ACCEPTED", "FAILED_EVALUATION", "ACTION_REQUIRED",
    "AUTH_BLOCKED", "DEAD", "REJECTED",
))
SUBMISSION_NONTERMINAL_STATES = frozenset((
    "PENDING", "IN_FLIGHT", "BLOCKED", "DEFERRED", "RECONCILING",
    "WAITING_FOR_LTMS",
))


class CloudUnavailableError(Exception):
    """Raised when the cloud URL is not configured."""


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
    # PASSED | FAILED_EVALUATION | ACTION_REQUIRED | DEFERRED |
    # AUTH_BLOCKED | RECONCILING, plus legacy ACCEPTED | REJECTED.
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
        return self.state in SUBMISSION_TERMINAL_STATES

    @property
    def is_success(self) -> bool:
        """Only successful terminal outcomes may produce or print a CEC."""
        return self.state in SUBMISSION_SUCCESS_STATES

    @property
    def is_known_nonterminal(self) -> bool:
        """Whether this state can safely be persisted and polled locally."""
        return self.state in SUBMISSION_NONTERMINAL_STATES


@dataclass
class BillingStatus:
    """Mode-aware center billing summary, as last seen from the cloud."""
    mode: str
    charge_per_upload_centavos: int
    balance_centavos: Optional[int] = None
    low: bool = False
    negative: bool = False
    blocked_count: int = 0
    current_usage_count: Optional[int] = None
    current_estimate_centavos: Optional[int] = None
    period_start: Optional[str] = None
    next_cutoff: Optional[str] = None
    open_total_centavos: Optional[int] = None
    past_due_total_centavos: Optional[int] = None
    past_due_invoice_count: Optional[int] = None


# Compatibility name retained for existing imports/tests.
WalletStatus = BillingStatus


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
        resp = self._post("/api/submissions", {
            "centerId": center_id,
            "testId": test_id,
            "payload": payload,
        })
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

    def get_wallet(self) -> "BillingStatus":
        """This center's mode-aware billing status. Cloud scopes it by API key."""
        with httpx.Client(timeout=self._timeout) as client:
            r = client.get(f"{self._base}/api/billing/me", headers=self._headers)
            r.raise_for_status()
            body = r.json()
        return BillingStatus(
            mode=body["mode"],
            charge_per_upload_centavos=body["chargePerUploadCentavos"],
            balance_centavos=body.get("balanceCentavos"),
            low=body.get("low") or False,
            negative=body.get("negative") or False,
            blocked_count=body.get("blockedCount") or 0,
            current_usage_count=body.get("currentUsageCount"),
            current_estimate_centavos=body.get("currentEstimateCentavos"),
            period_start=body.get("periodStart"),
            next_cutoff=body.get("nextCutoff"),
            open_total_centavos=body.get("openTotalCentavos"),
            past_due_total_centavos=body.get("pastDueTotalCentavos"),
            past_due_invoice_count=body.get("pastDueInvoiceCount"),
        )

    def create_topup(self, amount_centavos: int, client_request_id: str) -> dict:
        return self._post("/api/billing/me/topups", {
            "amountCentavos": amount_centavos,
            "clientRequestId": client_request_id,
        })

    def get_topup(self, topup_id: str) -> dict:
        return self._get(f"/api/billing/me/topups/{topup_id}")

    def get_invoices(self, limit: int = 20) -> list[dict]:
        return self._get(f"/api/billing/me/invoices?limit={max(1, min(limit, 100))}")

    def get_invoice(self, invoice_id: str) -> dict:
        return self._get(f"/api/billing/me/invoices/{invoice_id}")

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

    def _get(self, path: str):
        with httpx.Client(timeout=self._timeout) as client:
            r = client.get(f"{self._base}{path}", headers=self._headers)
            r.raise_for_status()
            return r.json()


def get_client() -> CloudClient:
    """
    Build a CloudClient from environment variables.
    Raises CloudUnavailableError if PETC_CLOUD_URL is not set.
    """
    url = os.environ.get("PETC_CLOUD_URL", "").strip()
    if not url:
        raise CloudUnavailableError(
            "PETC_CLOUD_URL is not set — cloud submission unavailable"
        )
    key = os.environ.get("PETC_CLOUD_KEY", "dev-insecure-key")
    return CloudClient(base_url=url, center_key=key)


def is_available() -> bool:
    """True when PETC_CLOUD_URL is configured."""
    return bool(os.environ.get("PETC_CLOUD_URL", "").strip())
