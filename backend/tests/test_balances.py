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


def insert_account(
    name,
    kind,
    *,
    tax_treatment="NONE",
    owner=None,
    is_liability=0,
    is_investable=0,
    withdrawal_priority=None,
    access_age=None,
):
    conn = connect()
    try:
        cursor = conn.execute(
            "INSERT INTO account (name, kind, tax_treatment, owner, is_liability, is_investable,"
            " withdrawal_priority, access_age)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                name,
                kind,
                tax_treatment,
                owner,
                is_liability,
                is_investable,
                withdrawal_priority,
                access_age,
            ),
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def query(sql, *params):
    conn = connect()
    try:
        return [dict(row) for row in conn.execute(sql, params)]
    finally:
        conn.close()


class TestGetAccounts:
    def test_empty_database_returns_no_accounts(self, client):
        response = client.get("/api/accounts")
        assert response.status_code == 200
        assert response.json() == []

    def test_returns_the_account_dimension_rows(self, client):
        eth_id = insert_account("Ethereum", "eth", tax_treatment="LTCG", is_investable=1)
        mortgage_id = insert_account("Mortgage", "mortgage", is_liability=1)
        response = client.get("/api/accounts")
        assert response.status_code == 200
        assert response.json() == [
            {
                "id": eth_id,
                "name": "Ethereum",
                "kind": "eth",
                "tax_treatment": "LTCG",
                "owner": None,
                "is_liability": False,
                "is_investable": True,
                "withdrawal_priority": None,
                "access_age": None,
                "active": True,
                "emoji": None,
            },
            {
                "id": mortgage_id,
                "name": "Mortgage",
                "kind": "mortgage",
                "tax_treatment": "NONE",
                "owner": None,
                "is_liability": True,
                "is_investable": False,
                "withdrawal_priority": None,
                "access_age": None,
                "active": True,
                "emoji": None,
            },
        ]

    def test_returns_the_planner_classification_columns(self, client):
        insert_account(
            "Retirement",
            "401k",
            tax_treatment="ORDINARY",
            is_investable=1,
            withdrawal_priority=3,
            access_age=59.5,
        )
        (account,) = client.get("/api/accounts").json()
        assert account["withdrawal_priority"] == 3
        assert account["access_age"] == 59.5

    def test_returns_the_account_emoji(self, client):
        eth_id = insert_account("Ethereum", "eth", tax_treatment="LTCG")
        conn = connect()
        try:
            conn.execute("UPDATE account SET emoji = '⚡' WHERE id = ?", (eth_id,))
            conn.commit()
        finally:
            conn.close()
        (account,) = client.get("/api/accounts").json()
        assert account["emoji"] == "⚡"

    def test_lists_accounts_by_sort_order_before_id(self, client):
        insert_account("Ethereum", "eth")
        insert_account("Brokerage", "brokerage_fund")
        insert_account("Cash", "cash")
        conn = connect()
        try:
            conn.execute("UPDATE account SET sort_order = 4 - id")
            conn.commit()
        finally:
            conn.close()
        accounts = client.get("/api/accounts").json()
        assert [account["name"] for account in accounts] == ["Cash", "Brokerage", "Ethereum"]


