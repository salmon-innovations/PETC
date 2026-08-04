"""
FastAPI server bound to 127.0.0.1 only.
The Electron renderer talks to the sidecar through these endpoints via IPC-resolved URL.
"""
from __future__ import annotations

import logging
import os
import uuid
import json
import hashlib
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

import uvicorn
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ..analyzer.base import Analyzer, AnalyzerConnectionError, AnalyzerTimeoutError, FuelType
from ..camera.capture import CameraCapture, CaptureError
from ..printer.base import Printer, ReceiptData
from ..gov.base import GovRegistryClient
from ..cloud_sync.pusher import CloudSyncPusher
from ..runtime import (
    FAILED_RETEST_LOCK_SECONDS,
    IMAGE_UPLOAD_GRACE_SECONDS,
    READING_CAPTURE_TIMEOUT_SECONDS,
    REPRINT_WINDOW_DAYS,
    allow_mock_paths,
    is_production,
)

logger = logging.getLogger(__name__)

app = FastAPI(title="PETC Sidecar", version="0.1.0")

# Keep the operator on the submission screen for the normal LTMS round-trip.
# Durable background recovery remains authoritative after this bounded wait.
_FOREGROUND_SUBMISSION_TIMEOUT_S = 60.0
_FOREGROUND_SUBMISSION_POLL_S = 1.0

# Renderer runs on a Vite dev server in dev, or as a file:// page in prod.
# In both cases requests to 127.0.0.1 originate from localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Dependency container — populated by service.py at startup.
# ---------------------------------------------------------------------------
_analyzer: Optional[Analyzer] = None
_camera: Optional[CameraCapture] = None
_printer: Optional[Printer] = None
_gov: Optional[GovRegistryClient] = None
_cloud_sync: Optional[CloudSyncPusher] = None
_local_sessions: dict[str, str] = {}


def init(
    analyzer: Analyzer,
    camera: CameraCapture,
    printer: Printer,
    gov: GovRegistryClient,
    cloud_sync: CloudSyncPusher,
) -> None:
    global _analyzer, _camera, _printer, _gov, _cloud_sync
    _analyzer = analyzer
    _camera = camera
    _printer = printer
    _gov = gov
    _cloud_sync = cloud_sync


def _get_analyzer() -> Analyzer:
    if _analyzer is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Analyzer not initialised")
    return _analyzer


def _get_gov() -> GovRegistryClient:
    if _gov is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gov client not initialised")
    return _gov


def _get_cloud_sync() -> CloudSyncPusher:
    if _cloud_sync is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Cloud sync not initialised")
    return _cloud_sync


def _get_camera() -> CameraCapture:
    if _camera is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Camera not initialised")
    return _camera


def _get_printer() -> Printer:
    if _printer is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Printer not initialised")
    return _printer


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
class StartTestRequest(BaseModel):
    operator_id: str
    plate_number: str
    fuel_type: str  # "GAS" | "DIESEL"


class StartTestResponse(BaseModel):
    test_id: str
    session_token: str
    started_at: str


class TestResultResponse(BaseModel):
    test_id: str
    session_token: str
    pass_fail: Optional[bool]
    fuel_type: str
    readings: dict
    captured_at: str


class CapturePhotoRequest(BaseModel):
    test_id: Optional[str] = None
    photo_type: str = "OTHER"


class PrintRequest(BaseModel):
    test_id: str
    plate_number: str
    vehicle_make: str
    vehicle_model: str
    year: int
    fuel_type: str
    pass_fail: bool
    operator_name: str
    center_name: str
    copies: int = 2


class StatusResponse(BaseModel):
    analyzer_connected: bool
    printer_status: dict
    cloud_outbox_pending: int
    agent_version: str
    # Wallet fields are None until the cloud has answered at least once — in
    # local-mock mode (no PETC_CLOUD_URL) they stay None forever, and the UI
    # simply omits the balance rather than showing a misleading zero.
    wallet_balance_centavos: Optional[int] = None
    wallet_low: bool = False
    wallet_negative: bool = False
    wallet_blocked_count: int = 0
    wallet_fetched_at: Optional[datetime] = None
    wallet_center_id: Optional[str] = None
    wallet_charge_per_upload_centavos: Optional[int] = None
    wallet_low_balance_threshold_centavos: Optional[int] = None
    wallet_pricing_updated_at: Optional[datetime] = None
    center_id: Optional[str] = None
    center_name: Optional[str] = None
    lane_id: Optional[str] = None
    lane_number: Optional[int] = None
    lane_active: Optional[bool] = None
    lane_identity_conflict: bool = False
    lane_quota_used: Optional[int] = None
    lane_quota_reserved: Optional[int] = None
    lane_quota_limit: Optional[int] = None
    lane_quota_remaining: Optional[int] = None
    lane_quota_business_date: Optional[str] = None
    lane_quota_resets_at: Optional[str] = None
    lane_quota_fetched_at: Optional[datetime] = None
    configured: bool = False
    commissioning_required: bool = True
    config: dict = {}
    readiness_ready: bool = False
    readiness_reason: str = "PETC commissioning is required"


class CommissioningRequest(BaseModel):
    cloud_url: str
    cloud_key: str
    expected_center: str
    expected_lane: str
    confirmed: bool = False


