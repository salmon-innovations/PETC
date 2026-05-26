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
    "cloud_url": os.environ.get("PETC_CLOUD_URL", "http://localhost:8080"),
    "center_id": os.environ.get("PETC_CENTER_ID", "dev-center"),
    "cloud_key": os.environ.get("PETC_CLOUD_KEY", "dev-insecure-key"),
    "port": int(os.environ.get("PETC_PORT", "8765")),
}


def _build_analyzer():
    """Build the analyzer from the app_settings table, falling back to env vars
    via the seeded defaults in _seed_default_settings()."""
    from .analyzer.builder import build_analyzer_from_settings
    return build_analyzer_from_settings()


def run() -> None:
    from .camera.capture import MockCameraCapture
    from .printer.mock import MockPrinter
    from .gov.mock_client import MockGovRegistryClient
    from .gov.stradcom_client import StradcomGovRegistryClient
    from .db.session import init_db
    from .cloud_sync.pusher import CloudSyncPusher
    from .api.server import init as init_api, run as run_api

    init_db()
    logger.info("SQLite initialised")

    analyzer = _build_analyzer()
    camera = MockCameraCapture()
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
        logger.warning(
            "Analyzer connect failed at boot (%s) — sidecar starting anyway; "
            "operator can switch type or port from Settings.",
            exc,
        )
    camera.open()
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

    init_api(analyzer, camera, printer, gov_client, cloud_sync)

    logger.info("PETC sidecar starting on port %s", _CONFIG["port"])
    try:
        run_api(host="127.0.0.1", port=_CONFIG["port"])
    finally:
        cloud_sync.stop()
        camera.close()
        analyzer.disconnect()
        logger.info("PETC sidecar stopped")


if __name__ == "__main__":
    run()
