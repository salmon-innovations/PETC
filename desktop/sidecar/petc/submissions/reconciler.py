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
import hashlib
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

_POLL_INTERVAL_S = 30.0
_WAITING_STATES = ("PENDING", "WAITING_FOR_LTMS")
_RETRY_BACKOFF_SECONDS = (5, 15, 60, 300, 900)
_MANILA = ZoneInfo("Asia/Manila")
# Foreground submission and the daemon may notice the same durable row at the
# same time.  A small fixed set of striped locks prevents duplicate evidence
# uploads/cloud POSTs without retaining one lock forever for every test UUID.
_DISPATCH_LOCKS = tuple(threading.Lock() for _ in range(32))

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

# A lane credential is an installation identity, not an operator preference.
# Persisting this snapshot lets the workstation remain safe through a restart
# and detects an accidental credential swap while it still has local work.
_lane_lock = threading.Lock()
_lane_cache: Optional[dict] = None
_LANE_SETTING_KEY = "lane.last_authoritative_status"


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


def get_cached_lane_status() -> Optional[dict]:
    """Last cloud-authoritative lane profile and daily quota, if available."""
    global _lane_cache
    with _lane_lock:
        if _lane_cache is None:
            _lane_cache = _load_persisted_lane_status()
        return dict(_lane_cache) if _lane_cache else None


def _store_lane_status(profile, quota) -> None:
    """Persist a matched profile/quota pair without moving pending work lanes."""
    global _lane_cache
    fetched_at = datetime.now(timezone.utc)
    value = {
        "tenant_id": profile.tenant_id,
        "center_id": profile.center_id,
        "center_name": profile.center_name,
        "lane_id": profile.lane_id,
        "lane_number": profile.lane_number,
        "active": profile.active,
        "used": quota.used,
        "reserved": quota.reserved,
        "limit": quota.limit,
        "remaining": quota.remaining,
        "business_date": quota.business_date,
        "resets_at": quota.resets_at,
        "fetched_at": fetched_at,
        "identity_conflict": False,
    }

    try:
        from ..db.models import AppSetting, EmissionTest, LtmsSubmission
        from ..db.session import SessionLocal

        with SessionLocal() as session:
            # Do not silently repurpose a physical workstation. Tests not yet
            # uploaded must stay with the credential/lane that started them.
            pending_other_lane = session.query(EmissionTest).filter(
                EmissionTest.lane_id.isnot(None),
                EmissionTest.lane_id != profile.lane_id,
                EmissionTest.uploaded_at.is_(None),
                EmissionTest.ltms_submissions.any(LtmsSubmission.state.in_(["PENDING", "WAITING_FOR_LTMS"])),
            ).first()
            if pending_other_lane is not None:
                cached = get_cached_lane_status() or {}
                cached["identity_conflict"] = True
                cached["conflict_lane_id"] = profile.lane_id
                cached["conflict_center_id"] = profile.center_id or profile.tenant_id
                cached["conflict_lane_number"] = profile.lane_number
                with _lane_lock:
                    _lane_cache = cached
                return

            row = session.get(AppSetting, _LANE_SETTING_KEY)
            if row is None:
                row = AppSetting(key=_LANE_SETTING_KEY)
                session.add(row)
            serializable = dict(value)
            serializable["fetched_at"] = fetched_at.isoformat()
            row.value = json.dumps(serializable, separators=(",", ":"))
            session.commit()
    except Exception:
        logger.exception("Could not persist last registered lane status")

    with _lane_lock:
        _lane_cache = value