def _require_commissioning_capability(
    token: Optional[str] = Header(None, alias="X-PETC-Commissioning-Token"),
    authorization: Optional[str] = Header(None),
) -> None:
    expected = os.environ.get("PETC_COMMISSIONING_TOKEN", "")
    if not expected or not token or not secrets.compare_digest(expected, token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Commissioning is available only from PETC Desktop")
    if _commissioning_verified():
        bearer = authorization.removeprefix("Bearer ").strip() if authorization else ""
        if _local_sessions.get(bearer) not in {"manager", "tenant_admin"}:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Cloud reconfiguration requires a local manager or tenant administrator session")


def _commissioning_verified() -> bool:
    """Properties become commissioned only after an authoritative match."""
    from ..config import ConfigError, load_config
    from ..submissions.reconciler import get_cached_lane_status
    try:
        config = load_config()
    except ConfigError:
        return False
    lane = get_cached_lane_status()
    return bool(lane and lane.get("active") is True and _trusted_center_id(lane) == config.expected_center and lane.get("lane_number") == config.expected_lane and not lane.get("identity_conflict"))


class VehicleLookupRequest(BaseModel):
    plate: str


class UploadSubmitRequest(BaseModel):
    payload: dict


# ---------------------------------------------------------------------------
# Schema — auth
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: str
    password: str

class LoginResponse(BaseModel):
    token: str
    user: dict


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> dict:
    return {"status": "ok", "ts": datetime.now(timezone.utc).isoformat()}


def _commissioning_check(config) -> dict:
    """Contact each authoritative endpoint once without exposing the key."""
    from ..cloud_client import CloudClient

    cloud = CloudClient(config.cloud_url, config.cloud_key)
    profile = cloud.get_lane_profile()
    wallet = cloud.get_wallet()
    quota = cloud.get_lane_quota()
    center = profile.center_id or profile.tenant_id
    lane_matches = config.expected_lane == profile.lane_number
    identity_matches = center == config.expected_center and lane_matches
    today = datetime.now(_MANILA).date().isoformat()
    readiness_reasons: list[str] = []
    if not identity_matches:
        readiness_reasons.append("The issued credential does not match the expected center or lane")
    if not profile.active:
        readiness_reasons.append("The issued lane is inactive")
    if wallet.negative or wallet.balance_centavos < wallet.charge_per_upload_centavos:
        readiness_reasons.append("The center wallet is insufficient for a new test")
    if quota.business_date != today:
        readiness_reasons.append("The cloud quota is not for the current Asia/Manila business date")
    if quota.remaining <= 0:
        readiness_reasons.append("The lane quota has no remaining capacity")
    return {
        "identityValid": identity_matches and profile.active,
        "ready": not readiness_reasons,
        "reason": "; ".join(readiness_reasons) if readiness_reasons else "Ready for testing",
        "centerId": center,
        "centerName": profile.center_name,
        "laneId": profile.lane_id,
        "laneNumber": profile.lane_number,
        "laneActive": profile.active,
        "walletBalanceCentavos": wallet.balance_centavos,
        "walletChargePerUploadCentavos": wallet.charge_per_upload_centavos,
        "walletLow": wallet.low,
        "walletNegative": wallet.negative,
        "quotaUsed": quota.used,
        "quotaReserved": quota.reserved,
        "quotaLimit": quota.limit,
        "quotaRemaining": quota.remaining,
        "quotaBusinessDate": quota.business_date,
    }


@app.post("/commissioning/validate")
def validate_commissioning(req: CommissioningRequest, _: None = Depends(_require_commissioning_capability)) -> dict:
    """Live, non-persisting validation used by the shared installer wizard."""
    from ..config import ConfigError, PetcConfig, _lane_number

    try:
        candidate = PetcConfig(
            profile="production" if os.name == "nt" else "dev",
            cloud_url=req.cloud_url.strip().rstrip("/"), cloud_key=req.cloud_key.strip(),
            expected_center=req.expected_center.strip(), expected_lane=_lane_number(req.expected_lane), path=Path("<unsaved>"),
        )
        if not all((candidate.cloud_url, candidate.cloud_key, candidate.expected_center, candidate.expected_lane)):
            raise ConfigError("All commissioning fields are required")
        if candidate.profile == "production" and not candidate.cloud_url.startswith("https://"):
            raise ConfigError("Production cloud URL must use HTTPS")
        return _commissioning_check(candidate)
    except ConfigError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except Exception:
        # HTTP client errors may contain a request URL, but never return it or
        # any authentication material to the renderer.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Cloud validation failed. Check the cloud URL and network connection.")


@app.post("/commissioning/save")
def save_commissioning(req: CommissioningRequest, _: None = Depends(_require_commissioning_capability)) -> dict:
    from ..config import ConfigError, PetcConfig, _lane_number, write_config
    from ..cloud_client import configure_identity

    if not req.confirmed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Confirm the resolved center and lane before saving")
    try:
        candidate = PetcConfig(
            profile="production" if os.name == "nt" else "dev",
            cloud_url=req.cloud_url.strip().rstrip("/"), cloud_key=req.cloud_key.strip(),
            expected_center=req.expected_center.strip(), expected_lane=_lane_number(req.expected_lane), path=Path("<unsaved>"),
        )
        validation = _commissioning_check(candidate)
        if not validation["identityValid"]:
            raise ConfigError("The issued credential does not match the expected active center and lane")
        saved = write_config(
            cloud_url=candidate.cloud_url, cloud_key=candidate.cloud_key,
            expected_center=candidate.expected_center, expected_lane=candidate.expected_lane,
            profile=candidate.profile,
        )
        configure_identity(saved.cloud_url, saved.cloud_key)
        # Seed the same persisted status cache used at startup, so a confirmed
        # commissioning does not make the operator wait for the next 30-second
        # reconciler tick before the readiness gate reflects the live check.
        from ..cloud_client import CloudClient
        cloud = CloudClient(saved.cloud_url, saved.cloud_key)
        from ..submissions.reconciler import _store_lane_status, _store_wallet
        _store_wallet(cloud.get_wallet())
        _store_lane_status(cloud.get_lane_profile(), cloud.get_lane_quota())
        return {"saved": True, "config": saved.public(), "validation": validation}
    except ConfigError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Cloud validation failed. Configuration was not saved.")


@app.post("/auth/login", response_model=LoginResponse)
def login(req: LoginRequest) -> LoginResponse:
    import uuid
    from ..db.session import SessionLocal
    from ..db.models import User

    with SessionLocal() as session:
        user = session.query(User).filter(User.email == req.email, User.active == True).first()
        if user is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
        # bcrypt check — passlib used at create time; fall back to sha256 in dev
        try:
            from passlib.context import CryptContext  # type: ignore
            ctx = CryptContext(schemes=["bcrypt"])
            try:
                valid_password = ctx.verify(req.password, user.password_hash)
            except Exception:
                valid_password = req.password == user.password_hash
            if not valid_password:
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
        except ImportError:
            # passlib not installed — accept plaintext match for dev seeding only
            if req.password != user.password_hash:
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

        token = str(uuid.uuid4())
        _local_sessions[token] = user.role
        return LoginResponse(
            token=token,
            user={
                "id": user.id,
                "email": user.email,
                "fullName": user.full_name,
                "role": user.role,
                "tesdaCertNo": user.tesda_cert_no,
                "certificationNo": user.certification_no,
            },
        )


@app.get("/status", response_model=StatusResponse)
def get_status(
    analyzer: Analyzer = Depends(_get_analyzer),
    printer: Printer = Depends(_get_printer),
) -> StatusResponse:
    from ..db.session import SessionLocal
    from ..db.models import LtmsSubmission
    from ..submissions.reconciler import get_cached_lane_status, get_cached_wallet

    with SessionLocal() as session:
        # cloud_outbox was the retired mirror transport. Operator visibility
        # now reflects actual durable submission work only.
        pending = session.query(LtmsSubmission).filter(
            LtmsSubmission.state.in_(["PENDING", "WAITING_FOR_LTMS"])
        ).count()

    # Read-through of the reconciler's cache — never a live cloud call. This
    # endpoint backs a 10 s UI poll and has to keep answering when the cloud is
    # unreachable.
    wallet = get_cached_wallet()
    lane = get_cached_lane_status()

    config, readiness = _readiness_status(lane, wallet)
    verified = _commissioning_verified()
    return StatusResponse(
        analyzer_connected=analyzer.is_connected,
        printer_status=printer.check_status(),
        cloud_outbox_pending=pending,
        agent_version="0.1.0",
        wallet_balance_centavos=wallet["balance_centavos"] if wallet else None,
        wallet_low=wallet["low"] if wallet else False,
        wallet_negative=wallet["negative"] if wallet else False,
        wallet_blocked_count=wallet["blocked_count"] if wallet else 0,
        wallet_fetched_at=wallet["fetched_at"] if wallet else None,
        wallet_center_id=wallet.get("tenant_id") if wallet else None,
        wallet_charge_per_upload_centavos=(
            wallet.get("charge_per_upload_centavos") if wallet else None
        ),
        wallet_low_balance_threshold_centavos=(
            wallet.get("low_balance_threshold_centavos") if wallet else None
        ),
        wallet_pricing_updated_at=wallet.get("pricing_updated_at") if wallet else None,
        center_id=_trusted_center_id(lane),
        center_name=lane.get("center_name") if lane else None,
        lane_id=lane.get("lane_id") if lane else None,
        lane_number=lane.get("lane_number") if lane else None,
        lane_active=lane.get("active") if lane else None,
        lane_identity_conflict=lane.get("identity_conflict", False) if lane else False,
        lane_quota_used=lane.get("used") if lane else None,
        lane_quota_reserved=lane.get("reserved") if lane else None,
        lane_quota_limit=lane.get("limit") if lane else None,
        lane_quota_remaining=lane.get("remaining") if lane else None,
        lane_quota_business_date=lane.get("business_date") if lane else None,
        lane_quota_resets_at=lane.get("resets_at") if lane else None,
        lane_quota_fetched_at=lane.get("fetched_at") if lane else None,
        configured=config is not None,
        commissioning_required=not verified,
        config=config.public() if config else {},
        readiness_ready=readiness["ready"],
        readiness_reason=readiness["reason"],
    )


@app.post("/test/start", response_model=StartTestResponse)
def start_test(
    req: StartTestRequest,
    analyzer: Analyzer = Depends(_get_analyzer),
    cloud_sync: CloudSyncPusher = Depends(_get_cloud_sync),
) -> StartTestResponse:
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest, User
    from ..submissions.reconciler import get_cached_lane_status

    started_at = datetime.now(timezone.utc)
    lane = get_cached_lane_status()
    _require_start_readiness(lane)
    _require_lane_start_capacity(lane)
    if is_production() and not analyzer.is_connected:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "DO 2023-008 requires an interfaced analyzer before test start",
        )

    try:
        token = analyzer.start_test(FuelType(req.fuel_type.upper()))
    except AnalyzerConnectionError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "fuel_type must be GAS or DIESEL") from exc

    test_id = str(uuid.uuid4())
    plate_number = _normalize_plate(req.plate_number)
    with SessionLocal() as session:
        lock_after = started_at.replace(tzinfo=None) - timedelta(seconds=FAILED_RETEST_LOCK_SECONDS)
        recent_failed = (
            session.query(EmissionTest)
            .filter(
                EmissionTest.plate_number == plate_number,
                EmissionTest.pass_fail == False,
                EmissionTest.completed_at >= lock_after,
            )
            .first()
        )
        if recent_failed is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Vehicle failed within the last hour; DO 2023-008 retest lock is active",
            )
        if session.get(User, req.operator_id) is None:
            session.add(
                User(
                    id=req.operator_id,
                    email=f"{req.operator_id}@local.invalid",
                    password_hash="disabled",
                    full_name="Unknown Operator",
                    role="operator",
                )
            )
            session.flush()
        test = EmissionTest(
            id=test_id,
            center_id=_trusted_center_id(lane),
            lane_id=lane.get("lane_id") if lane else None,
            lane_number=lane.get("lane_number") if lane else None,
            operator_id=req.operator_id,
            plate_number=plate_number,
            fuel_type=req.fuel_type.upper(),
            session_token=token,
            started_at=started_at,
            tested_at=started_at,
        )
        session.add(test)
        _audit(session, "TEST_START", "emission_test", test_id, {
            "plateNumber": plate_number,
            "fuelType": req.fuel_type.upper(),
            "operatorId": req.operator_id,
        }, req.operator_id)
        session.commit()

    cloud_sync.enqueue(
        "emission_test_started",
        test_id,
        {
            "id": test_id,
            "session_token": token,
            "operator_id": req.operator_id,
            "plate_number": plate_number,
            "fuel_type": req.fuel_type.upper(),
            "started_at": started_at.isoformat(),
            "center_id": _trusted_center_id(lane),
            "lane_id": lane.get("lane_id") if lane else None,
            "lane_number": lane.get("lane_number") if lane else None,
        },
    )

    return StartTestResponse(
        test_id=test_id,
        session_token=token,
        started_at=started_at.isoformat(),
    )


