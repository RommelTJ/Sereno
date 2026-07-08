"""GET /api/sourcing: the tax-aware waterfall fed by live balances,
lot-level basis, and the year's tax parameters. ?age= is required —
no birthdate lives in the schema — and ?spend= tests a what-if level
instead of the plan's annual target. Buckets aggregate accounts by
withdrawal_priority, each account contributing its latest balance from
any month (unlike guardrails' latest-month total, a stale ETH entry
still sources withdrawals) and its basis from open tax lots, falling
back to the balance row's cost_basis, then to zero. Null until a tax
year and at least one balance exist, and until either a spend plan or
?spend= provides the target.
"""

import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import connect
from sereno.main import app

TODAY = date.today()
LAST_YEAR = (TODAY - timedelta(days=365)).isoformat()

# The seed's 2026 MFJ brackets
BRACKETS_JSON = json.dumps(
    [
        {"rate": 0.10, "upto": 24_800},
        {"rate": 0.12, "upto": 100_800},
        {"rate": 0.22, "upto": 211_400},
        {"rate": 0.24, "upto": None},
    ]
)


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


def insert_spend_plan(annual_target=45_000):
    return execute(
        "INSERT INTO spend_plan (effective_date, annual_target) VALUES (?, ?)",
        (TODAY.isoformat(), annual_target),
    )


def insert_tax_param(tax_year=None, ltcg_0_ceiling=96_700, std_deduction=30_000):
    return execute(
        "INSERT INTO tax_param (tax_year, ltcg_0_ceiling, std_deduction, ordinary_brackets)"
        " VALUES (?, ?, ?, ?)",
        (tax_year or TODAY.year, ltcg_0_ceiling, std_deduction, BRACKETS_JSON),
    )


def insert_account(name, kind, *, tax_treatment="LTCG", priority=None, access_age=None):
    return execute(
        "INSERT INTO account (name, kind, tax_treatment, owner, is_liability, is_investable,"
        " withdrawal_priority, access_age) VALUES (?, ?, ?, NULL, 0, 1, ?, ?)",
        (name, kind, tax_treatment, priority, access_age),
    )


def insert_balance(account_id, balance_usd, *, as_of_date=None, cost_basis=None):
    return execute(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd, cost_basis)"
        " VALUES (?, ?, ?, ?)",
        (account_id, as_of_date or TODAY.isoformat(), balance_usd, cost_basis),
    )


def insert_tax_lot(account_id, cost_basis, *, closed_on=None):
    return execute(
        "INSERT INTO tax_lot (account_id, acquired_on, quantity, cost_basis, closed_on)"
        " VALUES (?, '2021-03-15', 100, ?, ?)",
        (account_id, cost_basis, closed_on),
    )


def insert_social_security(person="you", start_age=67, monthly_amount=2_500):
    return execute(
        "INSERT INTO social_security (person, effective_date, start_age, monthly_amount)"
        " VALUES (?, ?, ?, ?)",
        (person, TODAY.isoformat(), start_age, monthly_amount),
    )


def seed_portfolio():
    """The handoff's three buckets: low-basis ETH, a brokerage with open
    lots, and an age-gated 401(k)."""
    eth = insert_account("Ethereum", "eth", priority=1)
    insert_balance(eth, 400_000, cost_basis=4_000)
    brokerage = insert_account("VFIAX", "brokerage_fund", priority=2)
    insert_balance(brokerage, 600_000)
    insert_tax_lot(brokerage, 480_000)
    retirement = insert_account(
        "Retirement", "401k", tax_treatment="ORDINARY", priority=3, access_age=59.5
    )
    insert_balance(retirement, 500_000)


class TestPrerequisites:
    def test_returns_null_without_tax_params(self, client):
        seed_portfolio()
        insert_spend_plan()
        response = client.get("/api/sourcing", params={"age": 38})
        assert response.status_code == 200
        assert response.json() is None

    def test_returns_null_without_any_balances(self, client):
        insert_spend_plan()
        insert_tax_param()
        response = client.get("/api/sourcing", params={"age": 38})
        assert response.status_code == 200
        assert response.json() is None

    def test_returns_null_without_a_spend_plan_or_spend_query(self, client):
        seed_portfolio()
        insert_tax_param()
        response = client.get("/api/sourcing", params={"age": 38})
        assert response.status_code == 200
        assert response.json() is None

    def test_a_spend_query_stands_in_for_the_missing_plan(self, client):
        seed_portfolio()
        insert_tax_param()
        body = client.get("/api/sourcing", params={"age": 38, "spend": 45_000}).json()
        assert body is not None
        assert body["target_net"] == 45_000.0
        assert body["annual_target"] is None

    def test_a_missing_age_defaults_to_the_birthdate_derived_age(self, client):
        # Mirrors the backend's sanitized BIRTHDATE constant (January 1,
        # 1988): with a Jan-1 birthdate the derived current age is
        # simply the year difference.
        seed_portfolio()
        insert_spend_plan()
        insert_tax_param()
        response = client.get("/api/sourcing")
        assert response.status_code == 200
        assert response.json()["age"] == TODAY.year - 1988

    def test_rejects_a_non_positive_spend(self, client):
        params = {"age": 38, "spend": 0}
        assert client.get("/api/sourcing", params=params).status_code == 422


