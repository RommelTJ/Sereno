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


def insert_fund(name, kind="sinking", monthly_plan=None):
    return execute(
        "INSERT INTO fund (name, kind, monthly_plan) VALUES (?, ?, ?)", name, kind, monthly_plan
    )


def first_of_month(months_back=0):
    today = date.today()
    year, month = today.year, today.month - months_back
    while month < 1:
        year, month = year - 1, month + 12
    return date(year, month, 1).isoformat()


def insert_fund_entry(fund_id, as_of_date, balance, contribution=0, source=None):
    return execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
        " VALUES (?, ?, ?, ?, ?)",
        fund_id,
        as_of_date,
        balance,
        contribution,
        source,
    )


def insert_account(name, kind="cash"):
    return execute(
        "INSERT INTO account (name, kind, tax_treatment) VALUES (?, ?, 'NONE')", name, kind
    )


def fetch_fund_entries(fund_id):
    return query(
        "SELECT as_of_date, balance, contribution, source FROM fund_entry"
        " WHERE fund_id = ? ORDER BY id",
        fund_id,
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

    def test_lists_categories_by_sort_order_before_id(self, client):
        insert_category("Groceries")
        insert_category("Gas")
        insert_category("Travel")
        execute("UPDATE category SET sort_order = 4 - id")
        response = client.get("/api/categories")
        assert [category["name"] for category in response.json()] == [
            "Travel",
            "Gas",
            "Groceries",
        ]


class TestReorderCategories:
    def create(self, client, name):
        return client.post("/api/categories", json={"name": name, "planned": 100}).json()["id"]

    def assert_rejected(self, response):
        assert response.status_code == 422
        assert response.json()["detail"] == "ids must be exactly the active category ids"

    def test_persists_and_echoes_the_new_order(self, client):
        groceries = self.create(client, "Groceries")
        gas = self.create(client, "Gas")
        travel = self.create(client, "Travel")
        response = client.put("/api/categories/order", json={"ids": [travel, groceries, gas]})
        assert response.status_code == 200
        assert [category["name"] for category in response.json()] == [
            "Travel",
            "Groceries",
            "Gas",
        ]
        categories = client.get("/api/categories").json()
        assert [category["name"] for category in categories] == ["Travel", "Groceries", "Gas"]

    def test_ids_must_cover_exactly_the_active_categories(self, client):
        groceries = self.create(client, "Groceries")
        gas = self.create(client, "Gas")
        self.assert_rejected(client.put("/api/categories/order", json={"ids": [groceries]}))
        self.assert_rejected(
            client.put("/api/categories/order", json={"ids": [groceries, gas, 999]})
        )
        self.assert_rejected(
            client.put("/api/categories/order", json={"ids": [groceries, groceries, gas]})
        )

    def test_archived_categories_stay_out_of_the_order(self, client):
        groceries = self.create(client, "Groceries")
        gas = self.create(client, "Gas")
        retired = self.create(client, "Old envelope")
        client.post(f"/api/categories/{retired}/archive")
        self.assert_rejected(
            client.put("/api/categories/order", json={"ids": [gas, groceries, retired]})
        )
        response = client.put("/api/categories/order", json={"ids": [gas, groceries]})
        assert response.status_code == 200
        assert [category["name"] for category in response.json()] == ["Gas", "Groceries"]

    def test_new_category_lists_last_after_a_reorder(self, client):
        groceries = self.create(client, "Groceries")
        gas = self.create(client, "Gas")
        client.put("/api/categories/order", json={"ids": [gas, groceries]})
        self.create(client, "Travel")
        categories = client.get("/api/categories").json()
        assert [category["name"] for category in categories] == ["Gas", "Groceries", "Travel"]


class TestPostCategories:
    def test_creates_a_category_with_its_initial_plan(self, client):
        response = client.post(
            "/api/categories",
            json={"name": "Groceries", "emoji": "🛒", "planned": 500},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["id"] > 0
        assert {k: body[k] for k in body if k != "id"} == {
            "name": "Groceries",
            "emoji": "🛒",
            "is_fixed": False,
            "planned": 500,
        }
        assert query("SELECT name, emoji, is_fixed, active FROM category") == [
            {"name": "Groceries", "emoji": "🛒", "is_fixed": 0, "active": 1}
        ]
        assert query("SELECT category_id, effective_month, planned FROM category_plan") == [
            {
                "category_id": body["id"],
                "effective_month": date.today().strftime("%Y-%m"),
                "planned": 500,
            }
        ]

    def test_the_new_envelope_surfaces_in_categories_and_the_budget_month(self, client):
        month = date.today().strftime("%Y-%m")
        created = client.post(
            "/api/categories", json={"name": "Travel", "emoji": "✈️", "planned": 100}
        ).json()

        categories = client.get("/api/categories", params={"month": month}).json()
        assert categories == [
            {"id": created["id"], "name": "Travel", "emoji": "✈️", "is_fixed": False, "planned": 100}
        ]

        budget = client.get("/api/budget-month", params={"month": month}).json()
        assert budget["categories"] == [
            {
                "id": created["id"],
                "name": "Travel",
                "emoji": "✈️",
                "planned": 100,
                "spent": 0,
                "remaining": 100,
            }
        ]

    def test_effective_month_override(self, client):
        response = client.post(
            "/api/categories",
            json={"name": "Gas", "planned": 120, "effective_month": "2026-09"},
        )
        assert response.status_code == 201
        assert query("SELECT effective_month FROM category_plan") == [
            {"effective_month": "2026-09"}
        ]

    def test_rejects_a_malformed_effective_month(self, client):
        response = client.post(
            "/api/categories",
            json={"name": "Gas", "planned": 120, "effective_month": "September"},
        )
        assert response.status_code == 422

    def test_rejects_a_blank_name(self, client):
        for name in ("", "   "):
            response = client.post("/api/categories", json={"name": name, "planned": 100})
            assert response.status_code == 422
        assert query("SELECT id FROM category") == []

    def test_rejects_a_negative_planned(self, client):
        response = client.post("/api/categories", json={"name": "Gas", "planned": -1})
        assert response.status_code == 422
        assert query("SELECT id FROM category") == []

    def test_allows_a_zero_planned(self, client):
        response = client.post("/api/categories", json={"name": "Gifts", "planned": 0})
        assert response.status_code == 201
        assert response.json()["planned"] == 0

    def test_rejects_a_duplicate_active_name(self, client):
        insert_category("Groceries", emoji="🛒")
        for name in ("Groceries", "groceries", "  Groceries  "):
            response = client.post("/api/categories", json={"name": name, "planned": 500})
            assert response.status_code == 409
        assert len(query("SELECT id FROM category")) == 1

    def test_a_name_matching_an_inactive_category_is_allowed(self, client):
        insert_category("Vices", active=0)
        response = client.post("/api/categories", json={"name": "Vices", "planned": 150})
        assert response.status_code == 201


class TestPostCategoryPlan:
    def test_appends_a_plan_row(self, client):
        groceries_id = insert_category("Groceries")
        insert_plan(groceries_id, "2026-01", 500)
        response = client.post(
            f"/api/categories/{groceries_id}/plan",
            json={"planned": 550, "effective_month": "2026-06"},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["id"] > 0
        assert {k: body[k] for k in body if k != "id"} == {
            "category_id": groceries_id,
            "effective_month": "2026-06",
            "planned": 550,
        }
        assert query("SELECT effective_month, planned FROM category_plan") == [
            {"effective_month": "2026-01", "planned": 500},
            {"effective_month": "2026-06", "planned": 550},
        ]

    def test_the_latest_row_wins_and_earlier_months_keep_history(self, client):
        groceries_id = insert_category("Groceries")
        insert_plan(groceries_id, "2026-01", 500)
        for planned in (525, 550):
            payload = {"planned": planned, "effective_month": "2026-06"}
            response = client.post(f"/api/categories/{groceries_id}/plan", json=payload)
            assert response.status_code == 201

        june = client.get("/api/categories", params={"month": "2026-06"}).json()
        assert june[0]["planned"] == 550

        may = client.get("/api/categories", params={"month": "2026-05"}).json()
        assert may[0]["planned"] == 500

    def test_effective_month_defaults_to_the_current_month(self, client):
        gas_id = insert_category("Gas")
        response = client.post(f"/api/categories/{gas_id}/plan", json={"planned": 120})
        assert response.status_code == 201
        assert response.json()["effective_month"] == date.today().strftime("%Y-%m")

    def test_unknown_category_returns_404(self, client):
        response = client.post("/api/categories/999/plan", json={"planned": 120})
        assert response.status_code == 404

    def test_rejects_a_negative_planned(self, client):
        gas_id = insert_category("Gas")
        response = client.post(f"/api/categories/{gas_id}/plan", json={"planned": -1})
        assert response.status_code == 422
        assert query("SELECT id FROM category_plan") == []


class TestPutCategory:
    def test_renames_the_name_and_emoji(self, client):
        groceries_id = insert_category("Groceries", emoji="🛒")
        insert_plan(groceries_id, "2000-01", 500)
        response = client.put(
            f"/api/categories/{groceries_id}",
            json={"name": "Food", "emoji": "🍽️"},
        )
        assert response.status_code == 200
        assert response.json() == {
            "id": groceries_id,
            "name": "Food",
            "emoji": "🍽️",
            "is_fixed": False,
            "planned": 500,
        }
        assert query("SELECT name, emoji FROM category") == [{"name": "Food", "emoji": "🍽️"}]

    def test_a_null_emoji_clears_it(self, client):
        gas_id = insert_category("Gas", emoji="🛢️")
        response = client.put(f"/api/categories/{gas_id}", json={"name": "Gas", "emoji": None})
        assert response.status_code == 200
        assert response.json()["emoji"] is None
        assert query("SELECT emoji FROM category") == [{"emoji": None}]

    def test_leaves_plan_history_untouched(self, client):
        groceries_id = insert_category("Groceries")
        insert_plan(groceries_id, "2026-01", 500)
        insert_plan(groceries_id, "2026-06", 550)
        response = client.put(f"/api/categories/{groceries_id}", json={"name": "Food"})
        assert response.status_code == 200
        assert query("SELECT category_id, effective_month, planned FROM category_plan") == [
            {"category_id": groceries_id, "effective_month": "2026-01", "planned": 500},
            {"category_id": groceries_id, "effective_month": "2026-06", "planned": 550},
        ]

    def test_unknown_category_returns_404(self, client):
        response = client.put("/api/categories/999", json={"name": "Food"})
        assert response.status_code == 404

    def test_rejects_a_blank_name(self, client):
        gas_id = insert_category("Gas")
        for name in ("", "   "):
            response = client.put(f"/api/categories/{gas_id}", json={"name": name})
            assert response.status_code == 422
        assert query("SELECT name FROM category") == [{"name": "Gas"}]

    def test_rejects_another_active_categorys_name(self, client):
        insert_category("Groceries")
        gas_id = insert_category("Gas")
        for name in ("Groceries", "groceries", "  Groceries  "):
            response = client.put(f"/api/categories/{gas_id}", json={"name": name})
            assert response.status_code == 409
        assert query("SELECT name FROM category ORDER BY id") == [
            {"name": "Groceries"},
            {"name": "Gas"},
        ]

    def test_allows_a_case_only_rename_of_itself(self, client):
        groceries_id = insert_category("groceries")
        response = client.put(f"/api/categories/{groceries_id}", json={"name": "Groceries"})
        assert response.status_code == 200
        assert response.json()["name"] == "Groceries"

    def test_allows_an_archived_categorys_name(self, client):
        insert_category("Vices", active=0)
        gas_id = insert_category("Gas")
        response = client.put(f"/api/categories/{gas_id}", json={"name": "Vices"})
        assert response.status_code == 200


class TestArchiveCategory:
    def test_archives_the_envelope_out_of_the_category_list(self, client):
        groceries_id = insert_category("Groceries", emoji="🛒")
        insert_plan(groceries_id, "2000-01", 500)
        response = client.post(f"/api/categories/{groceries_id}/archive")
        assert response.status_code == 200
        assert response.json() == {
            "id": groceries_id,
            "name": "Groceries",
            "emoji": "🛒",
            "is_fixed": False,
            "planned": 500,
        }
        assert query("SELECT active FROM category") == [{"active": 0}]
        assert client.get("/api/categories").json() == []

    def test_archived_spending_still_counts_in_total_spent(self, client):
        gas_id = insert_category("Gas")
        insert_plan(gas_id, "2026-01", 100)
        payload = {"txn_date": "2026-06-10", "amount": 40, "category_id": gas_id}
        assert client.post("/api/expenses", json=payload).status_code == 201
        assert client.post(f"/api/categories/{gas_id}/archive").status_code == 200
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert body["categories"] == []
        assert body["total_spent"] == 40

    def test_plans_and_expense_lines_survive_in_the_database(self, client):
        gas_id = insert_category("Gas")
        insert_plan(gas_id, "2026-01", 100)
        payload = {"txn_date": "2026-06-10", "amount": 40, "category_id": gas_id}
        assert client.post("/api/expenses", json=payload).status_code == 201
        client.post(f"/api/categories/{gas_id}/archive")
        assert query("SELECT category_id, planned FROM category_plan") == [
            {"category_id": gas_id, "planned": 100}
        ]
        assert query("SELECT category_id, amount FROM expense_line") == [
            {"category_id": gas_id, "amount": 40}
        ]

    def test_archiving_twice_is_idempotent(self, client):
        gas_id = insert_category("Gas")
        for _ in range(2):
            response = client.post(f"/api/categories/{gas_id}/archive")
            assert response.status_code == 200
        assert query("SELECT active FROM category") == [{"active": 0}]

    def test_unknown_category_returns_404(self, client):
        response = client.post("/api/categories/999/archive")
        assert response.status_code == 404

    def test_the_freed_name_can_be_reused(self, client):
        vices_id = insert_category("Vices")
        client.post(f"/api/categories/{vices_id}/archive")
        response = client.post("/api/categories", json={"name": "Vices", "planned": 150})
        assert response.status_code == 201


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
        insert_fund_entry(bike_id, "2026-06-01", 5000)
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

    def test_fund_spending_draws_down_the_fund(self, client):
        # The other half of the double-entry: the expense line records the
        # spend, the appended fund_entry releases the earmark.
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
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
        assert fetch_fund_entries(bike_id) == [
            {"as_of_date": "2026-06-01", "balance": 5000, "contribution": 0, "source": None},
            {
                "as_of_date": "2026-06-05",
                "balance": 3800,
                "contribution": -1200,
                "source": "spend",
            },
        ]

    def test_discretionary_spending_appends_no_fund_entry(self, client):
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        response = client.post("/api/expenses", json={"txn_date": "2026-06-05", "amount": 100})
        assert response.status_code == 201
        assert len(fetch_fund_entries(bike_id)) == 1

    def test_overspending_a_fund_is_rejected(self, client):
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 1000)
        response = client.post(
            "/api/expenses",
            json={
                "txn_date": "2026-06-05",
                "amount": 1200,
                "funded_from": "fund",
                "fund_id": bike_id,
            },
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "expense exceeds fund balance"
        assert query("SELECT id FROM expense_line") == []
        assert len(fetch_fund_entries(bike_id)) == 1

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
                "source_label": "You paycheck",
                "note": "Includes the spot bonus",
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
            "source_label": "You paycheck",
            "note": "Includes the spot bonus",
        }
        rows = query("SELECT budget_month, source, amount, source_label, note FROM income_event")
        assert rows == [
            {
                "budget_month": "2026-06",
                "source": "paycheck",
                "amount": 2800,
                "source_label": "You paycheck",
                "note": "Includes the spot bonus",
            }
        ]

    def test_source_label_defaults_to_null(self, client):
        response = client.post(
            "/api/income",
            json={"txn_date": "2026-06-15", "source": "interest", "amount": 12.34},
        )
        assert response.status_code == 201
        assert response.json()["source_label"] is None

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
            "fund_contributions": 0,
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

    def test_envelopes_follow_the_category_sort_order(self, client):
        insert_category("Groceries")
        insert_category("Travel")
        execute("UPDATE category SET sort_order = 3 - id")
        response = client.get("/api/budget-month", params={"month": "2026-06"})
        names = [envelope["name"] for envelope in response.json()["categories"]]
        assert names == ["Travel", "Groceries"]

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

    def test_fund_funded_spending_stays_out_of_the_envelopes(self, client):
        # Same reasoning as the headline: parked money never drew on the
        # month's envelope, so the category bar must not move either.
        travel_id = insert_category("Travel", emoji="✈️")
        insert_plan(travel_id, "2026-01", 500)
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        self.fund_month(client, 5200)
        self.spend(client, 100, category_id=travel_id)
        self.spend(client, 1200, category_id=travel_id, funded_from="fund", fund_id=bike_id)
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert body["categories"][0]["spent"] == 100
        assert body["categories"][0]["remaining"] == 400

    def test_fund_funded_spending_leaves_the_headline_alone(self, client):
        # Paid from parked money, not the month's income: the expense is
        # recorded, but safe-to-spend must not drop a second time.
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        self.fund_month(client, 5200)
        self.spend(client, 100)
        self.spend(client, 1200, funded_from="fund", fund_id=bike_id)
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert body["total_spent"] == 100
        assert body["safe_to_spend"] == 5100

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

    def test_activity_items_carry_the_income_source_label(self, client):
        # Income rows carry their title separately from a true note; the
        # other two activity types have no title column, so theirs is null.
        fund_id = insert_fund("Emergency fund")
        insert_fund_entry(fund_id, "2026-06-01", 500, contribution=500, source="monthly_plan")
        payload = {
            "txn_date": "2026-05-24",
            "budget_month": "2026-06",
            "source": "paycheck",
            "amount": 2800,
            "source_label": "You paycheck",
            "note": "Includes the spot bonus",
        }
        assert client.post("/api/income", json=payload).status_code == 201
        self.spend(client, 96, txn_date="2026-06-20")
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert [(item["type"], item["source_label"]) for item in body["activity"]] == [
            ("expense", None),
            ("fund", None),
            ("income", "You paycheck"),
        ]
        assert body["activity"][2]["note"] == "Includes the spot bonus"

    def test_monthly_plan_and_top_up_entries_appear_as_fund_activity(self, client):
        # The feed lists exactly the sources the fund_contributions headline
        # subtracts: 'spend' rows would double-count their expense line, and
        # hand-entered (NULL-source) rows are balance restatements that never
        # touched safe-to-spend.
        fund_id = insert_fund("Emergency fund")
        insert_fund_entry(fund_id, "2026-06-01", 10500, contribution=500, source="monthly_plan")
        insert_fund_entry(fund_id, "2026-06-15", 10700, contribution=200, source="top_up")
        insert_fund_entry(fund_id, "2026-06-20", 10400, contribution=-300, source="spend")
        insert_fund_entry(fund_id, "2026-06-25", 11000)
        self.fund_month(client, 5200)
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert [(item["type"], item["txn_date"], item["amount"]) for item in body["activity"]] == [
            ("fund", "2026-06-15", 200),
            ("fund", "2026-06-01", 500),
            ("income", "2026-05-24", 5200),
        ]
        top_up = body["activity"][0]
        assert top_up["category"] == "Emergency fund"
        assert top_up["source"] == "top_up"
        assert top_up["note"] is None

    def test_activity_interleaves_all_three_types_newest_first(self, client):
        fund_id = insert_fund("Bike fund")
        self.fund_month(client, 2800, txn_date="2026-06-05")
        insert_fund_entry(fund_id, "2026-06-12", 500, contribution=500, source="monthly_plan")
        self.spend(client, 96, txn_date="2026-06-20")
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert [(item["type"], item["txn_date"]) for item in body["activity"]] == [
            ("expense", "2026-06-20"),
            ("fund", "2026-06-12"),
            ("income", "2026-06-05"),
        ]

    def test_fund_activity_is_scoped_to_the_calendar_month(self, client):
        # fund_entry has no budget_month column; the feed scopes it by
        # calendar month, exactly like the fund_contributions headline.
        fund_id = insert_fund("Emergency fund")
        insert_fund_entry(fund_id, "2026-05-01", 500, contribution=500, source="monthly_plan")
        insert_fund_entry(fund_id, "2026-06-01", 1000, contribution=500, source="monthly_plan")
        june = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert [(i["type"], i["txn_date"]) for i in june["activity"]] == [("fund", "2026-06-01")]
        may = client.get("/api/budget-month", params={"month": "2026-05"}).json()
        assert [(i["type"], i["txn_date"]) for i in may["activity"]] == [("fund", "2026-05-01")]

    def test_a_fund_funded_expense_appears_exactly_once(self, client):
        # The drawdown behind a fund-funded expense is a 'spend' fund_entry
        # with a negative contribution; listing it beside its expense line
        # would show every fund-funded purchase twice.
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        self.fund_month(client, 5200)
        self.spend(client, 1200, txn_date="2026-06-15", funded_from="fund", fund_id=bike_id)
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert [(item["type"], item["amount"]) for item in body["activity"]] == [
            ("expense", 1200),
            ("income", 5200),
        ]

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

    def test_due_contributions_count_against_the_headline(self, client):
        # Money moved into a fund on the 1st is parked, not spendable: the
        # budget month applies the catch-up itself and subtracts the month's
        # automatic contributions from safe-to-spend.
        fund_id = insert_fund("Emergency fund", monthly_plan=500)
        insert_fund_entry(fund_id, first_of_month(1), 10000)
        payload = {"txn_date": date.today().isoformat(), "source": "paycheck", "amount": 5000}
        assert client.post("/api/income", json=payload).status_code == 201
        body = client.get("/api/budget-month").json()
        assert body["fund_contributions"] == 500
        assert body["safe_to_spend"] == 4500
        assert len(fetch_fund_entries(fund_id)) == 2

    def test_a_month_with_nothing_due_reports_zero_contributions(self, client):
        self.fund_month(client, 5200)
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert body["fund_contributions"] == 0
        assert body["safe_to_spend"] == 5200

    def test_manual_contributions_do_not_count(self, client):
        # Hand-entered fund entries never touched the budget math before
        # and still don't — only the automatic monthly plan is subtracted.
        fund_id = insert_fund("Pool fund")
        insert_fund_entry(fund_id, first_of_month(), 5000, contribution=1000)
        payload = {"txn_date": date.today().isoformat(), "source": "paycheck", "amount": 5000}
        assert client.post("/api/income", json=payload).status_code == 201
        body = client.get("/api/budget-month").json()
        assert body["fund_contributions"] == 0
        assert body["safe_to_spend"] == 5000

    def test_contributions_count_in_their_own_month(self, client):
        # Two months of catch-up land one contribution per month: last
        # month's 1st funds last month, not the month being read.
        fund_id = insert_fund("Emergency fund", monthly_plan=100)
        insert_fund_entry(fund_id, first_of_month(2), 1000)
        client.get("/api/budget-month")
        last_month = first_of_month(1)[:7]
        body = client.get("/api/budget-month", params={"month": last_month}).json()
        assert body["fund_contributions"] == 100

    def test_top_ups_count_against_the_headline(self, client):
        # A one-time top-up parks money exactly like a monthly-plan
        # contribution: the delta joins fund_contributions and stops being
        # spendable the moment it lands.
        fund_id = insert_fund("Pool fund")
        insert_fund_entry(fund_id, first_of_month(), 5000)
        payload = {"txn_date": date.today().isoformat(), "source": "paycheck", "amount": 5000}
        assert client.post("/api/income", json=payload).status_code == 201
        top_up = client.post(f"/api/funds/{fund_id}/top-up", json={"amount": 250})
        assert top_up.status_code == 201
        body = client.get("/api/budget-month").json()
        assert body["fund_contributions"] == 250
        assert body["safe_to_spend"] == 4750

    def test_a_release_raises_the_headline(self, client):
        # The inverse move: releasing part of an over-saved fund makes the
        # money spendable again — the negative contribution lifts
        # safe-to-spend above the baseline.
        fund_id = insert_fund("Pool fund")
        insert_fund_entry(fund_id, first_of_month(), 5000)
        payload = {"txn_date": date.today().isoformat(), "source": "paycheck", "amount": 5000}
        assert client.post("/api/income", json=payload).status_code == 201
        release = client.post(f"/api/funds/{fund_id}/top-up", json={"amount": -400})
        assert release.status_code == 201
        body = client.get("/api/budget-month").json()
        assert body["fund_contributions"] == -400
        assert body["safe_to_spend"] == 5400

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
