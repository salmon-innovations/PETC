"""PETC installation configuration.

Cloud identity is deliberately kept out of environment variables.  Production
Windows installs read ``petc.properties`` next to PETC Desktop.exe; macOS is a
development target and reads ``desktop/petc.properties``.  ``PETC_CONFIG_PATH``
is intentionally only honoured by an unfrozen development/test sidecar.
"""
from __future__ import annotations

import os
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


REQUIRED_KEYS = ("petc.profile", "petc.cloud.url", "petc.cloud.key", "petc.expected.center", "petc.expected.lane")
PROFILES = {"dev", "accreditation-demo", "production"}


class ConfigError(ValueError):
    """A safe configuration error.  It must never contain the lane key."""


@dataclass(frozen=True)
class PetcConfig:
    profile: str
    cloud_url: str
    cloud_key: str
    expected_center: str
    expected_lane: int
    path: Path

    def public(self) -> dict[str, str | bool | int]:
        """Values safe for diagnostics and the renderer (never the raw key)."""
        return {
            "profile": self.profile,
            "cloudUrl": self.cloud_url,
            "expectedCenter": self.expected_center,
            "expectedLane": self.expected_lane,
            "keyConfigured": bool(self.cloud_key),
            "keyMasked": mask_secret(self.cloud_key),
        }


def mask_secret(value: str | None) -> str:
    if not value:
        return "Not configured"
    # Do not make a short issued key easier to guess in diagnostics.
    return "••••••••" if len(value) <= 8 else f"••••••••{value[-4:]}"


def default_config_path() -> Path:
    packaged_path = os.environ.get("PETC_PACKAGED_CONFIG_PATH", "").strip()
    # This variable is populated only by the Electron main process in the
    # packaged app from app.getPath("exe"). It is not a user override.
    if packaged_path and getattr(sys, "frozen", False):
        return Path(packaged_path).resolve()
    override = os.environ.get("PETC_CONFIG_PATH", "").strip()
    # A production binary must not be redirected through an ambient env var.
    if override and not getattr(sys, "frozen", False):
        return Path(override).expanduser().resolve()
    if sys.platform == "win32" and getattr(sys, "frozen", False):
        # Electron launches the frozen sidecar with cwd beside PETC Desktop.exe.
        return Path.cwd() / "petc.properties"
    # .../desktop/sidecar/petc/config.py -> .../desktop/petc.properties
    return Path(__file__).resolve().parents[2] / "petc.properties"


def parse_properties(text: str) -> Mapping[str, str]:
    values: dict[str, str] = {}
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith(("#", "!")):
            continue
        separator = next((i for i, c in enumerate(line) if c in "=:"), -1)
        if separator < 1:
            raise ConfigError(f"Invalid properties entry on line {number}")
        key, value = line[:separator].strip(), line[separator + 1 :].strip()
        if not key:
            raise ConfigError(f"Invalid properties entry on line {number}")
        values[key] = value
    return values


def _default_profile() -> str:
    return "production" if sys.platform == "win32" else "dev"


def load_config(path: Path | None = None) -> PetcConfig:
    path = path or default_config_path()
    if not path.exists():
        raise ConfigError("PETC commissioning is required: petc.properties is missing")
    try:
        values = parse_properties(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ConfigError("PETC configuration could not be read") from exc
    missing = [key for key in REQUIRED_KEYS if not values.get(key, "").strip()]
    if missing:
        raise ConfigError("PETC commissioning is required: " + ", ".join(missing) + " is missing")
    profile = values.get("petc.profile", _default_profile()).strip().lower()
    if profile not in PROFILES:
        raise ConfigError("petc.profile must be dev, accreditation-demo, or production")
    url = values["petc.cloud.url"].strip().rstrip("/")
    if not url.startswith(("https://", "http://")):
        raise ConfigError("petc.cloud.url must be an http(s) URL")
    if profile == "production" and (url.startswith("http://") or "localhost" in url.lower() or "127.0.0.1" in url):
        raise ConfigError("Production cloud URL must be an authorized HTTPS endpoint")
    return PetcConfig(
        profile=profile,
        cloud_url=url,
        cloud_key=values["petc.cloud.key"].strip(),
        expected_center=values["petc.expected.center"].strip(),
        expected_lane=_lane_number(values["petc.expected.lane"]),
        path=path,
    )


def _lane_number(value: str | int) -> int:
    try:
        lane = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise ConfigError("petc.expected.lane must be a positive lane number") from exc
    if lane < 1:
        raise ConfigError("petc.expected.lane must be a positive lane number")
    return lane


def write_config(*, cloud_url: str, cloud_key: str, expected_center: str, expected_lane: str | int, profile: str | None = None, path: Path | None = None) -> PetcConfig:
    """Atomically replace only the cloud identity properties, with no logging."""
    destination = path or default_config_path()
    effective_profile = (profile or _default_profile()).strip().lower()
    values = {
        "petc.profile": effective_profile,
        "petc.cloud.url": cloud_url.strip().rstrip("/"),
        "petc.cloud.key": cloud_key.strip(),
        "petc.expected.center": expected_center.strip(),
        "petc.expected.lane": str(expected_lane).strip(),
    }
    # Validate before anything touches disk; use an in-memory equivalent.
    missing = [key for key in REQUIRED_KEYS if not values[key]]
    if missing:
        raise ConfigError("All commissioning fields are required")
    if effective_profile not in PROFILES:
        raise ConfigError("petc.profile must be dev, accreditation-demo, or production")
    if effective_profile == "production" and (not values["petc.cloud.url"].startswith("https://") or "localhost" in values["petc.cloud.url"].lower()):
        raise ConfigError("Production cloud URL must be an authorized HTTPS endpoint")
    _lane_number(values["petc.expected.lane"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = "# PETC Desktop cloud commissioning. Keep this file restricted.\n" + "".join(f"{key}={value}\n" for key, value in values.items())
    fd, temporary = tempfile.mkstemp(prefix=".petc.", suffix=".properties", dir=destination.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
        if os.name != "nt":
            os.chmod(temporary, 0o600)
        os.replace(temporary, destination)
    except OSError as exc:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise ConfigError("PETC configuration could not be saved; administrator permission may be required") from exc
    return load_config(destination)