class TestWaterfall:
    def test_the_full_waterfall_at_thirty_eight(self, client):
        # staking (ETH > 50k) is the only income at 38, the whole gap
        # fits ETH's 0% headroom, and the 401(k) reports its gate
        seed_portfolio()
        insert_spend_plan(annual_target=45_000)
        insert_tax_param()
        insert_social_security(start_age=67)
        response = client.get("/api/sourcing", params={"age": 38})
        assert response.status_code == 200
        assert response.json() == {
            "target_net": 45_000.0,
            "annual_target": 45_000.0,
            "age": 38.0,
            "tax_year": TODAY.year,
            "ss_income": 0.0,
            "staking_income": 3_000.0,
            "income": 3_000.0,
            "gap": 42_000.0,
            "headroom": 96_700.0,
            "steps": [
                {
                    "name": "ETH",
                    "treatment": "LTCG",
                    "gross": 42_000.0,
                    "tax": 0.0,
                    "net": 42_000.0,
                    "note": None,
                },
                {
                    "name": "Brokerage",
                    "treatment": "LTCG",
                    "gross": 0.0,
                    "tax": 0.0,
                    "net": 0.0,
                    "note": None,
                },
                {
                    "name": "401(k)",
                    "treatment": "ORDINARY",
                    "gross": 0.0,
                    "tax": 0.0,
                    "net": 0.0,
                    "note": "locked until age 59.5",
                },
            ],
            "net_delivered": 45_000.0,
            "shortfall": 0.0,
        }

    def test_social_security_covers_the_gap_past_its_start_age(self, client):
        seed_portfolio()
        insert_spend_plan()
        insert_tax_param()
        insert_social_security(person="you", start_age=67, monthly_amount=2_500)
        insert_social_security(person="spouse", start_age=67, monthly_amount=2_000)
        body = client.get("/api/sourcing", params={"age": 68}).json()
        assert body["ss_income"] == 54_000.0
        assert body["gap"] == 0.0
        assert all(step["gross"] == 0 for step in body["steps"])
        assert body["net_delivered"] == 45_000.0

    def test_the_401k_unlocks_at_the_access_age(self, client):
        # only the 401(k) holds a balance: the deduction shelters the
        # first 30,000 gross and the rest is grossed up at 10%
        retirement = insert_account(
            "Retirement", "401k", tax_treatment="ORDINARY", priority=3, access_age=59.5
        )
        insert_balance(retirement, 500_000)
        insert_spend_plan()
        insert_tax_param()
        body = client.get("/api/sourcing", params={"age": 60}).json()
        step = body["steps"][0]
        assert step["note"] is None
        assert step["gross"] == pytest.approx(30_000 + 15_000 / 0.9)
        assert step["tax"] == pytest.approx(15_000 / 0.9 * 0.10)
        assert body["shortfall"] == 0.0

    def test_spend_query_tests_a_what_if_level(self, client):
        seed_portfolio()
        insert_spend_plan(annual_target=45_000)
        insert_tax_param()
        body = client.get("/api/sourcing", params={"age": 38, "spend": 100_000}).json()
        assert body["target_net"] == 100_000.0
        assert body["annual_target"] == 45_000.0
        assert body["gap"] == 97_000.0

    def test_open_lots_set_the_basis_and_closed_lots_do_not(self, client):
        # zero ceiling forces a taxed sale: with basis 480,000 on
        # 600,000 a fifth of every dollar is gain, so net N costs
        # N / 0.97 — a counted closed lot would change the gross-up
        brokerage = insert_account("VFIAX", "brokerage_fund", priority=2)
        insert_balance(brokerage, 600_000)
        insert_tax_lot(brokerage, 240_000)
        insert_tax_lot(brokerage, 240_000)
        insert_tax_lot(brokerage, 100_000, closed_on=TODAY.isoformat())
        insert_spend_plan()
        insert_tax_param(ltcg_0_ceiling=0)
        body = client.get("/api/sourcing", params={"age": 38}).json()
        step = body["steps"][0]
        assert step["gross"] == pytest.approx(45_000 / 0.97)
        assert step["tax"] == pytest.approx(45_000 / 0.97 * 0.2 * 0.15)

    def test_an_account_missing_a_lot_falls_back_to_the_balance_basis(self, client):
        # same numbers as the lots test, carried by cost_basis instead
        brokerage = insert_account("VFIAX", "brokerage_fund", priority=2)
        insert_balance(brokerage, 600_000, cost_basis=480_000)
        insert_spend_plan()
        insert_tax_param(ltcg_0_ceiling=0)
        body = client.get("/api/sourcing", params={"age": 38}).json()
        assert body["steps"][0]["gross"] == pytest.approx(45_000 / 0.97)

    def test_a_stale_balance_month_still_sources_withdrawals(self, client):
        # unlike guardrails' latest-month investable total, sourcing
        # walks back to each account's newest balance row
        eth = insert_account("Ethereum", "eth", priority=1)
        insert_balance(eth, 400_000, as_of_date=LAST_YEAR, cost_basis=4_000)
        insert_spend_plan()
        insert_tax_param()
        body = client.get("/api/sourcing", params={"age": 38}).json()
        assert body["steps"][0]["gross"] == pytest.approx(42_000)
        assert body["shortfall"] == 0.0