def _load_persisted_lane_status() -> Optional[dict]:
    try:
        from ..db.models import AppSetting
        from ..db.session import SessionLocal

        with SessionLocal() as session:
            row = session.get(AppSetting, _LANE_SETTING_KEY)
            if row is None or not row.value:
                return None
            value = json.loads(row.value)
        fetched_at = datetime.fromisoformat(value["fetched_at"])
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        value["fetched_at"] = fetched_at
        value.setdefault("reserved", 0)
        value.setdefault("remaining", max(0, int(value["limit"]) - int(value["used"]) - int(value["reserved"])))
        value.setdefault("identity_conflict", False)
        return value
    except Exception as exc:
        logger.warning("Could not load persisted lane status: %s", exc)
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

        # Refresh immediately at sidecar boot so the operator sees the bound
        # lane/capacity before starting a test, then continue at the normal
        # interval without making /status itself depend on the network.
        while not self._stop.is_set():
            if not cc.is_available():
                self._stop.wait(self._interval)
                continue
            client = cc.get_client()
            # Refresh the wallet first and independently of submission
            # reconciliation: the balance must keep updating even when there is
            # nothing pending, and a wallet failure must not stop reconciling.
            self._refresh_wallet(client)
            self._refresh_lane_status(client)
            try:
                self._reconcile_once(client)
            except Exception:
                logger.exception("SubmissionReconciler error")
            self._stop.wait(self._interval)

    def _refresh_wallet(self, cloud) -> None:
        try:
            _store_wallet(cloud.get_wallet())
        except Exception as exc:
            # Keep the previous cached value; the UI shows it as stale.
            logger.debug("Wallet refresh failed, keeping cached balance: %s", exc)

    def _refresh_lane_status(self, cloud) -> None:
        try:
            profile = cloud.get_lane_profile()
            quota = cloud.get_lane_quota()
            _store_lane_status(profile, quota)
        except Exception as exc:
            # Older cloud deployments do not expose lane endpoints yet. Keep
            # the desktop fully backward-compatible while they are rolled out.
            logger.debug("Lane status refresh failed, keeping cached status: %s", exc)

    def _reconcile_once(self, cloud) -> None:
        from ..db.session import SessionLocal
        from ..db.models import LtmsSubmission

        # First submit rows whose durable local transaction committed before a
        # network call. Same test UUID is the cloud idempotency key.
        with SessionLocal() as session:
            unsent_ids = [row.id for row in session.query(LtmsSubmission).filter(
                LtmsSubmission.state == "PENDING", LtmsSubmission.cloud_submission_id.is_(None),
                (LtmsSubmission.next_retry.is_(None) | (LtmsSubmission.next_retry <= datetime.now(timezone.utc).replace(tzinfo=None))),
            ).all()]
        for submission_id in unsent_ids:
            self._dispatch_pending(cloud, submission_id)

        with SessionLocal() as session:
            pending = (
                session.query(LtmsSubmission)
                .filter(
                    LtmsSubmission.state.in_(list(_WAITING_STATES)),
                    LtmsSubmission.cloud_submission_id.isnot(None),
                    (LtmsSubmission.next_retry.is_(None) | (LtmsSubmission.next_retry <= datetime.now(timezone.utc).replace(tzinfo=None))),
                )
                .all()
            )

        if not pending:
            return

        logger.debug("Reconciling %d pending submission(s)", len(pending))

        for sub in pending:
            try:
                self.reconcile_submission(cloud, sub.id)
            except Exception:
                logger.warning(
                    "Could not poll cloud submission %s", sub.cloud_submission_id, exc_info=True
                )

    def reconcile_submission(self, cloud, submission_id: str) -> str:
        """Poll and apply one cloud result.

        This is shared by the 30-second recovery daemon and the foreground
        upload request.  Keeping one terminal-state writer guarantees that a
        successful foreground response has already rendered and persisted the
        local CEC PDF before the renderer attempts to preview it.
        """
        from ..db.models import EmissionTest, LtmsSubmission
        from ..db.session import SessionLocal

        if self._expire_previous_day_other_lane(submission_id):
            return "EXPIRED"

        with SessionLocal() as session:
            sub = session.get(LtmsSubmission, submission_id)
            if sub is None:
                raise LookupError(f"Local submission {submission_id} was not found")
            if sub.state not in _WAITING_STATES:
                return sub.state
            if not sub.cloud_submission_id:
                return sub.state
            cloud_submission_id = sub.cloud_submission_id
            # Copy the render inputs while the row remains attached.
            render_id = sub.id
            render_payload = sub.payload_json

        try:
            status = cloud.get_submission(cloud_submission_id)
        except Exception as exc:
            self._record_poll_failure(submission_id, exc)
            raise

        if not status.is_terminal:
            return status.state

        now = datetime.now(timezone.utc)
        pdf_path: Optional[str] = None
        if status.state == "ACCEPTED" and status.certificate_no:
            render_row = type("CecRenderRow", (), {
                "id": render_id,
                "payload_json": render_payload,
            })()
            pdf_path = self._render_cec(render_row, status, now)

        with SessionLocal() as session:
            row = session.get(LtmsSubmission, submission_id)
            if row is None:
                raise LookupError(f"Local submission {submission_id} was not found")
            # Another reconciler may have completed this row while the network
            # request was in flight.  Reapplying the same cloud terminal result
            # is harmless; never move a terminal row back to a waiting state.
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
            submission_id,
            status.state,
            status.certificate_no,
        )
        return status.state

    def _expire_previous_day_other_lane(self, submission_id: str) -> bool:
        """Expire stale work from an old credential before a new key polls it."""
        from ..db.models import EmissionTest, LtmsSubmission
        from ..db.session import SessionLocal
        lane = get_cached_lane_status()
        if not lane:
            return False
        with SessionLocal() as session:
            sub = session.get(LtmsSubmission, submission_id)
            if sub is None or sub.state not in _WAITING_STATES:
                return False
            test = session.get(EmissionTest, sub.test_id)
            if test is None:
                return False
            tested_at = test.tested_at.replace(tzinfo=timezone.utc) if test.tested_at.tzinfo is None else test.tested_at
            # During a credential change _store_lane_status intentionally
            # retains the old cache to block same-day work. Its conflict_*
            # fields carry the new authenticated identity for safe expiry.
            target_lane = lane.get("conflict_lane_id") or lane.get("lane_id")
            target_center = lane.get("conflict_center_id") or lane.get("center_id") or lane.get("tenant_id")
            different_lane = bool(test.lane_id and test.lane_id != target_lane)
            different_center = bool(test.center_id and test.center_id != target_center)
            if (different_lane or different_center) and tested_at.astimezone(_MANILA).date() < datetime.now(_MANILA).date():
                sub.state = "EXPIRED"
                sub.last_error = "Recovery expired: prior Asia/Manila-day test belongs to a different commissioned lane"
                session.commit()
                return True
        return False

    def _record_poll_failure(self, submission_id: str, exc: Exception) -> None:
        """Avoid endlessly polling a missing/foreign cloud submission ID."""
        from ..db.models import LtmsSubmission
        from ..db.session import SessionLocal
        with SessionLocal() as session:
            sub = session.get(LtmsSubmission, submission_id)
            if not sub:
                return
            sub.attempts += 1
            if sub.attempts >= 5:
                sub.state = "DEAD"
                sub.last_error = "Cloud status could not be recovered after capped retries; manual recovery required"
            else:
                sub.next_retry = (datetime.now(timezone.utc) + timedelta(seconds=_RETRY_BACKOFF_SECONDS[min(sub.attempts - 1, len(_RETRY_BACKOFF_SECONDS) - 1)])).replace(tzinfo=None)
                sub.last_error = "Cloud status temporarily unavailable; retry scheduled"
            session.commit()

    def _dispatch_pending(self, cloud, submission_id: str) -> None:
        """Upload evidence and create a cloud submission from a durable row."""
        lock = _DISPATCH_LOCKS[hash(submission_id) % len(_DISPATCH_LOCKS)]
        with lock:
            self._dispatch_pending_locked(cloud, submission_id)

    def _dispatch_pending_locked(self, cloud, submission_id: str) -> None:
        """Dispatch implementation; caller holds this submission's stripe."""
        from ..db.session import SessionLocal
        from ..db.models import LtmsSubmission, TestPhoto
        from .. import cloud_client as cc
        try:
            with SessionLocal() as session:
                sub = session.get(LtmsSubmission, submission_id)
                if sub is None or sub.state != "PENDING" or sub.cloud_submission_id:
                    return
                test = sub.test
                payload = json.loads(sub.payload_json or "{}")
                photos = [(p.id, p.file_path, p.photo_type, p.mime_type) for p in test.photos]
                test_id, center_id, lane_id = sub.test_id, sub.center_id, sub.lane_id
                tested_at = test.tested_at
            # A machine may restart after midnight. Never create a cloud
            # reservation/submission for yesterday's Asia/Manila test.
            if tested_at.tzinfo is None:
                tested_at = tested_at.replace(tzinfo=timezone.utc)
            if tested_at.astimezone(_MANILA).date() != datetime.now(_MANILA).date():
                self._mark_permanent(submission_id, "EXPIRED", "Test was not submitted on its Asia/Manila business date")
                return
            refs: list[dict] = []
            for photo_id, file_path, photo_type, mime_type in photos:
                data = Path(file_path).read_bytes()
                digest = hashlib.sha256(data).hexdigest()
                presign = cloud.presign_photo(test_id, photo_id, photo_type, mime_type, digest)
                cloud.upload_photo(presign.upload_url, data, mime_type)
                refs.append({"photoId": photo_id, "s3Key": presign.s3_key, "photoType": photo_type, "sha256": digest})
                with SessionLocal() as session:
                    photo = session.get(TestPhoto, photo_id)
                    if photo:
                        photo.s3_key, photo.uploaded_at = presign.s3_key, datetime.now(timezone.utc)
                        session.commit()
            payload["photos"] = refs
            created = cloud.create_submission("" if lane_id else (center_id or ""), test_id, payload)
            with SessionLocal() as session:
                sub = session.get(LtmsSubmission, submission_id)
                if sub:
                    sub.cloud_submission_id = created.submission_id
                    sub.state = "WAITING_FOR_LTMS" if created.state != "ACCEPTED" else "PENDING"
                    sub.attempts += 1
                    sub.next_retry = datetime.now(timezone.utc).replace(tzinfo=None)
                    sub.last_error = None
                    session.commit()
        except cc.DailyUploadLimitError as exc:
            self._mark_permanent(submission_id, "REJECTED", "Lane quota is exhausted")
        except Exception as exc:
            # Credential/lane/late HTTP failures are permanent; transport and
            # S3/cloud outages stay PENDING for capped reconciler retries.
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code in (401, 403, 409, 422, 429):
                self._mark_permanent(submission_id, "REJECTED", "Cloud rejected the submission credential, lane, quota, or business date")
            else:
                with SessionLocal() as session:
                    sub = session.get(LtmsSubmission, submission_id)
                    if sub:
                        sub.attempts += 1
                        if sub.attempts >= 5:
                            sub.state = "DEAD"
                            sub.last_error = "Cloud submission retry limit reached; administrator diagnosis required"
                        else:
                            sub.last_error = "Transient cloud or evidence-upload failure; retry scheduled"
                            sub.next_retry = (datetime.now(timezone.utc) + timedelta(
                                seconds=_RETRY_BACKOFF_SECONDS[min(sub.attempts - 1, len(_RETRY_BACKOFF_SECONDS) - 1)]
                            )).replace(tzinfo=None)
                        session.commit()

    def _mark_permanent(self, submission_id: str, state: str, reason: str) -> None:
        from ..db.session import SessionLocal
        from ..db.models import LtmsSubmission
        with SessionLocal() as session:
            sub = session.get(LtmsSubmission, submission_id)
            if sub:
                sub.state, sub.last_error = state, reason
                session.commit()

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
