import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import connect
from sereno.main import app


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


def insert_category(name, emoji=None, is_fixed=0, active=1):
    return execute(
        "INSERT INTO category (name, emoji, is_fixed, active) VALUES (?, ?, ?, ?)",
        name,
        emoji,
        is_fixed,
        active,
    )


def insert_plan(category_id, effective_month, planned):
    return execute(
        "INSERT INTO category_plan (category_id, effective_month, planned) VALUES (?, ?, ?)",
        category_id,
        effective_month,
        planned,
    )


class TestGetCategories:
    def test_empty_database_returns_no_categories(self, client):
        response = client.get("/api/categories")
        assert response.status_code == 200
        assert response.json() == []

    def test_returns_the_category_dimension_with_planned_amounts(self, client):
        groceries_id = insert_category("Groceries", emoji="🛒")
        gas_id = insert_category("Gas", emoji="🛢️")
        insert_plan(groceries_id, "2026-01", 500)
        insert_plan(gas_id, "2026-01", 100)
        response = client.get("/api/categories", params={"month": "2026-06"})
        assert response.status_code == 200
        assert response.json() == [
            {
                "id": groceries_id,
                "name": "Groceries",
                "emoji": "🛒",
                "is_fixed": False,
                "planned": 500,
            },
            {"id": gas_id, "name": "Gas", "emoji": "🛢️", "is_fixed": False, "planned": 100},
        ]

    def test_planned_is_the_latest_plan_effective_on_or_before_the_month(self, client):
        groceries_id = insert_category("Groceries")
        insert_plan(groceries_id, "2026-01", 500)
        insert_plan(groceries_id, "2026-06", 550)

        may = client.get("/api/categories", params={"month": "2026-05"}).json()
        assert may[0]["planned"] == 500

        june = client.get("/api/categories", params={"month": "2026-06"}).json()
        assert june[0]["planned"] == 550

    def test_planned_is_zero_before_any_plan_takes_effect(self, client):
        unplanned_id = insert_category("Gifts")
        future_id = insert_category("Travel")
        insert_plan(future_id, "2026-06", 100)
        response = client.get("/api/categories", params={"month": "2026-01"})
        assert response.json() == [
            {"id": unplanned_id, "name": "Gifts", "emoji": None, "is_fixed": False, "planned": 0},
            {"id": future_id, "name": "Travel", "emoji": None, "is_fixed": False, "planned": 0},
        ]

    def test_excludes_inactive_categories(self, client):
        insert_category("Old envelope", active=0)
        response = client.get("/api/categories")
        assert response.json() == []

    def test_month_defaults_to_the_current_month(self, client):
        groceries_id = insert_category("Groceries")
        insert_plan(groceries_id, "2000-01", 500)
        insert_plan(groceries_id, "2999-01", 900)
        response = client.get("/api/categories")
        assert response.status_code == 200
        assert response.json()[0]["planned"] == 500

    def test_rejects_a_malformed_month(self, client):
        response = client.get("/api/categories", params={"month": "June 2026"})
        assert response.status_code == 422
