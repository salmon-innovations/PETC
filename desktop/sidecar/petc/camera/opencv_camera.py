"""
OpenCV-backed camera capture for production use.

On macOS this hits AVFoundation, on Windows it hits Media Foundation / DirectShow,
on Linux it hits V4L2 — all transparently via cv2.VideoCapture. The device index
is configurable via app_settings (camera.device, default 0).

We open and warm up the camera once at startup so the first capture() call
doesn't pay the camera-initialisation cost (which can be 1-2s on some webcams).
A short "grab a few discard frames" warmup also lets the auto-exposure stabilise
before the first photo.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone

from .capture import CameraCapture, CaptureError, Photo

logger = logging.getLogger(__name__)

_WARMUP_FRAMES = 5
_JPEG_QUALITY = 90


class OpenCvCameraCapture(CameraCapture):
    """Capture stills from a local camera via OpenCV."""

    def __init__(self, device_index: int = 0, camera_id: str | None = None) -> None:
        self._device_index = device_index
        self._camera_id = camera_id or f"opencv-cam-{device_index}"
        self._cap = None  # cv2.VideoCapture, set in open()
        self._lock = threading.Lock()

    def open(self) -> None:
        import cv2  # imported lazily so the sidecar can boot even if opencv is missing

        cap = cv2.VideoCapture(self._device_index)
        if not cap.isOpened():
            raise CaptureError(f"Could not open camera at index {self._device_index}")
        # Discard a few frames so auto-exposure / white balance stabilise
        for _ in range(_WARMUP_FRAMES):
            cap.read()
        self._cap = cap
        logger.info("OpenCvCamera opened: %s (device %d)", self._camera_id, self._device_index)

    def close(self) -> None:
        with self._lock:
            if self._cap is not None:
                self._cap.release()
                self._cap = None

    def capture(self) -> Photo:
        import cv2

        with self._lock:
            if self._cap is None:
                raise CaptureError("Camera not opened")
            ok, frame = self._cap.read()
            if not ok or frame is None:
                raise CaptureError("Camera read failed — device may have been unplugged")
            ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), _JPEG_QUALITY])
            if not ok:
                raise CaptureError("JPEG encode failed")
            return Photo(
                data=bytes(buf),
                mime_type="image/jpeg",
                captured_at=datetime.now(timezone.utc),
                camera_id=self._camera_id,
            )


def list_available_cameras(max_index: int = 5) -> list[dict]:
    """Probe device indices 0..max_index and return ones that opened successfully.

    Each entry: {"index": N, "label": "Camera N", "resolution": "WxH"}.
    Returns [] if cv2 isn't installed."""
    try:
        import cv2
    except ImportError:
        return []

    found: list[dict] = []
    for idx in range(max_index + 1):
        cap = cv2.VideoCapture(idx)
        if not cap.isOpened():
            cap.release()
            continue
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        found.append({
            "index": idx,
            "label": f"Camera {idx}",
            "resolution": f"{width}x{height}" if width and height else "unknown",
        })
        cap.release()
    return found
