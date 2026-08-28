from datetime import date

import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import connect
from sereno.main import app
from sereno.money import to_cents, to_dollars


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
    # Dollars in, cents stored — the same boundary the API keeps, so test
    # bodies stay in the dollars the JSON contract speaks.
    return execute(
        "INSERT INTO category_plan (category_id, effective_month, planned) VALUES (?, ?, ?)",
        category_id,
        effective_month,
        to_cents(planned),
    )


def insert_fund(name, kind="sinking", monthly_plan=None):
    return execute(
        "INSERT INTO fund (name, kind, monthly_plan) VALUES (?, ?, ?)",
        name,
        kind,
        to_cents(monthly_plan),
    )


def first_of_month(months_back=0):
    today = date.today()
    year, month = today.year, today.month - months_back
    while month < 1:
        year, month = year - 1, month + 12
    while month > 12:
        year, month = year + 1, month - 12
    return date(year, month, 1).isoformat()


def insert_fund_entry(fund_id, as_of_date, balance, contribution=0, source=None):
    return execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
        " VALUES (?, ?, ?, ?, ?)",
        fund_id,
        as_of_date,
        to_cents(balance),
        to_cents(contribution),
        source,
    )


def insert_account(name, kind="cash"):
    return execute(
        "INSERT INTO account (name, kind, tax_treatment) VALUES (?, ?, 'NONE')", name, kind
    )


