"""GET /api/budget-year — the yearly plan-vs-actual report.

planned is annual_target / 12 from the spend plan effective for each month
(the latest effective_date on or before the month's end, so a mid-year
revision splits the year instead of repricing January). actual is the
month's discretionary spending plus its monthly_plan/top_up fund
contributions — the same money-leaving-the-spendable-pool definition as
the Safe-to-spend headline, so fund-funded expense lines never count and
a release's negative contribution reads as money back.
"""

import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import connect
from sereno.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SERENO_DB_PATH", str(tmp_path / "sereno.db"))
    with TestClient(app) as client:
        yield client


def execute(sql, *params):
    conn = connect()
    try:
        cursor = conn.execute(sql, params)
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def insert_spend_plan(effective_date, annual_target):
    return execute(
        "INSERT INTO spend_plan (effective_date, annual_target) VALUES (?, ?)",
        effective_date,
        annual_target,
    )


def insert_expense(budget_month, amount, funded_from="discretionary", fund_id=None):
    return execute(
        "INSERT INTO expense_line (txn_date, budget_month, amount, funded_from, fund_id)"
        " VALUES (?, ?, ?, ?, ?)",
        f"{budget_month}-15",
        budget_month,
        amount,
        funded_from,
        fund_id,
    )


def insert_fund(name):
    # No monthly_plan, so the lazy catch-up never fabricates contributions
    # under these fixtures — every fund_entry is inserted explicitly.
    return execute("INSERT INTO fund (name, kind) VALUES (?, 'sinking')", name)


def insert_fund_entry(fund_id, as_of_date, balance, contribution, source):
    return execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
        " VALUES (?, ?, ?, ?, ?)",
        fund_id,
        as_of_date,
        balance,
        contribution,
        source,
    )


def get_months(client, year):
    response = client.get("/api/budget-year", params={"year": year})
    assert response.status_code == 200
    return response.json()["months"]


class TestBudgetYearMonths:
    def test_returns_twelve_rows_for_the_requested_year(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-01", 100)
        response = client.get("/api/budget-year", params={"year": 2025})
        assert response.status_code == 200
        body = response.json()
        assert body["year"] == 2025
        assert [row["month"] for row in body["months"]] == [
            f"2025-{number:02d}" for number in range(1, 13)
        ]

    def test_planned_is_the_annual_target_over_twelve(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-01", 100)
        months = get_months(client, 2025)
        assert months[0]["planned"] == 7500.0

    def test_planned_resolves_per_month_as_plans_change(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_spend_plan("2025-07-10", 96000)  # effective within July
        insert_expense("2025-01", 100)
        months = get_months(client, 2025)
        assert months[5]["planned"] == 7500.0  # June keeps the old target
        assert months[6]["planned"] == 8000.0  # July picks up the revision

    def test_planned_and_variance_are_null_with_no_spend_plan(self, client):
        insert_expense("2025-01", 100)
        months = get_months(client, 2025)
        assert months[0]["planned"] is None
        assert months[0]["variance"] is None
        assert months[0]["actual"] == 100.0

    def test_actual_sums_discretionary_lines_and_fund_contributions(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-03", 4000)
        insert_expense("2025-03", 1200)
        fund_id = insert_fund("Travel")
        insert_fund_entry(fund_id, "2025-03-01", 500, 500, "monthly_plan")
        insert_fund_entry(fund_id, "2025-03-20", 800, 300, "top_up")
        months = get_months(client, 2025)
        assert months[2]["actual"] == 6000.0  # 4000 + 1200 + 500 + 300
        assert months[2]["variance"] == 1500.0  # 7500 planned − 6000 actual

    def test_fund_funded_expenses_and_their_drawdowns_stay_out_of_actual(self, client):
        # Paid from parked money: the contributions that filled the fund
        # already counted, and the 'spend' drawdown row never does.
        insert_spend_plan("2024-12-01", 90000)
        fund_id = insert_fund("Travel")
        insert_expense("2025-04", 900, funded_from="fund", fund_id=fund_id)
        insert_fund_entry(fund_id, "2025-04-15", 0, -900, "spend")
        insert_expense("2025-04", 250)
        months = get_months(client, 2025)
        assert months[3]["actual"] == 250.0

    def test_hand_entered_fund_rows_never_count(self, client):
        # A NULL-source entry is a balance restatement, not a contribution.
        insert_spend_plan("2024-12-01", 90000)
        fund_id = insert_fund("Travel")
        insert_fund_entry(fund_id, "2025-05-10", 900, 900, None)
        insert_expense("2025-05", 1000)
        months = get_months(client, 2025)
        assert months[4]["actual"] == 1000.0

    def test_a_release_reduces_the_months_actual(self, client):
        insert_spend_plan("2024-12-01", 90000)
        fund_id = insert_fund("Travel")
        insert_fund_entry(fund_id, "2025-05-10", 400, -200, "top_up")
        insert_expense("2025-05", 1000)
        months = get_months(client, 2025)
        assert months[4]["actual"] == 800.0

    def test_cumulative_variance_runs_across_the_year(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-01", 7000)  # +500 under plan
        insert_expense("2025-02", 8000)  # −500 → back to 0
        insert_expense("2025-03", 7100)  # +400 → +400
        months = get_months(client, 2025)
        assert [row["cumulative_variance"] for row in months[:3]] == [500.0, 0.0, 400.0]
