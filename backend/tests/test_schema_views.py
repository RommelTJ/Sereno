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


def add_balance(
    db, account_id, as_of_date, balance_usd, quantity=None, unit_price=None, cost_basis=None
):
    db.execute(
        "INSERT INTO balance_entry"
        " (account_id, as_of_date, balance_usd, quantity, unit_price, cost_basis)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (account_id, as_of_date, balance_usd, quantity, unit_price, cost_basis),
    )


def add_fund(db, name="Bike fund"):
    cursor = db.execute("INSERT INTO fund (name, kind) VALUES (?, 'sinking')", (name,))
    return cursor.lastrowid


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


class TestCarryForward:
    """A month's balance for an account is the latest entry on or before the
    month's end — an account entered in January still counts in February."""

    def test_missing_months_carry_the_latest_earlier_entry(self, db):
        home = add_account(db, "Home", kind="home")
        cash = add_account(db, "Cash")
        add_balance(db, home, "2026-01-15", 300_000)
        add_balance(db, cash, "2026-01-20", 1000)
        add_balance(db, cash, "2026-02-20", 1100)
        add_balance(db, cash, "2026-03-20", 1200)
        rows = db.execute(
            "SELECT month, as_of_date, balance_usd FROM v_account_monthly"
            " WHERE account_id = ? ORDER BY month",
            (home,),
        ).fetchall()
        assert [(r["month"], r["as_of_date"], r["balance_usd"]) for r in rows] == [
            ("2026-01", "2026-01-15", 300_000),
            ("2026-02", "2026-01-15", 300_000),
            ("2026-03", "2026-01-15", 300_000),
        ]

    def test_a_real_entry_supersedes_the_carried_value(self, db):
        cash = add_account(db, "Cash")
        other = add_account(db, "Other")
        add_balance(db, other, "2026-02-10", 50)
        add_balance(db, cash, "2026-01-20", 1000)
        add_balance(db, cash, "2026-02-05", 1100)
        add_balance(db, cash, "2026-02-25", 1200)
        row = db.execute(
            "SELECT as_of_date, balance_usd FROM v_account_monthly"
            " WHERE account_id = ? AND month = '2026-02'",
            (cash,),
        ).fetchone()
        assert (row["as_of_date"], row["balance_usd"]) == ("2026-02-25", 1200)

    def test_carried_rows_keep_quantity_price_and_basis(self, db):
        eth = add_account(db, "Ethereum", kind="eth")
        cash = add_account(db, "Cash")
        add_balance(db, eth, "2026-01-15", 70_000, quantity=20, unit_price=3500, cost_basis=24_000)
        add_balance(db, cash, "2026-02-20", 1000)
        row = db.execute(
            "SELECT balance_usd, quantity, unit_price, cost_basis FROM v_account_monthly"
            " WHERE account_id = ? AND month = '2026-02'",
            (eth,),
        ).fetchone()
        assert dict(row) == {
            "balance_usd": 70_000,
            "quantity": 20,
            "unit_price": 3500,
            "cost_basis": 24_000,
        }

    def test_inactive_accounts_do_not_carry_forward(self, db):
        # No deactivation date exists, so a deactivated account reports only
        # the months it was really entered — carried months drop out.
        boat = add_account(db, "Boat")
        cash = add_account(db, "Cash")
        add_balance(db, boat, "2026-01-15", 9000)
        add_balance(db, cash, "2026-01-20", 1000)
        add_balance(db, cash, "2026-02-20", 1000)
        db.execute("UPDATE account SET active = 0 WHERE id = ?", (boat,))
        months = [
            row["month"]
            for row in db.execute(
                "SELECT month FROM v_account_monthly WHERE account_id = ? ORDER BY month",
                (boat,),
            )
        ]
        assert months == ["2026-01"]


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

    def test_net_worth_sums_carried_balances(self, db):
        # Only the brokerage was re-entered in February; the home, mortgage,
        # and investable totals still count at their carried January values.
        home = add_account(db, "Home", kind="home")
        mortgage = add_account(db, "Mortgage", kind="mortgage", is_liability=1)
        brokerage = add_account(db, "VFIAX", kind="brokerage_fund", is_investable=1)
        add_balance(db, home, "2026-01-15", 300_000)
        add_balance(db, mortgage, "2026-01-15", 100_000)
        add_balance(db, brokerage, "2026-01-15", 50_000)
        add_balance(db, brokerage, "2026-02-15", 60_000)
        row = db.execute(
            "SELECT net_worth, investable FROM v_net_worth WHERE month = '2026-02'"
        ).fetchone()
        assert row["net_worth"] == 260_000
        assert row["investable"] == 60_000