def fetch_fund_entries(fund_id):
    return [
        row
        | {"balance": to_dollars(row["balance"]), "contribution": to_dollars(row["contribution"])}
        for row in query(
            "SELECT as_of_date, balance, contribution, source FROM fund_entry"
            " WHERE fund_id = ? ORDER BY id",
            fund_id,
        )
    ]


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
        # Raw storage holds integer cents; dollars exist only in the JSON.
        assert query("SELECT category_id, effective_month, planned FROM category_plan") == [
            {
                "category_id": body["id"],
                "effective_month": date.today().strftime("%Y-%m"),
                "planned": 50000,
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
            {"effective_month": "2026-01", "planned": 50000},
            {"effective_month": "2026-06", "planned": 55000},
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
            {"category_id": groceries_id, "effective_month": "2026-01", "planned": 50000},
            {"category_id": groceries_id, "effective_month": "2026-06", "planned": 55000},
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
            {"category_id": gas_id, "planned": 10000}
        ]
        assert query("SELECT category_id, amount FROM expense_line") == [
            {"category_id": gas_id, "amount": 4000}
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
            "pending": False,
        }
        rows = query("SELECT budget_month, amount FROM expense_line")
        assert rows == [{"budget_month": "2026-06", "amount": 25482}]

    def test_prepay_charges_a_later_budget_month(self, client):
        response = client.post(
            "/api/expenses",
            json={"txn_date": "2026-06-28", "budget_month": "2026-07", "amount": 100},
        )
        assert response.status_code == 201
        assert response.json()["budget_month"] == "2026-07"

    def test_pending_defaults_to_false(self, client):
        response = client.post("/api/expenses", json={"txn_date": "2026-06-10", "amount": 96})
        assert response.status_code == 201
        assert response.json()["pending"] is False

    def test_a_pending_expense_still_counts_in_safe_to_spend(self, client):
        # The money has already left and the known amount is a floor — the
        # flag is a reminder to true up, never an exclusion.
        response = client.post(
            "/api/expenses",
            json={"txn_date": "2026-06-10", "amount": 96, "pending": True},
        )
        assert response.status_code == 201
        assert response.json()["pending"] is True
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert body["total_spent"] == 96
        assert body["safe_to_spend"] == -96

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

    def test_spending_the_displayed_balance_survives_cent_amounts(self, client):
        # Issue #112: the chained cent amounts drifted in float storage
        # (99.32999999999997 under a displayed $99.33), so spending the
        # figure the UI shows was a false 422. Integer cents make the
        # overdraw guard compare exactly what the UI displays.
        bike_id = insert_fund("Bike fund")
        for amount in (14.82, 68.57, 90.89):
            assert (
                client.post(f"/api/funds/{bike_id}/top-up", json={"amount": amount}).status_code
                == 201
            )
        spend = client.post(
            "/api/expenses",
            json={
                "txn_date": date.today().isoformat(),
                "amount": 74.95,
                "funded_from": "fund",
                "fund_id": bike_id,
            },
        )
        assert spend.status_code == 201
        response = client.post(
            "/api/expenses",
            json={
                "txn_date": date.today().isoformat(),
                "amount": 99.33,
                "funded_from": "fund",
                "fund_id": bike_id,
            },
        )
        assert response.status_code == 201
        assert fetch_fund_entries(bike_id)[-1]["balance"] == 0

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


class TestUpdateExpense:
    def insert_expense(self, client, **overrides):
        payload = {"txn_date": "2026-06-10", "amount": 96} | overrides
        response = client.post("/api/expenses", json=payload)
        assert response.status_code == 201
        return response.json()["id"]

    def test_revises_every_column_in_place(self, client):
        groceries_id = insert_category("Groceries")
        account_id = insert_account("Chase checking")
        expense_id = self.insert_expense(client, note="Lyft — provisional")
        payload = {
            "txn_date": "2026-06-12",
            "budget_month": "2026-07",
            "category_id": groceries_id,
            "amount": 118.4,
            "is_fixed": True,
            "account_id": account_id,
            "note": "Lyft — day's rides consolidated",
        }
        response = client.put(f"/api/expenses/{expense_id}", json=payload)
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == expense_id
        assert body["txn_date"] == "2026-06-12"
        assert body["budget_month"] == "2026-07"
        assert body["category_id"] == groceries_id
        assert body["amount"] == 118.4
        assert body["is_fixed"] is True
        assert body["account_id"] == account_id
        assert body["note"] == "Lyft — day's rides consolidated"
        rows = query("SELECT budget_month, amount FROM expense_line")
        assert rows == [{"budget_month": "2026-07", "amount": 11840}]

    def test_budget_month_defaults_to_the_txn_month(self, client):
        expense_id = self.insert_expense(client, budget_month="2026-07")
        payload = {"txn_date": "2026-06-10", "amount": 96}
        response = client.put(f"/api/expenses/{expense_id}", json=payload)
        assert response.status_code == 200
        assert response.json()["budget_month"] == "2026-06"

    def test_the_edit_can_set_pending(self, client):
        expense_id = self.insert_expense(client)
        payload = {"txn_date": "2026-06-10", "amount": 96, "pending": True}
        response = client.put(f"/api/expenses/{expense_id}", json=payload)
        assert response.status_code == 200
        assert response.json()["pending"] is True

    def test_an_omitted_pending_clears_the_flag(self, client):
        # The edit is a full replace: settling a pending charge means
        # saving the trued-up amount without the flag, and the ⚠️ drops.
        expense_id = self.insert_expense(client, pending=True)
        payload = {"txn_date": "2026-06-10", "amount": 118.4}
        response = client.put(f"/api/expenses/{expense_id}", json=payload)
        assert response.status_code == 200
        assert response.json()["pending"] is False

    def test_a_reassigned_month_moves_the_item_between_feeds(self, client):
        expense_id = self.insert_expense(client)
        payload = {"txn_date": "2026-06-10", "budget_month": "2026-07", "amount": 96}
        assert client.put(f"/api/expenses/{expense_id}", json=payload).status_code == 200
        june = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert june["activity"] == []
        july = client.get("/api/budget-month", params={"month": "2026-07"}).json()
        assert [item["id"] for item in july["activity"]] == [expense_id]

    def test_a_same_fund_amount_increase_appends_a_delta_entry(self, client):
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        expense_id = self.insert_expense(client, amount=1200, funded_from="fund", fund_id=bike_id)
        payload = {
            "txn_date": "2026-06-10",
            "amount": 1500,
            "funded_from": "fund",
            "fund_id": bike_id,
        }
        assert client.put(f"/api/expenses/{expense_id}", json=payload).status_code == 200
        entries = fetch_fund_entries(bike_id)
        assert [entry["balance"] for entry in entries] == [5000, 3800, 3500]
        delta = entries[-1]
        assert delta["contribution"] == -300
        assert delta["source"] == "spend"
        assert delta["as_of_date"] == date.today().isoformat()

    def test_a_same_fund_amount_decrease_releases_the_difference(self, client):
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        expense_id = self.insert_expense(client, amount=1200, funded_from="fund", fund_id=bike_id)
        payload = {
            "txn_date": "2026-06-10",
            "amount": 1000,
            "funded_from": "fund",
            "fund_id": bike_id,
        }
        assert client.put(f"/api/expenses/{expense_id}", json=payload).status_code == 200
        entries = fetch_fund_entries(bike_id)
        assert [entry["balance"] for entry in entries] == [5000, 3800, 4000]
        assert entries[-1]["contribution"] == 200

    def test_an_unchanged_amount_appends_no_fund_entry(self, client):
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        expense_id = self.insert_expense(client, amount=1200, funded_from="fund", fund_id=bike_id)
        payload = {
            "txn_date": "2026-06-10",
            "amount": 1200,
            "funded_from": "fund",
            "fund_id": bike_id,
            "note": "True-up note only",
        }
        assert client.put(f"/api/expenses/{expense_id}", json=payload).status_code == 200
        assert [entry["balance"] for entry in fetch_fund_entries(bike_id)] == [5000, 3800]
        assert query("SELECT note FROM expense_line") == [{"note": "True-up note only"}]

    def test_an_increase_beyond_the_fund_balance_is_rejected(self, client):
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        expense_id = self.insert_expense(client, amount=1200, funded_from="fund", fund_id=bike_id)
        payload = {
            "txn_date": "2026-06-10",
            "amount": 5100,
            "funded_from": "fund",
            "fund_id": bike_id,
        }
        assert client.put(f"/api/expenses/{expense_id}", json=payload).status_code == 422
        assert [entry["balance"] for entry in fetch_fund_entries(bike_id)] == [5000, 3800]
        assert query("SELECT amount FROM expense_line") == [{"amount": 120000}]

    def test_a_fund_to_discretionary_edit_reverses_the_draw_down(self, client):
        travel_id = insert_category("Travel")
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        expense_id = self.insert_expense(client, amount=1200, funded_from="fund", fund_id=bike_id)
        payload = {
            "txn_date": "2026-06-10",
            "amount": 1200,
            "funded_from": "discretionary",
            "category_id": travel_id,
        }
        assert client.put(f"/api/expenses/{expense_id}", json=payload).status_code == 200
        entries = fetch_fund_entries(bike_id)
        assert [entry["balance"] for entry in entries] == [5000, 3800, 5000]
        assert entries[-1]["contribution"] == 1200
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert body["total_spent"] == 1200

    def test_a_discretionary_to_fund_edit_draws_the_fund_down(self, client):
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        expense_id = self.insert_expense(client, amount=96)
        payload = {
            "txn_date": "2026-06-10",
            "amount": 96,
            "funded_from": "fund",
            "fund_id": bike_id,
        }
        assert client.put(f"/api/expenses/{expense_id}", json=payload).status_code == 200
        entries = fetch_fund_entries(bike_id)
        assert [entry["balance"] for entry in entries] == [5000, 4904]
        assert entries[-1]["contribution"] == -96
        assert entries[-1]["source"] == "spend"
        assert entries[-1]["as_of_date"] == date.today().isoformat()

    def test_a_discretionary_to_fund_edit_respects_the_overdraw_guard(self, client):
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 50)
        expense_id = self.insert_expense(client, amount=96)
        payload = {
            "txn_date": "2026-06-10",
            "amount": 96,
            "funded_from": "fund",
            "fund_id": bike_id,
        }
        assert client.put(f"/api/expenses/{expense_id}", json=payload).status_code == 422
        assert [entry["balance"] for entry in fetch_fund_entries(bike_id)] == [50]
        assert query("SELECT funded_from FROM expense_line") == [{"funded_from": "discretionary"}]

    def test_a_fund_to_fund_edit_moves_the_draw_down(self, client):
        bike_id = insert_fund("Bike fund")
        car_id = insert_fund("Car fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        insert_fund_entry(car_id, "2026-06-01", 2000)
        expense_id = self.insert_expense(client, amount=1200, funded_from="fund", fund_id=bike_id)
        payload = {
            "txn_date": "2026-06-10",
            "amount": 1200,
            "funded_from": "fund",
            "fund_id": car_id,
        }
        assert client.put(f"/api/expenses/{expense_id}", json=payload).status_code == 200
        assert [entry["balance"] for entry in fetch_fund_entries(bike_id)] == [5000, 3800, 5000]
        assert [entry["balance"] for entry in fetch_fund_entries(car_id)] == [2000, 800]

    def test_fund_spending_requires_a_fund_id(self, client):
        expense_id = self.insert_expense(client)
        payload = {"txn_date": "2026-06-10", "amount": 96, "funded_from": "fund"}
        assert client.put(f"/api/expenses/{expense_id}", json=payload).status_code == 422

    def test_unknown_expense_returns_404(self, client):
        payload = {"txn_date": "2026-06-10", "amount": 96}
        assert client.put("/api/expenses/99", json=payload).status_code == 404

    def test_unknown_category_returns_404(self, client):
        expense_id = self.insert_expense(client)
        payload = {"txn_date": "2026-06-10", "amount": 96, "category_id": 99}
        assert client.put(f"/api/expenses/{expense_id}", json=payload).status_code == 404


class TestDeleteExpense:
    def insert_expense(self, client, **overrides):
        payload = {"txn_date": "2026-06-10", "amount": 96} | overrides
        response = client.post("/api/expenses", json=payload)
        assert response.status_code == 201
        return response.json()["id"]

    def fund_month(self, client, amount):
        payload = {
            "txn_date": "2026-06-05",
            "budget_month": "2026-06",
            "source": "paycheck",
            "amount": amount,
        }
        assert client.post("/api/income", json=payload).status_code == 201

    def test_deletes_the_row(self, client):
        expense_id = self.insert_expense(client)
        assert client.delete(f"/api/expenses/{expense_id}").status_code == 204
        assert query("SELECT id FROM expense_line") == []

    def test_a_discretionary_delete_appends_no_fund_entry(self, client):
        expense_id = self.insert_expense(client)
        assert client.delete(f"/api/expenses/{expense_id}").status_code == 204
        assert query("SELECT id FROM fund_entry") == []

    def test_deleting_a_discretionary_expense_raises_the_headline(self, client):
        self.fund_month(client, 5200)
        expense_id = self.insert_expense(client, amount=100)
        before = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert before["safe_to_spend"] == 5100
        assert client.delete(f"/api/expenses/{expense_id}").status_code == 204
        after = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert after["safe_to_spend"] == 5200

    def test_a_fund_funded_delete_reverses_the_draw_down(self, client):
        # The paired 'spend' entry is never removed — each fund entry
        # snapshots the balance, so pulling a mid-chain row would not
        # restore it. A compensating entry is appended instead, dated
        # today: snapshots resolve newest-first, so a backdated correction
        # carrying a current balance would corrupt the chain.
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        expense_id = self.insert_expense(client, amount=1200, funded_from="fund", fund_id=bike_id)
        assert client.delete(f"/api/expenses/{expense_id}").status_code == 204
        entries = fetch_fund_entries(bike_id)
        assert [entry["balance"] for entry in entries] == [5000, 3800, 5000]
        reversal = entries[-1]
        assert reversal["contribution"] == 1200
        assert reversal["source"] == "spend"
        assert reversal["as_of_date"] == date.today().isoformat()

    def test_the_reversal_stays_out_of_the_headline_and_feed(self, client):
        # 'spend'-source entries never counted against safe-to-spend, so
        # the delete must not move the headline or land in the feed.
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        self.fund_month(client, 5200)
        expense_id = self.insert_expense(client, amount=1200, funded_from="fund", fund_id=bike_id)
        assert client.delete(f"/api/expenses/{expense_id}").status_code == 204
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert body["safe_to_spend"] == 5200
        assert [item["type"] for item in body["activity"]] == ["income"]

    def test_unknown_expense_returns_404(self, client):
        assert client.delete("/api/expenses/99").status_code == 404


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
            "pending": False,
            "drawn_from_fund_id": None,
        }
        rows = query("SELECT budget_month, source, amount, source_label, note FROM income_event")
        assert rows == [
            {
                "budget_month": "2026-06",
                "source": "paycheck",
                "amount": 280000,
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

    def test_pending_defaults_to_false(self, client):
        response = client.post(
            "/api/income",
            json={"txn_date": "2026-06-15", "source": "interest", "amount": 12.34},
        )
        assert response.status_code == 201
        assert response.json()["pending"] is False

    def test_marks_an_income_event_pending(self, client):
        response = client.post(
            "/api/income",
            json={"txn_date": "2026-06-15", "source": "staking", "amount": 120, "pending": True},
        )
        assert response.status_code == 201
        assert response.json()["pending"] is True

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

    def test_a_draw_from_fund_appends_the_paired_spend_entry(self, client):
        # The mirror of a fund-funded expense: the income row funds the
        # month, the appended 'spend' entry releases the earmark — one
        # action instead of an income row plus a hand-entered correction.
        fund_id = insert_fund("Year-2 cash")
        insert_fund_entry(fund_id, "2026-05-01", 60000)
        response = client.post(
            "/api/income",
            json={
                "txn_date": "2026-05-28",
                "budget_month": "2026-06",
                "source": "transfer_in",
                "amount": 5200,
                "drawn_from_fund_id": fund_id,
            },
        )
        assert response.status_code == 201
        assert response.json()["drawn_from_fund_id"] == fund_id
        rows = query("SELECT drawn_from_fund_id FROM income_event")
        assert rows == [{"drawn_from_fund_id": fund_id}]
        assert fetch_fund_entries(fund_id) == [
            {"as_of_date": "2026-05-01", "balance": 60000, "contribution": 0, "source": None},
            {
                "as_of_date": "2026-05-28",
                "balance": 54800,
                "contribution": -5200,
                "source": "spend",
            },
        ]

    def test_drawn_from_fund_defaults_to_null(self, client):
        response = client.post(
            "/api/income",
            json={"txn_date": "2026-06-15", "source": "interest", "amount": 12.34},
        )
        assert response.status_code == 201
        assert response.json()["drawn_from_fund_id"] is None

    def test_a_draw_exceeding_the_fund_balance_is_rejected(self, client):
        fund_id = insert_fund("Year-2 cash")
        insert_fund_entry(fund_id, "2026-05-01", 1000)
        response = client.post(
            "/api/income",
            json={
                "txn_date": "2026-05-28",
                "source": "transfer_in",
                "amount": 1200,
                "drawn_from_fund_id": fund_id,
            },
        )
        assert response.status_code == 422
        assert response.json()["detail"] == "income draw exceeds fund balance"
        assert query("SELECT id FROM income_event") == []
        assert len(fetch_fund_entries(fund_id)) == 1

    def test_an_unknown_drawn_from_fund_returns_404(self, client):
        response = client.post(
            "/api/income",
            json={
                "txn_date": "2026-05-28",
                "source": "transfer_in",
                "amount": 100,
                "drawn_from_fund_id": 999,
            },
        )
        assert response.status_code == 404

    def test_a_drawn_income_moves_safe_to_spend_exactly_once(self, client):
        # The crux of the one-touch draw: the income row is the only thing
        # moving safe-to-spend. The paired 'spend' entry stays out of the
        # fund_contributions headline and the feed, so the draw lowers the
        # fund without double-counting the inflow.
        fund_id = insert_fund("Year-2 cash")
        insert_fund_entry(fund_id, "2026-06-01", 60000)
        response = client.post(
            "/api/income",
            json={
                "txn_date": "2026-06-02",
                "budget_month": "2026-06",
                "source": "transfer_in",
                "amount": 5200,
                "drawn_from_fund_id": fund_id,
            },
        )
        assert response.status_code == 201
        assert fetch_fund_entries(fund_id)[-1]["source"] == "spend"
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert body["baseline"] == 5200
        assert body["fund_contributions"] == 0
        assert body["safe_to_spend"] == 5200
        assert [(item["type"], item["amount"]) for item in body["activity"]] == [("income", 5200)]


class TestUpdateIncome:
    def insert_income(self, client, **overrides):
        payload = {
            "txn_date": "2026-06-27",
            "budget_month": "2026-07",
            "source": "paycheck",
            "amount": 2800,
            "source_label": "You paycheck",
            "note": "Original",
        } | overrides
        response = client.post("/api/income", json=payload)
        assert response.status_code == 201
        return response.json()["id"]

    def test_revises_every_column_in_place(self, client):
        account_id = insert_account("Chase checking")
        income_id = self.insert_income(client)
        payload = {
            "txn_date": "2026-06-28",
            "budget_month": "2026-08",
            "source": "transfer_in",
            "amount": 3100.5,
            "tax_treatment": "ORDINARY",
            "account_id": account_id,
            "source_label": "Brokerage withdrawal",
            "note": "Tip settled",
        }
        response = client.put(f"/api/income/{income_id}", json=payload)
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == income_id
        assert body["txn_date"] == "2026-06-28"
        assert body["budget_month"] == "2026-08"
        assert body["source"] == "transfer_in"
        assert body["amount"] == 3100.5
        assert body["tax_treatment"] == "ORDINARY"
        assert body["account_id"] == account_id
        assert body["source_label"] == "Brokerage withdrawal"
        assert body["note"] == "Tip settled"
        rows = query("SELECT budget_month, amount FROM income_event")
        assert rows == [{"budget_month": "2026-08", "amount": 310050}]

    def test_budget_month_defaults_to_the_txn_month(self, client):
        income_id = self.insert_income(client)
        payload = {"txn_date": "2026-06-27", "source": "paycheck", "amount": 2800}
        response = client.put(f"/api/income/{income_id}", json=payload)
        assert response.status_code == 200
        assert response.json()["budget_month"] == "2026-06"

    def test_omitted_optional_fields_clear_the_stored_ones(self, client):
        # The edit is a full replace, like the create body: a form that
        # blanks the title or note really clears it.
        income_id = self.insert_income(client)
        payload = {"txn_date": "2026-06-27", "source": "paycheck", "amount": 2800}
        body = client.put(f"/api/income/{income_id}", json=payload).json()
        assert body["source_label"] is None
        assert body["note"] is None

    def test_the_edit_can_set_pending(self, client):
        income_id = self.insert_income(client)
        payload = {"txn_date": "2026-06-27", "source": "paycheck", "amount": 2800, "pending": True}
        response = client.put(f"/api/income/{income_id}", json=payload)
        assert response.status_code == 200
        assert response.json()["pending"] is True

    def test_an_omitted_pending_clears_the_flag(self, client):
        income_id = self.insert_income(client, pending=True)
        payload = {"txn_date": "2026-06-27", "source": "paycheck", "amount": 2800}
        response = client.put(f"/api/income/{income_id}", json=payload)
        assert response.status_code == 200
        assert response.json()["pending"] is False

    def test_unknown_income_returns_404(self, client):
        payload = {"txn_date": "2026-06-27", "source": "paycheck", "amount": 2800}
        response = client.put("/api/income/99", json=payload)
        assert response.status_code == 404

    def test_unknown_account_returns_404(self, client):
        income_id = self.insert_income(client)
        payload = {
            "txn_date": "2026-06-27",
            "source": "paycheck",
            "amount": 2800,
            "account_id": 99,
        }
        assert client.put(f"/api/income/{income_id}", json=payload).status_code == 404

    def test_rejects_a_non_positive_amount(self, client):
        income_id = self.insert_income(client)
        payload = {"txn_date": "2026-06-27", "source": "paycheck", "amount": 0}
        assert client.put(f"/api/income/{income_id}", json=payload).status_code == 422

    def test_a_same_fund_amount_increase_appends_a_delta_entry(self, client):
        fund_id = insert_fund("Year-2 cash")
        insert_fund_entry(fund_id, "2026-06-01", 60000)
        income_id = self.insert_income(
            client, source="transfer_in", amount=5200, drawn_from_fund_id=fund_id
        )
        payload = {
            "txn_date": "2026-06-27",
            "source": "transfer_in",
            "amount": 5500,
            "drawn_from_fund_id": fund_id,
        }
        assert client.put(f"/api/income/{income_id}", json=payload).status_code == 200
        entries = fetch_fund_entries(fund_id)
        assert [entry["balance"] for entry in entries] == [60000, 54800, 54500]
        delta = entries[-1]
        assert delta["contribution"] == -300
        assert delta["source"] == "spend"
        assert delta["as_of_date"] == date.today().isoformat()

    def test_a_same_fund_amount_decrease_releases_the_difference(self, client):
        fund_id = insert_fund("Year-2 cash")
        insert_fund_entry(fund_id, "2026-06-01", 60000)
        income_id = self.insert_income(
            client, source="transfer_in", amount=5200, drawn_from_fund_id=fund_id
        )
        payload = {
            "txn_date": "2026-06-27",
            "source": "transfer_in",
            "amount": 5000,
            "drawn_from_fund_id": fund_id,
        }
        assert client.put(f"/api/income/{income_id}", json=payload).status_code == 200
        entries = fetch_fund_entries(fund_id)
        assert [entry["balance"] for entry in entries] == [60000, 54800, 55000]
        assert entries[-1]["contribution"] == 200

    def test_an_increase_beyond_the_fund_balance_is_rejected(self, client):
        fund_id = insert_fund("Year-2 cash")
        insert_fund_entry(fund_id, "2026-06-01", 6000)
        income_id = self.insert_income(
            client, source="transfer_in", amount=5200, drawn_from_fund_id=fund_id
        )
        payload = {
            "txn_date": "2026-06-27",
            "source": "transfer_in",
            "amount": 6100,
            "drawn_from_fund_id": fund_id,
        }
        response = client.put(f"/api/income/{income_id}", json=payload)
        assert response.status_code == 422
        assert response.json()["detail"] == "income draw exceeds fund balance"
        assert [entry["balance"] for entry in fetch_fund_entries(fund_id)] == [6000, 800]
        assert query("SELECT amount FROM income_event") == [{"amount": 520000}]

    def test_clearing_the_draw_reverses_it(self, client):
        # The edit is a full replace: an omitted drawn_from_fund_id really
        # clears the draw, and the compensating entry restores the fund.
        fund_id = insert_fund("Year-2 cash")
        insert_fund_entry(fund_id, "2026-06-01", 60000)
        income_id = self.insert_income(
            client, source="transfer_in", amount=5200, drawn_from_fund_id=fund_id
        )
        payload = {"txn_date": "2026-06-27", "source": "transfer_in", "amount": 5200}
        response = client.put(f"/api/income/{income_id}", json=payload)
        assert response.status_code == 200
        assert response.json()["drawn_from_fund_id"] is None
        entries = fetch_fund_entries(fund_id)
        assert [entry["balance"] for entry in entries] == [60000, 54800, 60000]
        assert entries[-1]["contribution"] == 5200
        assert query("SELECT drawn_from_fund_id FROM income_event") == [
            {"drawn_from_fund_id": None}
        ]

    def test_adding_a_draw_draws_the_fund_down(self, client):
        fund_id = insert_fund("Year-2 cash")
        insert_fund_entry(fund_id, "2026-06-01", 60000)
        income_id = self.insert_income(client, source="transfer_in", amount=5200)
        payload = {
            "txn_date": "2026-06-27",
            "source": "transfer_in",
            "amount": 5200,
            "drawn_from_fund_id": fund_id,
        }
        response = client.put(f"/api/income/{income_id}", json=payload)
        assert response.status_code == 200
        assert response.json()["drawn_from_fund_id"] == fund_id
        entries = fetch_fund_entries(fund_id)
        assert [entry["balance"] for entry in entries] == [60000, 54800]
        assert entries[-1]["contribution"] == -5200
        assert entries[-1]["source"] == "spend"
        assert entries[-1]["as_of_date"] == date.today().isoformat()

    def test_adding_a_draw_respects_the_overdraw_guard(self, client):
        fund_id = insert_fund("Year-2 cash")
        insert_fund_entry(fund_id, "2026-06-01", 1000)
        income_id = self.insert_income(client, source="transfer_in", amount=2800)
        payload = {
            "txn_date": "2026-06-27",
            "source": "transfer_in",
            "amount": 2800,
            "drawn_from_fund_id": fund_id,
        }
        assert client.put(f"/api/income/{income_id}", json=payload).status_code == 422
        assert [entry["balance"] for entry in fetch_fund_entries(fund_id)] == [1000]
        assert query("SELECT drawn_from_fund_id FROM income_event") == [
            {"drawn_from_fund_id": None}
        ]

    def test_a_fund_to_fund_edit_moves_the_draw(self, client):
        year2_id = insert_fund("Year-2 cash")
        year3_id = insert_fund("Year-3 cash")
        insert_fund_entry(year2_id, "2026-06-01", 60000)
        insert_fund_entry(year3_id, "2026-06-01", 20000)
        income_id = self.insert_income(
            client, source="transfer_in", amount=5200, drawn_from_fund_id=year2_id
        )
        payload = {
            "txn_date": "2026-06-27",
            "source": "transfer_in",
            "amount": 5200,
            "drawn_from_fund_id": year3_id,
        }
        assert client.put(f"/api/income/{income_id}", json=payload).status_code == 200
        assert [entry["balance"] for entry in fetch_fund_entries(year2_id)] == [
            60000,
            54800,
            60000,
        ]
        assert [entry["balance"] for entry in fetch_fund_entries(year3_id)] == [20000, 14800]

    def test_an_unknown_drawn_from_fund_returns_404(self, client):
        income_id = self.insert_income(client)
        payload = {
            "txn_date": "2026-06-27",
            "source": "transfer_in",
            "amount": 2800,
            "drawn_from_fund_id": 999,
        }
        assert client.put(f"/api/income/{income_id}", json=payload).status_code == 404


class TestDeleteIncome:
    def test_deletes_the_row(self, client):
        payload = {"txn_date": "2026-06-27", "source": "paycheck", "amount": 2800}
        income_id = client.post("/api/income", json=payload).json()["id"]
        response = client.delete(f"/api/income/{income_id}")
        assert response.status_code == 204
        assert query("SELECT id FROM income_event") == []

    def test_the_baseline_drops_after_a_delete(self, client):
        payload = {
            "txn_date": "2026-06-05",
            "budget_month": "2026-06",
            "source": "paycheck",
            "amount": 5200,
        }
        income_id = client.post("/api/income", json=payload).json()["id"]
        before = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert before["baseline"] == 5200
        assert client.delete(f"/api/income/{income_id}").status_code == 204
        after = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert after["baseline"] == 0
        assert after["safe_to_spend"] == 0

    def test_unknown_income_returns_404(self, client):
        assert client.delete("/api/income/99").status_code == 404


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
            "rollover_assigned": 0,
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

    def test_expense_activity_carries_the_edit_form_fields(self, client):
        # An edit form pre-fills from the feed row itself — no GET-by-id
        # round trip — so expense rows carry every column the form needs.
        groceries_id = insert_category("Groceries")
        account_id = insert_account("Chase checking")
        self.fund_month(client, 5200)
        self.spend(
            client,
            96,
            txn_date="2026-06-20",
            category_id=groceries_id,
            is_fixed=True,
            account_id=account_id,
        )
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        expense = body["activity"][0]
        assert expense["type"] == "expense"
        assert expense["category_id"] == groceries_id
        assert expense["funded_from"] == "discretionary"
        assert expense["fund_id"] is None
        assert expense["account_id"] == account_id
        assert expense["is_fixed"] is True
        assert expense["budget_month"] == "2026-06"
        assert expense["tax_treatment"] is None

    def test_fund_funded_expense_activity_carries_its_fund_id(self, client):
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, "2026-06-01", 5000)
        self.fund_month(client, 5200)
        self.spend(client, 1200, txn_date="2026-06-15", funded_from="fund", fund_id=bike_id)
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        expense = body["activity"][0]
        assert expense["type"] == "expense"
        assert expense["funded_from"] == "fund"
        assert expense["fund_id"] == bike_id
        assert expense["category_id"] is None
        assert expense["is_fixed"] is False

    def test_income_activity_carries_the_edit_form_fields(self, client):
        account_id = insert_account("Chase checking")
        payload = {
            "txn_date": "2026-05-24",
            "budget_month": "2026-06",
            "source": "paycheck",
            "amount": 2800,
            "tax_treatment": "ORDINARY",
            "account_id": account_id,
        }
        assert client.post("/api/income", json=payload).status_code == 201
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        income = body["activity"][0]
        assert income["type"] == "income"
        assert income["budget_month"] == "2026-06"
        assert income["tax_treatment"] == "ORDINARY"
        assert income["account_id"] == account_id
        assert income["category_id"] is None
        assert income["funded_from"] is None
        assert income["fund_id"] is None
        assert income["is_fixed"] is None

    def test_activity_carries_the_pending_flag(self, client):
        # The feed is the edit form's only read and the ⚠️ renders from
        # the row itself, so expense and income rows carry the stored flag.
        self.spend(client, 96, txn_date="2026-06-20", pending=True)
        self.spend(client, 40, txn_date="2026-06-18")
        payload = {"txn_date": "2026-06-24", "source": "paycheck", "amount": 2800, "pending": True}
        assert client.post("/api/income", json=payload).status_code == 201
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        assert [(item["type"], item["pending"]) for item in body["activity"]] == [
            ("income", True),
            ("expense", True),
            ("expense", False),
        ]

    def test_fund_activity_carries_null_edit_fields(self, client):
        # Fund rows belong to the funds machinery — no edit affordance, so
        # every edit-form field is null.
        fund_id = insert_fund("Emergency fund")
        insert_fund_entry(fund_id, "2026-06-01", 500, contribution=500, source="monthly_plan")
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        fund_item = body["activity"][0]
        assert fund_item["type"] == "fund"
        assert fund_item["category_id"] is None
        assert fund_item["funded_from"] is None
        assert fund_item["fund_id"] is None
        assert fund_item["account_id"] is None
        assert fund_item["is_fixed"] is None
        assert fund_item["budget_month"] is None
        assert fund_item["tax_treatment"] is None
        assert fund_item["pending"] is None

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

    def test_a_category_less_fund_expense_carries_the_fund_name(self, client):
        # With the merged Paid-from select, a fund-funded spend posts no
        # category — the fund itself says what the spend was for, so its
        # name rides where the category's would have been.
        car_id = insert_fund("Car fund")
        insert_fund_entry(car_id, "2026-06-01", 5000)
        self.fund_month(client, 5200)
        self.spend(client, 1200, txn_date="2026-06-10", funded_from="fund", fund_id=car_id)
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        expense = body["activity"][0]
        assert expense["type"] == "expense"
        assert expense["category"] == "Car fund"

    def test_a_categorized_fund_expense_keeps_its_category_name(self, client):
        # Rows from before the merged select carry both a category and a
        # fund; the category wins, so history renders exactly as it did.
        travel_id = insert_category("Travel", emoji="✈️")
        car_id = insert_fund("Car fund")
        insert_fund_entry(car_id, "2026-06-01", 5000)
        self.fund_month(client, 5200)
        self.spend(
            client,
            1200,
            txn_date="2026-06-10",
            category_id=travel_id,
            funded_from="fund",
            fund_id=car_id,
        )
        body = client.get("/api/budget-month", params={"month": "2026-06"}).json()
        expense = body["activity"][0]
        assert expense["type"] == "expense"
        assert expense["category"] == "Travel"

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

    def test_a_dated_release_lands_in_its_own_months_headline(self, client):
        # Funding a coming month from a fund: the release is dated into the
        # target month, so that month's headline gains the money and the
        # current month's is never touched — one headline touch, not two.
        fund_id = insert_fund("Vacation fund")
        insert_fund_entry(fund_id, first_of_month(), 5000)
        release = client.post(
            f"/api/funds/{fund_id}/top-up",
            json={"amount": -500, "as_of_date": first_of_month(-1)},
        )
        assert release.status_code == 201
        body = client.get("/api/budget-month").json()
        assert body["fund_contributions"] == 0
        next_month = first_of_month(-1)[:7]
        body = client.get("/api/budget-month", params={"month": next_month}).json()
        assert body["fund_contributions"] == -500
        assert body["safe_to_spend"] == 500

    def test_rollover_entries_leave_the_headline_alone(self, client):
        # A rollover assigns last month's leftover, so the current month is
        # never charged for money the old month already earned: the entry
        # stays out of fund_contributions and safe-to-spend — locked in here
        # rather than left incidental to the ('monthly_plan', 'top_up')
        # filter.
        fund_id = insert_fund("Pool fund")
        insert_fund_entry(fund_id, first_of_month(), 5000)
        payload = {"txn_date": date.today().isoformat(), "source": "paycheck", "amount": 5000}
        assert client.post("/api/income", json=payload).status_code == 201
        rollover = client.post(
            f"/api/funds/{fund_id}/top-up", json={"amount": 1000, "source": "rollover"}
        )
        assert rollover.status_code == 201
        body = client.get("/api/budget-month").json()
        assert body["fund_contributions"] == 0
        assert body["safe_to_spend"] == 5000

    def test_rollover_entries_stay_out_of_the_activity_feed(self, client):
        # The feed lists exactly the sources the headline subtracts, so the
        # two reconcile; a rollover's visibility surfaces are the
        # assigned/unassigned line and the fund's own entry history.
        fund_id = insert_fund("Pool fund")
        insert_fund_entry(fund_id, first_of_month(), 5000)
        payload = {"txn_date": date.today().isoformat(), "source": "paycheck", "amount": 5000}
        assert client.post("/api/income", json=payload).status_code == 201
        rollover = client.post(
            f"/api/funds/{fund_id}/top-up", json={"amount": 1000, "source": "rollover"}
        )
        assert rollover.status_code == 201
        body = client.get("/api/budget-month").json()
        assert [item["type"] for item in body["activity"]] == ["income"]

    def test_rollover_assigned_sums_the_months_rollover_entries(self, client):
        # The client computes unassigned leftover as last month's
        # safe-to-spend minus this total, so the line can tick down to zero
        # as the money is given a job.
        pool_id = insert_fund("Pool fund")
        insert_fund_entry(pool_id, first_of_month(), 5000)
        bike_id = insert_fund("Bike fund")
        insert_fund_entry(bike_id, first_of_month(), 1000)
        for fund_id, amount in ((pool_id, 400), (bike_id, 200)):
            response = client.post(
                f"/api/funds/{fund_id}/top-up", json={"amount": amount, "source": "rollover"}
            )
            assert response.status_code == 201
        body = client.get("/api/budget-month").json()
        assert body["rollover_assigned"] == 600

    def test_a_negative_rollover_shrinks_the_assigned_total(self, client):
        # Un-assigning a mis-routed rollover subtracts from the total the
        # same way a release subtracts from fund_contributions.
        fund_id = insert_fund("Pool fund")
        insert_fund_entry(fund_id, first_of_month(), 5000)
        for amount in (500, -200):
            response = client.post(
                f"/api/funds/{fund_id}/top-up", json={"amount": amount, "source": "rollover"}
            )
            assert response.status_code == 201
        body = client.get("/api/budget-month").json()
        assert body["rollover_assigned"] == 300

    def test_other_sources_stay_out_of_rollover_assigned(self, client):
        # The mirror of the headline exclusion: a top-up or monthly-plan
        # contribution is this month's money being parked, never last
        # month's leftover being assigned.
        fund_id = insert_fund("Pool fund")
        insert_fund_entry(fund_id, first_of_month(), 5000)
        insert_fund_entry(fund_id, first_of_month(), 5500, contribution=500, source="monthly_plan")
        top_up = client.post(f"/api/funds/{fund_id}/top-up", json={"amount": 250})
        assert top_up.status_code == 201
        body = client.get("/api/budget-month").json()
        assert body["rollover_assigned"] == 0

    def test_rollover_assigned_scopes_by_calendar_month(self, client):
        # fund_entry has no budget_month column; the sum scopes by calendar
        # month, exactly like fund_contributions.
        fund_id = insert_fund("Pool fund")
        insert_fund_entry(fund_id, first_of_month(1), 4600, contribution=400, source="rollover")
        body = client.get("/api/budget-month").json()
        assert body["rollover_assigned"] == 0
        last_month = first_of_month(1)[:7]
        body = client.get("/api/budget-month", params={"month": last_month}).json()
        assert body["rollover_assigned"] == 400

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
