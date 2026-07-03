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
