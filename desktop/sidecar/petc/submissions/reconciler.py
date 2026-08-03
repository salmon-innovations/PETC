"""
Background reconciler for cloud LTMS submissions.

Polls the cloud every 30 s for any LtmsSubmission rows stuck in
PENDING or WAITING_FOR_LTMS that have a cloud_submission_id.
When the cloud reports a terminal state (ACCEPTED / REJECTED / DEAD),
updates the local row and renders the CEC PDF if accepted.

Started as a daemon thread by service.py alongside the CloudSyncPusher.
Silently no-ops when PETC_CLOUD_URL is not configured.
"""
from __future__ import annotations

import logging
import json
import threading
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_POLL_INTERVAL_S = 30.0
_WAITING_STATES = ("PENDING", "WAITING_FOR_LTMS")

# Last-known wallet balance, refreshed on each reconcile cycle.
#
# GET /status is polled by the desktop UI every 10 s and must stay instant and
# offline-tolerant, so it reads this cache rather than calling the cloud itself.
# The value is deliberately kept when a refresh fails: showing the last known
# balance with its timestamp is more useful to an operator than showing nothing,
# provided the UI marks it stale.
_wallet_lock = threading.Lock()
_wallet_cache: Optional[dict] = None
_WALLET_SETTING_KEY = "wallet.last_registered"


def get_cached_wallet() -> Optional[dict]:
    """Last-known wallet state, including the value restored from SQLite."""
    global _wallet_cache
    with _wallet_lock:
        if _wallet_cache is None:
            _wallet_cache = _load_persisted_wallet()
        return dict(_wallet_cache) if _wallet_cache else None


def _store_wallet(wallet) -> None:
    global _wallet_cache
    fetched_at = datetime.now(timezone.utc)
    value = {
        "tenant_id": wallet.tenant_id,
        "balance_centavos": wallet.balance_centavos,
        "low": wallet.low,
        "negative": wallet.negative,
        "blocked_count": wallet.blocked_count,
        "charge_per_upload_centavos": wallet.charge_per_upload_centavos,
        "low_balance_threshold_centavos": wallet.low_balance_threshold_centavos,
        "pricing_updated_at": wallet.pricing_updated_at,
        "fetched_at": fetched_at,
    }

    # Persist the cloud-authoritative price together with the center identity.
    # This is display-only state: it must never gate a local test or upload.
    try:
        from ..db.models import AppSetting
        from ..db.session import SessionLocal

        serializable = dict(value)
        serializable["fetched_at"] = fetched_at.isoformat()
        with SessionLocal() as session:
            row = session.get(AppSetting, _WALLET_SETTING_KEY)
            if row is None:
                row = AppSetting(key=_WALLET_SETTING_KEY)
                session.add(row)
            row.value = json.dumps(serializable, separators=(",", ":"))
            session.commit()
    except Exception:
        logger.exception("Could not persist last registered wallet price")

    with _wallet_lock:
        _wallet_cache = value


def _load_persisted_wallet() -> Optional[dict]:
    try:
        from ..db.models import AppSetting
        from ..db.session import SessionLocal

        with SessionLocal() as session:
            row = session.get(AppSetting, _WALLET_SETTING_KEY)
            if row is None or not row.value:
                return None
            value = json.loads(row.value)
        fetched_at = datetime.fromisoformat(value["fetched_at"])
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        value["fetched_at"] = fetched_at
        return value
    except Exception as exc:
        logger.warning("Could not load persisted wallet price: %s", exc)
        return None


class SubmissionReconciler:
    """Daemon thread that reconciles local LTMS submission rows with the cloud."""

    def __init__(self, poll_interval_s: float = _POLL_INTERVAL_S) -> None:
        self._interval = poll_interval_s
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._thread = threading.Thread(
            target=self._run, daemon=True, name="petc-submission-reconciler"
        )
        self._thread.start()
        logger.info("SubmissionReconciler started (interval=%ss)", self._interval)

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=10)

    # ── main loop ─────────────────────────────────────────────────────────

    def _run(self) -> None:
        from .. import cloud_client as cc

        while not self._stop.wait(self._interval):
            if not cc.is_available():
                continue
            client = cc.get_client()
            # Refresh the wallet first and independently of submission
            # reconciliation: the balance must keep updating even when there is
            # nothing pending, and a wallet failure must not stop reconciling.
            self._refresh_wallet(client)
            try:
                self._reconcile_once(client)
            except Exception:
                logger.exception("SubmissionReconciler error")

    def _refresh_wallet(self, cloud) -> None:
        try:
            _store_wallet(cloud.get_wallet())
        except Exception as exc:
            # Keep the previous cached value; the UI shows it as stale.
            logger.debug("Wallet refresh failed, keeping cached balance: %s", exc)

    def _reconcile_once(self, cloud) -> None:
        from ..db.session import SessionLocal
        from ..db.models import EmissionTest, LtmsSubmission

        with SessionLocal() as session:
            pending = (
                session.query(LtmsSubmission)
                .filter(
                    LtmsSubmission.state.in_(list(_WAITING_STATES)),
                    LtmsSubmission.cloud_submission_id.isnot(None),
                )
                .all()
            )

        if not pending:
            return

        logger.debug("Reconciling %d pending submission(s)", len(pending))

        for sub in pending:
            try:
                status = cloud.get_submission(sub.cloud_submission_id)
            except Exception:
                logger.warning(
                    "Could not poll cloud submission %s", sub.cloud_submission_id, exc_info=True
                )
                continue

            if not status.is_terminal:
                continue

            now = datetime.now(timezone.utc)
            pdf_path: Optional[str] = None

            if status.state == "ACCEPTED" and status.certificate_no:
                pdf_path = self._render_cec(sub, status, now)

            with SessionLocal() as session:
                row = session.get(LtmsSubmission, sub.id)
                if row is None:
                    continue
                row.state = status.state
                row.certificate_no = status.certificate_no
                row.ltms_reference_no = status.ltms_ref_no
                row.or_no = status.or_no
                row.dermalog_token = status.dermalog_token
                row.valid_from = status.valid_from
                row.valid_until = status.valid_until
                row.last_error = status.rejection_reason
                row.accepted_at = now if status.state == "ACCEPTED" else None
                if pdf_path:
                    row.pdf_path = pdf_path

                if status.state == "ACCEPTED":
                    test_row = session.get(EmissionTest, row.test_id)
                    if test_row:
                        test_row.uploaded_at = now

                session.commit()

            logger.info(
                "Submission %s resolved → %s (cert=%s)",
                sub.id,
                status.state,
                status.certificate_no,
            )

    def _render_cec(self, sub, status, now: datetime) -> Optional[str]:
        try:
            import json
            from ..cec.pdf import render_cec_pdf

            payload = json.loads(sub.payload_json) if sub.payload_json else {}
            path = render_cec_pdf(
                submission_id=sub.id,
                certificate_no=status.certificate_no,
                payload=payload,
                issued_at=now,
                or_no=status.or_no,
                dermalog_token=status.dermalog_token,
                valid_from=status.valid_from,
                valid_until=status.valid_until,
            )
            return str(path)
        except Exception:
            logger.exception("Failed to render CEC PDF for submission %s", sub.id)
            return None
