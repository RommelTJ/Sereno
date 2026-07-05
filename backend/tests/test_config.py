"""The planning-config slice: effective-dated rows where the latest row per key wins.

GET endpoints resolve the effective row — the latest effective_date on or
before today, ties broken by insertion order — mirroring the category_plan
rule ("the latest row on or before the month wins"). tax_param is keyed by
tax_year instead, so its GET returns every year.
"""

import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import connect
from sereno.main import app

TODAY = date.today()


def days_ago(days):
    return (TODAY - timedelta(days=days)).isoformat()


def days_ahead(days):
    return (TODAY + timedelta(days=days)).isoformat()


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


def count_rows(table):
    conn = connect()
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


def insert_assumption(effective_date, return_pct=7.0, inflation_pct=3.0, eth_growth_pct=None):
    return execute(
        "INSERT INTO assumption (effective_date, return_pct, inflation_pct, eth_growth_pct)"
        " VALUES (?, ?, ?, ?)",
        (effective_date, return_pct, inflation_pct, eth_growth_pct),
    )


def insert_spend_plan(effective_date, annual_target=45000, initial_rate=None, guardrail_band=0.20):
    return execute(
        "INSERT INTO spend_plan (effective_date, annual_target, initial_rate, guardrail_band)"
        " VALUES (?, ?, ?, ?)",
        (effective_date, annual_target, initial_rate, guardrail_band),
    )


def insert_social_security(person, effective_date, start_age=67, monthly_amount=1500):
    return execute(
        "INSERT INTO social_security (person, effective_date, start_age, monthly_amount)"
        " VALUES (?, ?, ?, ?)",
        (person, effective_date, start_age, monthly_amount),
    )


def insert_tax_param(
    tax_year,
    filing_status="MFJ",
    ltcg_0_ceiling=96700,
    ltcg_15_ceiling=None,
    niit_rate=0.038,
    niit_threshold=None,
    state_treatment="CA_ordinary",
    std_deduction=None,
    ordinary_brackets=None,
):
    return execute(
        "INSERT INTO tax_param (tax_year, filing_status, ltcg_0_ceiling, ltcg_15_ceiling,"
        " niit_rate, niit_threshold, state_treatment, std_deduction, ordinary_brackets)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            tax_year,
            filing_status,
            ltcg_0_ceiling,
            ltcg_15_ceiling,
            niit_rate,
            niit_threshold,
            state_treatment,
            std_deduction,
            json.dumps(ordinary_brackets) if ordinary_brackets is not None else None,
        ),
    )


class TestGetAssumptions:
    def test_empty_database_returns_null(self, client):
        response = client.get("/api/assumptions")
        assert response.status_code == 200
        assert response.json() is None

    def test_returns_the_effective_row(self, client):
        row_id = insert_assumption(days_ago(30), return_pct=7.0, inflation_pct=3.0)
        response = client.get("/api/assumptions")
        assert response.status_code == 200
        assert response.json() == {
            "id": row_id,
            "effective_date": days_ago(30),
            "return_pct": 7.0,
            "inflation_pct": 3.0,
            "eth_growth_pct": None,
        }

    def test_latest_row_on_or_before_today_wins(self, client):
        insert_assumption(days_ago(365), return_pct=6.0)
        latest_id = insert_assumption(days_ago(30), return_pct=7.5, eth_growth_pct=5.0)
        response = client.get("/api/assumptions")
        assert response.json()["id"] == latest_id
        assert response.json()["return_pct"] == 7.5

    def test_a_future_dated_row_does_not_win_yet(self, client):
        current_id = insert_assumption(days_ago(30), return_pct=7.0)
        insert_assumption(days_ahead(30), return_pct=9.0)
        response = client.get("/api/assumptions")
        assert response.json()["id"] == current_id

    def test_same_date_ties_break_by_insertion_order(self, client):
        insert_assumption(days_ago(30), return_pct=7.0)
        corrected_id = insert_assumption(days_ago(30), return_pct=6.5)
        response = client.get("/api/assumptions")
        assert response.json()["id"] == corrected_id
        assert response.json()["return_pct"] == 6.5


class TestGetSpendPlan:
    def test_empty_database_returns_null(self, client):
        response = client.get("/api/spend-plan")
        assert response.status_code == 200
        assert response.json() is None

    def test_returns_the_effective_row(self, client):
        insert_spend_plan(days_ago(365), annual_target=42000)
        latest_id = insert_spend_plan(days_ago(30), annual_target=45000, initial_rate=0.0294)
        response = client.get("/api/spend-plan")
        assert response.status_code == 200
        assert response.json() == {
            "id": latest_id,
            "effective_date": days_ago(30),
            "annual_target": 45000,
            "initial_rate": 0.0294,
            "guardrail_band": 0.2,
        }

    def test_a_future_dated_row_does_not_win_yet(self, client):
        current_id = insert_spend_plan(days_ago(30), annual_target=45000)
        insert_spend_plan(days_ahead(30), annual_target=50000)
        response = client.get("/api/spend-plan")
        assert response.json()["id"] == current_id


class TestGetSocialSecurity:
    def test_empty_database_returns_no_rows(self, client):
        response = client.get("/api/social-security")
        assert response.status_code == 200
        assert response.json() == []

    def test_resolves_the_latest_row_per_person_you_first(self, client):
        insert_social_security("spouse", days_ago(365), monthly_amount=1300)
        spouse_id = insert_social_security("spouse", days_ago(30), monthly_amount=1400)
        you_id = insert_social_security("you", days_ago(30), monthly_amount=1500)
        response = client.get("/api/social-security")
        assert response.status_code == 200
        assert response.json() == [
            {
                "id": you_id,
                "person": "you",
                "effective_date": days_ago(30),
                "start_age": 67,
                "monthly_amount": 1500,
            },
            {
                "id": spouse_id,
                "person": "spouse",
                "effective_date": days_ago(30),
                "start_age": 67,
                "monthly_amount": 1400,
            },
        ]

    def test_a_future_dated_row_does_not_win_yet(self, client):
        current_id = insert_social_security("you", days_ago(30), monthly_amount=1500)
        insert_social_security("you", days_ahead(30), monthly_amount=1800)
        response = client.get("/api/social-security")
        assert [row["id"] for row in response.json()] == [current_id]


