import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import connect
from sereno.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SERENO_DB_PATH", str(tmp_path / "sereno.db"))
    with TestClient(app) as client:
        yield client


def insert_fund(
    name,
    kind="sinking",
    target_amount=None,
    target_date=None,
    monthly_plan=None,
    active=1,
):
    conn = connect()
    try:
        cursor = conn.execute(
            "INSERT INTO fund (name, kind, target_amount, target_date, monthly_plan, active)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (name, kind, target_amount, target_date, monthly_plan, active),
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def insert_fund_entry(fund_id, as_of_date, balance, contribution=0):
    conn = connect()
    try:
        cursor = conn.execute(
            "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution)"
            " VALUES (?, ?, ?, ?)",
            (fund_id, as_of_date, balance, contribution),
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


class TestGetFunds:
    def test_empty_database_returns_no_funds(self, client):
        response = client.get("/api/funds")
        assert response.status_code == 200
        assert response.json() == []

    def test_returns_the_fund_dimension_rows_ordered_by_id(self, client):
        emergency_id = insert_fund("Emergency fund", target_amount=30000, monthly_plan=500)
        pool_id = insert_fund(
            "Pool fund", kind="goal", target_amount=14000, target_date="2027-08-01"
        )
        insert_fund_entry(emergency_id, "2026-06-01", 10000)
        insert_fund_entry(pool_id, "2026-06-01", 14000)
        response = client.get("/api/funds")
        assert response.status_code == 200
        assert response.json() == [
            {
                "id": emergency_id,
                "name": "Emergency fund",
                "kind": "sinking",
                "target_amount": 30000,
                "target_date": None,
                "monthly_plan": 500,
                "balance": 10000,
                "note": "$500 / mo · ~3.3 yrs to target",
            },
            {
                "id": pool_id,
                "name": "Pool fund",
                "kind": "goal",
                "target_amount": 14000,
                "target_date": "2027-08-01",
                "monthly_plan": None,
                "balance": 14000,
                "note": "✓ fully funded — ready to spend",
            },
        ]

    def test_omits_inactive_funds(self, client):
        insert_fund("Old fund", active=0)
        active_id = insert_fund("Bike fund", kind="goal", target_amount=10000)
        response = client.get("/api/funds")
        assert [fund["id"] for fund in response.json()] == [active_id]

    def test_a_fund_without_entries_has_a_zero_balance(self, client):
        insert_fund("House maintenance", target_amount=30000)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 0
        assert fund["note"] == "$30,000 to target · add a monthly plan"

    def test_the_latest_entry_wins(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000, monthly_plan=500)
        insert_fund_entry(fund_id, "2026-06-01", 10000)
        insert_fund_entry(fund_id, "2026-04-01", 8000)
        insert_fund_entry(fund_id, "2026-05-01", 9000)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 10000

    def test_same_day_entries_break_the_tie_by_insertion_order(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000)
        insert_fund_entry(fund_id, "2026-06-01", 10000)
        insert_fund_entry(fund_id, "2026-06-01", 10500)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 10500

    def test_an_open_ended_fund_notes_its_monthly_plan(self, client):
        fund_id = insert_fund("Travel fund", monthly_plan=300)
        insert_fund_entry(fund_id, "2026-06-01", 4200)
        (fund,) = client.get("/api/funds").json()
        assert fund["note"] == "$300 / mo · open-ended"