@app.get("/test/{session_token}/result", response_model=TestResultResponse)
def get_result(
    session_token: str,
    analyzer: Analyzer = Depends(_get_analyzer),
    cloud_sync: CloudSyncPusher = Depends(_get_cloud_sync),
) -> TestResultResponse:
    from ..db.session import SessionLocal
    from ..db.models import DieselTestResult, EmissionTest, GasTestResult

    started_capture = time.monotonic()
    try:
        result = analyzer.read_result(session_token)
    except AnalyzerTimeoutError as exc:
        raise HTTPException(status.HTTP_408_REQUEST_TIMEOUT, str(exc)) from exc
    elapsed = time.monotonic() - started_capture
    if elapsed > READING_CAPTURE_TIMEOUT_SECONDS:
        raise HTTPException(
            status.HTTP_408_REQUEST_TIMEOUT,
            "Analyzer reading exceeded the DO 2023-008 five-second automatic capture requirement",
        )

    readings = _reading_to_dict(result)
    _validate_readings_for_do(result.fuel_type.value, readings)
    captured_at = result.captured_at
    raw_bytes_hex = result.raw_bytes.hex()

    with SessionLocal() as session:
        test = session.query(EmissionTest).filter(EmissionTest.session_token == session_token).first()
        if test is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Session {session_token} not found")
        if is_production() or not raw_bytes_hex.startswith("4d4f434b3a"):
            duplicate = (
                session.query(EmissionTest)
                .filter(
                    EmissionTest.raw_bytes_hex == raw_bytes_hex,
                    EmissionTest.id != test.id,
                )
                .first()
            )
            if duplicate is not None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "Duplicate analyzer result rejected; previous machine result cannot be reused",
                )

        test.fuel_type = result.fuel_type.value
        test.pass_fail = result.pass_fail
        test.analyzer_serial = result.serial_no
        test.raw_bytes_hex = raw_bytes_hex
        test.tested_at = captured_at
        test.completed_at = captured_at

        if result.fuel_type is FuelType.GAS:
            session.merge(GasTestResult(test_id=test.id, **readings))
        else:
            session.merge(DieselTestResult(test_id=test.id, **readings))
        test_id = test.id
        plate_number = test.plate_number
        photo_count = len(test.photos)
        _audit(session, "RESULT_CAPTURE", "emission_test", test.id, {
            "fuelType": result.fuel_type.value,
            "serialNo": result.serial_no,
            "captureElapsedSeconds": round(elapsed, 4),
            "passFail": result.pass_fail,
        }, test.operator_id)
        session.commit()

    cloud_sync.enqueue(
        "emission_test_result",
        test_id,
        {
            "id": test_id,
            "session_token": session_token,
            "plate_number": plate_number,
            "fuel_type": result.fuel_type.value,
            "pass_fail": result.pass_fail,
            "serial_no": result.serial_no,
            "captured_at": captured_at.isoformat(),
            "readings": readings,
            "photo_count": photo_count,
            "raw": result.raw_bytes.hex(),
        },
    )

    return TestResultResponse(
        test_id=test_id,
        session_token=session_token,
        pass_fail=result.pass_fail,
        fuel_type=result.fuel_type.value,
        readings=readings,
        captured_at=captured_at.isoformat(),
    )


@app.post("/test/{session_token}/abort")
def abort_test(
    session_token: str,
    analyzer: Analyzer = Depends(_get_analyzer),
) -> dict:
    analyzer.abort_test(session_token)
    return {"aborted": session_token}


@app.get("/api/v1/photos/{photo_id}")
def get_photo_file(photo_id: str):
    """Serve the raw photo bytes by ID so the UI can render thumbnails."""
    from fastapi.responses import FileResponse
    from ..db.session import SessionLocal
    from ..db.models import TestPhoto

    with SessionLocal() as session:
        row = session.get(TestPhoto, photo_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "photo not found")
        path = Path(row.file_path)
        if not path.is_file():
            raise HTTPException(status.HTTP_410_GONE, "photo file missing on disk")
        return FileResponse(path, media_type=row.mime_type)


@app.post("/api/v1/tests/{test_id}/photo")
async def upload_test_photo(
    test_id: str,
    file: UploadFile = File(...),
    photo_type: str = "FRONT",
    cloud_sync: CloudSyncPusher = Depends(_get_cloud_sync),
) -> dict:
    """Accept a JPEG captured client-side (browser getUserMedia) and persist it
    to disk + the cloud queue. Replaces the sidecar-owned OpenCV capture path."""
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest, TestPhoto
    from datetime import datetime, timezone

    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty upload")

    photo_id = str(uuid.uuid4())
    captured_at = datetime.now(timezone.utc)
    mime_type = file.content_type or "image/jpeg"

    with SessionLocal() as session:
        test = session.get(EmissionTest, test_id)
        if test is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Test {test_id} not found")

        data_dir = Path(os.environ.get("PETC_DATA_DIR", "."))
        photo_dir = data_dir / "photos" / test_id
        photo_dir.mkdir(parents=True, exist_ok=True)
        file_path = photo_dir / f"{photo_id}.jpg"
        file_path.write_bytes(data)

        row = TestPhoto(
            id=photo_id,
            test_id=test_id,
            photo_type=photo_type.upper(),
            file_path=str(file_path),
            mime_type=mime_type,
            camera_id="browser",
            captured_at=captured_at,
        )
        session.add(row)
        _audit(session, "PHOTO_CAPTURE", "test_photo", photo_id, {
            "testId": test_id,
            "photoType": photo_type.upper(),
            "cameraId": "browser",
            "sizeBytes": len(data),
        })
        session.commit()

    cloud_sync.enqueue(
        "test_photo",
        photo_id,
        {
            "id": photo_id,
            "test_id": test_id,
            "photo_type": photo_type.upper(),
            "file_path": str(file_path),
            "mime_type": mime_type,
            "camera_id": "browser",
            "captured_at": captured_at.isoformat(),
        },
    )

    return {
        "id": photo_id,
        "test_id": test_id,
        "photo_type": photo_type.upper(),
        "size_bytes": len(data),
        "captured_at": captured_at.isoformat(),
    }


@app.post("/camera/capture")
def capture_photo(
    req: CapturePhotoRequest = CapturePhotoRequest(),
    camera: CameraCapture = Depends(_get_camera),
    cloud_sync: CloudSyncPusher = Depends(_get_cloud_sync),
) -> dict:
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest, TestPhoto

    try:
        photo = camera.capture()
    except CaptureError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc

    photo_id = str(uuid.uuid4())
    file_path: Optional[Path] = None
    if req.test_id:
        with SessionLocal() as session:
            test = session.get(EmissionTest, req.test_id)
            if test is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, f"Test {req.test_id} not found")

            data_dir = Path(os.environ.get("PETC_DATA_DIR", "."))
            photo_dir = data_dir / "photos" / req.test_id
            photo_dir.mkdir(parents=True, exist_ok=True)
            file_path = photo_dir / f"{photo_id}.jpg"
            file_path.write_bytes(photo.data)

            row = TestPhoto(
                id=photo_id,
                test_id=req.test_id,
                photo_type=req.photo_type.upper(),
                file_path=str(file_path),
                mime_type=photo.mime_type,
                camera_id=photo.camera_id,
                captured_at=photo.captured_at,
            )
            session.add(row)
            _audit(session, "PHOTO_CAPTURE", "test_photo", photo_id, {
                "testId": req.test_id,
                "photoType": req.photo_type.upper(),
                "cameraId": photo.camera_id,
                "sizeBytes": len(photo.data),
            })
            session.commit()

        cloud_sync.enqueue(
            "test_photo",
            photo_id,
            {
                "id": photo_id,
                "test_id": req.test_id,
                "photo_type": req.photo_type.upper(),
                "file_path": str(file_path),
                "mime_type": photo.mime_type,
                "camera_id": photo.camera_id,
                "captured_at": photo.captured_at.isoformat(),
            },
        )

    return {
        "id": photo_id,
        "test_id": req.test_id,
        "photo_type": req.photo_type.upper(),
        "file_path": str(file_path) if file_path else None,
        "mime_type": photo.mime_type,
        "size_bytes": len(photo.data),
        "captured_at": photo.captured_at.isoformat(),
        "camera_id": photo.camera_id,
    }


@app.post("/print/receipt")
def print_receipt(
    req: PrintRequest,
    printer: Printer = Depends(_get_printer),
) -> dict:
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest, Receipt

    data = ReceiptData(
        test_id=req.test_id,
        plate_number=req.plate_number,
        vehicle_make=req.vehicle_make,
        vehicle_model=req.vehicle_model,
        year=req.year,
        fuel_type=req.fuel_type,
        pass_fail=req.pass_fail,
        operator_name=req.operator_name,
        center_name=req.center_name,
        printed_at=datetime.now(timezone.utc),
    )
    printer.print_receipt(data, copies=req.copies)
    with SessionLocal() as session:
        if session.get(EmissionTest, req.test_id) is not None:
            session.add(
                Receipt(
                    id=str(uuid.uuid4()),
                    test_id=req.test_id,
                    copy_count=req.copies,
                    printed_at=data.printed_at,
                )
            )
            session.commit()
    return {"printed": True, "copies": req.copies}


