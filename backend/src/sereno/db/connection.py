"""SQLite connection handling.

Every connection enforces foreign keys and returns ``sqlite3.Row`` rows.
The database file lives in the Docker volume mounted at /app/data; tests
point ``SERENO_DB_PATH`` at a temporary file instead.
"""

import os
import sqlite3
from collections.abc import Iterator
from pathlib import Path

DEFAULT_DB_PATH = Path("/app/data/sereno.db")


def db_path() -> Path:
    """Resolve the database file location from the environment."""
    return Path(os.environ.get("SERENO_DB_PATH", str(DEFAULT_DB_PATH)))


def connect(path: Path | None = None) -> sqlite3.Connection:
    """Open a connection with foreign keys on and Row access by column name.

    ``check_same_thread=False`` because FastAPI may open, use, and close a
    request's connection on different threadpool threads; each connection is
    still only ever used by one request at a time.
    """
    conn = sqlite3.connect(path if path is not None else db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: one connection per request, closed afterwards."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
