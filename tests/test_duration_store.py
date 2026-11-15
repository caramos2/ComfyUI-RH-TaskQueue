import contextlib
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.duration_store import DurationStore
from backend.fingerprint import is_valid_signature, is_valid_version


@contextlib.contextmanager
def _store():
    """A DurationStore on a throwaway sqlite file.

    The connection must be closed before the temp dir is removed: on Windows an
    open sqlite handle keeps the file locked and cleanup raises PermissionError.
    """
    tmp = tempfile.TemporaryDirectory()
    store = DurationStore(os.path.join(tmp.name, "h.sqlite3"))
    try:
        yield store
    finally:
        store.close()
        tmp.cleanup()


def test_record_then_get():
    with _store() as store:
        store.record("a" * 64, 12.5, "pid-1")
        record = store.get("a" * 64)
        assert record is not None
        assert record["last_duration"] == 12.5
        assert record["sample_count"] == 1
        assert abs(record["avg_duration"] - 12.5) < 1e-9
        assert record["last_prompt_id"] == "pid-1"


def test_average_updates_on_second_record():
    with _store() as store:
        store.record("b" * 64, 10.0, "p1")
        store.record("b" * 64, 20.0, "p2")
        record = store.get("b" * 64)
        assert record["last_duration"] == 20.0
        assert record["sample_count"] == 2
        assert abs(record["avg_duration"] - 15.0) < 1e-9
        assert record["last_prompt_id"] == "p2"


def test_missing_signature_returns_none():
    with _store() as store:
        assert store.get("c" * 64) is None


def test_invalid_signature_rejected():
    with _store() as store:
        try:
            store.record("not-hex", 1.0, "p")
        except ValueError:
            return
        raise AssertionError("expected ValueError")


def test_invalid_duration_rejected():
    with _store() as store:
        for bad in (-1.0, "x", None, True):
            try:
                store.record("a" * 64, bad, "p")
            except ValueError:
                continue
            raise AssertionError("expected ValueError for %r" % (bad,))


def test_signature_validator():
    assert is_valid_signature("a" * 64)
    assert not is_valid_signature("A" * 64)
    assert not is_valid_signature("a" * 63)
    assert not is_valid_signature(None)
    assert is_valid_version(1)
    assert not is_valid_version(0)
    assert not is_valid_version(True)


def test_delete_and_list():
    with _store() as store:
        store.record("d" * 64, 1.0, "p1")
        store.record("e" * 64, 2.0, "p2")
        assert store.count() == 2
        assert store.delete("d" * 64) is True
        assert store.delete("d" * 64) is False
        assert store.count() == 1
        listing = store.list(limit=10, offset=0)
        assert listing["total"] == 1
        assert len(listing["records"]) == 1


def test_data_survives_reopen():
    tmp = tempfile.TemporaryDirectory()
    try:
        path = os.path.join(tmp.name, "h.sqlite3")
        first = DurationStore(path)
        first.record("f" * 64, 3.5, "p1")
        first.close()
        second = DurationStore(path)
        record = second.get("f" * 64)
        assert record is not None
        assert record["last_duration"] == 3.5
        second.close()
    finally:
        tmp.cleanup()


def test_health_reports_counts():
    with _store() as store:
        store.record("1" * 64, 1.0, "p")
        health = store.health()
        assert health["ok"] is True
        assert health["count"] == 1
        assert health["path"].endswith("h.sqlite3")