# ---------------------------------------------------------------------------
# Gov registry routes
# ---------------------------------------------------------------------------
@app.post("/api/v1/vehicle/lookup")
def lookup_vehicle_v1(
    req: VehicleLookupRequest,
    gov: GovRegistryClient = Depends(_get_gov),
) -> dict:
    from ..db.session import SessionLocal
    from ..db.models import VehicleCache
    from .. import cloud_client as cc

    plate = _normalize_plate(req.plate)
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Check local cache first regardless of source
    with SessionLocal() as session:
        cached = session.query(VehicleCache).filter(VehicleCache.plate_number == plate).first()
        if cached and cached.expires_at > now:
            return {
                "found": True,
                "source": "LTMS_CACHE",
                "fetchedAt": cached.fetched_at.isoformat(),
                **_vehicle_cache_to_response(cached),
            }

    # Fetch from cloud proxy (production) or local mock (dev)
    if cc.is_available():
        raw = cc.get_client().lookup_vehicle(plate)
        if raw is None:
            return {"found": False, "source": "LTMS", "vehicle": None, "owner": None, "fetchedAt": None}

        fetched_at = now
        expires_at = fetched_at + timedelta(hours=24)
        with SessionLocal() as session:
            cached = session.query(VehicleCache).filter(VehicleCache.plate_number == plate).first()
            if cached is None:
                cached = VehicleCache(id=str(uuid.uuid4()), plate_number=plate, expires_at=expires_at)
                session.add(cached)
            # raw is a plain dict from the cloud response
            cached.mv_no = raw.get("mvNo")
            cached.make = raw.get("make")
            cached.series = raw.get("series")
            cached.vehicle_type = raw.get("vehicleType")
            cached.year_model = raw.get("yearModel")
            cached.fuel_type = raw.get("fuelType")
            cached.engine_no = raw.get("engineNo")
            cached.chassis_no = raw.get("chassisNo")
            cached.color = raw.get("color")
            cached.transmission = raw.get("transmission")
            cached.last_name = raw.get("lastName")
            cached.first_name = raw.get("firstName")
            cached.middle_name = raw.get("middleName")
            cached.organization = raw.get("organization")
            cached.address = raw.get("address")
            cached.city = raw.get("city")
            cached.or_type = raw.get("orType")
            cached.cr_date = raw.get("crDate")
            cached.cr_no = raw.get("crNo")
            cached.district_office = raw.get("districtOffice")
            cached.owner_type = raw.get("ownerType")
            cached.source = "LTMS"
            cached.fetched_at = fetched_at
            cached.expires_at = expires_at
            session.commit()
            # commit() expires the instance; read it back before the session
            # closes, otherwise attribute access raises DetachedInstanceError.
            response = _vehicle_cache_to_response(cached)

        return {
            "found": True,
            "source": "LTMS",
            "fetchedAt": fetched_at.isoformat(),
            **response,
        }

    # Local mock fallback
    info = gov.find_vehicle(plate)
    if info is None:
        return {"found": False, "source": "LTMS", "vehicle": None, "owner": None, "fetchedAt": None}

    fetched_at = now
    expires_at = fetched_at + timedelta(hours=24)
    with SessionLocal() as session:
        cached = session.query(VehicleCache).filter(VehicleCache.plate_number == plate).first()
        if cached is None:
            cached = VehicleCache(id=str(uuid.uuid4()), plate_number=plate, expires_at=expires_at)
            session.add(cached)
        _update_vehicle_cache(cached, info, fetched_at, expires_at)
        session.commit()

    return {
        "found": True,
        "source": "LTMS",
        "fetchedAt": fetched_at.isoformat(),
        **_vehicle_info_to_response(info),
    }


@app.get("/gov/vehicle/{plate_number}")
def lookup_vehicle(
    plate_number: str,
    gov: GovRegistryClient = Depends(_get_gov),
) -> dict:
    from .. import cloud_client as cc
    if cc.is_available():
        raw = cc.get_client().lookup_vehicle(plate_number)
        if raw is None:
            return {"found": False, "vehicle": None}
        return {"found": True, **raw}
    info = gov.find_vehicle(plate_number)
    if info is None:
        return {"found": False, "vehicle": None}
    return {"found": True, **_vehicle_info_to_response(info)}


@app.get("/gov/driver/{license_no}")
def lookup_driver(
    license_no: str,
    gov: GovRegistryClient = Depends(_get_gov),
) -> dict:
    from .. import cloud_client as cc
    if cc.is_available():
        raw = cc.get_client().lookup_driver(license_no)
        if raw is None:
            return {"found": False, "driver": None}
        return {"found": True, "driver": raw}
    info = gov.find_driver(license_no)
    if info is None:
        return {"found": False, "driver": None}
    return {
        "found": True,
        "driver": {
            "licenseNo": info.license_no,
            "fullName": info.full_name,
            "licenseType": info.license_type,
            "expiryDate": info.expiry_date.isoformat(),
        },
    }


class LtmsSubmitRequest(BaseModel):
    plate_number: Optional[str] = None
    license_no: Optional[str] = None
    operator_id: Optional[str] = None
    center_id: Optional[str] = None


@app.post("/gov/submit/{test_id}")
def submit_ltms(
    test_id: str,
    req: LtmsSubmitRequest = LtmsSubmitRequest(),
    gov: GovRegistryClient = Depends(_get_gov),
    cloud_sync: CloudSyncPusher = Depends(_get_cloud_sync),
) -> dict:
    from ..gov.base import EmissionPayload
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest, LtmsSubmission
    import uuid

    if not allow_mock_paths():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Production LTMS/IRDS submission must use /api/v1/upload/submit through the cloud",
        )

    with SessionLocal() as session:
        test = session.get(EmissionTest, test_id)
        if test is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Test {test_id} not found")
        _require_current_lane_for_submission(test)

        readings: dict = {}
        if test.gas_result:
            r = test.gas_result
            readings = {"co_pct": r.co_pct, "hc_ppm": r.hc_ppm, "co2_pct": r.co2_pct,
                        "o2_pct": r.o2_pct, "lambda_value": r.lambda_value}
        elif test.diesel_result:
            r = test.diesel_result
            readings = {"opacity_pct": r.opacity_pct, "k_value": r.k_value}

        payload = EmissionPayload(
            test_id=test_id,
            plate_number=req.plate_number or test.plate_number,
            license_no=req.license_no or "",
            fuel_type=test.fuel_type,
            pass_fail=test.pass_fail or False,
            readings=readings,
            photo_paths=[p.file_path for p in test.photos],
            operator_id=req.operator_id or test.operator_id,
            center_id=req.center_id or os.environ.get("PETC_CENTER_ID", "dev-center"),
        )

        result = gov.submit_emission_result(payload)

        sub = LtmsSubmission(
            id=str(uuid.uuid4()),
            test_id=test_id,
            **_lane_snapshot(test),
            state=result.state,
            certificate_no=result.certificate_no,
            submitted_at=datetime.now(timezone.utc),
            accepted_at=datetime.now(timezone.utc) if result.state == "ACCEPTED" else None,
            last_error=result.rejection_reason,
        )
        session.add(sub)
        session.commit()

    cloud_sync.enqueue("ltms_submission", sub.id, {
        "test_id": test_id,
        "state": result.state,
        "certificate_no": result.certificate_no,
        "rejection_reason": result.rejection_reason,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    })

    return {
        "state": result.state,
        "certificateNo": result.certificate_no,
        "rejectionReason": result.rejection_reason,
    }


@app.post("/api/v1/upload/submit")
def submit_upload_v1(
    req: UploadSubmitRequest,
    gov: GovRegistryClient = Depends(_get_gov),
    cloud_sync: CloudSyncPusher = Depends(_get_cloud_sync),
) -> dict:
    """Submit an emission test result.

    Cloud path (default): presign + upload photos to S3, POST to cloud
    /api/submissions, short-poll up to 60s for LTMS result.

    Local-mock path (fallback when PETC_CLOUD_URL unset and PETC_GOV_MOCK=true):
    call the local mock gov client directly — preserves developer workflow.
    """
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest, GovOutbox, LtmsSubmission, TestPhoto
    from .. import cloud_client as cc
    from ..submissions.reconciler import get_cached_lane_status

    payload = req.payload
    test_id = payload.get("testId")
    if not test_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "payload.testId is required")

    now = datetime.now(timezone.utc)

    with SessionLocal() as session:
        test = session.get(EmissionTest, test_id)
        if test is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Test {test_id} not found")
        _require_current_lane_for_submission(test)
        payload = _apply_authoritative_lane_identity(payload, get_cached_lane_status())

        vehicle = payload.get("vehicle", {})
        readings = payload.get("readings") or _readings_for_test(test)
        _validate_submission_payload(payload, test, readings, len(test.photos))

        # Collect photo rows now (before session closes)
        photo_rows: list[tuple[str, str, str, str]] = [
            (p.id, p.file_path, p.photo_type, p.mime_type)
            for p in test.photos
        ]

    center_id = payload.get("centerId") or os.environ.get("PETC_CENTER_ID", "dev-center")

    request_json = json.dumps(payload, default=str)

    # ── Cloud submission path ─────────────────────────────────────────────
    if cc.is_available():
        # Persist the immutable test UUID and payload before *any* photo or
        # submission network call. The reconciler owns retries after this
        # point, so a restart/transient outage cannot turn into a manual retry
        # or a second cloud submission.
        with SessionLocal() as session:
            existing = (
                session.query(LtmsSubmission)
                .filter(LtmsSubmission.test_id == test_id, LtmsSubmission.state.notin_(["REJECTED", "DEAD"]))
                .order_by(LtmsSubmission.submitted_at.desc())
                .first()
            )
            if existing:
                existing_id = existing.id
                if existing.state in ("ACCEPTED", "REJECTED", "DEAD", "EXPIRED"):
                    return _local_submission_response(existing_id)
                # A renderer refresh or repeated click should resume waiting on
                # the same idempotent durable row, never create a duplicate.
                return _dispatch_and_wait_for_cloud(existing_id, cc.get_client())
            sub_id = str(uuid.uuid4())
            session.add(LtmsSubmission(
                id=sub_id, test_id=test_id, **_lane_snapshot(test), payload_json=request_json,
                state="PENDING", submitted_at=now, incident_due_at=now + timedelta(hours=24),
            ))
            session.commit()
        return _dispatch_and_wait_for_cloud(sub_id, cc.get_client())

    if not allow_mock_paths():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Production requires cloud-mediated LTMS/IRDS submission",
        )

    # ── Local-mock path (dev / offline) ───────────────────────────────────
    from ..gov.base import EmissionPayload

    with SessionLocal() as session:
        test = session.get(EmissionTest, test_id)
        readings_local = payload.get("readings") or _readings_for_test(test)
        photos_local = payload.get("photos", [])

        emission_payload = EmissionPayload(
            test_id=test_id,
            plate_number=vehicle.get("plateNo") or test.plate_number,
            license_no="",
            fuel_type=vehicle.get("fuelType") or test.fuel_type,
            pass_fail=bool(payload.get("verdict", {}).get("pass", test.pass_fail)),
            readings=readings_local,
            photo_paths=[p.get("filePath", "") for p in photos_local if p.get("filePath")],
            operator_id=test.operator_id,
            center_id=center_id,
            tested_at=test.tested_at,
        )

        outbox = GovOutbox(
            id=str(uuid.uuid4()),
            event_type="LTMS_SUBMIT",
            payload_json=request_json,
            status="PENDING",
        )
        session.add(outbox)

        try:
            result = gov.submit_emission_result(emission_payload)
            outbox.status = "DONE"
            outbox.response_json = json.dumps({
                "state": result.state,
                "certificateNo": result.certificate_no,
                "rejectionReason": result.rejection_reason,
            })
        except Exception as exc:
            sub_id = str(uuid.uuid4())
            sub = LtmsSubmission(
                id=sub_id,
                test_id=test_id,
                **_lane_snapshot(test),
                payload_json=request_json,
                state="PENDING",
                submitted_at=now,
                last_error=str(exc),
            )
            outbox.last_error = str(exc)
            session.add(sub)
            session.commit()
            return {
                "state": "PENDING",
                "certificateNo": None,
                "rejectionReason": None,
                "queued": True,
                "submissionId": sub_id,
            }

        sub_id = str(uuid.uuid4())
        pdf_path = None
        if result.state == "ACCEPTED" and result.certificate_no:
            from ..cec.pdf import render_cec_pdf
            try:
                pdf_path = str(render_cec_pdf(
                    submission_id=sub_id,
                    certificate_no=result.certificate_no,
                    payload=payload,
                    issued_at=now,
                ))
            except Exception:
                logger.exception("Failed to render CEC PDF for submission %s", sub_id)

        sub = LtmsSubmission(
            id=sub_id,
            test_id=test_id,
            **_lane_snapshot(test),
            payload_json=request_json,
            state=result.state,
            certificate_no=result.certificate_no,
            ltms_reference_no=result.certificate_no,
            submitted_at=now,
            accepted_at=now if result.state == "ACCEPTED" else None,
            last_error=result.rejection_reason,
            pdf_path=pdf_path,
        )
        session.add(sub)
        _audit(session, "SUBMISSION_MOCK_ACCEPTED" if result.state == "ACCEPTED" else "SUBMISSION_MOCK_REJECTED",
               "ltms_submission", sub_id, {
                   "testId": test_id,
                   "state": result.state,
                   "nonOfficial": True,
               })

        if result.state == "ACCEPTED":
            test.uploaded_at = now

        session.commit()

    cloud_sync.enqueue("ltms_submission", sub_id, {
        "test_id": test_id,
        "state": result.state,
        "certificate_no": result.certificate_no,
        "rejection_reason": result.rejection_reason,
        "submitted_at": now.isoformat(),
    })

    return {
        "state": result.state,
        "certificateNo": result.certificate_no,
        "rejectionReason": result.rejection_reason,
        "queued": False,
        "submissionId": sub_id,
        "official": False,
    }


