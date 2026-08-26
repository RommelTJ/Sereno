"""The mortgage slice: the loan's terms as effective-dated planning config,
resolved the way assumption and spend_plan are — the latest effective_date
on or before today, ties broken by insertion order, null until a row
exists. POST appends a revision; the terms are never updated in place, so a
refinance and every change to the extra payment stay queryable history.

The linked account must be a real, active liability: the payoff is solved
from that account's ledger balance, so pointing the terms at a brokerage
fund would silently amortize the wrong number.
"""

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
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: S608
    finally:
        conn.close()


def insert_account(name="Mortgage", kind="mortgage", *, is_liability=1, active=1):
    return execute(
        "INSERT INTO account (name, kind, tax_treatment, is_liability, active)"
        " VALUES (?, ?, 'NONE', ?, ?)",
        (name, kind, is_liability, active),
    )


def insert_mortgage(
    effective_date,
    account_id,
    annual_rate=0.03,
    monthly_pi=1075,
    monthly_extra=0,
    monthly_escrow=0,
):
    return execute(
        "INSERT INTO mortgage (effective_date, account_id, annual_rate, monthly_pi,"
        " monthly_extra, monthly_escrow) VALUES (?, ?, ?, ?, ?, ?)",
        (effective_date, account_id, annual_rate, monthly_pi, monthly_extra, monthly_escrow),
    )


def body(account_id, **overrides):
    return {
        "effective_date": TODAY.isoformat(),
        "account_id": account_id,
        "annual_rate": 0.03,
        "monthly_pi": 1075,
        **overrides,
    }


class TestGetResolvesTheEffectiveRow:
    def test_null_until_the_terms_are_configured(self, client):
        assert client.get("/api/mortgage").json() is None

    def test_returns_the_stored_terms(self, client):
        account_id = insert_account()
        insert_mortgage(
            days_ago(30),
            account_id,
            annual_rate=0.03,
            monthly_pi=1075,
            monthly_extra=200,
            monthly_escrow=450,
        )
        payload = client.get("/api/mortgage").json()
        assert payload["effective_date"] == days_ago(30)
        assert payload["account_id"] == account_id
        assert payload["annual_rate"] == 0.03
        assert payload["monthly_pi"] == 1075
        assert payload["monthly_extra"] == 200
        assert payload["monthly_escrow"] == 450

    def test_the_latest_row_on_or_before_today_wins(self, client):
        account_id = insert_account()
        insert_mortgage(days_ago(400), account_id, annual_rate=0.05)
        insert_mortgage(days_ago(30), account_id, annual_rate=0.03)
        assert client.get("/api/mortgage").json()["annual_rate"] == 0.03

    def test_a_future_dated_revision_stays_staged(self, client):
        account_id = insert_account()
        insert_mortgage(days_ago(30), account_id, monthly_extra=200)
        insert_mortgage(days_ahead(30), account_id, monthly_extra=500)
        assert client.get("/api/mortgage").json()["monthly_extra"] == 200

    def test_a_tie_breaks_by_insertion_order(self, client):
        account_id = insert_account()
        insert_mortgage(days_ago(1), account_id, monthly_extra=200)
        insert_mortgage(days_ago(1), account_id, monthly_extra=350)
        assert client.get("/api/mortgage").json()["monthly_extra"] == 350


class TestPostAppendsARevision:
    def test_creates_the_first_row(self, client):
        account_id = insert_account()
        response = client.post("/api/mortgage", json=body(account_id, monthly_extra=200))
        assert response.status_code == 201
        payload = response.json()
        assert payload["account_id"] == account_id
        assert payload["annual_rate"] == 0.03
        assert payload["monthly_pi"] == 1075
        assert payload["monthly_extra"] == 200

    def test_extra_and_escrow_default_to_zero(self, client):
        account_id = insert_account()
        payload = client.post("/api/mortgage", json=body(account_id)).json()
        assert (payload["monthly_extra"], payload["monthly_escrow"]) == (0, 0)

    def test_a_revision_appends_rather_than_updating(self, client):
        account_id = insert_account()
        client.post("/api/mortgage", json=body(account_id, monthly_extra=200))
        client.post("/api/mortgage", json=body(account_id, monthly_extra=500))
        assert count_rows("mortgage") == 2
        assert client.get("/api/mortgage").json()["monthly_extra"] == 500


class TestPostGuardsTheLinkedAccount:
    def test_an_unknown_account_is_a_404(self, client):
        assert client.post("/api/mortgage", json=body(99)).status_code == 404

    def test_an_asset_account_is_a_422(self, client):
        account_id = insert_account("VFIAX", "brokerage_fund", is_liability=0)
        response = client.post("/api/mortgage", json=body(account_id))
        assert response.status_code == 422
        assert "liability" in response.json()["detail"]

    def test_an_inactive_account_is_a_422(self, client):
        account_id = insert_account(active=0)
        assert client.post("/api/mortgage", json=body(account_id)).status_code == 422

    def test_a_rejected_post_appends_nothing(self, client):
        insert_account()
        client.post("/api/mortgage", json=body(99))
        assert count_rows("mortgage") == 0


class TestPostGuardsTheTerms:
    @pytest.mark.parametrize(
        "field,value",
        [
            ("annual_rate", -0.01),
            ("monthly_pi", 0),
            ("monthly_pi", -1075),
            ("monthly_extra", -200),
            ("monthly_escrow", -450),
        ],
    )
    def test_impossible_terms_are_a_422(self, client, field, value):
        account_id = insert_account()
        response = client.post("/api/mortgage", json=body(account_id, **{field: value}))
        assert response.status_code == 422

    def test_a_zero_rate_loan_is_allowed(self, client):
        account_id = insert_account()
        response = client.post("/api/mortgage", json=body(account_id, annual_rate=0))
        assert response.status_code == 201
