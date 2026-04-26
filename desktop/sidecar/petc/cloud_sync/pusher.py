"""
Opportunistic cloud mirror pusher.

Drains the cloud_outbox table and POSTs each event to the cloud backend's
mirror ingest endpoint.  Failures are re-queued with back-off — the desktop
is fully functional even if the cloud is unreachable for days.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Optional

import httpx

from ..db.session import SessionLocal
from ..db.models import CloudOutbox

logger = logging.getLogger(__name__)

_BACKOFF = [5, 15, 60, 300, 900]
MAX_ATTEMPTS = 5


class CloudSyncPusher:
    """Daemon thread that mirrors local records to the cloud backend."""

    def __init__(
        self,
        cloud_base_url: str,
        center_id: str,
        api_key: str,
        poll_interval_s: float = 10.0,
    ) -> None:
        self._base_url = cloud_base_url.rstrip("/")
        self._center_id = center_id
        self._api_key = api_key
        self._interval = poll_interval_s
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True, name="petc-cloud-sync")
        self._thread.start()
        logger.info("CloudSyncPusher started")

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=10)

    def enqueue(self, entity_type: str, entity_id: str, payload: dict) -> None:
        """Called immediately after a local write to schedule a mirror push."""
        import uuid
        with SessionLocal() as session:
            row = CloudOutbox(
                id=str(uuid.uuid4()),
                entity_type=entity_type,
                entity_id=entity_id,
                payload_json=json.dumps(payload),
            )
            session.add(row)
            session.commit()

    # ----------------------------------------------------------------- private

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                self._flush()
            except Exception:
                logger.exception("CloudSyncPusher flush error")

    def _flush(self) -> None:
        now = time.time()
        with SessionLocal() as session:
            rows = (
                session.query(CloudOutbox)
                .filter(
                    CloudOutbox.status == "PENDING",
                    CloudOutbox.next_retry <= __import__("datetime").datetime.utcfromtimestamp(now),
                )
                .order_by(CloudOutbox.next_retry)
                .limit(20)
                .all()
            )

        for row in rows:
            self._send_row(row)

    def _send_row(self, row: CloudOutbox) -> None:
        url = f"{self._base_url}/api/ingest/mirror"
        try:
            with httpx.Client(timeout=15) as client:
                resp = client.post(
                    url,
                    json={
                        "center_id": self._center_id,
                        "entity_type": row.entity_type,
                        "entity_id": row.entity_id,
                        "payload": json.loads(row.payload_json),
                    },
                    headers={"X-Center-Key": self._api_key},
                )
                resp.raise_for_status()
            self._mark(row.id, "DONE")
        except Exception as exc:
            logger.warning("Mirror push failed id=%s: %s", row.id, exc)
            self._mark_failed(row.id, str(exc))

    def _mark(self, row_id: str, status: str) -> None:
        with SessionLocal() as session:
            row = session.get(CloudOutbox, row_id)
            if row:
                row.status = status
                session.commit()

    def _mark_failed(self, row_id: str, error: str) -> None:
        import datetime
        with SessionLocal() as session:
            row = session.get(CloudOutbox, row_id)
            if not row:
                return
            row.attempts += 1
            row.last_error = error
            if row.attempts >= MAX_ATTEMPTS:
                row.status = "DEAD"
            else:
                delay = _BACKOFF[min(row.attempts - 1, len(_BACKOFF) - 1)]
                row.next_retry = datetime.datetime.utcfromtimestamp(time.time() + delay)
                row.status = "PENDING"
            session.commit()