def _local_submission_response(
    submission_id: str,
    *,
    state_override: Optional[str] = None,
    message_override: Optional[str] = None,
) -> dict:
    """Build the renderer contract from the durable local source of truth."""
    from ..db.models import LtmsSubmission
    from ..db.session import SessionLocal

    with SessionLocal() as session:
        sub = session.get(LtmsSubmission, submission_id)
        if sub is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "submission not found")
        state = state_override or sub.state
        queued = state not in ("ACCEPTED", "REJECTED", "DEAD", "EXPIRED")
        return {
            "state": state,
            "certificateNo": sub.certificate_no,
            "rejectionReason": sub.last_error,
            "statusMessage": message_override,
            "queued": queued,
            "submissionId": sub.id,
            "incidentDueAt": sub.incident_due_at.isoformat() if sub.incident_due_at else None,
        }


def _dispatch_and_wait_for_cloud(submission_id: str, cloud) -> dict:
    """Attempt immediately, then short-poll while the operator is watching.

    Any transient dispatch/poll failure is already recorded by the reconciler
    with its retry schedule.  In that case this request returns promptly and
    the daemon continues from the same row after a restart or network outage.
    """
    from ..db.models import LtmsSubmission
    from ..db.session import SessionLocal
    from ..submissions.reconciler import SubmissionReconciler

    reconciler = SubmissionReconciler()
    reconciler._dispatch_pending(cloud, submission_id)

    with SessionLocal() as session:
        row = session.get(LtmsSubmission, submission_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "submission not found")
        if row.state in ("ACCEPTED", "REJECTED", "DEAD", "EXPIRED"):
            return _local_submission_response(submission_id)
        if not row.cloud_submission_id:
            # The immediate photo/cloud call failed. _dispatch_pending has
            # persisted the error and next retry; do not pretend this is a
            # healthy LTMS processing delay.
            return _local_submission_response(
                submission_id,
                state_override="PENDING",
                message_override="The cloud upload failed temporarily and is queued for automatic retry.",
            )

    deadline = time.monotonic() + _FOREGROUND_SUBMISSION_TIMEOUT_S
    while True:
        try:
            cloud_state = reconciler.reconcile_submission(cloud, submission_id)
        except Exception:
            return _local_submission_response(
                submission_id,
                state_override="PENDING",
                message_override="LTMS status is temporarily unavailable; automatic recovery will continue.",
            )

        if cloud_state in ("ACCEPTED", "REJECTED", "DEAD", "EXPIRED"):
            return _local_submission_response(submission_id)
        if cloud_state == "BLOCKED":
            return _local_submission_response(
                submission_id,
                state_override="BLOCKED",
                message_override="The cloud is holding this submission until the center wallet is funded.",
            )

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return _local_submission_response(
                submission_id,
                state_override="WAITING_FOR_LTMS",
                message_override="LTMS is still processing. The result will continue updating in History.",
            )
        time.sleep(min(_FOREGROUND_SUBMISSION_POLL_S, remaining))


class CecPrintRequest(BaseModel):
    copies: int = 2


@app.get("/api/v1/cec/{submission_id}/pdf")
def get_cec_pdf(submission_id: str):
    """Stream the CEC PDF for an accepted submission so the operator can preview
    it in the LTMS wizard before printing."""
    from fastapi.responses import FileResponse
    from ..db.session import SessionLocal
    from ..db.models import LtmsSubmission

    with SessionLocal() as session:
        sub = session.get(LtmsSubmission, submission_id)
        if sub is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "submission not found")
        if not sub.pdf_path:
            raise HTTPException(status.HTTP_409_CONFLICT, "CEC PDF has not been generated for this submission")
        path = Path(sub.pdf_path)
        if not path.is_file():
            raise HTTPException(status.HTTP_410_GONE, "CEC PDF file missing on disk")
        return FileResponse(
            path,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'inline; filename="CEC-{sub.certificate_no or submission_id}.pdf"',
            },
        )


@app.post("/api/v1/cec/{submission_id}/print")
def print_cec(
    submission_id: str,
    req: CecPrintRequest = CecPrintRequest(),
    printer: Printer = Depends(_get_printer),
) -> dict:
    """Print the CEC for an accepted submission. Records a Receipt row."""
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest, LtmsSubmission, Receipt

    with SessionLocal() as session:
        sub = session.get(LtmsSubmission, submission_id)
        if sub is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "submission not found")
        if sub.state != "ACCEPTED" or not sub.certificate_no:
            raise HTTPException(status.HTTP_409_CONFLICT, "submission is not in ACCEPTED state")

        test = session.get(EmissionTest, sub.test_id)
        if test is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "test not found")

        if is_production():
            if not test.photos:
                raise HTTPException(status.HTTP_409_CONFLICT, "CEC print blocked until required photos are uploaded")
            missing_uploads = [p.id for p in test.photos if not p.uploaded_at or not p.s3_key]
            if missing_uploads:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "CEC print blocked until all required photos are uploaded",
                )

        existing_prints = (
            session.query(Receipt)
            .filter(Receipt.submission_id == submission_id)
            .order_by(Receipt.printed_at.asc())
            .all()
        )
        print_kind = "ORIGINAL" if not existing_prints else "REPRINT"
        now = datetime.now(timezone.utc)
        if print_kind == "REPRINT":
            test_dt = test.tested_at
            if test_dt.tzinfo is not None:
                test_dt = test_dt.replace(tzinfo=None)
            if datetime.utcnow() > test_dt + timedelta(days=REPRINT_WINDOW_DAYS):
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "CEC reprint rejected because the original test is more than two months old",
                )

        payload = json.loads(sub.payload_json) if sub.payload_json else {}
        vehicle = payload.get("vehicle") or {}
        technician = payload.get("technician") or {}
        verdict = payload.get("verdict") or {}
        readings = payload.get("readings") or _readings_for_test(test)

        printer.print_receipt(
            ReceiptData(
                test_id=test.id,
                plate_number=vehicle.get("plateNo") or test.plate_number,
                vehicle_make=vehicle.get("make") or "",
                vehicle_model=vehicle.get("series") or "",
                year=int(vehicle.get("yearModel") or 0),
                fuel_type=vehicle.get("fuelType") or test.fuel_type,
                pass_fail=bool(verdict.get("pass", test.pass_fail or False)),
                operator_name=technician.get("technicianName") or "Operator",
                center_name=payload.get("centerName") or "PETC Center",
                printed_at=now,
                certificate_no=sub.certificate_no,
                raw_readings=readings,
            ),
            copies=req.copies,
        )

        session.add(
            Receipt(
                id=str(uuid.uuid4()),
                test_id=test.id,
                submission_id=submission_id,
                print_kind=print_kind,
                certificate_no=sub.certificate_no,
                valid_until=sub.valid_until,
                copy_count=req.copies,
                printed_at=now,
            )
        )
        _audit(session, "CEC_PRINT" if print_kind == "ORIGINAL" else "CEC_REPRINT",
               "ltms_submission", submission_id, {
                   "testId": test.id,
                   "certificateNo": sub.certificate_no,
                   "copies": req.copies,
                   "validUntil": sub.valid_until,
               }, test.operator_id)
        session.commit()

    return {"printed": True, "copies": req.copies, "printKind": print_kind}


