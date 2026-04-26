"""
FastAPI server bound to 127.0.0.1 only.
The Electron renderer talks to the sidecar through these endpoints via IPC-resolved URL.
"""
from __future__ import annotations

import logging
import os
import uuid
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ..analyzer.base import Analyzer, AnalyzerConnectionError, AnalyzerTimeoutError, FuelType
from ..camera.capture import CameraCapture, CaptureError
from ..printer.base import Printer, ReceiptData
from ..gov.base import GovRegistryClient
from ..cloud_sync.pusher import CloudSyncPusher

logger = logging.getLogger(__name__)

app = FastAPI(title="PETC Sidecar", version="0.1.0")

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
    from ..db.models import CloudOutbox
    with SessionLocal() as session:
        pending = session.query(CloudOutbox).filter(CloudOutbox.status == "PENDING").count()
    return StatusResponse(
        analyzer_connected=analyzer.is_connected,
        printer_status=printer.check_status(),
        cloud_outbox_pending=pending,
        agent_version="0.1.0",
    )


@app.post("/test/start", response_model=StartTestResponse)
def start_test(
    req: StartTestRequest,
    analyzer: Analyzer = Depends(_get_analyzer),
    cloud_sync: CloudSyncPusher = Depends(_get_cloud_sync),
) -> StartTestResponse:
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest, User

    started_at = datetime.now(timezone.utc)
    try:
        token = analyzer.start_test(FuelType(req.fuel_type.upper()))
    except AnalyzerConnectionError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "fuel_type must be GAS or DIESEL") from exc

    test_id = str(uuid.uuid4())
    with SessionLocal() as session:
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
            operator_id=req.operator_id,
            plate_number=req.plate_number.upper().replace(" ", ""),
            fuel_type=req.fuel_type.upper(),
            session_token=token,
            started_at=started_at,
            tested_at=started_at,
        )
        session.add(test)
        session.commit()

    cloud_sync.enqueue(
        "emission_test_started",
        test_id,
        {
            "id": test_id,
            "operator_id": req.operator_id,
            "plate_number": req.plate_number.upper().replace(" ", ""),
            "fuel_type": req.fuel_type.upper(),
            "started_at": started_at.isoformat(),
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

    try:
        result = analyzer.read_result(session_token)
    except AnalyzerTimeoutError as exc:
        raise HTTPException(status.HTTP_408_REQUEST_TIMEOUT, str(exc)) from exc

    readings = _reading_to_dict(result)
    captured_at = result.captured_at

    with SessionLocal() as session:
        test = session.query(EmissionTest).filter(EmissionTest.session_token == session_token).first()
        if test is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Session {session_token} not found")

        test.fuel_type = result.fuel_type.value
        test.pass_fail = result.pass_fail
        test.analyzer_serial = result.serial_no
        test.raw_bytes_hex = result.raw_bytes.hex()
        test.tested_at = captured_at
        test.completed_at = captured_at

        if result.fuel_type is FuelType.GAS:
            session.merge(GasTestResult(test_id=test.id, **readings))
        else:
            session.merge(DieselTestResult(test_id=test.id, **readings))
        session.commit()
        test_id = test.id

    cloud_sync.enqueue(
        "emission_test_result",
        test_id,
        {
            "id": test_id,
            "session_token": session_token,
            "fuel_type": result.fuel_type.value,
            "pass_fail": result.pass_fail,
            "serial_no": result.serial_no,
            "captured_at": captured_at.isoformat(),
            "readings": readings,
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


@app.post("/camera/capture")
def capture_photo(
    req: CapturePhotoRequest = CapturePhotoRequest(),
    camera: CameraCapture = Depends(_get_camera),
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
            session.commit()

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

    plate = _normalize_plate(req.plate)
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with SessionLocal() as session:
        cached = session.query(VehicleCache).filter(VehicleCache.plate_number == plate).first()
        if cached and cached.expires_at > now:
            return {
                "found": True,
                "source": "LTMS_CACHE",
                "fetchedAt": cached.fetched_at.isoformat(),
                **_vehicle_cache_to_response(cached),
            }

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
    info = gov.find_vehicle(plate_number)
    if info is None:
        return {"found": False, "vehicle": None}
    return {"found": True, **_vehicle_info_to_response(info)}


@app.get("/gov/driver/{license_no}")
def lookup_driver(
    license_no: str,
    gov: GovRegistryClient = Depends(_get_gov),
) -> dict:
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

    with SessionLocal() as session:
        test = session.get(EmissionTest, test_id)
        if test is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Test {test_id} not found")

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
            state=result.state,
            certificate_no=result.certificate_no,
            submitted_at=datetime.now(timezone.utc),
            accepted_at=datetime.now(timezone.utc) if result.state == "ACCEPTED" else None,
            last_error=result.rejection_reason,
        )
        session.add(sub)
        session.commit()

    cloud_sync.enqueue("ltms_submission", sub.id, {
        "test_id": test_id, "state": result.state,
        "certificate_no": result.certificate_no,
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
    printer: Printer = Depends(_get_printer),
    cloud_sync: CloudSyncPusher = Depends(_get_cloud_sync),
) -> dict:
    from ..gov.base import EmissionPayload
    from ..db.session import SessionLocal
    from ..db.models import EmissionTest, GovOutbox, LtmsSubmission, Receipt

    payload = req.payload
    test_id = payload.get("testId")
    if not test_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "payload.testId is required")

    now = datetime.now(timezone.utc)
    request_json = json.dumps(payload, default=str)

    with SessionLocal() as session:
        test = session.get(EmissionTest, test_id)
        if test is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Test {test_id} not found")

        vehicle = payload.get("vehicle", {})
        technician = payload.get("technician", {})
        photos = payload.get("photos", [])
        readings = payload.get("readings") or _readings_for_test(test)

        emission_payload = EmissionPayload(
            test_id=test_id,
            plate_number=vehicle.get("plateNo") or test.plate_number,
            license_no="",
            fuel_type=vehicle.get("fuelType") or test.fuel_type,
            pass_fail=bool(payload.get("verdict", {}).get("pass", test.pass_fail)),
            readings=readings,
            photo_paths=[p.get("filePath", "") for p in photos if p.get("filePath")],
            operator_id=test.operator_id,
            center_id=payload.get("centerId") or os.environ.get("PETC_CENTER_ID", "dev-center"),
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
            outbox.response_json = json.dumps(
                {
                    "state": result.state,
                    "certificateNo": result.certificate_no,
                    "rejectionReason": result.rejection_reason,
                }
            )
        except Exception as exc:
            sub_id = str(uuid.uuid4())
            sub = LtmsSubmission(
                id=sub_id,
                test_id=test_id,
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
        sub = LtmsSubmission(
            id=sub_id,
            test_id=test_id,
            payload_json=request_json,
            state=result.state,
            certificate_no=result.certificate_no,
            ltms_reference_no=result.certificate_no,
            submitted_at=now,
            accepted_at=now if result.state == "ACCEPTED" else None,
            last_error=result.rejection_reason,
        )
        session.add(sub)

        if result.state == "ACCEPTED":
            test.uploaded_at = now
            receipt = Receipt(
                id=str(uuid.uuid4()),
                test_id=test_id,
                copy_count=2,
                printed_at=now,
            )
            session.add(receipt)

        session.commit()

    if result.state == "ACCEPTED":
        printer.print_receipt(
            ReceiptData(
                test_id=test_id,
                plate_number=vehicle.get("plateNo") or "",
                vehicle_make=vehicle.get("make") or "",
                vehicle_model=vehicle.get("series") or "",
                year=int(vehicle.get("yearModel") or 0),
                fuel_type=vehicle.get("fuelType") or "",
                pass_fail=bool(payload.get("verdict", {}).get("pass", False)),
                operator_name=technician.get("technicianName") or "Operator",
                center_name=payload.get("centerName") or "PETC Center",
                printed_at=now,
                certificate_no=result.certificate_no,
                raw_readings=readings,
            ),
            copies=2,
        )

    cloud_sync.enqueue(
        "ltms_submission",
        sub_id,
        {
            "test_id": test_id,
            "state": result.state,
            "certificate_no": result.certificate_no,
            "submitted_at": now.isoformat(),
        },
    )

    return {
        "state": result.state,
        "certificateNo": result.certificate_no,
        "rejectionReason": result.rejection_reason,
        "queued": False,
        "submissionId": sub_id,
    }


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
                "startedAt": t.started_at.isoformat() if t.started_at else None,
                "completedAt": t.completed_at.isoformat() if t.completed_at else None,
                "ltmsState": t.ltms_submissions[0].state if t.ltms_submissions else None,
                "certificateNo": t.ltms_submissions[0].certificate_no if t.ltms_submissions else None,
                "photoCount": len(t.photos),
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
                "capturedAt": p.captured_at.isoformat() if p.captured_at else None,
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
    from ..db.models import EmissionTest, LtmsSubmission
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
    from sqlalchemy import func, cast, Date, Integer

    with SessionLocal() as session:
        cutoff = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        from datetime import timedelta
        cutoff = cutoff - timedelta(days=days - 1)

        rows = (
            session.query(
                cast(EmissionTest.started_at, Date).label("date"),
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
        "startedAt": test.started_at.isoformat() if test.started_at else None,
        "completedAt": test.completed_at.isoformat() if test.completed_at else None,
        "testedAt": test.tested_at.isoformat() if test.tested_at else None,
        "readings": _readings_for_test(test),
        "photos": [
            {
                "id": p.id,
                "testId": p.test_id,
                "photoType": p.photo_type,
                "mimeType": p.mime_type,
                "filePath": p.file_path,
                "capturedAt": p.captured_at.isoformat() if p.captured_at else None,
                "cameraId": p.camera_id,
            }
            for p in test.photos
        ],
        "ltmsState": test.ltms_submissions[0].state if test.ltms_submissions else None,
        "certificateNo": test.ltms_submissions[0].certificate_no if test.ltms_submissions else None,
    }


def run(host: str = "127.0.0.1", port: int = 8765) -> None:
    uvicorn.run(app, host=host, port=port, log_level="info")
