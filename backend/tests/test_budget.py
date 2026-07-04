from datetime import date

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


class TestPostIncome:
    def test_appends_an_income_event(self, client):
        account_id = insert_account("Chase checking")
        response = client.post(
            "/api/income",
            json={
                "txn_date": "2026-05-24",
                "budget_month": "2026-06",
                "source": "paycheck",
                "amount": 2800,
                "tax_treatment": "ORDINARY",
                "account_id": account_id,
                "note": "You paycheck",
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["id"] > 0
        assert body["created_at"]
        assert {k: body[k] for k in body if k not in ("id", "created_at")} == {
            "txn_date": "2026-05-24",
            "budget_month": "2026-06",
            "source": "paycheck",
            "amount": 2800,
            "tax_treatment": "ORDINARY",
            "account_id": account_id,
            "note": "You paycheck",
        }
        rows = query("SELECT budget_month, source, amount FROM income_event")
        assert rows == [{"budget_month": "2026-06", "source": "paycheck", "amount": 2800}]

    def test_budget_month_defaults_to_the_txn_month(self, client):
        response = client.post(
            "/api/income",
            json={"txn_date": "2026-06-15", "source": "interest", "amount": 12.34},
        )
        assert response.status_code == 201
        assert response.json()["budget_month"] == "2026-06"

    def test_rejects_an_unknown_source(self, client):
        response = client.post(
            "/api/income",
            json={"txn_date": "2026-06-15", "source": "lottery", "amount": 100},
        )
        assert response.status_code == 422

    def test_rejects_a_non_positive_amount(self, client):
        response = client.post(
            "/api/income",
            json={"txn_date": "2026-06-15", "source": "paycheck", "amount": 0},
        )
        assert response.status_code == 422

    def test_unknown_account_returns_404(self, client):
        response = client.post(
            "/api/income",
            json={"txn_date": "2026-06-15", "source": "paycheck", "amount": 100, "account_id": 9},
        )
        assert response.status_code == 404


class TestGetBudgetMonth:
    def spend(self, client, amount, txn_date="2026-06-10", **extra):
        payload = {"txn_date": txn_date, "budget_month": "2026-06", "amount": amount, **extra}
        assert client.post("/api/expenses", json=payload).status_code == 201

    def fund_month(self, client, amount, txn_date="2026-05-24", note=None):
        payload = {
            "txn_date": txn_date,
            "budget_month": "2026-06",
            "source": "paycheck",
            "amount": amount,
            "note": note,
        }
        assert client.post("/api/income", json=payload).status_code == 201

    def test_an_empty_month_returns_zeros(self, client):
        response = client.get("/api/budget-month", params={"month": "2026-06"})
        assert response.status_code == 200
        assert response.json() == {
            "month": "2026-06",
            "baseline": 0,
            "total_spent": 0,
            "safe_to_spend": 0,
            "categories": [],
            "activity": [],
        }

    def test_envelope_math_per_category(self, client):
        groceries_id = insert_category("Groceries", emoji="🛒")
        travel_id = insert_category("Travel", emoji="✈️")
        insert_plan(groceries_id, "2026-01", 500)
        insert_plan(travel_id, "2026-01", 100)
        self.fund_month(client, 5200)
        self.spend(client, 387, category_id=groceries_id)
        response = client.get("/api/budget-month", params={"month": "2026-06"})
        body = response.json()
        assert body["categories"] == [
            {
                "id": groceries_id,
                "name": "Groceries",
                "emoji": "🛒",
                "planned": 500,
                "spent": 387,
                "remaining": 113,
            },
            {
                "id": travel_id,
                "name": "Travel",
                "emoji": "✈️",
                "planned": 100,
                "spent": 0,
                "remaining": 100,
            },
        ]
        assert body["baseline"] == 5200
        assert body["total_spent"] == 387
        assert body["safe_to_spend"] == 4813

    def test_over_budget_is_allowed_and_goes_negative(self, client):
        gas_id = insert_category("Gas")
        insert_plan(gas_id, "2026-01", 100)
        self.fund_month(client, 5200)
        self.spend(client, 150, category_id=gas_id)
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert body["categories"][0]["remaining"] == -50
        assert body["safe_to_spend"] == 5050

    def test_the_baseline_is_stored_not_recomputed_from_live_spend(self, client):
        # The handoff warns the baseline is a constant seeded by funding
        # events; deriving it from live spend would cancel to a constant.
        self.fund_month(client, 5200)
        self.spend(client, 1000)
        before = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert before["baseline"] == 5200
        assert before["safe_to_spend"] == 4200

        self.spend(client, 500)
        after = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert after["baseline"] == 5200
        assert after["safe_to_spend"] == 3700

    def test_uncategorized_spending_hits_the_headline_but_no_envelope(self, client):
        groceries_id = insert_category("Groceries")
        insert_plan(groceries_id, "2026-01", 500)
        self.fund_month(client, 5200)
        self.spend(client, 118.21, is_fixed=True, note="Electric — PG&E")
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert body["categories"][0]["spent"] == 0
        assert body["total_spent"] == 118.21
        assert body["safe_to_spend"] == 5200 - 118.21

    def test_activity_merges_spending_and_funding_newest_first(self, client):
        groceries_id = insert_category("Groceries")
        self.fund_month(client, 2800, txn_date="2026-05-24", note="You paycheck")
        self.spend(client, 132.18, txn_date="2026-06-10", category_id=groceries_id, note="Costco")
        self.spend(client, 96, txn_date="2026-06-20")
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert [(item["type"], item["txn_date"], item["amount"]) for item in body["activity"]] == [
            ("expense", "2026-06-20", 96),
            ("expense", "2026-06-10", 132.18),
            ("income", "2026-05-24", 2800),
        ]
        assert body["activity"][1]["category"] == "Groceries"
        assert body["activity"][1]["note"] == "Costco"
        assert body["activity"][2]["source"] == "paycheck"
        assert body["activity"][2]["category"] is None

    def test_everything_is_scoped_to_the_requested_month(self, client):
        self.fund_month(client, 5200)
        self.spend(client, 100)
        july = {"txn_date": "2026-07-02", "budget_month": "2026-07", "amount": 40}
        assert client.post("/api/expenses", json=july).status_code == 201
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert body["total_spent"] == 100
        assert len(body["activity"]) == 2

    def test_a_funded_month_with_no_spending_keeps_its_baseline(self, client):
        # v_budget_month groups over expense_line, so a month that is funded
        # ahead (the seed's Jun 27 paycheck funding July) has no view row yet;
        # the baseline must still be the stored funding, not zero.
        self.fund_month(client, 2400, txn_date="2026-05-27")
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert body["baseline"] == 2400
        assert body["total_spent"] == 0
        assert body["safe_to_spend"] == 2400
        assert [item["type"] for item in body["activity"]] == ["income"]

    def test_month_defaults_to_the_current_month(self, client):
        today = date.today()
        payload = {"txn_date": today.isoformat(), "amount": 75}
        assert client.post("/api/expenses", json=payload).status_code == 201
        body = client.get("/api/budget-month").json()
        assert body["month"] == today.strftime("%Y-%m")
        assert body["total_spent"] == 75

    def test_rejects_a_malformed_month(self, client):
        response = client.get("/api/budget-month", params={"month": "2026-6"})
        assert response.status_code == 422
