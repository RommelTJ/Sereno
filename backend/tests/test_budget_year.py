"""GET /api/budget-year — the yearly plan-vs-actual report.

planned is annual_target / 12 from the spend plan effective for each month
(the latest effective_date on or before the month's end, so a mid-year
revision splits the year instead of repricing January). actual is the
month's spending on a consumption basis — every expense line, paid from
the spendable pool or drawn from a fund alike — so a one-off paid from
parked money still reads as money spent. Fund contributions are transfers,
not spending: the month's monthly_plan/top_up sum rides apart as
contributions, where a restoration or windfall park can't inflate the
spending story. Safe-to-spend keeps its own money-leaving-the-pool
definition; only the report changes.
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

    def test_actual_counts_expense_lines_never_fund_contributions(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-03", 4000)
        insert_expense("2025-03", 1200)
        fund_id = insert_fund("Travel")
        insert_fund_entry(fund_id, "2025-03-01", 500, 500, "monthly_plan")
        insert_fund_entry(fund_id, "2025-03-20", 800, 300, "top_up")
        months = get_months(client, 2025)
        assert months[2]["actual"] == 5200.0  # 4000 + 1200; transfers stay out
        assert months[2]["contributions"] == 800.0  # 500 + 300, its own line
        assert months[2]["variance"] == 2300.0  # 7500 planned − 5200 actual

    def test_fund_funded_expenses_count_and_their_drawdowns_do_not(self, client):
        # Consumption basis: a one-off paid from parked money is real
        # spending, while the paired 'spend' drawdown row is its transfer
        # half and never counts anywhere.
        insert_spend_plan("2024-12-01", 90000)
        fund_id = insert_fund("Travel")
        insert_expense("2025-04", 900, funded_from="fund", fund_id=fund_id)
        insert_fund_entry(fund_id, "2025-04-15", 0, -900, "spend")
        insert_expense("2025-04", 250)
        months = get_months(client, 2025)
        assert months[3]["actual"] == 1150.0
        assert months[3]["contributions"] == 0.0

    def test_hand_entered_fund_rows_never_count(self, client):
        # A NULL-source entry is a balance restatement, not a contribution.
        insert_spend_plan("2024-12-01", 90000)
        fund_id = insert_fund("Travel")
        insert_fund_entry(fund_id, "2025-05-10", 900, 900, None)
        insert_expense("2025-05", 1000)
        months = get_months(client, 2025)
        assert months[4]["actual"] == 1000.0
        assert months[4]["contributions"] == 0.0

    def test_a_release_moves_contributions_never_actual(self, client):
        insert_spend_plan("2024-12-01", 90000)
        fund_id = insert_fund("Travel")
        insert_fund_entry(fund_id, "2025-05-10", 400, -200, "top_up")
        insert_expense("2025-05", 1000)
        months = get_months(client, 2025)
        assert months[4]["actual"] == 1000.0
        assert months[4]["contributions"] == -200.0

    def test_rollover_entries_stay_out_of_the_report(self, client):
        # The old month already showed its leftover as positive variance;
        # counting the rollover as new-month outflow would re-count the
        # same dollars — locked in here rather than left incidental to the
        # ('monthly_plan', 'top_up') filter.
        insert_spend_plan("2024-12-01", 90000)
        fund_id = insert_fund("Travel")
        insert_fund_entry(fund_id, "2025-05-10", 900, 900, "rollover")
        insert_expense("2025-05", 1000)
        months = get_months(client, 2025)
        assert months[4]["actual"] == 1000.0
        assert months[4]["contributions"] == 0.0

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
            assert row["contributions"] is None
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
            row["planned"] is None and row["actual"] is None and row["contributions"] is None
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
            and row["contributions"] is None
            for row in future
        )

    def test_a_covered_month_with_no_rows_reads_zero_not_null(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-01", 100)
        months = get_months(client, 2025)
        assert months[1]["actual"] == 0.0  # February: covered, nothing logged
        assert months[1]["contributions"] == 0.0


class TestBudgetYearSplit:
    """actual split by the category's flag: mandatory is the spend that
    can't be cut, discretionary everything else — uncategorized lines
    included, since a line only lands on the mandatory side by saying so."""

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

    def test_a_fund_funded_line_follows_its_category(self, client):
        # A categorized one-off lands on its category's side; without a
        # category the draw reads discretionary like any unclassified line.
        insert_spend_plan("2024-12-01", 90000)
        repairs = insert_category("Home repairs", is_mandatory=1)
        fund_id = insert_fund("Emergency")
        insert_expense("2025-04", 2000, funded_from="fund", fund_id=fund_id, category_id=repairs)
        insert_expense("2025-04", 900, funded_from="fund", fund_id=fund_id)
        months = get_months(client, 2025)
        assert months[3]["mandatory"] == 2000.0
        assert months[3]["discretionary"] == 900.0
        assert months[3]["actual"] == 2900.0

    def test_the_split_is_null_outside_coverage_and_zero_on_an_empty_month(self, client):
        insert_spend_plan("2024-12-01", 90000)
        insert_expense("2025-02", 100)
        months = get_months(client, 2025)
        assert months[0]["mandatory"] is None  # January predates the data
        assert months[0]["discretionary"] is None
        assert months[2]["mandatory"] == 0.0  # March: covered, nothing logged
        assert months[2]["discretionary"] == 0.0
