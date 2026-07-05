import sqlite3
import threading
from pathlib import Path

from sereno.db.connection import connect, db_path


def test_db_path_defaults_to_docker_volume(monkeypatch):
    monkeypatch.delenv("SERENO_DB_PATH", raising=False)
    assert db_path() == Path("/app/data/sereno.db")


def test_db_path_honors_env_var(monkeypatch, tmp_path):
    monkeypatch.setenv("SERENO_DB_PATH", str(tmp_path / "custom.db"))
    assert db_path() == tmp_path / "custom.db"


def test_connect_enables_foreign_keys(tmp_path):
    conn = connect(tmp_path / "test.db")
    try:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    finally:
        conn.close()


def test_connect_returns_sqlite_rows(tmp_path):
    conn = connect(tmp_path / "test.db")
    try:
        row = conn.execute("SELECT 1 AS one").fetchone()
        assert isinstance(row, sqlite3.Row)
        assert row["one"] == 1
    finally:
        conn.close()


def test_connect_allows_use_from_another_thread(tmp_path):
    # FastAPI may open, use, and close a request's connection on different
    # threadpool threads; the connection must not enforce thread affinity.
    conn = connect(tmp_path / "test.db")
    errors: list[Exception] = []

    def use_connection() -> None:
        try:
            conn.execute("SELECT 1").fetchone()
        except Exception as exc:  # noqa: BLE001 - captured for assertion
            errors.append(exc)

    try:
        thread = threading.Thread(target=use_connection)
        thread.start()
        thread.join()
        assert errors == []
    finally:
        conn.close()


def test_connect_defaults_to_db_path(monkeypatch, tmp_path):
    monkeypatch.setenv("SERENO_DB_PATH", str(tmp_path / "default.db"))
    conn = connect()
    try:
        conn.execute("CREATE TABLE t (x)")
    finally:
        conn.close()
    assert (tmp_path / "default.db").exists()