@app.get("/api/v1/upload/status/{test_id}")
def upload_status_v1(test_id: str) -> dict:
    from ..db.session import SessionLocal
    from ..db.models import LtmsSubmission

    with SessionLocal() as session:
        sub = (
            session.query(LtmsSubmission)
            .filter(LtmsSubmission.test_id == test_id)
            .order_by(LtmsSubmission.submitted_at.desc())
            .first()
        )
        if sub is None:
            return {"state": None, "certificateNo": None, "rejectionReason": None}
        return {
            "state": sub.state,
            "certificateNo": sub.certificate_no,
            "rejectionReason": sub.last_error,
            "submissionId": sub.id,
        }


# ---------------------------------------------------------------------------
# Test history routes
# ---------------------------------------------------------------------------
@app.get("/tests")
def list_tests(
    limit: int = 50,
    ltms_state: Optional[str] = None,
) -> list:
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest, LtmsSubmission
    from sqlalchemy.orm import joinedload

    with SessionLocal() as session:
        q = session.query(EmissionTest).options(
            joinedload(EmissionTest.ltms_submissions),
            joinedload(EmissionTest.photos),
        ).order_by(EmissionTest.started_at.desc())

        if ltms_state is not None:
            if ltms_state.upper() == "PENDING":
                # Tests that have never been submitted to LTMS
                q = q.filter(~EmissionTest.ltms_submissions.any())
            else:
                q = q.join(LtmsSubmission, LtmsSubmission.test_id == EmissionTest.id).filter(
                    LtmsSubmission.state == ltms_state.upper()
                )

        tests = q.limit(limit).all()

        return [
            {
                "id": t.id,
                "plateNumber": t.plate_number,
                "fuelType": t.fuel_type,
                "passFail": t.pass_fail,
                "startedAt": _utc_iso(t.started_at),
                "completedAt": _utc_iso(t.completed_at),
                "ltmsState": t.ltms_submissions[0].state if t.ltms_submissions else None,
                "certificateNo": t.ltms_submissions[0].certificate_no if t.ltms_submissions else None,
                "submissionId": t.ltms_submissions[0].id if t.ltms_submissions else None,
                "photoCount": len(t.photos),
                "centerId": t.center_id,
                "laneId": t.lane_id,
                "laneNumber": t.lane_number,
            }
            for t in tests
        ]


@app.get("/tests/{test_id}/photos")
def get_test_photos(test_id: str) -> list:
    from ..db.session import SessionLocal
    from ..db.models import TestPhoto, EmissionTest

    with SessionLocal() as session:
        photos = session.query(TestPhoto).filter(TestPhoto.test_id == test_id).all()
        if not photos:
            test_exists = session.query(
                session.query(EmissionTest).filter_by(id=test_id).exists()
            ).scalar()
            if not test_exists:
                raise HTTPException(status.HTTP_404_NOT_FOUND, f"Test {test_id} not found")
        return [
            {
                "id": p.id,
                "testId": p.test_id,
                "photoType": p.photo_type,
                "mimeType": p.mime_type,
                "filePath": p.file_path,
                "capturedAt": _utc_iso(p.captured_at),
                "cameraId": p.camera_id,
            }
            for p in photos
        ]


@app.get("/tests/{test_id}")
def get_test_detail(test_id: str) -> dict:
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest
    from sqlalchemy.orm import joinedload

    with SessionLocal() as session:
        test = (
            session.query(EmissionTest)
            .options(
                joinedload(EmissionTest.gas_result),
                joinedload(EmissionTest.diesel_result),
                joinedload(EmissionTest.photos),
                joinedload(EmissionTest.ltms_submissions),
            )
            .filter(EmissionTest.id == test_id)
            .first()
        )
        if test is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Test {test_id} not found")
        return _test_detail_to_response(test)


# ---------------------------------------------------------------------------
# Analytics routes
# ---------------------------------------------------------------------------
@app.get("/analytics/summary")
def analytics_summary() -> dict:
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest
    from sqlalchemy import func

    with SessionLocal() as session:
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        total = session.query(func.count(EmissionTest.id)).scalar() or 0
        this_month = session.query(func.count(EmissionTest.id)).filter(
            EmissionTest.started_at >= month_start
        ).scalar() or 0

        passed = session.query(func.count(EmissionTest.id)).filter(
            EmissionTest.pass_fail == True,
            EmissionTest.started_at >= month_start,
        ).scalar() or 0
        failed = session.query(func.count(EmissionTest.id)).filter(
            EmissionTest.pass_fail == False,
            EmissionTest.started_at >= month_start,
        ).scalar() or 0

        pending_ltms = session.query(func.count(EmissionTest.id)).filter(
            ~EmissionTest.ltms_submissions.any()
        ).scalar() or 0

        pass_rate = (passed / this_month) if this_month > 0 else 0.0

        return {
            "totalTests": total,
            "testsThisMonth": this_month,
            "passRate": round(pass_rate, 4),
            "passed": passed,
            "failed": failed,
            "pendingLtms": pending_ltms,
        }


@app.get("/analytics/daily")
def analytics_daily(days: int = 7) -> list:
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest
    from sqlalchemy import func, cast, Integer

    with SessionLocal() as session:
        cutoff = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        from datetime import timedelta
        cutoff = cutoff - timedelta(days=days - 1)

        rows = (
            session.query(
                func.date(EmissionTest.started_at).label("date"),
                func.count(EmissionTest.id).label("total"),
                func.sum(cast(EmissionTest.pass_fail, Integer)).label("passed"),
            )
            .filter(EmissionTest.started_at >= cutoff)
            .group_by("date")
            .order_by("date")
            .all()
        )
        return [
            {"date": str(r.date), "total": r.total, "passed": int(r.passed or 0)}
            for r in rows
        ]


@app.get("/api/v1/ports")
def list_ports() -> list:
    """Return available serial ports for the settings / hardware-config screen."""
    from ..analyzer.serial_base import list_serial_ports
    return list_serial_ports()


# ---------------------------------------------------------------------------
# Settings routes — analyzer hardware config (read + hot-reconnect)
# ---------------------------------------------------------------------------
_ANALYZER_SETTING_KEYS = (
    "analyzer.type",
    "analyzer.port",
    "analyzer.baud",
    "analyzer.data_bits",
    "analyzer.parity",
    "analyzer.stop_bits",
    "analyzer.address",
)

_ANALYZER_TYPES = {"mock", "serial_gas", "serial_diesel", "fty_opacimeter", "fofen_gas", "fofen_ascii"}
_PARITY_VALUES = {"N", "E", "O"}


class AnalyzerSettings(BaseModel):
    type: str
    port: str
    baud: int
    dataBits: int
    parity: str
    stopBits: int
    address: str


def _load_analyzer_settings() -> AnalyzerSettings:
    from ..db.session import SessionLocal
    from ..db.models import AppSetting

    with SessionLocal() as session:
        rows = {
            r.key: (r.value or "")
            for r in session.query(AppSetting).filter(AppSetting.key.in_(_ANALYZER_SETTING_KEYS)).all()
        }
    return AnalyzerSettings(
        type=rows.get("analyzer.type", "mock"),
        port=rows.get("analyzer.port", "COM1"),
        baud=int(rows.get("analyzer.baud", "9600")),
        dataBits=int(rows.get("analyzer.data_bits", "8")),
        parity=rows.get("analyzer.parity", "N"),
        stopBits=int(rows.get("analyzer.stop_bits", "1")),
        address=rows.get("analyzer.address", "01"),
    )


@app.get("/api/v1/settings/analyzer", response_model=AnalyzerSettings)
def get_analyzer_settings() -> AnalyzerSettings:
    return _load_analyzer_settings()


@app.put("/api/v1/settings/analyzer")
def update_analyzer_settings(req: AnalyzerSettings) -> dict:
    """Persist new analyzer settings and rebuild the analyzer in place.

    On failure to connect the new analyzer, rolls back to the previous settings
    and reconnects the previous analyzer so the lane is never left offline."""
    global _analyzer
    from ..db.session import SessionLocal
    from ..db.models import AppSetting
    from ..analyzer.builder import build_analyzer_from_settings

    if req.type not in _ANALYZER_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"type must be one of {sorted(_ANALYZER_TYPES)}")
    if req.parity.upper() not in _PARITY_VALUES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "parity must be N, E, or O")
    if req.dataBits not in (7, 8):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "dataBits must be 7 or 8")
    if req.stopBits not in (1, 2):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "stopBits must be 1 or 2")
    if req.baud <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "baud must be positive")

    previous = _load_analyzer_settings()
    new_values = {
        "analyzer.type": req.type,
        "analyzer.port": req.port,
        "analyzer.baud": str(req.baud),
        "analyzer.data_bits": str(req.dataBits),
        "analyzer.parity": req.parity.upper(),
        "analyzer.stop_bits": str(req.stopBits),
        "analyzer.address": req.address,
    }

    def _persist(values: dict[str, str]) -> None:
        with SessionLocal() as session:
            for key, value in values.items():
                row = session.get(AppSetting, key)
                if row is None:
                    session.add(AppSetting(key=key, value=value))
                else:
                    row.value = value
            session.commit()

    _persist(new_values)

    old_analyzer = _analyzer
    try:
        new_analyzer = build_analyzer_from_settings()
        new_analyzer.connect()
    except Exception as exc:
        logger.exception("Failed to bring up new analyzer; rolling back")
        _persist({
            "analyzer.type": previous.type,
            "analyzer.port": previous.port,
            "analyzer.baud": str(previous.baud),
            "analyzer.data_bits": str(previous.dataBits),
            "analyzer.parity": previous.parity,
            "analyzer.stop_bits": str(previous.stopBits),
            "analyzer.address": previous.address,
        })
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"Could not connect with new settings: {exc}. Reverted to previous configuration.",
        ) from exc

    _analyzer = new_analyzer
    if old_analyzer is not None:
        try:
            old_analyzer.disconnect()
        except Exception:
            logger.exception("Error disconnecting previous analyzer (ignored)")

    return {"applied": True, "connected": new_analyzer.is_connected}


