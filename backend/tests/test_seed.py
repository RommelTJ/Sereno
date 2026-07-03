import pytest

from sereno.db.connection import connect
from sereno.db.migrations import migrate
from sereno.db.seed import seed

ALL_TABLES = [
    "account",
    "fund",
    "category",
    "category_plan",
    "balance_entry",
    "tax_lot",
    "expense_line",
    "income_event",
    "fund_entry",
    "transfer",
    "assumption",
    "spend_plan",
    "social_security",
    "tax_param",
]


@pytest.fixture
def db(tmp_path):
    conn = connect(tmp_path / "sereno.db")
    migrate(conn)
    yield conn
    conn.close()


class TestSeedPopulatesEveryTable:
    @pytest.mark.parametrize("table", ALL_TABLES)
    def test_every_table_has_rows(self, db, table):
        seed(db)
        count = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: S608
        assert count > 0, f"{table} was not seeded"

    def test_seeds_the_ten_design_handoff_accounts(self, db):
        seed(db)
        names = {row["name"] for row in db.execute("SELECT name FROM account")}
        assert names == {
            "Ethereum",
            "VFIAX",
            "VTIAX",
            "VGSH",
            "Retirement",
            "Home",
            "Chase checking",
            "Vanguard Cash Plus",
            "Car",
            "Mortgage",
        }


class TestSeedSatisfiesTheViews:
    def test_net_worth_covers_twelve_months(self, db):
        seed(db)
        query = "SELECT month FROM v_net_worth ORDER BY month"
        months = [row["month"] for row in db.execute(query)]
        assert len(months) == 12
        assert months[0] == "2025-07"
        assert months[-1] == "2026-06"

    def test_current_month_net_worth_matches_the_design_handoff(self, db):
        seed(db)
        row = db.execute(
            "SELECT net_worth, investable FROM v_net_worth WHERE month = '2026-06'"
        ).fetchone()
        assert row["net_worth"] == 1_744_000
        assert row["investable"] == 1_500_000

    def test_budget_month_has_income_and_spend(self, db):
        seed(db)
        row = db.execute("SELECT * FROM v_budget_month WHERE month = '2026-06'").fetchone()
        assert row is not None
        assert row["funded_in"] > 0
        assert row["total_spent"] > 0

    def test_eth_balances_are_quantity_times_price(self, db):
        seed(db)
        rows = db.execute(
            "SELECT b.balance_usd, b.quantity, b.unit_price FROM balance_entry b"
            " JOIN account a ON a.id = b.account_id WHERE a.kind = 'eth'"
        ).fetchall()
        assert rows
        for row in rows:
            assert row["balance_usd"] == row["quantity"] * row["unit_price"]
