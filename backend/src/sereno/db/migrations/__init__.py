"""Migration runner: applies the numbered SQL files in this package, in order.

Applied migrations are recorded by filename in ``schema_migration``, so
running the migrator repeatedly (e.g. on every app startup) is safe.
"""

import sqlite3
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent


def migrate(conn: sqlite3.Connection, directory: Path | None = None) -> list[str]:
    """Apply pending migrations from ``directory`` and return their filenames."""
    directory = MIGRATIONS_DIR if directory is None else directory
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migration ("
        "    name       TEXT NOT NULL PRIMARY KEY,"
        "    applied_at TEXT NOT NULL DEFAULT (datetime('now'))"
        ")"
    )
    already_applied = {row[0] for row in conn.execute("SELECT name FROM schema_migration")}
    applied: list[str] = []
    for sql_file in sorted(directory.glob("*.sql")):
        if sql_file.name in already_applied:
            continue
        conn.executescript(sql_file.read_text())
        conn.execute("INSERT INTO schema_migration (name) VALUES (?)", (sql_file.name,))
        applied.append(sql_file.name)
    conn.commit()
    return applied
