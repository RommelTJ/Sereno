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


def test_income_source_label_backfills_from_note(conn, tmp_path):
    # A database migrated before 0008 existed holds title-style income notes
    # ("Spouse paycheck" — the seed's and the income form's hardcoded style),
    # so the new source_label column takes them over and note empties out,
    # keeping every row's rendered title unchanged.
    for name in (
        "0001_initial_schema.sql",
        "0002_category_plan.sql",
        "0003_account_emoji.sql",
        "0004_carry_forward_views.sql",
        "0005_fund_emoji.sql",
        "0006_budget_month_fund_spend.sql",
        "0007_fund_entry_source.sql",
    ):
        (tmp_path / name).write_text((MIGRATIONS_DIR / name).read_text())
    migrate(conn, tmp_path)
    conn.execute(
        "INSERT INTO income_event (txn_date, budget_month, source, amount, note)"
        " VALUES ('2026-05-27', '2026-06', 'paycheck', 2400, 'Spouse paycheck')"
    )
    conn.execute(
        "INSERT INTO income_event (txn_date, budget_month, source, amount, note)"
        " VALUES ('2026-06-15', '2026-06', 'interest', 12.34, NULL)"
    )
    label_migration = "0008_income_source_label.sql"
    (tmp_path / label_migration).write_text((MIGRATIONS_DIR / label_migration).read_text())
    assert migrate(conn, tmp_path) == [label_migration]
    rows = conn.execute("SELECT source_label, note FROM income_event ORDER BY id").fetchall()
    assert rows == [("Spouse paycheck", None), (None, None)]


def test_sort_order_backfills_from_id(conn, tmp_path):
    # A database migrated before 0009 existed keeps its insertion order:
    # sort_order takes over each row's id, so accounts and envelopes render
    # exactly as they did when the lists were ordered by id alone.
    for name in (
        "0001_initial_schema.sql",
        "0002_category_plan.sql",
        "0003_account_emoji.sql",
        "0004_carry_forward_views.sql",
        "0005_fund_emoji.sql",
        "0006_budget_month_fund_spend.sql",
        "0007_fund_entry_source.sql",
        "0008_income_source_label.sql",
    ):
        (tmp_path / name).write_text((MIGRATIONS_DIR / name).read_text())
    migrate(conn, tmp_path)
    conn.execute("INSERT INTO account (name, kind) VALUES ('Ethereum', 'eth')")
    conn.execute(
        "INSERT INTO account (name, kind, is_liability) VALUES ('Mortgage', 'mortgage', 1)"
    )
    conn.execute("INSERT INTO category (name) VALUES ('Groceries')")
    conn.execute("INSERT INTO category (name) VALUES ('Dining out')")
    sort_migration = "0009_sort_order.sql"
    (tmp_path / sort_migration).write_text((MIGRATIONS_DIR / sort_migration).read_text())
    assert migrate(conn, tmp_path) == [sort_migration]
    accounts = conn.execute("SELECT id, sort_order FROM account ORDER BY id").fetchall()
    assert accounts == [(1, 1), (2, 2)]
    categories = conn.execute("SELECT id, sort_order FROM category ORDER BY id").fetchall()
    assert categories == [(1, 1), (2, 2)]


def test_quick_link_table_holds_labeled_urls(conn):
    # Quick links are user-managed navigation rows (a label, a URL, a place
    # in the list). 0010 creates the table empty — a new table, so unlike
    # 0009 there is nothing to backfill and sort_order is NOT NULL from the
    # start: every insert sets it explicitly.
    migrate(conn)
    conn.execute(
        "INSERT INTO quick_link (label, url, sort_order)"
        " VALUES ('Chase', 'https://chaseonline.chase.com/MyAccounts.aspx', 1)"
    )
    rows = conn.execute("SELECT label, url, sort_order FROM quick_link").fetchall()
    assert rows == [("Chase", "https://chaseonline.chase.com/MyAccounts.aspx", 1)]


def test_fund_emoji_backfills_existing_seed_funds(conn, tmp_path):
    # A database migrated before 0005 existed, already holding the
    # seed-named funds, gets its emojis backfilled by name.
    for name in (
        "0001_initial_schema.sql",
        "0002_category_plan.sql",
        "0003_account_emoji.sql",
        "0004_carry_forward_views.sql",
    ):
        (tmp_path / name).write_text((MIGRATIONS_DIR / name).read_text())
    migrate(conn, tmp_path)
    conn.execute("INSERT INTO fund (name, kind) VALUES ('Emergency fund', 'sinking')")
    conn.execute("INSERT INTO fund (name, kind) VALUES ('Bike fund', 'goal')")
    emoji_migration = "0005_fund_emoji.sql"
    (tmp_path / emoji_migration).write_text((MIGRATIONS_DIR / emoji_migration).read_text())
    assert migrate(conn, tmp_path) == [emoji_migration]
    emojis = dict(conn.execute("SELECT name, emoji FROM fund"))
    assert emojis == {"Emergency fund": "🚨", "Bike fund": "🚲"}
