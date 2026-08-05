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


def test_unique_monthly_plan_index_rejects_a_racing_duplicate(conn):
    # Two first-of-month requests racing the monthly catch-up can both
    # conclude the month is due and both insert its contribution; 0012's
    # partial unique index makes the second row impossible at the schema
    # level, where a race can't dodge it.
    migrate(conn)
    conn.execute("INSERT INTO fund (name, kind) VALUES ('Emergency fund', 'sinking')")
    conn.execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
        " VALUES (1, '2026-08-01', 10500, 500, 'monthly_plan')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
            " VALUES (1, '2026-08-01', 11000, 500, 'monthly_plan')"
        )


def test_unique_monthly_plan_index_leaves_other_sources_unconstrained(conn):
    # The index is partial on purpose: same-fund same-date duplicates of
    # every other kind are real usage — two Correct-balance restatements
    # (NULL source), two top-ups, or two fund-funded spends in a day.
    migrate(conn)
    conn.execute("INSERT INTO fund (name, kind) VALUES ('Emergency fund', 'sinking')")
    for source in (None, "top_up", "spend"):
        for _ in range(2):
            conn.execute(
                "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
                " VALUES (1, '2026-08-01', 10500, 0, ?)",
                (source,),
            )
    (count,) = conn.execute("SELECT COUNT(*) FROM fund_entry").fetchone()
    assert count == 6


_PRE_CENTS_MIGRATIONS = (
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
    "0011_pending_flag.sql",
    "0012_unique_monthly_plan.sql",
)


def _seed_drifted_dollars(conn):
    """A pre-0013 database as issue #112 describes it: every money column a
    float, the fund_entry chain carrying real representation drift."""
    conn.execute("INSERT INTO account (name, kind) VALUES ('Chase checking', 'cash')")
    conn.execute(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd)"
        " VALUES (1, '2026-06-01', 12500.5)"
    )
    conn.execute("INSERT INTO category (name) VALUES ('Groceries')")
    conn.execute(
        "INSERT INTO category_plan (category_id, effective_month, planned)"
        " VALUES (1, '2026-06', 650.0)"
    )
    conn.execute(
        "INSERT INTO fund (name, kind, target_amount, monthly_plan)"
        " VALUES ('Emergency fund', 'sinking', 10000.0, 250.75)"
    )
    conn.execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
        " VALUES (1, '2026-06-05', 99.32999999999997, -74.95, 'spend')"
    )
    conn.execute(
        "INSERT INTO expense_line (txn_date, budget_month, category_id, amount)"
        " VALUES ('2026-06-05', '2026-06', 1, 74.95)"
    )
    conn.execute(
        "INSERT INTO income_event (txn_date, budget_month, source, amount)"
        " VALUES ('2026-05-27', '2026-06', 'paycheck', 2400.5)"
    )


def test_money_in_cents_converts_ledger_dollars_to_integer_cents(conn, tmp_path):
    # A database migrated before 0013 stores ledger money as drifted floats;
    # the migration converts all eight money columns to ROUND(value * 100)
    # integer cents — healing the drift the append-only chains accumulated —
    # while quantity, unit price, and cost basis stay fractional dollars.
    for name in _PRE_CENTS_MIGRATIONS:
        (tmp_path / name).write_text((MIGRATIONS_DIR / name).read_text())
    migrate(conn, tmp_path)
    _seed_drifted_dollars(conn)
    conn.execute("INSERT INTO account (name, kind) VALUES ('Ethereum', 'eth')")
    conn.execute(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd,"
        " quantity, unit_price, cost_basis)"
        " VALUES (2, '2026-06-01', 30117.278174999998, 12.0459, 2500.25, 21000.5)"
    )
    cents_migration = "0013_money_in_cents.sql"
    (tmp_path / cents_migration).write_text((MIGRATIONS_DIR / cents_migration).read_text())
    assert migrate(conn, tmp_path) == [cents_migration]
    converted = {
        ("balance_entry", "balance_usd"): 1250050,
        ("category_plan", "planned"): 65000,
        ("fund", "target_amount"): 1000000,
        ("fund", "monthly_plan"): 25075,
        ("fund_entry", "balance"): 9933,
        ("fund_entry", "contribution"): -7495,
        ("expense_line", "amount"): 7495,
        ("income_event", "amount"): 240050,
    }
    for (table, column), cents in converted.items():
        value, storage = conn.execute(
            f"SELECT {column}, typeof({column}) FROM {table} ORDER BY rowid LIMIT 1"  # noqa: S608
        ).fetchone()
        assert (value, storage) == (cents, "integer"), f"{table}.{column}"
    eth = conn.execute(
        "SELECT balance_usd, quantity, unit_price, cost_basis FROM balance_entry"
        " WHERE account_id = 2"
    ).fetchone()
    assert tuple(eth) == (3011728, 12.0459, 2500.25, 21000.5)


def test_money_in_cents_rebuilds_views_and_keeps_the_monthly_plan_index(conn, tmp_path):
    # The table rebuild drops and recreates the three money views — which
    # now sum cents — and must not lose 0012's racing-duplicate guard.
    for name in _PRE_CENTS_MIGRATIONS:
        (tmp_path / name).write_text((MIGRATIONS_DIR / name).read_text())
    migrate(conn, tmp_path)
    _seed_drifted_dollars(conn)
    cents_migration = "0013_money_in_cents.sql"
    (tmp_path / cents_migration).write_text((MIGRATIONS_DIR / cents_migration).read_text())
    migrate(conn, tmp_path)
    assert conn.execute("SELECT net_worth FROM v_net_worth").fetchone()[0] == 1250050
    funded_in, total_spent = conn.execute(
        "SELECT funded_in, total_spent FROM v_budget_month"
    ).fetchone()
    assert (funded_in, total_spent) == (240050, 7495)
    conn.execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
        " VALUES (1, '2026-08-01', 10500, 500, 'monthly_plan')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
            " VALUES (1, '2026-08-01', 11000, 500, 'monthly_plan')"
        )


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