# ---------------------------------------------------------------------------
# Settings routes — camera hardware
# ---------------------------------------------------------------------------
_CAMERA_TYPES = {"mock", "opencv"}


class CameraSettings(BaseModel):
    type: str
    device: int


def _load_camera_settings() -> CameraSettings:
    from ..db.session import SessionLocal
    from ..db.models import AppSetting

    with SessionLocal() as session:
        rows = {
            r.key: (r.value or "")
            for r in session.query(AppSetting).filter(AppSetting.key.in_(("camera.type", "camera.device"))).all()
        }
    try:
        device = int(rows.get("camera.device", "0"))
    except ValueError:
        device = 0
    return CameraSettings(type=rows.get("camera.type", "mock"), device=device)


@app.get("/api/v1/cameras")
def list_cameras() -> list:
    """Probe local cameras and return ones the OS / OpenCV can open."""
    try:
        from ..camera.opencv_camera import list_available_cameras
        return list_available_cameras()
    except ImportError:
        return []


@app.get("/api/v1/settings/camera", response_model=CameraSettings)
def get_camera_settings() -> CameraSettings:
    return _load_camera_settings()


@app.put("/api/v1/settings/camera")
def update_camera_settings(req: CameraSettings) -> dict:
    """Persist new camera settings and rebuild the camera in place.

    On failure, rolls back to the previous settings and reopens the previous
    camera so the lane is never left without a capture device."""
    global _camera
    from ..db.session import SessionLocal
    from ..db.models import AppSetting
    from ..camera.builder import build_camera_from_settings

    if req.type not in _CAMERA_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"type must be one of {sorted(_CAMERA_TYPES)}")
    if req.device < 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "device must be >= 0")

    previous = _load_camera_settings()
    new_values = {
        "camera.type": req.type,
        "camera.device": str(req.device),
    }

    def _persist(values: dict[str, str]) -> None:
        with SessionLocal() as session:
            for key, value in values.items():
                row = session.get(AppSetting, key)
                if row is None:
                    session.add(AppSetting(key=key, value=value))
                else:
                    row.value = value
            session.commit()

    _persist(new_values)

    old_camera = _camera
    try:
        new_camera = build_camera_from_settings()
        new_camera.open()
    except Exception as exc:
        logger.exception("Failed to bring up new camera; rolling back")
        _persist({
            "camera.type": previous.type,
            "camera.device": str(previous.device),
        })
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"Could not open camera with new settings: {exc}. Reverted to previous configuration.",
        ) from exc

    _camera = new_camera
    if old_camera is not None:
        try:
            old_camera.close()
        except Exception:
            logger.exception("Error closing previous camera (ignored)")

    return {"applied": True}


@app.get("/analytics/fuel-split")
def analytics_fuel_split() -> list:
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest
    from sqlalchemy import func

    with SessionLocal() as session:
        rows = (
            session.query(EmissionTest.fuel_type, func.count(EmissionTest.id).label("count"))
            .group_by(EmissionTest.fuel_type)
            .all()
        )
        return [{"fuelType": r.fuel_type, "count": r.count} for r in rows]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _audit(session, action: str, entity_type: str | None, entity_id: str | None, detail: dict | None = None,
           user_id: str | None = None) -> None:
    from ..db.models import AuditLog

    session.add(
        AuditLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            detail_json=json.dumps(detail or {}, default=str),
            occurred_at=datetime.utcnow(),
        )
    )


def _require_nonblank(value, label: str) -> None:
    if value is None or str(value).strip() == "":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{label} is required")


def _validate_readings_for_do(fuel_type: str, readings: dict) -> None:
    if not readings:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "machine readings are required")
    gas_fields = ("co_pct", "hc_ppm", "co2_pct", "o2_pct", "lambda_value", "rpm")
    diesel_fields = ("opacity_pct", "k_value", "rpm")
    fields = gas_fields if fuel_type.upper() == "GAS" else diesel_fields
    for field in fields:
        value = readings.get(field)
        if value is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"reading {field} is required")
        try:
            numeric = float(value)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"reading {field} must be numeric") from exc
        if numeric <= 0:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"reading {field} must be greater than zero under DO 2023-008",
            )


def _validate_submission_payload(payload: dict, test, readings: dict, photo_count: int) -> None:
    _require_nonblank(payload.get("centerId"), "centerId")
    _require_nonblank(payload.get("centerName"), "centerName")
    _require_nonblank(payload.get("testId"), "testId")
    vehicle = payload.get("vehicle") or {}
    owner = payload.get("owner") or {}
    technician = payload.get("technician") or {}
    _require_nonblank(vehicle.get("plateNo"), "vehicle.plateNo")
    _require_nonblank(vehicle.get("fuelType"), "vehicle.fuelType")
    _require_nonblank(test.analyzer_serial, "analyzer serial")
    if owner.get("ownerType") == "ORGANIZATION":
        _require_nonblank(owner.get("organization"), "owner.organization")
    else:
        _require_nonblank(owner.get("lastName") or owner.get("organization"), "owner name")
    _require_nonblank(technician.get("technicianName"), "technician.technicianName")
    _require_nonblank(technician.get("tesdaCertNo") or technician.get("certificationNo"), "technician certification")
    _validate_readings_for_do(vehicle.get("fuelType") or test.fuel_type, readings)
    if photo_count <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "at least one captured test photo is required")


def _reading_to_dict(result) -> dict:
    from ..analyzer.base import GasReading, DieselReading
    r = result.reading
    if isinstance(r, GasReading):
        return {
            "co_pct": r.co_pct,
            "hc_ppm": r.hc_ppm,
            "co2_pct": r.co2_pct,
            "o2_pct": r.o2_pct,
            "lambda_value": r.lambda_value,
            "rpm": r.rpm,
            "oil_temp_c": r.oil_temp_c,
        }
    elif isinstance(r, DieselReading):
        return {
            "opacity_pct": r.opacity_pct,
            "k_value": r.k_value,
            "rpm": r.rpm,
            "boost_kpa": r.boost_kpa,
        }
    return {}


def _normalize_plate(value: str) -> str:
    return value.upper().replace(" ", "").replace("-", "")


def _owner_name_from_parts(owner: dict) -> str:
    if owner.get("ownerType") == "ORGANIZATION":
        return owner.get("organization") or ""
    return " ".join(
        part for part in [owner.get("firstName"), owner.get("middleName"), owner.get("lastName")]
        if part
    )


def _vehicle_info_to_response(info) -> dict:
    owner = {
        "ownerType": info.owner_type,
        "lastName": info.last_name,
        "firstName": info.first_name,
        "middleName": info.middle_name,
        "organization": info.organization,
        "address": info.address,
        "city": info.city,
    }
    vehicle = {
        "plateNo": info.plate_number,
        "plateNumber": info.plate_number,
        "mvNo": info.mv_no,
        "engineNo": info.engine_no,
        "chassisNo": info.chassis_no,
        "orType": info.or_type,
        "crDate": info.cr_date.isoformat(),
        "crNo": info.cr_no,
        "districtOffice": info.district_office,
        "make": info.make,
        "series": info.series,
        "model": info.series,
        "vehicleType": info.vehicle_type,
        "yearModel": info.year_model,
        "year": info.year_model,
        "color": info.color,
        "transmission": info.transmission,
        "fuelType": info.fuel_type,
        "ownerName": _owner_name_from_parts(owner),
    }
    return {"vehicle": vehicle, "owner": owner}


def _vehicle_cache_to_response(cached) -> dict:
    owner = {
        "ownerType": cached.owner_type,
        "lastName": cached.last_name or "",
        "firstName": cached.first_name or "",
        "middleName": cached.middle_name or "",
        "organization": cached.organization or "",
        "address": cached.address or "",
        "city": cached.city or "",
    }
    vehicle = {
        "plateNo": cached.plate_number,
        "plateNumber": cached.plate_number,
        "mvNo": cached.mv_no,
        "engineNo": cached.engine_no,
        "chassisNo": cached.chassis_no,
        "orType": cached.or_type,
        "crDate": cached.cr_date,
        "crNo": cached.cr_no,
        "districtOffice": cached.district_office,
        "make": cached.make,
        "series": cached.series or cached.model,
        "model": cached.series or cached.model,
        "vehicleType": cached.vehicle_type,
        "yearModel": cached.year_model or cached.year,
        "year": cached.year_model or cached.year,
        "color": cached.color,
        "transmission": cached.transmission,
        "fuelType": cached.fuel_type,
        "ownerName": cached.owner_name or _owner_name_from_parts(owner),
    }
    return {"vehicle": vehicle, "owner": owner}


def _update_vehicle_cache(cached, info, fetched_at: datetime, expires_at: datetime) -> None:
    owner = _vehicle_info_to_response(info)["owner"]
    cached.mv_no = info.mv_no
    cached.or_type = info.or_type
    cached.cr_date = info.cr_date.isoformat()
    cached.cr_no = info.cr_no
    cached.district_office = info.district_office
    cached.make = info.make
    cached.series = info.series
    cached.model = info.series
    cached.vehicle_type = info.vehicle_type
    cached.year_model = info.year_model
    cached.year = info.year_model
    cached.color = info.color
    cached.transmission = info.transmission
    cached.fuel_type = info.fuel_type
    cached.engine_no = info.engine_no
    cached.chassis_no = info.chassis_no
    cached.owner_type = info.owner_type
    cached.last_name = info.last_name
    cached.first_name = info.first_name
    cached.middle_name = info.middle_name
    cached.organization = info.organization
    cached.address = info.address
    cached.city = info.city
    cached.owner_name = _owner_name_from_parts(owner)
    cached.source = "LTMS"
    cached.fetched_at = fetched_at
    cached.expires_at = expires_at


