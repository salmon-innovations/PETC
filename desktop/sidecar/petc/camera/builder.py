"""
Build a camera instance from the app_settings table.

Keys read:
  camera.type    "mock" | "opencv"
  camera.device  integer device index (default "0")
"""
from __future__ import annotations

import logging

from .capture import CameraCapture, MockCameraCapture

logger = logging.getLogger(__name__)


def _read_settings() -> dict[str, str]:
    from ..db.models import AppSetting
    from ..db.session import SessionLocal

    with SessionLocal() as session:
        rows = session.query(AppSetting).filter(AppSetting.key.like("camera.%")).all()
        return {r.key: (r.value or "") for r in rows}


def build_camera_from_settings() -> CameraCapture:
    settings = _read_settings()
    kind = settings.get("camera.type", "mock")

    if kind == "opencv":
        from .opencv_camera import OpenCvCameraCapture
        try:
            device = int(settings.get("camera.device", "0"))
        except ValueError:
            device = 0
        return OpenCvCameraCapture(device_index=device)

    if kind != "mock":
        logger.warning("Unknown camera.type=%r — falling back to MockCameraCapture", kind)
    return MockCameraCapture()
