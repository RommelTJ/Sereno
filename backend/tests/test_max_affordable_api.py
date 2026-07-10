"""GET /api/forecast/max-affordable: the solver behind "how much can
I afford in year N?" — a binary search to $1,000 over the same
simulation GET /api/forecast runs, under the same transient overrides
and purchase= composition. The default criterion is never running
out; ?last_to_age= relaxes it to a target age and
?min_balance_at_100= adds a terminal floor. The response names which
constraint binds — the purchase year's own liquidity versus long-run
longevity — because the two are different failures with different
fixes. Null until the forecast's prerequisites exist.
"""

import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import connect
from sereno.main import app

TODAY = date.today()

# Mirrors the backend's sanitized BIRTHDATE constant (January 1, 1988 —
# not a real birthday): with a Jan-1 birthdate the derived current age
# is simply the year difference.
START_AGE = TODAY.year - 1988

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


def insert_account(name, kind, *, tax_treatment="LTCG", priority=None, access_age=None):
    return execute(
        "INSERT INTO account (name, kind, tax_treatment, owner, is_liability, is_investable,"
        " withdrawal_priority, access_age) VALUES (?, ?, ?, NULL, 0, 1, ?, ?)",
        (name, kind, tax_treatment, priority, access_age),
    )


def insert_balance(account_id, balance_usd, *, cost_basis=None):
    return execute(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd, cost_basis)"
        " VALUES (?, ?, ?, ?)",
        (account_id, TODAY.isoformat(), balance_usd, cost_basis),
    )


def seed_config(annual_target=45_000):
    execute(
        "INSERT INTO spend_plan (effective_date, annual_target) VALUES (?, ?)",
        (TODAY.isoformat(), annual_target),
    )
    execute(
        "INSERT INTO assumption (effective_date, return_pct, inflation_pct) VALUES (?, ?, ?)",
        (TODAY.isoformat(), 7, 3),
    )
    execute(
        "INSERT INTO tax_param (tax_year, ltcg_0_ceiling, std_deduction, ordinary_brackets)"
        " VALUES (?, ?, ?, ?)",
        (TODAY.year, 96_700, 30_000, BRACKETS_JSON),
    )


def seed_portfolio(eth_balance=400_000):
    """The handoff's three buckets — 1.5M of net worth at the default."""
    eth = insert_account("Ethereum", "eth", priority=1)
    insert_balance(eth, eth_balance, cost_basis=4_000)
    brokerage = insert_account("VFIAX", "brokerage_fund", priority=2)
    insert_balance(brokerage, 600_000, cost_basis=480_000)
    retirement = insert_account(
        "Retirement", "401k", tax_treatment="ORDINARY", priority=3, access_age=59.5
    )
    insert_balance(retirement, 500_000)


def seed_bridge_portfolio():
    """A thin taxable bridge over a deep 401(k): the shape that makes
    the pre-59½ gate the binding constraint."""
    brokerage = insert_account("VFIAX", "brokerage_fund", priority=2)
    insert_balance(brokerage, 300_000, cost_basis=300_000)
    retirement = insert_account(
        "Retirement", "401k", tax_treatment="ORDINARY", priority=3, access_age=59.5
    )
    insert_balance(retirement, 5_000_000)


def year_at(age):
    """The calendar year a given age is reached, mirroring the API's
    year ↔ age mapping off the Jan-1 birthdate."""
    return TODAY.year + (age - START_AGE)


def solve(client, year, **params):
    response = client.get("/api/forecast/max-affordable", params={"year": year, **params})
    assert response.status_code == 200
    return response.json()


def forecast_with(client, *purchases):
    params = [("purchase", value) for value in purchases]
    return client.get("/api/forecast", params=params).json()


class TestPrerequisites:
    def test_null_on_an_empty_database(self, client):
        response = client.get("/api/forecast/max-affordable", params={"year": year_at(45)})
        assert response.status_code == 200
        assert response.json() is None

    def test_the_year_is_required(self, client):
        assert client.get("/api/forecast/max-affordable").status_code == 422

    def test_rejects_a_past_year(self, client):
        params = {"year": TODAY.year - 1}
        assert client.get("/api/forecast/max-affordable", params=params).status_code == 422

    def test_rejects_a_year_beyond_age_100(self, client):
        params = {"year": year_at(101)}
        assert client.get("/api/forecast/max-affordable", params=params).status_code == 422