class TestReorderAccounts:
    def create(self, client, name):
        return client.post("/api/accounts", json={"name": name, "initial_value": 100}).json()["id"]

    def test_persists_and_echoes_the_new_order(self, client):
        eth = self.create(client, "Ethereum")
        brokerage = self.create(client, "Brokerage")
        cash = self.create(client, "Cash")
        response = client.put("/api/accounts/order", json={"ids": [cash, eth, brokerage]})
        assert response.status_code == 200
        assert [account["name"] for account in response.json()] == [
            "Cash",
            "Ethereum",
            "Brokerage",
        ]
        accounts = client.get("/api/accounts").json()
        assert [account["name"] for account in accounts] == ["Cash", "Ethereum", "Brokerage"]

    def assert_rejected(self, response):
        assert response.status_code == 422
        assert response.json()["detail"] == "ids must be exactly the active account ids"

    def test_ids_must_cover_exactly_the_active_accounts(self, client):
        eth = self.create(client, "Ethereum")
        brokerage = self.create(client, "Brokerage")
        self.assert_rejected(client.put("/api/accounts/order", json={"ids": [eth]}))
        self.assert_rejected(client.put("/api/accounts/order", json={"ids": [eth, brokerage, 999]}))
        self.assert_rejected(client.put("/api/accounts/order", json={"ids": [eth, eth, brokerage]}))

    def test_inactive_accounts_stay_out_of_the_order(self, client):
        eth = self.create(client, "Ethereum")
        brokerage = self.create(client, "Brokerage")
        retired = self.create(client, "Old checking")
        client.post(f"/api/accounts/{retired}/deactivate")
        self.assert_rejected(
            client.put("/api/accounts/order", json={"ids": [brokerage, eth, retired]})
        )
        response = client.put("/api/accounts/order", json={"ids": [brokerage, eth]})
        assert response.status_code == 200
        assert [account["name"] for account in response.json()] == ["Brokerage", "Ethereum"]

    def test_new_account_lists_last_after_a_reorder(self, client):
        eth = self.create(client, "Ethereum")
        brokerage = self.create(client, "Brokerage")
        client.put("/api/accounts/order", json={"ids": [brokerage, eth]})
        self.create(client, "Cash")
        accounts = client.get("/api/accounts").json()
        assert [account["name"] for account in accounts] == ["Brokerage", "Ethereum", "Cash"]


