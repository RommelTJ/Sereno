"""SQLite connection handling.

Every connection enforces foreign keys and returns ``sqlite3.Row`` rows.
The database file lives in the Docker volume mounted at /app/data; tests
point ``SERENO_DB_PATH`` at a temporary file instead.
"""

import os
import sqlite3
from pathlib import Path

DEFAULT_DB_PATH = Path("/app/data/sereno.db")


def db_path() -> Path:
    """Resolve the database file location from the environment."""
    return Path(os.environ.get("SERENO_DB_PATH", str(DEFAULT_DB_PATH)))


def connect(path: Path | None = None) -> sqlite3.Connection:
    """Open a connection with foreign keys on and Row access by column name."""
    conn = sqlite3.connect(path if path is not None else db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn
