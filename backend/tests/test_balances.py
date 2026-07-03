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
            },
        ]


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
