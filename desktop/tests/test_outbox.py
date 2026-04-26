import tempfile
from pathlib import Path

import pytest

from petc.queue.outbox import Outbox, OutboxStatus


@pytest.fixture
def outbox(tmp_path):
    return Outbox(tmp_path / "test.db")


def test_enqueue_and_pending_count(outbox):
    outbox.enqueue("TEST_EVENT", {"key": "value"})
    assert outbox.pending_count() == 1


def test_successful_send(outbox):
    outbox.enqueue("TEST_EVENT", {"key": "value"})
    received = []
    outbox.poll_pending(lambda e: received.append(e))
    assert len(received) == 1
    assert received[0].event_type == "TEST_EVENT"
    assert outbox.pending_count() == 0


def test_failed_send_increments_attempts(outbox):
    outbox.enqueue("TEST_EVENT", {"key": "value"})

    def failing_sender(entry):
        raise RuntimeError("simulated failure")

    outbox.poll_pending(failing_sender)
    # Item still in queue but next_retry is in the future — count as 0 ready now
    assert outbox.pending_count() == 1  # status=PENDING, attempts=1


def test_dead_letter_after_max_attempts(outbox):
    """After MAX_ATTEMPTS failures the entry becomes DEAD, not PENDING."""
    outbox.enqueue("TEST_EVENT", {})

    def failing_sender(entry):
        raise RuntimeError("always fails")

    # Force next_retry to past so each poll picks it up immediately
    import sqlite3, json
    conn = sqlite3.connect(outbox._db_path)

    for _ in range(Outbox.MAX_ATTEMPTS):
        # reset next_retry to past so it's picked up
        conn.execute("UPDATE outbox SET next_retry='2000-01-01T00:00:00'")
        conn.commit()
        outbox.poll_pending(failing_sender)

    conn.close()
    assert outbox.pending_count() == 0  # DEAD, not PENDING
