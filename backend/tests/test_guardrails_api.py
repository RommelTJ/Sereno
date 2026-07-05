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
    return execute(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd) VALUES (?, ?, ?)",
        (account_id, as_of_date or TODAY.isoformat(), balance_usd),
    )


def seed_portfolio():
    """1,500,000 investable across two buckets, plus cash that must not count."""
    insert_balance(insert_account("Brokerage", "fund", is_investable=1), 1_000_000)
    insert_balance(insert_account("Retirement", "retirement", is_investable=1), 500_000)
    insert_balance(insert_account("Chase checking", "cash"), 25_000)


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
        }

    def test_spend_query_tests_a_what_if_level(self, client):
        seed_portfolio()
        insert_spend_plan(annual_target=45000)
        body = client.get("/api/guardrails", params={"spend": 60000}).json()
        assert body["spend"] == 60000.0
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