class TestGetTaxParams:
    def test_empty_database_returns_no_rows(self, client):
        response = client.get("/api/tax-params")
        assert response.status_code == 200
        assert response.json() == []

    def test_returns_all_years_ascending_with_parsed_brackets(self, client):
        brackets = [{"rate": 0.10, "upto": 24800}, {"rate": 0.12, "upto": None}]
        insert_tax_param(2027, ltcg_0_ceiling=99000)
        insert_tax_param(
            2026,
            ltcg_15_ceiling=600050,
            niit_threshold=250000,
            std_deduction=30000,
            ordinary_brackets=brackets,
        )
        response = client.get("/api/tax-params")
        assert response.status_code == 200
        assert response.json() == [
            {
                "tax_year": 2026,
                "filing_status": "MFJ",
                "ltcg_0_ceiling": 96700,
                "ltcg_15_ceiling": 600050,
                "niit_rate": 0.038,
                "niit_threshold": 250000,
                "state_treatment": "CA_ordinary",
                "std_deduction": 30000,
                "ordinary_brackets": brackets,
            },
            {
                "tax_year": 2027,
                "filing_status": "MFJ",
                "ltcg_0_ceiling": 99000,
                "ltcg_15_ceiling": None,
                "niit_rate": 0.038,
                "niit_threshold": None,
                "state_treatment": "CA_ordinary",
                "std_deduction": None,
                "ordinary_brackets": None,
            },
        ]


class TestPostAssumptions:
    def test_appends_a_new_row_and_returns_it(self, client):
        insert_assumption(days_ago(365), return_pct=7.0)
        response = client.post(
            "/api/assumptions",
            json={"effective_date": TODAY.isoformat(), "return_pct": 6.5, "inflation_pct": 2.8},
        )
        assert response.status_code == 201
        created = response.json()
        assert created == {
            "id": created["id"],
            "effective_date": TODAY.isoformat(),
            "return_pct": 6.5,
            "inflation_pct": 2.8,
            "eth_growth_pct": None,
        }
        assert client.get("/api/assumptions").json() == created
        assert count_rows("assumption") == 2  # append-only: the old row remains


class TestPostSpendPlan:
    def test_appends_a_new_row_and_returns_it(self, client):
        insert_spend_plan(days_ago(365), annual_target=42000)
        response = client.post(
            "/api/spend-plan",
            json={
                "effective_date": TODAY.isoformat(),
                "annual_target": 48000,
                "initial_rate": 0.0294,
            },
        )
        assert response.status_code == 201
        created = response.json()
        assert created["annual_target"] == 48000
        assert created["guardrail_band"] == 0.2  # schema default carried by the API
        assert client.get("/api/spend-plan").json() == created
        assert count_rows("spend_plan") == 2


class TestPostSocialSecurity:
    def test_appends_a_row_for_one_person(self, client):
        response = client.post(
            "/api/social-security",
            json={
                "person": "you",
                "effective_date": TODAY.isoformat(),
                "start_age": 67,
                "monthly_amount": 1550,
            },
        )
        assert response.status_code == 201
        created = response.json()
        assert created["person"] == "you"
        assert created["monthly_amount"] == 1550
        assert client.get("/api/social-security").json() == [created]

    def test_rejects_an_unknown_person(self, client):
        response = client.post(
            "/api/social-security",
            json={
                "person": "kid",
                "effective_date": TODAY.isoformat(),
                "start_age": 67,
                "monthly_amount": 100,
            },
        )
        assert response.status_code == 422
        assert count_rows("social_security") == 0


class TestPostTaxParams:
    def test_creates_a_new_tax_year(self, client):
        brackets = [{"rate": 0.10, "upto": 24800}, {"rate": 0.12, "upto": None}]
        response = client.post(
            "/api/tax-params",
            json={
                "tax_year": 2027,
                "filing_status": "MFJ",
                "ltcg_0_ceiling": 99000,
                "ltcg_15_ceiling": 615000,
                "niit_rate": 0.038,
                "niit_threshold": 250000,
                "state_treatment": "CA_ordinary",
                "std_deduction": 30500,
                "ordinary_brackets": brackets,
            },
        )
        assert response.status_code == 201
        assert response.json()["tax_year"] == 2027
        assert response.json()["ordinary_brackets"] == brackets
        assert client.get("/api/tax-params").json() == [response.json()]

    def test_defaults_match_the_schema(self, client):
        response = client.post("/api/tax-params", json={"tax_year": 2027, "ltcg_0_ceiling": 99000})
        assert response.status_code == 201
        assert response.json() == {
            "tax_year": 2027,
            "filing_status": "MFJ",
            "ltcg_0_ceiling": 99000,
            "ltcg_15_ceiling": None,
            "niit_rate": 0.038,
            "niit_threshold": None,
            "state_treatment": "CA_ordinary",
            "std_deduction": None,
            "ordinary_brackets": None,
        }

    def test_a_duplicate_year_conflicts(self, client):
        insert_tax_param(2026)
        response = client.post("/api/tax-params", json={"tax_year": 2026, "ltcg_0_ceiling": 96700})
        assert response.status_code == 409
        assert count_rows("tax_param") == 1
