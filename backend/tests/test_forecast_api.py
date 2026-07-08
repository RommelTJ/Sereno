"""GET /api/forecast: the longevity simulation fed by live buckets and
the stored planning config. Spend defaults to the plan's annual
target, return and inflation to the assumptions row, and Social
Security to the per-person stored rows; ?spend=, ?return_pct=,
?inflation_pct=, ?ss_you=, ?ss_spouse=, and ?ss_start= override
transiently (the Forecast screen's sliders never persist). The
response carries the full series, the run-out age, the age-90
balance, and the sensitivity table — whole percentages of the latest
net worth from 2% to 6%, each rounded to the nearest $1,000 and
simulated at the resolved assumptions. Null until a tax year,
balances, a spend target, and return/inflation figures exist.
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


def insert_spend_plan(annual_target=45_000):
    return execute(
        "INSERT INTO spend_plan (effective_date, annual_target) VALUES (?, ?)",
        (TODAY.isoformat(), annual_target),
    )


def insert_assumption(return_pct=7, inflation_pct=3):
    return execute(
        "INSERT INTO assumption (effective_date, return_pct, inflation_pct) VALUES (?, ?, ?)",
        (TODAY.isoformat(), return_pct, inflation_pct),
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


def insert_balance(account_id, balance_usd, *, cost_basis=None):
    return execute(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd, cost_basis)"
        " VALUES (?, ?, ?, ?)",
        (account_id, TODAY.isoformat(), balance_usd, cost_basis),
    )


def insert_social_security(person="you", start_age=67, monthly_amount=2_500):
    return execute(
        "INSERT INTO social_security (person, effective_date, start_age, monthly_amount)"
        " VALUES (?, ?, ?, ?)",
        (person, TODAY.isoformat(), start_age, monthly_amount),
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


def seed_config():
    insert_spend_plan(annual_target=45_000)
    insert_assumption(return_pct=7, inflation_pct=3)
    insert_tax_param()


class TestPrerequisites:
    def test_returns_null_without_tax_params(self, client):
        seed_portfolio()
        insert_spend_plan()
        insert_assumption()
        response = client.get("/api/forecast")
        assert response.status_code == 200
        assert response.json() is None

    def test_returns_null_without_any_balances(self, client):
        seed_config()
        response = client.get("/api/forecast")
        assert response.status_code == 200
        assert response.json() is None

    def test_returns_null_without_a_spend_plan_or_spend_query(self, client):
        seed_portfolio()
        insert_assumption()
        insert_tax_param()
        assert client.get("/api/forecast").json() is None

    def test_a_spend_query_stands_in_for_the_missing_plan(self, client):
        seed_portfolio()
        insert_assumption()
        insert_tax_param()
        body = client.get("/api/forecast", params={"spend": 45_000}).json()
        assert body is not None
        assert body["spend"] == 45_000.0
        assert body["annual_target"] is None

    def test_returns_null_without_assumptions(self, client):
        seed_portfolio()
        insert_spend_plan()
        insert_tax_param()
        assert client.get("/api/forecast").json() is None

    def test_rate_queries_stand_in_for_missing_assumptions(self, client):
        seed_portfolio()
        insert_spend_plan()
        insert_tax_param()
        params = {"return_pct": 7, "inflation_pct": 3}
        body = client.get("/api/forecast", params=params).json()
        assert body is not None
        assert body["return_pct"] == 7.0
        assert body["inflation_pct"] == 3.0

    def test_rejects_a_non_positive_spend(self, client):
        assert client.get("/api/forecast", params={"spend": 0}).status_code == 422


class TestForecast:
    def test_the_start_age_derives_from_the_birthdate(self, client):
        seed_portfolio()
        seed_config()
        body = client.get("/api/forecast").json()
        assert body["start_age"] == START_AGE
        assert body["series"][0]["age"] == START_AGE

    def test_the_full_forecast_with_seeded_config(self, client):
        seed_portfolio()
        seed_config()
        insert_social_security(person="you", start_age=67, monthly_amount=2_500)
        insert_social_security(person="spouse", start_age=67, monthly_amount=2_000)
        response = client.get("/api/forecast")
        assert response.status_code == 200
        body = response.json()
        assert body["spend"] == 45_000.0
        assert body["annual_target"] == 45_000.0
        assert body["return_pct"] == 7.0
        assert body["inflation_pct"] == 3.0
        assert body["ss_you"] == 2_500.0
        assert body["ss_spouse"] == 2_000.0
        assert body["ss_start"] == 67.0
        assert body["tax_year"] == TODAY.year

        assert [point["age"] for point in body["series"]] == list(range(START_AGE, 96))
        first = body["series"][0]
        assert first["eth"] == pytest.approx(400_000 * 1.04)
        assert first["brokerage"] == pytest.approx(600_000 * 1.04)
        assert first["retirement"] == pytest.approx(500_000 * 1.04)
        assert first["ss_income"] == 0.0
        assert body["series"][67 - START_AGE]["ss_income"] == pytest.approx(54_000)

        # 45,000 against 1.5M growing 4% real: the money outlasts 95.
        assert body["run_out_age"] is None
        assert body["balance_at_90"] > 0

    def test_the_series_reflects_the_sourcing_waterfall(self, client):
        # Age 38 stakes 3,000 (ETH > 50k) and sells the 42,000 gap out
        # of ETH inside the headroom; the next point shows it.
        seed_portfolio()
        seed_config()
        body = client.get("/api/forecast").json()
        expected = (400_000 * 1.04 - 42_000) * 1.04
        assert body["series"][1]["eth"] == pytest.approx(expected)
        assert body["series"][1]["brokerage"] == pytest.approx(600_000 * 1.04**2)

    def test_rate_overrides_change_the_simulation(self, client):
        seed_portfolio()
        seed_config()
        params = {"return_pct": 3, "inflation_pct": 3}
        body = client.get("/api/forecast", params=params).json()
        assert body["series"][0]["eth"] == pytest.approx(400_000)

    def test_a_heavy_spend_override_runs_the_money_out(self, client):
        seed_portfolio()
        seed_config()
        body = client.get("/api/forecast", params={"spend": 200_000}).json()
        assert body["annual_target"] == 45_000.0
        assert body["spend"] == 200_000.0
        assert body["run_out_age"] is not None

    def test_ss_overrides_replace_the_stored_benefits(self, client):
        seed_portfolio()
        seed_config()
        insert_social_security(person="you", start_age=67, monthly_amount=2_500)
        insert_social_security(person="spouse", start_age=67, monthly_amount=2_000)
        params = {"ss_you": 1_500, "ss_spouse": 1_400, "ss_start": 62}
        body = client.get("/api/forecast", params=params).json()
        assert body["ss_you"] == 1_500.0
        assert body["ss_spouse"] == 1_400.0
        assert body["ss_start"] == 62.0
        assert body["series"][61 - START_AGE]["ss_income"] == 0.0
        assert body["series"][62 - START_AGE]["ss_income"] == pytest.approx(34_800)

    def test_without_ss_rows_the_benefits_default_to_zero(self, client):
        seed_portfolio()
        seed_config()
        body = client.get("/api/forecast").json()
        assert body["ss_you"] == 0.0
        assert body["ss_spouse"] == 0.0
        assert body["ss_start"] == 67.0
        assert all(point["ss_income"] == 0 for point in body["series"])


class TestSensitivity:
    def test_levels_are_whole_percentages_of_net_worth(self, client):
        # 1.5M of balances → 2% through 6%, the 4% middle the classic
        # withdrawal rule of thumb.
        seed_portfolio()
        seed_config()
        body = client.get("/api/forecast").json()
        assert [row["spend"] for row in body["sensitivity"]] == [
            30_000.0,
            45_000.0,
            60_000.0,
            75_000.0,
            90_000.0,
        ]

    def test_levels_round_to_the_nearest_thousand(self, client):
        # 1,512,345 of net worth: 4% = 60,493.80 → 60,000, 5% =
        # 75,617.25 → 76,000.
        seed_portfolio(eth_balance=412_345)
        seed_config()
        body = client.get("/api/forecast").json()
        assert [row["spend"] for row in body["sensitivity"]] == [
            30_000.0,
            45_000.0,
            60_000.0,
            76_000.0,
            91_000.0,
        ]

    def test_each_row_carries_its_own_outcome(self, client):
        seed_portfolio()
        seed_config()
        rows = client.get("/api/forecast").json()["sensitivity"]
        by_spend = {row["spend"]: row for row in rows}
        assert by_spend[30_000.0]["run_out_age"] is None
        assert by_spend[30_000.0]["balance_at_90"] > 0
        assert by_spend[90_000.0]["run_out_age"] is not None