def _readings_for_test(test) -> dict:
    if test.gas_result:
        r = test.gas_result
        return {
            "co_pct": r.co_pct,
            "hc_ppm": r.hc_ppm,
            "co2_pct": r.co2_pct,
            "o2_pct": r.o2_pct,
            "lambda_value": r.lambda_value,
            "rpm": r.rpm,
            "oil_temp_c": r.oil_temp_c,
        }
    if test.diesel_result:
        r = test.diesel_result
        return {
            "opacity_pct": r.opacity_pct,
            "k_value": r.k_value,
            "rpm": r.rpm,
            "boost_kpa": r.boost_kpa,
        }
    return {}


def _test_detail_to_response(test) -> dict:
    return {
        "id": test.id,
        "plateNumber": test.plate_number,
        "fuelType": test.fuel_type,
        "passFail": test.pass_fail,
        # SQLite returns its UTC timestamps as naive datetimes.  Always expose
        # an explicit UTC offset so the cloud cannot interpret a near-midnight
        # test as a different Asia/Manila business date.
        "startedAt": _utc_iso(test.started_at),
        "completedAt": _utc_iso(test.completed_at),
        "testedAt": _utc_iso(test.tested_at),
        "readings": _readings_for_test(test),
        "photos": [
            {
                "id": p.id,
                "testId": p.test_id,
                "photoType": p.photo_type,
                "mimeType": p.mime_type,
                "filePath": p.file_path,
                "capturedAt": _utc_iso(p.captured_at),
                "cameraId": p.camera_id,
            }
            for p in test.photos
        ],
        "ltmsState": test.ltms_submissions[0].state if test.ltms_submissions else None,
        "certificateNo": test.ltms_submissions[0].certificate_no if test.ltms_submissions else None,
        "submissionId": test.ltms_submissions[0].id if test.ltms_submissions else None,
        "centerId": test.center_id,
        "laneId": test.lane_id,
        "laneNumber": test.lane_number,
    }


_MANILA = ZoneInfo("Asia/Manila")
_LANE_QUOTA_MAX_AGE_SECONDS = 120


def _readiness_status(lane: Optional[dict], wallet: Optional[dict]) -> tuple[object | None, dict]:
    """Return the fail-closed operational gate without ever reading a key out."""
    # Explicit test-only escape hatch keeps legacy isolated API tests focused
    # on analyzer behavior. It is never used by an Electron launch.
    if os.environ.get("PETC_TEST_ALLOW_UNCONFIGURED") == "1":
        return None, {"ready": True, "reason": "Test mode"}
    from ..config import ConfigError, load_config
    try:
        config = load_config()
    except ConfigError as exc:
        return None, {"ready": False, "reason": str(exc)}

    reasons: list[str] = []
    startup_error = os.environ.get("PETC_STARTUP_COMPLIANCE_ERROR")
    if startup_error:
        reasons.append(startup_error)
    today = datetime.now(_MANILA).date().isoformat()
    now = datetime.now(timezone.utc)
    if not lane:
        reasons.append("Cloud lane profile is unavailable")
    else:
        fetched_at = lane.get("fetched_at")
        if isinstance(fetched_at, str):
            try:
                fetched_at = datetime.fromisoformat(fetched_at)
            except ValueError:
                fetched_at = None
        if fetched_at and fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        if not fetched_at or (now - fetched_at).total_seconds() > _LANE_QUOTA_MAX_AGE_SECONDS:
            reasons.append("Cloud lane profile or quota is offline/stale")
        actual_center = _trusted_center_id(lane)
        if actual_center != config.expected_center or config.expected_lane != lane.get("lane_number"):
            reasons.append("Credential identity does not match the commissioned center/lane")
        if lane.get("active") is not True:
            reasons.append("Commissioned lane is inactive")
        if lane.get("identity_conflict"):
            reasons.append("Unresolved tests belong to another lane")
        if lane.get("business_date") != today:
            reasons.append("Lane quota is not current for the Asia/Manila business date")
        if int(lane.get("remaining", 0)) <= 0:
            reasons.append("Lane quota is exhausted")
    if not wallet:
        reasons.append("Cloud wallet is unavailable")
    else:
        fetched_at = wallet.get("fetched_at")
        if isinstance(fetched_at, str):
            try:
                fetched_at = datetime.fromisoformat(fetched_at)
            except ValueError:
                fetched_at = None
        if fetched_at and fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        if not fetched_at or (now - fetched_at).total_seconds() > _LANE_QUOTA_MAX_AGE_SECONDS:
            reasons.append("Cloud wallet is offline/stale")
        if wallet.get("negative") or int(wallet.get("balance_centavos", 0)) < int(wallet.get("charge_per_upload_centavos", 1)):
            reasons.append("Center wallet is insufficient for a new test")
    return config, {"ready": not reasons, "reason": "; ".join(dict.fromkeys(reasons)) or "Ready for testing"}


def _require_start_readiness(lane: Optional[dict]) -> None:
    from ..submissions.reconciler import get_cached_wallet
    _config, readiness = _readiness_status(lane, get_cached_wallet())
    if not readiness["ready"]:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"code": "PETC_NOT_READY", "message": readiness["reason"]},
        )


def _manila_date(value: datetime) -> str:
    """Return a business date even for SQLite's legacy naive timestamps."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(_MANILA).date().isoformat()


def _utc_iso(value: Optional[datetime]) -> Optional[str]:
    """Serialize legacy naive SQLite datetimes as UTC, never local time."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _require_lane_start_capacity(lane: Optional[dict]) -> None:
    """Use the last cloud-authoritative capacity to keep a lane below its cap.

    No lane record means an older/dev cloud deployment, so existing local mock
    installs keep working. A stale record from a previous Philippine business
    date is also not used to block the new day.
    """
    if not lane:
        if is_production():
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                {"code": "LANE_QUOTA_UNAVAILABLE", "message": "A current lane quota is required before starting a production test."},
            )
        return
    if lane.get("identity_conflict"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "code": "LANE_IDENTITY_CHANGE_BLOCKED",
                "message": "This workstation has pending tests for another lane. Complete or resolve them before changing credentials.",
            },
        )
    if lane.get("active") is False:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "LANE_INACTIVE", "message": "This lane is inactive and cannot start tests."},
        )
    today = datetime.now(_MANILA).date().isoformat()
    fetched_at = lane.get("fetched_at")
    if isinstance(fetched_at, str):
        fetched_at = datetime.fromisoformat(fetched_at)
    if fetched_at and fetched_at.tzinfo is None:
        fetched_at = fetched_at.replace(tzinfo=timezone.utc)
    fresh = bool(fetched_at and (datetime.now(timezone.utc) - fetched_at).total_seconds() <= _LANE_QUOTA_MAX_AGE_SECONDS)
    if is_production() and (lane.get("business_date") != today or not fresh):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"code": "LANE_QUOTA_UNAVAILABLE", "message": "The lane quota is stale or unavailable. Reconnect to the cloud before starting a test."},
        )
    if lane.get("business_date") == today and int(lane.get("remaining", 0)) <= 0:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            {
                "code": "LANE_DAILY_UPLOAD_LIMIT_REACHED",
                "message": "This lane has no upload slots available today.",
                "used": lane.get("used", 0),
                "reserved": lane.get("reserved", 0),
                "limit": lane.get("limit"),
                "remaining": lane.get("remaining", 0),
                "resetsAt": lane.get("resets_at"),
            },
        )


def _require_current_lane_for_submission(test) -> None:
    """Reject late tests and lane credential swaps before photo/cloud work."""
    if _manila_date(test.tested_at) != datetime.now(_MANILA).date().isoformat():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "code": "LATE_TEST_SUBMISSION_NOT_ALLOWED",
                "message": "Tests must be submitted on the same Asia/Manila calendar date they were performed.",
            },
        )

    from ..submissions.reconciler import get_cached_lane_status
    lane = get_cached_lane_status()
    if not lane:
        return
    if lane.get("identity_conflict") or (test.lane_id and test.lane_id != lane.get("lane_id")):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "code": "LANE_IDENTITY_CHANGE_BLOCKED",
                "message": "This test belongs to a different lane and cannot be submitted from this workstation credential.",
            },
        )


def _lane_snapshot(test) -> dict:
    return {
        "center_id": test.center_id,
        "lane_id": test.lane_id,
        "lane_number": test.lane_number,
    }


def _trusted_center_id(lane: Optional[dict]) -> Optional[str]:
    """Center identity from the credential profile, not renderer input.

    Older profile responses exposed only tenantId. Keep that compatibility
    fallback during rollout, while retaining center_id separately whenever the
    lane-aware cloud supplies its operational center identifier.
    """
    if not lane:
        return None
    return lane.get("center_id") or lane.get("tenant_id")


def _apply_authoritative_lane_identity(payload: dict, lane: Optional[dict]) -> dict:
    """Replace display/CEC identity fields with the credential-bound profile."""
    if not lane or not lane.get("lane_id"):
        return dict(payload)
    return {
        **payload,
        "centerId": _trusted_center_id(lane),
        "centerName": lane.get("center_name"),
        "laneId": lane["lane_id"],
        "laneNumber": lane.get("lane_number"),
    }


def run(host: str = "127.0.0.1", port: int = 8765) -> None:
    uvicorn.run(app, host=host, port=port, log_level="info")
