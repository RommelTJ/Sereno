"""GET /api/guardrails: the Guyton-Klinger engine fed by live balances
and the effective spend plan. The rate is computed against the latest
month's investable total (every is_investable account), the spend being
tested defaults to the plan's annual target, and ?spend= tries a what-if
level. Null until a spend plan with an initial rate and at least one
balance month exist.
"""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import connect
from sereno.main import app
from sereno.money import to_cents

TODAY = date.today()
LAST_YEAR = (TODAY - timedelta(days=365)).isoformat()


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SERENO_DB_PATH", str(tmp_path / "sereno.db"))
    with TestClient(app) as client:
        yield client


def execute(sql, params):
    conn = connect()
    try:
        cursor = conn.execute(sql, params)
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def insert_spend_plan(annual_target=45000, initial_rate=0.0294, guardrail_band=0.20):
    return execute(
        "INSERT INTO spend_plan (effective_date, annual_target, initial_rate, guardrail_band)"
        " VALUES (?, ?, ?, ?)",
        (TODAY.isoformat(), annual_target, initial_rate, guardrail_band),
    )


def insert_account(name, kind, *, is_investable=0):
    return execute(
        "INSERT INTO account (name, kind, tax_treatment, owner, is_liability, is_investable)"
        " VALUES (?, ?, 'NONE', NULL, 0, ?)",
        (name, kind, is_investable),
    )


def insert_balance(account_id, balance_usd, as_of_date=None):
    # Dollars in, cents stored — the boundary the API keeps.
    return execute(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd) VALUES (?, ?, ?)",
        (account_id, as_of_date or TODAY.isoformat(), to_cents(balance_usd)),
    )


def seed_portfolio():
    """1,500,000 investable across two buckets, plus cash that must not count."""
    insert_balance(insert_account("Brokerage", "fund", is_investable=1), 1_000_000)
    insert_balance(insert_account("Retirement", "retirement", is_investable=1), 500_000)
    insert_balance(insert_account("Chase checking", "cash"), 25_000)


def month_str(months_back):
    """'YYYY-MM' for the month months_back before the current one."""
    total = TODAY.year * 12 + TODAY.month - 1 - months_back
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def insert_expense(amount, budget_month, funded_from="discretionary", fund_id=None):
    return execute(
        "INSERT INTO expense_line (txn_date, budget_month, amount, funded_from, fund_id)"
        " VALUES (?, ?, ?, ?, ?)",
        (f"{budget_month}-15", budget_month, to_cents(amount), funded_from, fund_id),
    )


def insert_fund(name="Travel fund"):
    return execute("INSERT INTO fund (name, kind) VALUES (?, 'sinking')", (name,))


def insert_fund_contribution(fund_id, amount, as_of_date):
    return execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
        " VALUES (?, ?, ?, ?, 'monthly_plan')",
        (fund_id, as_of_date, to_cents(amount), to_cents(amount)),
    )


class TestPrerequisites:
    def test_returns_null_without_a_spend_plan(self, client):
        seed_portfolio()
        response = client.get("/api/guardrails")
        assert response.status_code == 200
        assert response.json() is None

    def test_returns_null_without_an_initial_rate(self, client):
        seed_portfolio()
        insert_spend_plan(initial_rate=None)
        response = client.get("/api/guardrails")
        assert response.status_code == 200
        assert response.json() is None

    def test_returns_null_without_any_balances(self, client):
        insert_spend_plan()
        response = client.get("/api/guardrails")
        assert response.status_code == 200
        assert response.json() is None


