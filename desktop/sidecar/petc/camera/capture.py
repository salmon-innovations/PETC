"""Camera capture ABC + mock implementation."""
from __future__ import annotations

import abc
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_MOCK_JPEG = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xd9"
)


@dataclass
class Photo:
    data: bytes
    mime_type: str
    captured_at: datetime
    camera_id: str


class CameraCapture(abc.ABC):
    @abc.abstractmethod
    def capture(self) -> Photo:
        """Take a still image and return it."""

    @abc.abstractmethod
    def open(self) -> None:
        """Initialize the camera device."""

    @abc.abstractmethod
    def close(self) -> None:
        """Release the camera device."""


class CaptureError(Exception):
    pass


class MockCameraCapture(CameraCapture):
    def __init__(self, camera_id: str = "mock-cam-0") -> None:
        self._camera_id = camera_id
        self._open = False

    def open(self) -> None:
        self._open = True
        logger.info("MockCamera opened: %s", self._camera_id)

    def close(self) -> None:
        self._open = False

    def capture(self) -> Photo:
        if not self._open:
            raise CaptureError("Camera not opened")
        return Photo(
            data=_MOCK_JPEG,
            mime_type="image/jpeg",
            captured_at=datetime.utcnow(),
            camera_id=self._camera_id,
        )