class TestBudgetMonth:
    def add_expense(
        self, db, budget_month, amount, is_fixed=0, funded_from="discretionary", fund_id=None
    ):
        db.execute(
            "INSERT INTO expense_line"
            " (txn_date, budget_month, amount, is_fixed, funded_from, fund_id)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (f"{budget_month}-15", budget_month, amount, is_fixed, funded_from, fund_id),
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

    def test_fund_funded_spend_stays_out_of_the_spent_totals(self, db):
        # A fund-funded expense was paid from parked money, not the month's
        # income — it must not lower safe-to-spend a second time.
        bike = add_fund(db)
        self.add_expense(db, "2026-07", 300)
        self.add_expense(db, "2026-07", 1200, funded_from="fund", fund_id=bike)
        row = db.execute("SELECT * FROM v_budget_month WHERE month = '2026-07'").fetchone()
        assert row["total_spent"] == 300
        assert row["variable_spent"] == 300
        assert row["fixed_spent"] == 0
        assert row["fund_spent"] == 1200

    def test_a_month_with_only_fund_spending_keeps_its_row(self, db):
        bike = add_fund(db)
        self.add_expense(db, "2026-07", 1200, funded_from="fund", fund_id=bike)
        row = db.execute("SELECT * FROM v_budget_month WHERE month = '2026-07'").fetchone()
        assert row["total_spent"] == 0
        assert row["fund_spent"] == 1200

    def test_safe_to_spend_example_query(self, db):
        # The example query from docs/design/schema.sql.
        bike = add_fund(db)
        db.execute(
            "INSERT INTO income_event (txn_date, budget_month, source, amount)"
            " VALUES ('2026-06-30', '2026-07', 'paycheck', 6000)"
        )
        self.add_expense(db, "2026-07", 2000, is_fixed=1)
        self.add_expense(db, "2026-07", 450)
        db.execute(
            "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
            " VALUES (?, '2026-07-01', 500, 500, 'monthly_plan')",
            (bike,),
        )
        row = db.execute(
            "SELECT funded_in - total_spent"
            "     - (SELECT COALESCE(SUM(contribution),0) FROM fund_entry"
            "        WHERE source = 'monthly_plan' AND substr(as_of_date,1,7) = '2026-07')"
            "   AS safe_to_spend"
            " FROM v_budget_month WHERE month = '2026-07'"
        ).fetchone()
        assert row["safe_to_spend"] == 3050


class TestCategoryPlan:
    def add_category(self, db, name):
        cursor = db.execute("INSERT INTO category (name) VALUES (?)", (name,))
        return cursor.lastrowid

    def test_planned_amounts_are_effective_dated_per_category(self, db):
        groceries = self.add_category(db, "Groceries")
        db.execute(
            "INSERT INTO category_plan (category_id, effective_month, planned)"
            " VALUES (?, '2026-01', 500)",
            (groceries,),
        )
        db.execute(
            "INSERT INTO category_plan (category_id, effective_month, planned)"
            " VALUES (?, '2026-06', 550)",
            (groceries,),
        )
        rows = db.execute(
            "SELECT effective_month, planned FROM category_plan"
            " WHERE category_id = ? ORDER BY effective_month",
            (groceries,),
        ).fetchall()
        assert [(r["effective_month"], r["planned"]) for r in rows] == [
            ("2026-01", 500),
            ("2026-06", 550),
        ]

    def test_category_plan_requires_an_existing_category(self, db):
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO category_plan (category_id, effective_month, planned)"
                " VALUES (999, '2026-01', 500)"
            )


def test_foreign_keys_are_enforced(db):
    with pytest.raises(sqlite3.IntegrityError):
        add_balance(db, 999, "2026-06-28", 100)