class TestGuardrails:
    def test_defaults_the_tested_spend_to_the_annual_target(self, client):
        seed_portfolio()
        insert_spend_plan(annual_target=45000, initial_rate=0.0294, guardrail_band=0.20)
        response = client.get("/api/guardrails")
        assert response.status_code == 200
        assert response.json() == {
            "investable": 1_500_000.0,
            "spend": 45000.0,
            "annual_target": 45000.0,
            "rate": 0.03,
            "initial_rate": 0.0294,
            "band": 0.20,
            "lower": 0.0294 * 0.80,
            "upper": 0.0294 * 1.20,
            "zone": "hold",
            "raise_trigger": 45000 / (0.0294 * 0.80),
            "cut_trigger": 45000 / (0.0294 * 1.20),
            "four_percent_spend": 60000.0,
            "spend_source": "target",
            "spend_months": 0,
            "drawdown_start": None,
        }

    def test_spend_query_tests_a_what_if_level(self, client):
        seed_portfolio()
        insert_spend_plan(annual_target=45000)
        body = client.get("/api/guardrails", params={"spend": 60000}).json()
        assert body["spend"] == 60000.0
        assert body["spend_source"] == "what_if"
        assert body["annual_target"] == 45000.0
        assert body["rate"] == 0.04
        assert body["zone"] == "cut"

    def test_a_low_rate_lands_in_the_raise_zone(self, client):
        seed_portfolio()
        insert_spend_plan()
        assert client.get("/api/guardrails", params={"spend": 30000}).json()["zone"] == "raise"

    def test_only_investable_accounts_count(self, client):
        # seed_portfolio's 25,000 checking balance must not move the rate
        seed_portfolio()
        insert_spend_plan()
        assert client.get("/api/guardrails").json()["investable"] == 1_500_000.0

    def test_old_entries_carry_forward_into_the_latest_month(self, client):
        # An investable account entered a year ago and never re-entered
        # still counts at its carried value (v_account_monthly carries the
        # latest entry on or before each month's end).
        seed_portfolio()
        insert_balance(insert_account("Old brokerage", "fund", is_investable=1), 400_000, LAST_YEAR)
        insert_spend_plan()
        assert client.get("/api/guardrails").json()["investable"] == 1_900_000.0

    def test_rejects_a_non_positive_spend(self, client):
        seed_portfolio()
        insert_spend_plan()
        assert client.get("/api/guardrails", params={"spend": 0}).status_code == 422


class TestTrailingSpend:
    """The default numerator is trailing actual spending, not the plan's
    target: money that left the household counts whatever funded it, so
    the measure stays continuous across a buffer-to-portfolio transition.
    Until twelve complete months exist the target stands in, labeled by
    spend_months so a short window is never dressed up as a year."""

    def test_a_year_of_actuals_replaces_the_target(self, client):
        seed_portfolio()
        insert_spend_plan(annual_target=45000)
        for months_back in range(1, 13):
            insert_expense(3000, month_str(months_back))
        body = client.get("/api/guardrails").json()
        assert body["spend"] == 36000.0
        assert body["spend_source"] == "actual"
        assert body["spend_months"] == 12
        assert body["rate"] == 0.024
        assert body["annual_target"] == 45000.0

    def test_fund_outflows_count_and_contributions_do_not(self, client):
        # Outflows are the realisation of the smoothed plan the
        # contributions describe — counting both would double-count.
        seed_portfolio()
        insert_spend_plan()
        fund_id = insert_fund()
        for months_back in range(1, 13):
            insert_expense(2000, month_str(months_back))
            insert_fund_contribution(fund_id, 1500, f"{month_str(months_back)}-01")
        insert_expense(5000, month_str(1), funded_from="fund", fund_id=fund_id)
        assert client.get("/api/guardrails").json()["spend"] == 29000.0

    def test_the_window_is_the_last_twelve_complete_months(self, client):
        # The in-progress month undercounts and stays out; a thirteenth
        # month back has aged out of the window.
        seed_portfolio()
        insert_spend_plan()
        for months_back in range(1, 13):
            insert_expense(3000, month_str(months_back))
        insert_expense(9999, month_str(0))
        insert_expense(8888, month_str(13))
        body = client.get("/api/guardrails").json()
        assert body["spend"] == 36000.0
        assert body["spend_months"] == 12

    def test_a_short_history_falls_back_to_the_target(self, client):
        seed_portfolio()
        insert_spend_plan(annual_target=45000)
        insert_expense(3000, month_str(1))
        insert_expense(3000, month_str(2))
        body = client.get("/api/guardrails").json()
        assert body["spend"] == 45000.0
        assert body["spend_source"] == "target"
        assert body["spend_months"] == 2

    def test_a_current_month_only_history_counts_no_complete_months(self, client):
        seed_portfolio()
        insert_spend_plan()
        insert_expense(3000, month_str(0))
        body = client.get("/api/guardrails").json()
        assert body["spend_source"] == "target"
        assert body["spend_months"] == 0