class TestPostAccounts:
    def test_creates_an_asset_with_defaults_and_its_initial_balance(self, client):
        response = client.post(
            "/api/accounts",
            json={"name": "Robinhood", "emoji": "🪙", "initial_value": 12000},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["id"] > 0
        assert body["name"] == "Robinhood"
        assert body["emoji"] == "🪙"
        assert body["kind"] == "other"
        assert body["is_liability"] is False
        assert body["is_investable"] is False
        assert body["withdrawal_priority"] is None
        assert body["access_age"] is None
        assert body["active"] is True
        entries = query(
            "SELECT as_of_date, balance_usd, source FROM balance_entry WHERE account_id = ?",
            body["id"],
        )
        # Raw storage holds integer cents; dollars exist only in the JSON.
        assert entries == [
            {
                "as_of_date": date.today().isoformat(),
                "balance_usd": 1_200_000,
                "source": "manual",
            }
        ]

    def test_new_account_surfaces_in_accounts_and_ledger(self, client):
        created = client.post(
            "/api/accounts", json={"name": "Valuables", "initial_value": 5000}
        ).json()
        accounts = client.get("/api/accounts").json()
        assert [account["name"] for account in accounts] == ["Valuables"]
        assert accounts[0]["emoji"] is None
        (month,) = client.get("/api/ledger").json()["months"]
        assert month["month"] == date.today().strftime("%Y-%m")
        assert month["net_worth"] == 5000
        assert month["balances"][0]["account_id"] == created["id"]

    def test_creates_a_liability_stored_positive(self, client):
        response = client.post(
            "/api/accounts",
            json={
                "name": "Student loan",
                "emoji": "🎓",
                "is_liability": True,
                "initial_value": 20000,
            },
        )
        assert response.status_code == 201
        assert response.json()["is_liability"] is True
        (month,) = client.get("/api/ledger").json()["months"]
        assert month["balances"][0]["balance_usd"] == 20000
        assert month["net_worth"] == -20000

    def test_blank_name_is_rejected(self, client):
        response = client.post("/api/accounts", json={"name": "   ", "initial_value": 100})
        assert response.status_code == 422

    def test_duplicate_active_name_is_rejected_case_insensitively(self, client):
        assert (
            client.post(
                "/api/accounts", json={"name": "Robinhood", "initial_value": 100}
            ).status_code
            == 201
        )
        response = client.post("/api/accounts", json={"name": "robinhood", "initial_value": 100})
        assert response.status_code == 409

    def test_negative_initial_value_is_rejected(self, client):
        response = client.post("/api/accounts", json={"name": "Robinhood", "initial_value": -5})
        assert response.status_code == 422
        assert query("SELECT COUNT(*) AS n FROM account")[0]["n"] == 0


class TestDeactivateAccount:
    def create(self, client, name):
        response = client.post("/api/accounts", json={"name": name, "initial_value": 100})
        assert response.status_code == 201
        return response.json()

    def test_deactivate_flips_active_off(self, client):
        created = self.create(client, "Robinhood")
        response = client.post(f"/api/accounts/{created['id']}/deactivate")
        assert response.status_code == 200
        assert response.json()["active"] is False
        (account,) = client.get("/api/accounts").json()
        assert account["active"] is False

    def test_unknown_account_returns_404(self, client):
        response = client.post("/api/accounts/999/deactivate")
        assert response.status_code == 404
        assert response.json()["detail"] == "account not found"

    def test_entered_months_stay_in_net_worth_after_deactivation(self, client):
        # Soft-deactivation preserves the append-only history: months where
        # the account really had entries keep counting in net worth.
        cash_id = insert_account("Chase checking", "cash")
        boat_id = insert_account("Boat", "other")
        post_entry(client, cash_id, "2026-05-28", balance_usd=1000)
        post_entry(client, boat_id, "2026-05-28", balance_usd=9000)
        post_entry(client, cash_id, "2026-06-28", balance_usd=1000)
        assert client.post(f"/api/accounts/{boat_id}/deactivate").status_code == 200
        months = {m["month"]: m["net_worth"] for m in client.get("/api/ledger").json()["months"]}
        assert months["2026-05"] == 10000

    def test_deactivated_name_is_reusable(self, client):
        created = self.create(client, "Robinhood")
        client.post(f"/api/accounts/{created['id']}/deactivate")
        response = client.post("/api/accounts", json={"name": "Robinhood", "initial_value": 200})
        assert response.status_code == 201


class TestUpdateAccount:
    CLASSIFICATION = {
        "kind": "eth",
        "tax_treatment": "LTCG",
        "is_investable": True,
        "withdrawal_priority": 1,
        "access_age": None,
    }

    def create(self, client, name, **extra):
        response = client.post("/api/accounts", json={"name": name, "initial_value": 100, **extra})
        assert response.status_code == 201
        return response.json()

    def test_classifies_an_account_for_the_planners(self, client):
        created = self.create(client, "Coinbase ETH")
        response = client.put(f"/api/accounts/{created['id']}", json=self.CLASSIFICATION)
        assert response.status_code == 200
        body = response.json()
        assert body["kind"] == "eth"
        assert body["tax_treatment"] == "LTCG"
        assert body["is_investable"] is True
        assert body["withdrawal_priority"] == 1
        assert body["access_age"] is None
        (account,) = client.get("/api/accounts").json()
        assert account["kind"] == "eth"
        assert account["is_investable"] is True
        assert account["withdrawal_priority"] == 1

    def test_classifies_a_retirement_account_with_an_access_age(self, client):
        created = self.create(client, "Fidelity 401k")
        response = client.put(
            f"/api/accounts/{created['id']}",
            json={
                "kind": "401k",
                "tax_treatment": "ORDINARY",
                "is_investable": True,
                "withdrawal_priority": 3,
                "access_age": 59.5,
            },
        )
        assert response.status_code == 200
        assert response.json()["access_age"] == 59.5
        (row,) = query(
            "SELECT withdrawal_priority, access_age FROM account WHERE id = ?", created["id"]
        )
        assert row == {"withdrawal_priority": 3, "access_age": 59.5}

    def test_classifies_an_hsa_into_the_fourth_withdrawal_tier(self, client):
        # HSAs are their own tier: tax-free, gated later than a 401(k),
        # and drawn after it.
        created = self.create(client, "Fidelity HSA")
        response = client.put(
            f"/api/accounts/{created['id']}",
            json={
                "kind": "hsa",
                "tax_treatment": "TAX_FREE",
                "is_investable": True,
                "withdrawal_priority": 4,
                "access_age": 65,
            },
        )
        assert response.status_code == 200
        assert response.json()["withdrawal_priority"] == 4
        (row,) = query(
            "SELECT withdrawal_priority, access_age FROM account WHERE id = ?", created["id"]
        )
        assert row == {"withdrawal_priority": 4, "access_age": 65.0}

    def test_classifies_the_accounts_owner(self, client):
        # Whose account it is decides which age its gate is read
        # against, so the planners need it recorded.
        created = self.create(client, "Her 401(k)")
        response = client.put(
            f"/api/accounts/{created['id']}", json={**self.CLASSIFICATION, "owner": "spouse"}
        )
        assert response.status_code == 200
        assert response.json()["owner"] == "spouse"
        (account,) = client.get("/api/accounts").json()
        assert account["owner"] == "spouse"
        (row,) = query("SELECT owner FROM account WHERE id = ?", created["id"])
        assert row == {"owner": "spouse"}

    def test_an_unknown_owner_is_rejected(self, client):
        created = self.create(client, "Robinhood")
        response = client.put(
            f"/api/accounts/{created['id']}", json={**self.CLASSIFICATION, "owner": "cousin"}
        )
        assert response.status_code == 422

    def test_the_owner_can_be_cleared(self, client):
        created = self.create(client, "Robinhood")
        client.put(f"/api/accounts/{created['id']}", json={**self.CLASSIFICATION, "owner": "you"})
        response = client.put(
            f"/api/accounts/{created['id']}", json={**self.CLASSIFICATION, "owner": None}
        )
        assert response.status_code == 200
        assert response.json()["owner"] is None

    def test_classification_can_be_cleared_back_to_net_worth_only(self, client):
        created = self.create(client, "Coinbase ETH")
        classified = client.put(f"/api/accounts/{created['id']}", json=self.CLASSIFICATION)
        assert classified.status_code == 200
        response = client.put(
            f"/api/accounts/{created['id']}",
            json={
                "kind": "other",
                "tax_treatment": "NONE",
                "is_investable": False,
                "withdrawal_priority": None,
                "access_age": None,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["is_investable"] is False
        assert body["withdrawal_priority"] is None

    def test_unknown_account_returns_404(self, client):
        response = client.put("/api/accounts/999", json=self.CLASSIFICATION)
        assert response.status_code == 404
        assert response.json()["detail"] == "account not found"

    def test_unknown_kind_is_rejected(self, client):
        created = self.create(client, "Robinhood")
        response = client.put(
            f"/api/accounts/{created['id']}", json={**self.CLASSIFICATION, "kind": "stocks"}
        )
        assert response.status_code == 422

    def test_unknown_tax_treatment_is_rejected(self, client):
        created = self.create(client, "Robinhood")
        response = client.put(
            f"/api/accounts/{created['id']}", json={**self.CLASSIFICATION, "tax_treatment": "STCG"}
        )
        assert response.status_code == 422

    def test_out_of_range_withdrawal_priority_is_rejected(self, client):
        created = self.create(client, "Robinhood")
        for priority in (0, 5):
            response = client.put(
                f"/api/accounts/{created['id']}",
                json={**self.CLASSIFICATION, "withdrawal_priority": priority},
            )
            assert response.status_code == 422

    def test_negative_access_age_is_rejected(self, client):
        created = self.create(client, "Robinhood")
        response = client.put(
            f"/api/accounts/{created['id']}", json={**self.CLASSIFICATION, "access_age": -1}
        )
        assert response.status_code == 422

    def test_a_liability_cannot_join_the_portfolio(self, client):
        # An investable liability would add its positive stored balance to
        # v_net_worth's investable sum, and a prioritized one would enter the
        # withdrawal buckets — both nonsense for money that is owed.
        created = self.create(client, "Mortgage", is_liability=True)
        base = {
            "kind": "mortgage",
            "tax_treatment": "NONE",
            "is_investable": False,
            "withdrawal_priority": None,
            "access_age": None,
        }
        assert client.put(f"/api/accounts/{created['id']}", json=base).status_code == 200
        investable = client.put(
            f"/api/accounts/{created['id']}", json={**base, "is_investable": True}
        )
        assert investable.status_code == 422
        prioritized = client.put(
            f"/api/accounts/{created['id']}", json={**base, "withdrawal_priority": 2}
        )
        assert prioritized.status_code == 422


class TestPostBalanceEntries:
    def test_usd_entry_is_created_as_sent(self, client):
        account_id = insert_account("Chase checking", "cash")
        response = client.post(
            "/api/balance-entries",
            json={"account_id": account_id, "as_of_date": "2026-06-28", "balance_usd": 9000},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["id"] > 0
        assert body["account_id"] == account_id
        assert body["as_of_date"] == "2026-06-28"
        assert body["balance_usd"] == 9000
        assert body["quantity"] is None
        assert body["unit_price"] is None
        assert body["created_at"]

    def test_eth_entry_derives_usd_from_quantity_times_price(self, client):
        account_id = insert_account("Ethereum", "eth", tax_treatment="LTCG", is_investable=1)
        response = client.post(
            "/api/balance-entries",
            json={
                "account_id": account_id,
                "as_of_date": "2026-06-28",
                "quantity": 20,
                "unit_price": 3500,
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["balance_usd"] == 70000
        assert body["quantity"] == 20
        assert body["unit_price"] == 3500

    def test_an_eth_entry_rounds_the_derived_usd_to_exact_cents(self, client):
        # quantity × price rarely lands on a cent boundary (issue #112);
        # the derived balance rounds to exact cents at the boundary, so
        # ledger money is never stored with sub-cent fractions.
        account_id = insert_account("Ethereum", "eth", tax_treatment="LTCG", is_investable=1)
        response = client.post(
            "/api/balance-entries",
            json={
                "account_id": account_id,
                "as_of_date": "2026-06-28",
                "quantity": 12.0459,
                "unit_price": 2500.25,
            },
        )
        assert response.status_code == 201
        assert response.json()["balance_usd"] == 30117.76

    def test_a_cost_basis_is_stored_in_dollars_and_returned(self, client):
        # Basis is the one ledger figure that stays in dollars (migration
        # 0013) — the sourcing loader weighs it against a dollar balance.
        account_id = insert_account(
            "VFIAX", "brokerage_fund", tax_treatment="LTCG", is_investable=1
        )
        response = client.post(
            "/api/balance-entries",
            json={
                "account_id": account_id,
                "as_of_date": "2026-06-28",
                "balance_usd": 600_000,
                "cost_basis": 480_000,
            },
        )
        assert response.status_code == 201
        assert response.json()["cost_basis"] == 480_000
        stored = query(
            "SELECT balance_usd, cost_basis FROM balance_entry WHERE account_id = ?",
            account_id,
        )
        assert stored == [{"balance_usd": 60_000_000, "cost_basis": 480_000}]

    def test_an_entry_without_a_cost_basis_records_none(self, client):
        # Null means unknown, not zero: the bucket keeps whatever basis
        # it already had rather than being restated as all gain.
        account_id = insert_account("Chase checking", "cash")
        response = client.post(
            "/api/balance-entries",
            json={"account_id": account_id, "as_of_date": "2026-06-28", "balance_usd": 9000},
        )
        assert response.status_code == 201
        assert response.json()["cost_basis"] is None
        assert query("SELECT cost_basis FROM balance_entry")[0]["cost_basis"] is None

    def test_quantity_without_unit_price_is_rejected(self, client):
        account_id = insert_account("Ethereum", "eth")
        response = client.post(
            "/api/balance-entries",
            json={"account_id": account_id, "as_of_date": "2026-06-28", "quantity": 20},
        )
        assert response.status_code == 422

    def test_balance_usd_alongside_quantity_and_price_is_rejected(self, client):
        account_id = insert_account("Ethereum", "eth")
        response = client.post(
            "/api/balance-entries",
            json={
                "account_id": account_id,
                "as_of_date": "2026-06-28",
                "balance_usd": 70000,
                "quantity": 20,
                "unit_price": 3500,
            },
        )
        assert response.status_code == 422

    def test_neither_balance_nor_quantity_pair_is_rejected(self, client):
        account_id = insert_account("Chase checking", "cash")
        response = client.post(
            "/api/balance-entries",
            json={"account_id": account_id, "as_of_date": "2026-06-28"},
        )
        assert response.status_code == 422

    def test_a_negative_cost_basis_is_rejected(self, client):
        # A basis below zero puts the gain fraction above 1.0, taxing more
        # gain than the sale can hold. The form cannot type one; the API
        # is called directly, so the guard lives here.
        account_id = insert_account(
            "VFIAX", "brokerage_fund", tax_treatment="LTCG", is_investable=1
        )
        response = client.post(
            "/api/balance-entries",
            json={
                "account_id": account_id,
                "as_of_date": "2026-06-28",
                "balance_usd": 600_000,
                "cost_basis": -1,
            },
        )
        assert response.status_code == 422

    def test_unknown_account_returns_404(self, client):
        response = client.post(
            "/api/balance-entries",
            json={"account_id": 999, "as_of_date": "2026-06-28", "balance_usd": 100},
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "account not found"

    def test_posting_twice_in_a_month_appends_and_the_newer_value_wins(self, client):
        account_id = insert_account("Chase checking", "cash")
        for as_of_date, balance in (("2026-06-26", 8000), ("2026-06-28", 9000)):
            response = client.post(
                "/api/balance-entries",
                json={"account_id": account_id, "as_of_date": as_of_date, "balance_usd": balance},
            )
            assert response.status_code == 201
        history = query(
            "SELECT balance_usd FROM balance_entry WHERE account_id = ? ORDER BY as_of_date",
            account_id,
        )
        assert [row["balance_usd"] for row in history] == [800_000, 900_000]
        monthly = query(
            "SELECT balance_usd FROM v_account_monthly WHERE account_id = ? AND month = '2026-06'",
            account_id,
        )
        assert [row["balance_usd"] for row in monthly] == [900_000]


def post_entry(client, account_id, as_of_date, **fields):
    response = client.post(
        "/api/balance-entries",
        json={"account_id": account_id, "as_of_date": as_of_date, **fields},
    )
    assert response.status_code == 201
    return response.json()


def month_sequence(start, count):
    """`count` consecutive "YYYY-MM" keys from `start`, oldest first."""
    year, month = (int(part) for part in start.split("-"))
    keys = []
    for _ in range(count):
        keys.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return keys


class TestGetLedger:
    """The ledger pages: newest 12 months by default, older months behind a
    `before` cursor. A page is whole months — never a month cut in half."""

    def fill(self, client, start, count):
        """`count` consecutive months of entries for one cash account,
        oldest first, each month a dollar richer than the last."""
        cash_id = insert_account("Chase checking", "cash")
        for index, month in enumerate(month_sequence(start, count)):
            post_entry(client, cash_id, f"{month}-15", balance_usd=1000 + index)
        return cash_id

    def test_empty_database_returns_no_months(self, client):
        response = client.get("/api/ledger")
        assert response.status_code == 200
        assert response.json() == {"months": [], "has_more": False}

    def test_groups_balances_by_month_newest_first(self, client):
        eth_id = insert_account("Ethereum", "eth", tax_treatment="LTCG", is_investable=1)
        cash_id = insert_account("Chase checking", "cash")
        post_entry(client, eth_id, "2026-05-28", quantity=20, unit_price=3400)
        post_entry(client, cash_id, "2026-05-28", balance_usd=7000)
        post_entry(client, eth_id, "2026-06-28", quantity=20, unit_price=3500)
        post_entry(client, cash_id, "2026-06-28", balance_usd=9000)
        response = client.get("/api/ledger")
        assert response.status_code == 200
        assert response.json() == {
            "months": [
                {
                    "month": "2026-06",
                    "net_worth": 79000,
                    "balances": [
                        {
                            "account_id": eth_id,
                            "as_of_date": "2026-06-28",
                            "balance_usd": 70000,
                            "quantity": 20,
                            "unit_price": 3500,
                        },
                        {
                            "account_id": cash_id,
                            "as_of_date": "2026-06-28",
                            "balance_usd": 9000,
                            "quantity": None,
                            "unit_price": None,
                        },
                    ],
                },
                {
                    "month": "2026-05",
                    "net_worth": 75000,
                    "balances": [
                        {
                            "account_id": eth_id,
                            "as_of_date": "2026-05-28",
                            "balance_usd": 68000,
                            "quantity": 20,
                            "unit_price": 3400,
                        },
                        {
                            "account_id": cash_id,
                            "as_of_date": "2026-05-28",
                            "balance_usd": 7000,
                            "quantity": None,
                            "unit_price": None,
                        },
                    ],
                },
            ],
            "has_more": False,
        }

    def test_latest_entry_in_a_month_wins(self, client):
        cash_id = insert_account("Chase checking", "cash")
        post_entry(client, cash_id, "2026-06-26", balance_usd=8000)
        post_entry(client, cash_id, "2026-06-28", balance_usd=9000)
        (month,) = client.get("/api/ledger").json()["months"]
        assert month["balances"] == [
            {
                "account_id": cash_id,
                "as_of_date": "2026-06-28",
                "balance_usd": 9000,
                "quantity": None,
                "unit_price": None,
            }
        ]

    def test_liabilities_subtract_from_the_month_net_worth(self, client):
        home_id = insert_account("Home", "home")
        mortgage_id = insert_account("Mortgage", "mortgage", is_liability=1)
        post_entry(client, home_id, "2026-06-28", balance_usd=350000)
        post_entry(client, mortgage_id, "2026-06-28", balance_usd=150000)
        (month,) = client.get("/api/ledger").json()["months"]
        assert month["net_worth"] == 200000

    def test_returns_the_twelve_newest_months_by_default(self, client):
        self.fill(client, "2025-05", 14)
        page = client.get("/api/ledger").json()
        assert [month["month"] for month in page["months"]] == list(
            reversed(month_sequence("2025-07", 12))
        )
        assert page["has_more"] is True
        assert page["months"][0]["net_worth"] == 1013

    def test_exactly_twelve_months_reports_no_more(self, client):
        self.fill(client, "2025-07", 12)
        page = client.get("/api/ledger").json()
        assert len(page["months"]) == 12
        assert page["has_more"] is False

    def test_before_returns_the_next_older_page(self, client):
        self.fill(client, "2025-05", 14)
        page = client.get("/api/ledger", params={"before": "2025-07"}).json()
        assert [month["month"] for month in page["months"]] == ["2025-06", "2025-05"]
        assert page["has_more"] is False
        assert page["months"][0]["net_worth"] == 1001

    def test_limit_caps_the_page(self, client):
        self.fill(client, "2025-05", 14)
        page = client.get("/api/ledger", params={"limit": 3}).json()
        assert [month["month"] for month in page["months"]] == [
            "2026-06",
            "2026-05",
            "2026-04",
        ]
        assert page["has_more"] is True

    def test_a_page_carries_every_account_of_its_months(self, client):
        # The page is measured in months, not rows: a limit of 2 must not
        # cut a month's accounts in half.
        cash_id = insert_account("Chase checking", "cash")
        home_id = insert_account("Home", "home")
        for month in month_sequence("2026-01", 3):
            post_entry(client, cash_id, f"{month}-15", balance_usd=1000)
            post_entry(client, home_id, f"{month}-15", balance_usd=350000)
        page = client.get("/api/ledger", params={"limit": 2}).json()
        assert [len(month["balances"]) for month in page["months"]] == [2, 2]

    def test_before_the_oldest_month_returns_an_empty_final_page(self, client):
        self.fill(client, "2025-05", 2)
        page = client.get("/api/ledger", params={"before": "2025-05"}).json()
        assert page == {"months": [], "has_more": False}

    def test_malformed_before_is_rejected(self, client):
        assert client.get("/api/ledger", params={"before": "2026-6"}).status_code == 422

    def test_limit_outside_the_bounds_is_rejected(self, client):
        assert client.get("/api/ledger", params={"limit": 0}).status_code == 422
        assert client.get("/api/ledger", params={"limit": 121}).status_code == 422


class TestGetNetWorth:
    def test_empty_database_returns_nulls_and_no_series(self, client):
        response = client.get("/api/net-worth")
        assert response.status_code == 200
        assert response.json() == {"current": None, "yoy": None, "series": []}

    def test_net_worth_is_the_sum_of_assets_minus_liabilities(self, client):
        # The design-handoff formula with its illustrative 2026-06 values:
        # ETH(qty×price) + funds + retirement + home + cash + car + mortgage(negative).
        eth_id = insert_account("Ethereum", "eth", tax_treatment="LTCG", is_investable=1)
        post_entry(client, eth_id, "2026-06-28", quantity=20, unit_price=3500)
        usd_balances = [
            ("VFIAX", "brokerage_fund", 0, 700000),
            ("VTIAX", "brokerage_fund", 0, 250000),
            ("VGSH", "brokerage_fund", 0, 130000),
            ("Retirement", "401k", 0, 350000),
            ("Home", "home", 0, 350000),
            ("Chase checking", "cash", 0, 9000),
            ("Vanguard Cash Plus", "cash_plus", 0, 20000),
            ("Car", "car", 0, 15000),
            ("Mortgage", "mortgage", 1, 150000),
        ]
        for name, kind, is_liability, balance in usd_balances:
            account_id = insert_account(name, kind, is_liability=is_liability)
            post_entry(client, account_id, "2026-06-28", balance_usd=balance)
        body = client.get("/api/net-worth").json()
        assert body["current"] == 1_744_000
        assert body["series"] == [{"month": "2026-06", "net_worth": 1_744_000}]

    def test_yoy_compares_against_the_same_month_a_year_earlier(self, client):
        cash_id = insert_account("Chase checking", "cash")
        post_entry(client, cash_id, "2025-06-28", balance_usd=100000)
        post_entry(client, cash_id, "2026-06-28", balance_usd=110000)
        body = client.get("/api/net-worth").json()
        assert body["current"] == 110000
        assert body["yoy"] == pytest.approx(0.10)

    def test_yoy_is_null_without_a_baseline_month(self, client):
        cash_id = insert_account("Chase checking", "cash")
        post_entry(client, cash_id, "2025-07-28", balance_usd=100000)
        post_entry(client, cash_id, "2026-06-28", balance_usd=110000)
        body = client.get("/api/net-worth").json()
        assert body["current"] == 110000
        assert body["yoy"] is None

    def test_series_is_the_last_twelve_months_ascending(self, client):
        cash_id = insert_account("Chase checking", "cash")
        months = [f"2025-{m:02d}" for m in range(6, 13)] + [f"2026-{m:02d}" for m in range(1, 7)]
        for i, month in enumerate(months):  # 13 months: 2025-06 .. 2026-06
            post_entry(client, cash_id, f"{month}-15", balance_usd=100000 + i * 1000)
        body = client.get("/api/net-worth").json()
        assert [point["month"] for point in body["series"]] == months[1:]
        assert body["series"][0] == {"month": "2025-07", "net_worth": 101000}
        assert body["series"][-1] == {"month": "2026-06", "net_worth": 112000}
