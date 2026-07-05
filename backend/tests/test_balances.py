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
):
    conn = connect()
    try:
        cursor = conn.execute(
            "INSERT INTO account (name, kind, tax_treatment, owner, is_liability, is_investable)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (name, kind, tax_treatment, owner, is_liability, is_investable),
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
                "active": True,
                "emoji": None,
            },
        ]

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
        assert body["active"] is True
        entries = query(
            "SELECT as_of_date, balance_usd, source FROM balance_entry WHERE account_id = ?",
            body["id"],
        )
        assert entries == [
            {
                "as_of_date": date.today().isoformat(),
                "balance_usd": 12000,
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
        (month,) = client.get("/api/ledger").json()
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
        (month,) = client.get("/api/ledger").json()
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
        months = {m["month"]: m["net_worth"] for m in client.get("/api/ledger").json()}
        assert months["2026-05"] == 10000

    def test_deactivated_name_is_reusable(self, client):
        created = self.create(client, "Robinhood")
        client.post(f"/api/accounts/{created['id']}/deactivate")
        response = client.post("/api/accounts", json={"name": "Robinhood", "initial_value": 200})
        assert response.status_code == 201


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
        assert [row["balance_usd"] for row in history] == [8000, 9000]
        monthly = query(
            "SELECT balance_usd FROM v_account_monthly WHERE account_id = ? AND month = '2026-06'",
            account_id,
        )
        assert [row["balance_usd"] for row in monthly] == [9000]


def post_entry(client, account_id, as_of_date, **fields):
    response = client.post(
        "/api/balance-entries",
        json={"account_id": account_id, "as_of_date": as_of_date, **fields},
    )
    assert response.status_code == 201
    return response.json()


class TestGetLedger:
    def test_empty_database_returns_no_months(self, client):
        response = client.get("/api/ledger")
        assert response.status_code == 200
        assert response.json() == []

    def test_groups_balances_by_month_newest_first(self, client):
        eth_id = insert_account("Ethereum", "eth", tax_treatment="LTCG", is_investable=1)
        cash_id = insert_account("Chase checking", "cash")
        post_entry(client, eth_id, "2026-05-28", quantity=20, unit_price=3400)
        post_entry(client, cash_id, "2026-05-28", balance_usd=7000)
        post_entry(client, eth_id, "2026-06-28", quantity=20, unit_price=3500)
        post_entry(client, cash_id, "2026-06-28", balance_usd=9000)
        response = client.get("/api/ledger")
        assert response.status_code == 200
        assert response.json() == [
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
        ]

    def test_latest_entry_in_a_month_wins(self, client):
        cash_id = insert_account("Chase checking", "cash")
        post_entry(client, cash_id, "2026-06-26", balance_usd=8000)
        post_entry(client, cash_id, "2026-06-28", balance_usd=9000)
        (month,) = client.get("/api/ledger").json()
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
        (month,) = client.get("/api/ledger").json()
        assert month["net_worth"] == 200000


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
