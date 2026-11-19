from petc.cloud_client import WalletStatus
from petc.db import session as db_session
from petc.submissions import reconciler


class _FakeSession:
    def __init__(self, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def get(self, _model, key):
        return self.rows.get(key)

    def add(self, row):
        self.rows[row.key] = row

    def commit(self):
        return None


def test_wallet_price_survives_memory_cache_reset(monkeypatch):
    rows = {}
    monkeypatch.setattr(db_session, "SessionLocal", lambda: _FakeSession(rows))
    monkeypatch.setattr(reconciler, "_wallet_cache", None)
    wallet = WalletStatus(
        tenant_id="tenant-001",
        balance_centavos=123_400,
        low=False,
        negative=False,
        blocked_count=0,
        charge_per_upload_centavos=9_500,
        low_balance_threshold_centavos=50_000,
        pricing_updated_at="2026-08-03T10:15:30+08:00",
    )

    reconciler._store_wallet(wallet)
    monkeypatch.setattr(reconciler, "_wallet_cache", None)  # simulate restart
    restored = reconciler.get_cached_wallet()

    assert restored is not None
    assert restored["tenant_id"] == "tenant-001"
    assert restored["charge_per_upload_centavos"] == 9_500
    assert restored["low_balance_threshold_centavos"] == 50_000
    assert restored["pricing_updated_at"] == "2026-08-03T10:15:30+08:00"
    assert restored["fetched_at"].tzinfo is not None