class TestSolver:
    def test_the_default_criterion_is_never_running_out(self, client):
        # The found amount is a $1,000-rounded fixed point: it fits its
        # year and never runs out, and one step more breaks one of the
        # two — the bracketing is checked through GET /api/forecast
        # itself, so the solver can't drift from the simulation.
        seed_portfolio()
        seed_config()
        year = year_at(45)
        body = solve(client, year)
        amount = body["max_amount"]
        assert amount > 0
        assert amount % 1_000 == 0
        assert body["year"] == year
        assert body["age"] == 45

        fits = forecast_with(client, f"{year}:{amount}")
        assert fits["run_out_age"] is None
        assert fits["unaffordable"] == []
        breaks = forecast_with(client, f"{year}:{amount + 1_000}")
        assert breaks["run_out_age"] is not None or breaks["unaffordable"] != []

    def test_last_to_age_relaxes_the_criterion(self, client):
        # Accepting a plan that lasts "only" past 90 buys a bigger
        # purchase than one that must never run out.
        seed_portfolio()
        seed_config()
        year = year_at(65)
        never = solve(client, year)["max_amount"]
        to_90 = solve(client, year, last_to_age=90)["max_amount"]
        assert to_90 > never

        outcome = forecast_with(client, f"{year}:{to_90}")
        assert outcome["unaffordable"] == []
        assert outcome["run_out_age"] is None or outcome["run_out_age"] > 90

    def test_min_balance_at_100_adds_a_terminal_floor(self, client):
        seed_portfolio()
        seed_config()
        year = year_at(65)
        plain = solve(client, year)["max_amount"]
        floored = solve(client, year, min_balance_at_100=1_000_000)["max_amount"]
        assert floored < plain

        outcome = forecast_with(client, f"{year}:{floored}")
        assert outcome["balance_at_100"] >= 999_999

    def test_composes_with_fixed_purchases(self, client):
        # "Given I'm already buying the car at 40, how much house at
        # 45?" — the car drains the taxable buckets first, so the house
        # ceiling drops.
        seed_portfolio()
        seed_config()
        alone = solve(client, year_at(45))["max_amount"]
        with_car = solve(client, year_at(45), purchase=f"{year_at(40)}:80000")["max_amount"]
        assert with_car < alone

    def test_forecast_overrides_flow_through(self, client):
        # A lighter what-if spend leaves more room for the purchase.
        seed_portfolio()
        seed_config()
        year = year_at(65)
        at_plan = solve(client, year)["max_amount"]
        at_less = solve(client, year, spend=30_000)["max_amount"]
        assert at_less > at_plan

    def test_the_binding_constraint_flips_past_the_401k_gate(self, client):
        # At 59 the 401(k)'s millions are visible but locked: the
        # ceiling is the taxable bridge, and the response says so. At
        # 62 the same portfolio's ceiling jumps and the constraint
        # becomes longevity — different failures, different fixes.
        seed_bridge_portfolio()
        seed_config(annual_target=10_000)
        early = solve(client, year_at(59))
        late = solve(client, year_at(62))
        assert early["binding_constraint"] == "purchase_year_liquidity"
        assert late["binding_constraint"] == "longevity"
        assert late["max_amount"] > early["max_amount"]

    def test_a_plan_already_failing_solves_to_zero(self, client):
        # 100k at a 45k spend runs out in a few years with no purchase
        # at all: nothing is affordable, and the constraint is the
        # plan's own longevity.
        brokerage = insert_account("VFIAX", "brokerage_fund", priority=2)
        insert_balance(brokerage, 100_000, cost_basis=100_000)
        seed_config()
        body = solve(client, year_at(45))
        assert body["max_amount"] == 0.0
        assert body["binding_constraint"] == "longevity"
        assert body["run_out_age"] is not None
