"""
Sidecar entry point — spawned by Electron main process.

Dev:   python -m petc.service
Prod:  petc_sidecar.exe  (PyInstaller frozen)
"""
from __future__ import annotations

import logging
import os
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("petc.service")

# ── configuration (env vars set by Electron main process) ─────────────────
_CONFIG = {
    # PETC_ANALYZER: "mock" | "serial_gas" | "serial_diesel"
    "analyzer": os.environ.get("PETC_ANALYZER", "mock"),
    # PETC_ANALYZER_PORT: COM port for serial adapters, e.g. "COM3" or "/dev/ttyUSB0"
    "analyzer_port": os.environ.get("PETC_ANALYZER_PORT", "COM1"),
    # PETC_ANALYZER_BAUD: baud rate for serial adapters (default 9600)
    "analyzer_baud": int(os.environ.get("PETC_ANALYZER_BAUD", "9600")),
    "camera": os.environ.get("PETC_CAMERA", "mock"),
    "printer": os.environ.get("PETC_PRINTER", "mock"),
    "gov_mock": os.environ.get("PETC_GOV_MOCK", "true").lower() == "true",
    # Cloud identity is loaded exclusively from petc.properties in run().
    "cloud_url": "",
    "center_id": "",
    "cloud_key": "",
    "port": int(os.environ.get("PETC_PORT", "8765")),
}


def _build_analyzer():
    """Build the analyzer from the app_settings table, falling back to env vars
    via the seeded defaults in _seed_default_settings()."""
    from .analyzer.builder import build_analyzer_from_settings
    return build_analyzer_from_settings()


def run() -> None:
    from .camera.builder import build_camera_from_settings
    from .printer.mock import MockPrinter
    from .gov.mock_client import MockGovRegistryClient
    from .gov.stradcom_client import StradcomGovRegistryClient
    from .db.session import init_db
    from .cloud_sync.pusher import CloudSyncPusher
    from .api.server import init as init_api, run as run_api
    from .runtime import ProductionConfigError, is_production, validate_desktop_startup_config
    from .config import ConfigError, load_config
    from .cloud_client import configure_identity

    os.environ.pop("PETC_STARTUP_COMPLIANCE_ERROR", None)
    try:
        installation = load_config()
        _CONFIG.update({
            "profile": installation.profile,
            "cloud_url": installation.cloud_url,
            "center_id": installation.expected_center,
            "cloud_key": installation.cloud_key,
        })
        # Do not log any property values here; particularly never the lane key.
        configure_identity(installation.cloud_url, installation.cloud_key)
        os.environ["PETC_RUNTIME_PROFILE"] = installation.profile
    except ConfigError as exc:
        # The local API must remain up for the shared commissioning and
        # diagnostic UI. /test/start applies the readiness gate and fails shut.
        logger.warning("PETC cloud commissioning is incomplete: %s", exc)
        # A packaged process must fail closed even if its parent happened to
        # carry legacy PETC_CLOUD_* environment variables.
        configure_identity("", "")
        _CONFIG["profile"] = "production" if sys.platform == "win32" else "dev"
        os.environ["PETC_RUNTIME_PROFILE"] = _CONFIG["profile"]

    try:
        runtime_config = validate_desktop_startup_config(_CONFIG)
    except ProductionConfigError as exc:
        logger.warning("Production readiness is incomplete; diagnostics/commissioning remain available: %s", exc)
        # Safe, descriptive field consumed by the API readiness gate. The
        # validation error names settings only and never includes a lane key.
        os.environ["PETC_STARTUP_COMPLIANCE_ERROR"] = str(exc)
        # Keep a usable descriptive profile in startup diagnostics instead of
        # crashing before an administrator can repair a fresh install.
        runtime_config = type("Runtime", (), {"profile": _CONFIG["profile"]})()

    init_db()
    logger.info("SQLite initialised (profile=%s)", runtime_config.profile)

    analyzer = _build_analyzer()
    camera = build_camera_from_settings()
    printer = MockPrinter()

    gov_client = (
        MockGovRegistryClient()
        if _CONFIG["gov_mock"]
        else StradcomGovRegistryClient(
            base_url=_CONFIG["cloud_url"],
            api_key=_CONFIG["cloud_key"],
        )
    )

    try:
        analyzer.connect()
    except Exception as exc:
        if is_production():
            logger.exception("Analyzer connect failed in production")
            raise
        logger.warning(
            "Analyzer connect failed at boot (%s) — sidecar starting anyway; "
            "operator can switch type or port from Settings.",
            exc,
        )
    try:
        camera.open()
    except Exception as exc:
        if is_production():
            logger.exception("Camera open failed in production")
            raise
        logger.warning(
            "Camera open failed at boot (%s) — sidecar starting anyway; "
            "operator can switch device from Settings.",
            exc,
        )
    logger.info(
        "Hardware initialised (analyzer=%s port=%s, camera=%s, printer=%s, gov_mock=%s)",
        _CONFIG["analyzer"], _CONFIG["analyzer_port"],
        _CONFIG["camera"], _CONFIG["printer"], _CONFIG["gov_mock"],
    )

    cloud_sync = CloudSyncPusher(
        cloud_base_url=_CONFIG["cloud_url"],
        center_id=_CONFIG["center_id"],
        api_key=_CONFIG["cloud_key"],
    )
    cloud_sync.start()

    from .submissions.reconciler import SubmissionReconciler
    reconciler = SubmissionReconciler()
    reconciler.start()

    init_api(analyzer, camera, printer, gov_client, cloud_sync)

    logger.info("PETC sidecar starting on port %s", _CONFIG["port"])
    try:
        run_api(host="127.0.0.1", port=_CONFIG["port"])
    finally:
        reconciler.stop()
        cloud_sync.stop()
        camera.close()
        analyzer.disconnect()
        logger.info("PETC sidecar stopped")


if __name__ == "__main__":
    run()
