import sqlite3

import pytest

from sereno.db.connection import connect
from sereno.db.migrations import migrate


@pytest.fixture
def db(tmp_path):
    conn = connect(tmp_path / "sereno.db")
    migrate(conn)
    yield conn
    conn.close()


def add_account(db, name, kind="cash", is_liability=0, is_investable=0):
    cursor = db.execute(
        "INSERT INTO account (name, kind, is_liability, is_investable) VALUES (?, ?, ?, ?)",
        (name, kind, is_liability, is_investable),
    )
    return cursor.lastrowid


def add_balance(db, account_id, as_of_date, balance_usd):
    db.execute(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd) VALUES (?, ?, ?)",
        (account_id, as_of_date, balance_usd),
    )


class TestAccountMonthly:
    def test_latest_entry_in_month_wins(self, db):
        checking = add_account(db, "Checking")
        add_balance(db, checking, "2026-06-26", 1000)
        add_balance(db, checking, "2026-06-28", 1200)
        rows = db.execute(
            "SELECT month, balance_usd FROM v_account_monthly WHERE account_id = ?", (checking,)
        ).fetchall()
        assert [(r["month"], r["balance_usd"]) for r in rows] == [("2026-06", 1200)]

    def test_same_date_tie_broken_by_latest_id(self, db):
        checking = add_account(db, "Checking")
        add_balance(db, checking, "2026-06-28", 1000)
        add_balance(db, checking, "2026-06-28", 1500)
        row = db.execute(
            "SELECT balance_usd FROM v_account_monthly WHERE account_id = ?", (checking,)
        ).fetchone()
        assert row["balance_usd"] == 1500

    def test_superseded_rows_are_kept_as_history(self, db):
        checking = add_account(db, "Checking")
        add_balance(db, checking, "2026-06-26", 1000)
        add_balance(db, checking, "2026-06-28", 1200)
        count = db.execute("SELECT COUNT(*) FROM balance_entry").fetchone()[0]
        assert count == 2

    def test_each_month_gets_its_own_row(self, db):
        checking = add_account(db, "Checking")
        add_balance(db, checking, "2026-05-31", 900)
        add_balance(db, checking, "2026-06-28", 1200)
        rows = db.execute(
            "SELECT month, balance_usd FROM v_account_monthly ORDER BY month"
        ).fetchall()
        assert [(r["month"], r["balance_usd"]) for r in rows] == [
            ("2026-05", 900),
            ("2026-06", 1200),
        ]


class TestNetWorth:
    def test_subtracts_positive_liability_balances(self, db):
        checking = add_account(db, "Checking")
        mortgage = add_account(db, "Mortgage", kind="mortgage", is_liability=1)
        add_balance(db, checking, "2026-06-28", 500_000)
        add_balance(db, mortgage, "2026-06-28", 300_000)
        row = db.execute("SELECT net_worth FROM v_net_worth WHERE month = '2026-06'").fetchone()
        assert row["net_worth"] == 200_000

    def test_investable_sums_only_investable_accounts(self, db):
        brokerage = add_account(db, "VFIAX", kind="brokerage_fund", is_investable=1)
        home = add_account(db, "Home", kind="home")
        add_balance(db, brokerage, "2026-06-28", 400_000)
        add_balance(db, home, "2026-06-28", 800_000)
        row = db.execute(
            "SELECT net_worth, investable FROM v_net_worth WHERE month = '2026-06'"
        ).fetchone()
        assert row["net_worth"] == 1_200_000
        assert row["investable"] == 400_000


class TestBudgetMonth:
    def add_expense(self, db, budget_month, amount, is_fixed=0):
        db.execute(
            "INSERT INTO expense_line (txn_date, budget_month, amount, is_fixed)"
            " VALUES (?, ?, ?, ?)",
            (f"{budget_month}-15", budget_month, amount, is_fixed),
        )

    def test_splits_fixed_and_variable_spend(self, db):
        self.add_expense(db, "2026-07", 2000, is_fixed=1)
        self.add_expense(db, "2026-07", 300)
        self.add_expense(db, "2026-07", 150)
        row = db.execute("SELECT * FROM v_budget_month WHERE month = '2026-07'").fetchone()
        assert row["fixed_spent"] == 2000
        assert row["variable_spent"] == 450
        assert row["total_spent"] == 2450

    def test_funded_in_sums_income_for_the_month(self, db):
        db.execute(
            "INSERT INTO income_event (txn_date, budget_month, source, amount)"
            " VALUES ('2026-06-30', '2026-07', 'paycheck', 6000)"
        )
        self.add_expense(db, "2026-07", 100)
        row = db.execute("SELECT funded_in FROM v_budget_month WHERE month = '2026-07'").fetchone()
        assert row["funded_in"] == 6000

    def test_safe_to_spend_example_query(self, db):
        # The example query from docs/design/schema.sql.
        db.execute(
            "INSERT INTO income_event (txn_date, budget_month, source, amount)"
            " VALUES ('2026-06-30', '2026-07', 'paycheck', 6000)"
        )
        self.add_expense(db, "2026-07", 2000, is_fixed=1)
        self.add_expense(db, "2026-07", 450)
        row = db.execute(
            "SELECT funded_in - total_spent AS safe_to_spend"
            " FROM v_budget_month WHERE month = '2026-07'"
        ).fetchone()
        assert row["safe_to_spend"] == 3550


def test_foreign_keys_are_enforced(db):
    with pytest.raises(sqlite3.IntegrityError):
        add_balance(db, 999, "2026-06-28", 100)
