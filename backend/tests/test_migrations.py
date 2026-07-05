import sqlite3

import pytest

from sereno.db.migrations import MIGRATIONS_DIR, migrate


@pytest.fixture
def conn():
    conn = sqlite3.connect(":memory:")
    yield conn
    conn.close()


def test_applies_numbered_files_in_order(conn, tmp_path):
    # Written out of order on purpose; the runner must sort by filename.
    (tmp_path / "0002_second.sql").write_text("INSERT INTO log (entry) VALUES ('second');")
    (tmp_path / "0001_first.sql").write_text(
        "CREATE TABLE log (entry TEXT); INSERT INTO log (entry) VALUES ('first');"
    )
    applied = migrate(conn, tmp_path)
    assert applied == ["0001_first.sql", "0002_second.sql"]
    entries = [row[0] for row in conn.execute("SELECT entry FROM log")]
    assert entries == ["first", "second"]


def test_records_applied_migrations(conn, tmp_path):
    (tmp_path / "0001_first.sql").write_text("CREATE TABLE t (x);")
    migrate(conn, tmp_path)
    rows = conn.execute("SELECT name, applied_at FROM schema_migration").fetchall()
    assert [name for name, _ in rows] == ["0001_first.sql"]
    assert all(applied_at for _, applied_at in rows)


def test_second_run_is_a_noop(conn, tmp_path):
    (tmp_path / "0001_first.sql").write_text("CREATE TABLE t (x);")
    assert migrate(conn, tmp_path) == ["0001_first.sql"]
    assert migrate(conn, tmp_path) == []


def test_new_file_applied_on_next_run(conn, tmp_path):
    (tmp_path / "0001_first.sql").write_text("CREATE TABLE t (x);")
    migrate(conn, tmp_path)
    (tmp_path / "0002_second.sql").write_text("CREATE TABLE u (y);")
    assert migrate(conn, tmp_path) == ["0002_second.sql"]
    names = [row[0] for row in conn.execute("SELECT name FROM schema_migration ORDER BY name")]
    assert names == ["0001_first.sql", "0002_second.sql"]


def test_empty_directory_applies_nothing(conn, tmp_path):
    assert migrate(conn, tmp_path) == []


def test_account_emoji_backfills_existing_seed_accounts(conn, tmp_path):
    # A database migrated before 0003 existed, already holding the
    # seed-named accounts, gets its emojis backfilled by name.
    for name in ("0001_initial_schema.sql", "0002_category_plan.sql"):
        (tmp_path / name).write_text((MIGRATIONS_DIR / name).read_text())
    migrate(conn, tmp_path)
    conn.execute("INSERT INTO account (name, kind) VALUES ('Ethereum', 'eth')")
    conn.execute(
        "INSERT INTO account (name, kind, is_liability) VALUES ('Mortgage', 'mortgage', 1)"
    )
    emoji_migration = "0003_account_emoji.sql"
    (tmp_path / emoji_migration).write_text((MIGRATIONS_DIR / emoji_migration).read_text())
    assert migrate(conn, tmp_path) == [emoji_migration]
    emojis = dict(conn.execute("SELECT name, emoji FROM account"))
    assert emojis == {"Ethereum": "⚡", "Mortgage": "🏡"}
