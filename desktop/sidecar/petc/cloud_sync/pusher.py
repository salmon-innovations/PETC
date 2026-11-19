"""Retired compatibility shim for the former mirror ingest path.

The old ``/api/ingest/mirror`` endpoint was an unauthenticated parallel path
to submissions and commonly returned 403.  Test submission is now persisted
in SQLite and sent only through the idempotent ``/api/submissions`` workflow.
This shim remains temporarily so older local API call sites do not lose their
audit writes during an upgrade, but it never performs a network request.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

class CloudSyncPusher:
    """Compatibility sink; cloud submission is owned by submissions/reconciler."""

    def __init__(
        self,
        cloud_base_url: str,
        center_id: str,
        api_key: str,
        poll_interval_s: float = 10.0,
    ) -> None:
        # Keep the constructor signature so mixed-version installs start
        # cleanly. Values (especially api_key) are deliberately not retained.
        del cloud_base_url, center_id, api_key, poll_interval_s

    def start(self) -> None:
        # Existing installs can have mirror rows left in PENDING. They are not
        # submission work and must neither look like a stuck queue nor be sent
        # to the retired endpoint after upgrade.
        from ..db.models import CloudOutbox
        from ..db.session import SessionLocal
        with SessionLocal() as session:
            session.query(CloudOutbox).filter(CloudOutbox.status == "PENDING").update(
                {CloudOutbox.status: "RETIRED", CloudOutbox.last_error: "Legacy mirror path retired"},
                synchronize_session=False,
            )
            session.commit()
        logger.info("Legacy mirror sync retired; using durable submission workflow")

    def stop(self) -> None:
        return None

    def enqueue(self, entity_type: str, entity_id: str, payload: dict) -> None:
        """No-op: records are persisted by their owning local transactions.

        ``payload`` is explicitly discarded so diagnostic/audit data cannot
        accidentally include an issued key or revive the legacy mirror route.
        """
        del entity_type, entity_id, payload
