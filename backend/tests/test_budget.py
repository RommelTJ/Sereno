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


def insert_fund(name, kind="sinking"):
    return execute("INSERT INTO fund (name, kind) VALUES (?, ?)", name, kind)


def insert_account(name, kind="cash"):
    return execute(
        "INSERT INTO account (name, kind, tax_treatment) VALUES (?, ?, 'NONE')", name, kind
    )


def query(sql, *params):
    conn = connect()
    try:
        return [dict(row) for row in conn.execute(sql, params)]
    finally:
        conn.close()


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


class TestPostExpenses:
    def test_appends_an_expense_line(self, client):
        groceries_id = insert_category("Groceries")
        account_id = insert_account("Chase checking")
        response = client.post(
            "/api/expenses",
            json={
                "txn_date": "2026-06-10",
                "category_id": groceries_id,
                "amount": 254.82,
                "account_id": account_id,
                "note": "Weekly shop",
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["id"] > 0
        assert body["created_at"]
        assert {k: body[k] for k in body if k not in ("id", "created_at")} == {
            "txn_date": "2026-06-10",
            "budget_month": "2026-06",
            "category_id": groceries_id,
            "amount": 254.82,
            "is_fixed": False,
            "funded_from": "discretionary",
            "fund_id": None,
            "account_id": account_id,
            "note": "Weekly shop",
        }
        rows = query("SELECT budget_month, amount FROM expense_line")
        assert rows == [{"budget_month": "2026-06", "amount": 254.82}]

    def test_prepay_charges_a_later_budget_month(self, client):
        response = client.post(
            "/api/expenses",
            json={"txn_date": "2026-06-28", "budget_month": "2026-07", "amount": 100},
        )
        assert response.status_code == 201
        assert response.json()["budget_month"] == "2026-07"

    def test_fund_spending_records_the_fund(self, client):
        bike_id = insert_fund("Bike fund")
        response = client.post(
            "/api/expenses",
            json={
                "txn_date": "2026-06-05",
                "amount": 1200,
                "funded_from": "fund",
                "fund_id": bike_id,
            },
        )
        assert response.status_code == 201
        assert response.json()["funded_from"] == "fund"
        assert response.json()["fund_id"] == bike_id

    def test_fund_spending_requires_a_fund_id(self, client):
        response = client.post(
            "/api/expenses",
            json={"txn_date": "2026-06-05", "amount": 1200, "funded_from": "fund"},
        )
        assert response.status_code == 422

    def test_a_fund_id_requires_fund_spending(self, client):
        bike_id = insert_fund("Bike fund")
        response = client.post(
            "/api/expenses",
            json={"txn_date": "2026-06-05", "amount": 1200, "fund_id": bike_id},
        )
        assert response.status_code == 422

    def test_unknown_category_returns_404(self, client):
        response = client.post(
            "/api/expenses",
            json={"txn_date": "2026-06-10", "category_id": 999, "amount": 50},
        )
        assert response.status_code == 404

    def test_unknown_fund_returns_404(self, client):
        response = client.post(
            "/api/expenses",
            json={"txn_date": "2026-06-05", "amount": 1200, "funded_from": "fund", "fund_id": 999},
        )
        assert response.status_code == 404

    def test_unknown_account_returns_404(self, client):
        response = client.post(
            "/api/expenses",
            json={"txn_date": "2026-06-10", "amount": 50, "account_id": 999},
        )
        assert response.status_code == 404

    def test_rejects_a_non_positive_amount(self, client):
        for amount in (0, -25):
            response = client.post(
                "/api/expenses", json={"txn_date": "2026-06-10", "amount": amount}
            )
            assert response.status_code == 422

    def test_rejects_an_unknown_funded_from(self, client):
        response = client.post(
            "/api/expenses",
            json={"txn_date": "2026-06-10", "amount": 50, "funded_from": "mattress"},
        )
        assert response.status_code == 422
