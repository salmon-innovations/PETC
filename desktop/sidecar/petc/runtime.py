"""Runtime profile and DO 2023-008 guardrails."""
from __future__ import annotations

import os
from dataclasses import dataclass


PROFILES = {"dev", "accreditation-demo", "production"}
READING_CAPTURE_TIMEOUT_SECONDS = 5.0
STALE_RESULT_TTL_SECONDS = 120
FAILED_RETEST_LOCK_SECONDS = 3600
IMAGE_UPLOAD_GRACE_SECONDS = 3600
REPRINT_WINDOW_DAYS = 62


class ProductionConfigError(RuntimeError):
    """Raised when production is configured with demo or placeholder settings."""


def profile() -> str:
    value = os.environ.get("PETC_PROFILE", "dev").strip().lower() or "dev"
    if value not in PROFILES:
        raise ProductionConfigError(
            f"PETC_PROFILE must be one of {sorted(PROFILES)}; got {value!r}"
        )
    return value


def is_production() -> bool:
    return profile() == "production"


def allow_mock_paths() -> bool:
    return profile() in {"dev", "accreditation-demo"}


def is_placeholder_secret(value: str | None) -> bool:
    if value is None:
        return True
    normalized = value.strip().lower()
    return normalized in {
        "",
        "dev-insecure-key",
        "changeme",
        "change-me",
        "placeholder",
        "secret",
        "test",
    }


@dataclass(frozen=True)
class RuntimeConfig:
    profile: str
    analyzer: str
    camera: str
    printer: str
    gov_mock: bool
    cloud_url: str
    center_id: str
    cloud_key: str


def validate_desktop_startup_config(config: dict) -> RuntimeConfig:
    runtime = RuntimeConfig(
        profile=profile(),
        analyzer=str(config.get("analyzer", "")),
        camera=str(config.get("camera", "")),
        printer=str(config.get("printer", "")),
        gov_mock=bool(config.get("gov_mock")),
        cloud_url=str(config.get("cloud_url", "")).strip(),
        center_id=str(config.get("center_id", "")).strip(),
        cloud_key=str(config.get("cloud_key", "")).strip(),
    )
    if runtime.profile != "production":
        return runtime

    errors: list[str] = []
    if runtime.gov_mock:
        errors.append("PETC_GOV_MOCK must be false")
    if runtime.analyzer == "mock":
        errors.append("PETC_ANALYZER must use a real analyzer adapter")
    if runtime.camera == "mock":
        errors.append("PETC_CAMERA must use a real camera adapter")
    if runtime.printer == "mock":
        errors.append("PETC_PRINTER must use a real printer adapter")
    if not runtime.cloud_url or "localhost" in runtime.cloud_url or "127.0.0.1" in runtime.cloud_url:
        errors.append("PETC_CLOUD_URL must point to the authorized cloud endpoint")
    if runtime.center_id in {"", "dev-center", "mock-center"}:
        errors.append("PETC_CENTER_ID must be an issued PETC center identifier")
    if is_placeholder_secret(runtime.cloud_key):
        errors.append("PETC_CLOUD_KEY must be an issued non-placeholder center key")
    if errors:
        raise ProductionConfigError("Production profile is not compliant: " + "; ".join(errors))
    return runtime
