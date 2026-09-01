"""GET /api/budget-year — the yearly plan-vs-actual report.

planned is annual_target / 12 from the spend plan effective for each month
(the latest effective_date on or before the month's end, so a mid-year
revision splits the year instead of repricing January). actual is the
month's lifestyle spend — mandatory + discretionary category spend, only
the funded_from='discretionary' expense lines. A fund-funded one-off's
lifestyle cost was incurred as the fund was saved, so its delivery-month
draw stays out of actual, the split, variance, and cumulative — parked
money materializing, not this month's cost of living. Fund activity
rides apart as the funds flow: funds_in sums the calendar month's
monthly_plan, top_up, and rollover contributions (a release reads
negative), and funds_out nets its 'spend'-source entries, so
compensating corrections cancel and an edit or delete never distorts
the flow. One response feeds both tables. Safe-to-spend keeps its own
money-leaving-the-pool definition; only the report changes.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import connect
from sereno.main import app
from sereno.money import to_cents


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


def insert_expense(
    budget_month, amount, funded_from="discretionary", fund_id=None, category_id=None
):
    # Dollars in, cents stored — the boundary the API keeps, so tests stay
    # in the dollars the JSON contract speaks.
    return execute(
        "INSERT INTO expense_line (txn_date, budget_month, amount, funded_from, fund_id,"
        " category_id) VALUES (?, ?, ?, ?, ?, ?)",
        f"{budget_month}-15",
        budget_month,
        to_cents(amount),
        funded_from,
        fund_id,
        category_id,
    )


def insert_category(name, is_mandatory=0):
    return execute("INSERT INTO category (name, is_mandatory) VALUES (?, ?)", name, is_mandatory)


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
        to_cents(balance),
        to_cents(contribution),
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

    def test_actual_counts_category_lines_never_fund_flows(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-03", 4000)
        insert_expense("2025-03", 1200)
        fund_id = insert_fund("Travel")
        insert_fund_entry(fund_id, "2025-03-01", 500, 500, "monthly_plan")
        insert_fund_entry(fund_id, "2025-03-20", 800, 300, "top_up")
        months = get_months(client, 2025)
        assert months[2]["actual"] == 5200.0  # 4000 + 1200; transfers stay out
        assert months[2]["funds_in"] == 800.0  # 500 + 300, the flow's own table
        assert months[2]["variance"] == 2300.0  # 7500 planned − 5200 actual
        assert "contributions" not in months[2]  # replaced by the flow fields

    def test_fund_funded_expenses_leave_actual(self, client):
        # Lifestyle basis: a one-off paid from parked money incurred its
        # lifestyle cost as the fund was saved, so the delivery-month draw
        # stays out — only the discretionary-funded line is this month's
        # cost of living.
        insert_spend_plan("2024-12-01", 90000)
        fund_id = insert_fund("Travel")
        insert_expense("2025-04", 900, funded_from="fund", fund_id=fund_id)
        insert_fund_entry(fund_id, "2025-04-15", 0, -900, "spend")
        insert_expense("2025-04", 250)
        months = get_months(client, 2025)
        assert months[3]["actual"] == 250.0
        assert months[3]["variance"] == 7250.0

    def test_hand_entered_fund_rows_never_count(self, client):
        # A NULL-source entry is a balance restatement, not a flow.
        insert_spend_plan("2024-12-01", 90000)
        fund_id = insert_fund("Travel")
        insert_fund_entry(fund_id, "2025-05-10", 900, 900, None)
        insert_expense("2025-05", 1000)
        months = get_months(client, 2025)
        assert months[4]["actual"] == 1000.0
        assert months[4]["funds_in"] == 0.0
        assert months[4]["funds_out"] == 0.0

    def test_a_release_reads_negative_in_funds_in_never_actual(self, client):
        insert_spend_plan("2024-12-01", 90000)
        fund_id = insert_fund("Travel")
        insert_fund_entry(fund_id, "2025-05-10", 400, -200, "top_up")
        insert_expense("2025-05", 1000)
        months = get_months(client, 2025)
        assert months[4]["actual"] == 1000.0
        assert months[4]["funds_in"] == -200.0

    def test_a_rollover_lands_in_funds_in_never_actual(self, client):
        # Leftover money being given a job is saving like any other
        # contribution: it joins the flow's In column, apart from the
        # plan-vs-actual discipline where it could re-count the old
        # month's leftover.
        insert_spend_plan("2024-12-01", 90000)
        fund_id = insert_fund("Travel")
        insert_fund_entry(fund_id, "2025-05-10", 900, 900, "rollover")
        insert_expense("2025-05", 1000)
        months = get_months(client, 2025)
        assert months[4]["actual"] == 1000.0
        assert months[4]["funds_in"] == 900.0

    def test_funds_out_nets_the_months_spend_entries(self, client):
        # Out is parked money materializing — the draw rides signed
        # negative in the flow, never in actual.
        insert_spend_plan("2024-12-01", 90000)
        fund_id = insert_fund("Emergency")
        insert_expense("2025-06", 3000, funded_from="fund", fund_id=fund_id)
        insert_fund_entry(fund_id, "2025-06-15", 0, -3000, "spend")
        insert_expense("2025-06", 250)
        months = get_months(client, 2025)
        assert months[5]["funds_out"] == -3000.0
        assert months[5]["funds_in"] == 0.0
        assert months[5]["actual"] == 250.0

    def test_compensating_spend_corrections_cancel_in_funds_out(self, client):
        # An expense edit or delete appends a positive 'spend' correction;
        # netting keeps the flow at what actually left the funds.
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-06", 100)
        fund_id = insert_fund("Emergency")
        insert_fund_entry(fund_id, "2025-06-10", 0, -900, "spend")
        insert_fund_entry(fund_id, "2025-06-12", 900, 900, "spend")
        insert_fund_entry(fund_id, "2025-06-20", 400, -500, "spend")
        months = get_months(client, 2025)
        assert months[5]["funds_out"] == -500.0

    def test_cumulative_variance_runs_across_the_year(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-01", 7000)  # +500 under plan
        insert_expense("2025-02", 8000)  # −500 → back to 0
        insert_expense("2025-03", 7100)  # +400 → +400
        months = get_months(client, 2025)
        assert [row["cumulative_variance"] for row in months[:3]] == [500.0, 0.0, 400.0]


class TestBudgetYearCoverage:
    """The app cannot distinguish "no data" from "spent nothing", so rows
    outside data-start → current month are null, never zero — a partial
    year must be visibly partial."""

    def test_months_before_the_first_expense_are_null(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-03", 7000)
        months = get_months(client, 2025)
        for row in months[:2]:  # Jan and Feb predate the data
            assert row["planned"] is None
            assert row["actual"] is None
            assert row["variance"] is None
            assert row["cumulative_variance"] is None
            assert row["funds_in"] is None
            assert row["funds_out"] is None
        assert months[2]["actual"] == 7000.0

    def test_cumulative_variance_starts_at_data_start(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-03", 7000)
        months = get_months(client, 2025)
        assert months[2]["cumulative_variance"] == 500.0

    def test_data_start_is_the_first_expense_month(self, client):
        insert_expense("2025-03", 100)
        body = client.get("/api/budget-year", params={"year": 2025}).json()
        assert body["data_start"] == "2025-03"

    def test_an_empty_database_reads_blank(self, client):
        insert_spend_plan("2024-12-01", 90000)
        body = client.get("/api/budget-year", params={"year": 2025}).json()
        assert body["data_start"] is None
        assert all(
            row["planned"] is None and row["actual"] is None and row["funds_in"] is None
            for row in body["months"]
        )

    def test_defaults_to_the_current_year_with_a_provisional_current_month(self, client):
        current = date.today().strftime("%Y-%m")
        insert_expense(current, 100)
        response = client.get("/api/budget-year")
        assert response.status_code == 200
        body = response.json()
        assert body["year"] == date.today().year
        by_month = {row["month"]: row for row in body["months"]}
        assert by_month[current]["provisional"] is True
        assert by_month[current]["actual"] == 100.0
        assert all(row["provisional"] is False for row in body["months"] if row["month"] != current)

    def test_months_after_the_current_one_are_null(self, client):
        # Empty in December — the guard costs nothing the rest of the year.
        insert_spend_plan("2024-12-01", 90000)
        current = date.today().strftime("%Y-%m")
        insert_expense(current, 100)
        months = get_months(client, date.today().year)
        future = [row for row in months if row["month"] > current]
        assert all(
            row["planned"] is None
            and row["actual"] is None
            and row["variance"] is None
            and row["funds_in"] is None
            and row["funds_out"] is None
            for row in future
        )

    def test_a_covered_month_with_no_rows_reads_zero_not_null(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-01", 100)
        months = get_months(client, 2025)
        assert months[1]["actual"] == 0.0  # February: covered, nothing logged
        assert months[1]["funds_in"] == 0.0
        assert months[1]["funds_out"] == 0.0


class TestBudgetYearSplit:
    """actual split by the category's flag: mandatory is the spend that
    can't be cut, discretionary everything else — uncategorized
    discretionary-funded lines included, since a line only lands on the
    mandatory side by saying so. Fund-funded lines leave the split with
    actual; the flag never pulls a draw back in."""

    def test_expenses_split_by_their_categorys_flag(self, client):
        insert_spend_plan("2024-12-01", 90000)
        groceries = insert_category("Groceries", is_mandatory=1)
        fun = insert_category("Fun")
        insert_expense("2025-03", 3000, category_id=groceries)
        insert_expense("2025-03", 1200, category_id=fun)
        months = get_months(client, 2025)
        assert months[2]["mandatory"] == 3000.0
        assert months[2]["discretionary"] == 1200.0
        assert months[2]["actual"] == 4200.0

    def test_an_uncategorized_line_counts_discretionary(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-03", 800)
        months = get_months(client, 2025)
        assert months[2]["mandatory"] == 0.0
        assert months[2]["discretionary"] == 800.0

    def test_a_fund_funded_line_leaves_the_split_even_categorized(self, client):
        # Fund-funded lines leave the table entirely — a mandatory
        # category never pulls a draw back into the split.
        insert_spend_plan("2024-12-01", 90000)
        repairs = insert_category("Home repairs", is_mandatory=1)
        fund_id = insert_fund("Emergency")
        insert_expense("2025-04", 2000, funded_from="fund", fund_id=fund_id, category_id=repairs)
        insert_expense("2025-04", 900, funded_from="fund", fund_id=fund_id)
        insert_expense("2025-04", 300, category_id=repairs)
        months = get_months(client, 2025)
        assert months[3]["mandatory"] == 300.0
        assert months[3]["discretionary"] == 0.0
        assert months[3]["actual"] == 300.0

    def test_the_split_is_null_outside_coverage_and_zero_on_an_empty_month(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-02", 100)
        months = get_months(client, 2025)
        assert months[0]["mandatory"] is None  # January predates the data
        assert months[0]["discretionary"] is None
        assert months[2]["mandatory"] == 0.0  # March: covered, nothing logged
        assert months[2]["discretionary"] == 0.0
