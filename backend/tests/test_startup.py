import sqlite3

import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import get_db
from sereno.main import app


def test_startup_applies_migrations(monkeypatch, tmp_path):
    db_file = tmp_path / "sereno.db"
    monkeypatch.setenv("SERENO_DB_PATH", str(db_file))
    with TestClient(app):
        pass
    assert db_file.exists()
    conn = sqlite3.connect(db_file)
    try:
        names = [row[0] for row in conn.execute("SELECT name FROM schema_migration")]
    finally:
        conn.close()
    assert names == [
        "0001_initial_schema.sql",
        "0002_category_plan.sql",
        "0003_account_emoji.sql",
        "0004_carry_forward_views.sql",
        "0005_fund_emoji.sql",
        "0006_budget_month_fund_spend.sql",
        "0007_fund_entry_source.sql",
        "0008_income_source_label.sql",
        "0009_sort_order.sql",
        "0010_quick_links.sql",
    ]


def test_startup_is_idempotent(monkeypatch, tmp_path):
    monkeypatch.setenv("SERENO_DB_PATH", str(tmp_path / "sereno.db"))
    with TestClient(app):
        pass
    with TestClient(app):
        pass


def test_get_db_yields_migrated_connection(monkeypatch, tmp_path):
    monkeypatch.setenv("SERENO_DB_PATH", str(tmp_path / "sereno.db"))
    with TestClient(app):
        pass
    dependency = get_db()
    conn = next(dependency)
    try:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM account").fetchone()[0] == 0
    finally:
        with pytest.raises(StopIteration):
            next(dependency)


def test_get_db_closes_the_connection_after_use(monkeypatch, tmp_path):
    monkeypatch.setenv("SERENO_DB_PATH", str(tmp_path / "sereno.db"))
    with TestClient(app):
        pass
    dependency = get_db()
    conn = next(dependency)
    with pytest.raises(StopIteration):
        next(dependency)
    with pytest.raises(sqlite3.ProgrammingError):
        conn.execute("SELECT 1")
