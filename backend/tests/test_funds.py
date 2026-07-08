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


def insert_fund(
    name,
    kind="sinking",
    target_amount=None,
    target_date=None,
    monthly_plan=None,
    active=1,
    emoji=None,
):
    conn = connect()
    try:
        cursor = conn.execute(
            "INSERT INTO fund (name, kind, target_amount, target_date, monthly_plan, active, emoji)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name, kind, target_amount, target_date, monthly_plan, active, emoji),
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def insert_fund_entry(fund_id, as_of_date, balance, contribution=0):
    conn = connect()
    try:
        cursor = conn.execute(
            "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution)"
            " VALUES (?, ?, ?, ?)",
            (fund_id, as_of_date, balance, contribution),
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def fetch_fund_entries(fund_id):
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT as_of_date, balance, contribution FROM fund_entry"
            " WHERE fund_id = ? ORDER BY id",
            (fund_id,),
        ).fetchall()
        return [tuple(row) for row in rows]
    finally:
        conn.close()


class TestGetFunds:
    def test_empty_database_returns_no_funds(self, client):
        response = client.get("/api/funds")
        assert response.status_code == 200
        assert response.json() == []

    def test_returns_the_fund_dimension_rows_ordered_by_id(self, client):
        emergency_id = insert_fund(
            "Emergency fund", target_amount=30000, monthly_plan=500, emoji="🚨"
        )
        pool_id = insert_fund(
            "Pool fund", kind="goal", target_amount=14000, target_date="2027-08-01"
        )
        insert_fund_entry(emergency_id, "2026-06-01", 10000)
        insert_fund_entry(pool_id, "2026-06-01", 14000)
        response = client.get("/api/funds")
        assert response.status_code == 200
        assert response.json() == [
            {
                "id": emergency_id,
                "name": "Emergency fund",
                "emoji": "🚨",
                "kind": "sinking",
                "target_amount": 30000,
                "target_date": None,
                "monthly_plan": 500,
                "balance": 10000,
                "note": "$500 / mo · ~3.3 yrs to target",
            },
            {
                "id": pool_id,
                "name": "Pool fund",
                "emoji": None,
                "kind": "goal",
                "target_amount": 14000,
                "target_date": "2027-08-01",
                "monthly_plan": None,
                "balance": 14000,
                "note": "✓ fully funded — ready to spend",
            },
        ]

    def test_omits_inactive_funds(self, client):
        insert_fund("Old fund", active=0)
        active_id = insert_fund("Bike fund", kind="goal", target_amount=10000)
        response = client.get("/api/funds")
        assert [fund["id"] for fund in response.json()] == [active_id]

    def test_a_fund_without_entries_has_a_zero_balance(self, client):
        insert_fund("House maintenance", target_amount=30000)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 0
        assert fund["note"] == "$30,000 to target · add a monthly plan"

    def test_the_latest_entry_wins(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000, monthly_plan=500)
        insert_fund_entry(fund_id, "2026-06-01", 10000)
        insert_fund_entry(fund_id, "2026-04-01", 8000)
        insert_fund_entry(fund_id, "2026-05-01", 9000)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 10000

    def test_same_day_entries_break_the_tie_by_insertion_order(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000)
        insert_fund_entry(fund_id, "2026-06-01", 10000)
        insert_fund_entry(fund_id, "2026-06-01", 10500)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 10500

    def test_an_open_ended_fund_notes_its_monthly_plan(self, client):
        fund_id = insert_fund("Travel fund", monthly_plan=300)
        insert_fund_entry(fund_id, "2026-06-01", 4200)
        (fund,) = client.get("/api/funds").json()
        assert fund["note"] == "$300 / mo · open-ended"


class TestCreateFund:
    def test_a_blank_target_date_creates_a_sinking_fund(self, client):
        response = client.post(
            "/api/funds",
            json={"name": "House maintenance", "target_amount": 30000, "monthly_plan": 180},
        )
        assert response.status_code == 201
        fund = response.json()
        assert fund["name"] == "House maintenance"
        assert fund["kind"] == "sinking"
        assert fund["target_amount"] == 30000
        assert fund["target_date"] is None
        assert fund["monthly_plan"] == 180
        assert fund["balance"] == 0

    def test_a_target_date_creates_a_goal(self, client):
        response = client.post(
            "/api/funds",
            json={"name": "Pool fund", "target_amount": 14000, "target_date": "2027-08-01"},
        )
        assert response.status_code == 201
        fund = response.json()
        assert fund["kind"] == "goal"
        assert fund["target_date"] == "2027-08-01"

    def test_a_blank_target_creates_an_open_ended_fund(self, client):
        response = client.post("/api/funds", json={"name": "Travel fund", "monthly_plan": 300})
        assert response.status_code == 201
        fund = response.json()
        assert fund["kind"] == "sinking"
        assert fund["target_amount"] is None
        assert fund["note"] == "$300 / mo · open-ended"

    def test_the_created_fund_shows_up_in_the_listing(self, client):
        created = client.post("/api/funds", json={"name": "Bike fund"}).json()
        listed = client.get("/api/funds").json()
        assert [fund["id"] for fund in listed] == [created["id"]]

    def test_creating_a_fund_appends_an_anchor_entry(self, client):
        # A fund's history starts at creation: the zero entry anchors the
        # monthly-plan catch-up even before any saved amount is posted.
        response = client.post("/api/funds", json={"name": "Travel fund", "monthly_plan": 300})
        fund_id = response.json()["id"]
        assert fetch_fund_entries(fund_id) == [(date.today().isoformat(), 0, 0)]

    def test_persists_the_emoji(self, client):
        response = client.post("/api/funds", json={"name": "Pool fund", "emoji": "🏊"})
        assert response.status_code == 201
        assert response.json()["emoji"] == "🏊"
        (fund,) = client.get("/api/funds").json()
        assert fund["emoji"] == "🏊"

    def test_an_omitted_emoji_is_null(self, client):
        response = client.post("/api/funds", json={"name": "Pool fund"})
        assert response.status_code == 201
        assert response.json()["emoji"] is None

    def test_rejects_a_non_positive_target(self, client):
        response = client.post("/api/funds", json={"name": "Bad fund", "target_amount": 0})
        assert response.status_code == 422

    def test_rejects_a_negative_monthly_plan(self, client):
        response = client.post("/api/funds", json={"name": "Bad fund", "monthly_plan": -5})
        assert response.status_code == 422

    def test_rejects_a_blank_name(self, client):
        response = client.post("/api/funds", json={"name": ""})
        assert response.status_code == 422


class TestCreateFundEntry:
    def test_appends_a_dated_balance_row(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000)
        response = client.post(
            "/api/fund-entries",
            json={"fund_id": fund_id, "as_of_date": "2026-06-01", "balance": 10000},
        )
        assert response.status_code == 201
        entry = response.json()
        assert entry["fund_id"] == fund_id
        assert entry["as_of_date"] == "2026-06-01"
        assert entry["balance"] == 10000
        assert entry["contribution"] == 0

    def test_a_later_entry_becomes_the_balance_and_history_is_kept(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000)
        client.post(
            "/api/fund-entries",
            json={"fund_id": fund_id, "as_of_date": "2026-05-01", "balance": 9000},
        )
        client.post(
            "/api/fund-entries",
            json={
                "fund_id": fund_id,
                "as_of_date": "2026-06-01",
                "balance": 10000,
                "contribution": 1000,
            },
        )
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 10000
        conn = connect()
        try:
            (count,) = conn.execute(
                "SELECT COUNT(*) FROM fund_entry WHERE fund_id = ?", (fund_id,)
            ).fetchone()
        finally:
            conn.close()
        assert count == 2

    def test_an_unknown_fund_is_a_404(self, client):
        response = client.post(
            "/api/fund-entries",
            json={"fund_id": 999, "as_of_date": "2026-06-01", "balance": 10000},
        )
        assert response.status_code == 404

    def test_rejects_a_negative_balance(self, client):
        fund_id = insert_fund("Emergency fund")
        response = client.post(
            "/api/fund-entries",
            json={"fund_id": fund_id, "as_of_date": "2026-06-01", "balance": -1},
        )
        assert response.status_code == 422


class TestArchiveFund:
    def test_archives_the_fund_out_of_the_listing(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000)
        insert_fund_entry(fund_id, "2026-06-01", 10000)
        response = client.post(f"/api/funds/{fund_id}/archive")
        assert response.status_code == 200
        assert client.get("/api/funds").json() == []

    def test_returns_the_archived_fund_with_a_zero_balance(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000)
        insert_fund_entry(fund_id, "2026-06-01", 10000)
        response = client.post(f"/api/funds/{fund_id}/archive")
        assert response.status_code == 200
        fund = response.json()
        assert fund["id"] == fund_id
        assert fund["balance"] == 0

    def test_appends_a_zeroing_entry_at_archive_time(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000)
        insert_fund_entry(fund_id, "2026-06-01", 10000)
        client.post(f"/api/funds/{fund_id}/archive")
        assert fetch_fund_entries(fund_id) == [
            ("2026-06-01", 10000, 0),
            (date.today().isoformat(), 0, 0),
        ]

    def test_a_zero_balance_fund_gets_no_zeroing_entry(self, client):
        fund_id = insert_fund("Travel fund")
        response = client.post(f"/api/funds/{fund_id}/archive")
        assert response.status_code == 200
        assert fetch_fund_entries(fund_id) == []

    def test_archiving_twice_is_idempotent(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000)
        insert_fund_entry(fund_id, "2026-06-01", 10000)
        client.post(f"/api/funds/{fund_id}/archive")
        response = client.post(f"/api/funds/{fund_id}/archive")
        assert response.status_code == 200
        assert fetch_fund_entries(fund_id) == [
            ("2026-06-01", 10000, 0),
            (date.today().isoformat(), 0, 0),
        ]

    def test_an_unknown_fund_is_a_404(self, client):
        response = client.post("/api/funds/999/archive")
        assert response.status_code == 404
