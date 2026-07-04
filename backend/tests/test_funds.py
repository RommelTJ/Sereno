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
            },
            {
                "id": pool_id,
                "name": "Pool fund",
                "kind": "goal",
                "target_amount": 14000,
                "target_date": "2027-08-01",
                "monthly_plan": None,
            },
        ]

    def test_omits_inactive_funds(self, client):
        insert_fund("Old fund", active=0)
        active_id = insert_fund("Bike fund", kind="goal", target_amount=10000)
        response = client.get("/api/funds")
        assert [fund["id"] for fund in response.json()] == [active_id]
