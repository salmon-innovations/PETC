"""Background thread that drains the outbox to the cloud web app."""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional

import httpx

from ..queue.outbox import Outbox, OutboxEntry

logger = logging.getLogger(__name__)


class SyncWorker:
    """
    Runs in a daemon thread.  Calls outbox.poll_pending() on a fixed interval,
    forwarding each entry to the web app via HTTP POST.
    """

    def __init__(
        self,
        outbox: Outbox,
        web_app_base_url: str,
        api_key: str,
        poll_interval_s: float = 5.0,
    ) -> None:
        self._outbox = outbox
        self._base_url = web_app_base_url.rstrip("/")
        self._api_key = api_key
        self._poll_interval = poll_interval_s
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True, name="petc-sync")
        self._thread.start()
        logger.info("SyncWorker started (interval=%ss)", self._poll_interval)

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=10)

    def _run(self) -> None:
        while not self._stop_event.wait(self._poll_interval):
            try:
                n = self._outbox.poll_pending(self._send)
                if n:
                    logger.debug("SyncWorker flushed %d entries", n)
            except Exception:
                logger.exception("SyncWorker poll error")

    def _send(self, entry: OutboxEntry) -> None:
        url = f"{self._base_url}/api/agent/events"
        with httpx.Client(timeout=15) as client:
            resp = client.post(
                url,
                json={"event_type": entry.event_type, "payload": entry.payload},
                headers={"X-Agent-Key": self._api_key},
            )
            resp.raise_for_status()
