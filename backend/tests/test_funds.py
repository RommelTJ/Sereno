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


def insert_fund_entry(fund_id, as_of_date, balance, contribution=0, source=None):
    conn = connect()
    try:
        cursor = conn.execute(
            "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
            " VALUES (?, ?, ?, ?, ?)",
            (fund_id, as_of_date, balance, contribution, source),
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def first_of_month(months_back=0):
    """The 1st of the month months_back before today, ISO — catch-up tests
    date entries relative to the wall clock so they can't drift stale."""
    today = date.today()
    year, month = today.year, today.month - months_back
    while month < 1:
        year, month = year - 1, month + 12
    return date(year, month, 1).isoformat()


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


def fetch_fund_entries_with_source(fund_id):
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT as_of_date, balance, contribution, source FROM fund_entry"
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
        # Entries dated this month's 1st: the monthly-plan catch-up has
        # nothing further due, so the listed balances stay put.
        insert_fund_entry(emergency_id, first_of_month(), 10000)
        insert_fund_entry(pool_id, first_of_month(), 14000)
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
        fund_id = insert_fund("Emergency fund", target_amount=30000)
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
        insert_fund_entry(fund_id, first_of_month(), 4200)
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


class TestMonthlyPlanCatchUp:
    def test_a_read_applies_the_missed_contribution(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000, monthly_plan=500)
        insert_fund_entry(fund_id, first_of_month(1), 10000)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 10500
        assert fetch_fund_entries_with_source(fund_id) == [
            (first_of_month(1), 10000, 0, None),
            (first_of_month(0), 10500, 500, "monthly_plan"),
        ]

    def test_a_second_read_appends_nothing(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000, monthly_plan=500)
        insert_fund_entry(fund_id, first_of_month(1), 10000)
        client.get("/api/funds")
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 10500
        assert len(fetch_fund_entries_with_source(fund_id)) == 2

    def test_every_missed_month_catches_up(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000, monthly_plan=100)
        insert_fund_entry(fund_id, first_of_month(3), 1000)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 1300
        assert fetch_fund_entries_with_source(fund_id) == [
            (first_of_month(3), 1000, 0, None),
            (first_of_month(2), 1100, 100, "monthly_plan"),
            (first_of_month(1), 1200, 100, "monthly_plan"),
            (first_of_month(0), 1300, 100, "monthly_plan"),
        ]

    def test_a_fund_without_a_plan_is_untouched(self, client):
        fund_id = insert_fund("Pool fund", target_amount=14000)
        insert_fund_entry(fund_id, first_of_month(1), 5000)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 5000
        assert len(fetch_fund_entries_with_source(fund_id)) == 1

    def test_an_archived_fund_is_untouched(self, client):
        fund_id = insert_fund("Old fund", monthly_plan=500, active=0)
        insert_fund_entry(fund_id, first_of_month(1), 1000)
        assert client.get("/api/funds").json() == []
        assert len(fetch_fund_entries_with_source(fund_id)) == 1

    def test_a_drawdown_on_the_first_does_not_hide_the_due_contribution(self, client):
        # The spend entry is not a contribution: the schedule anchors on the
        # latest planned or hand-entered row, while the appended balance
        # still builds on the drawdown the spend left behind.
        fund_id = insert_fund("Emergency fund", target_amount=30000, monthly_plan=500)
        insert_fund_entry(fund_id, first_of_month(1), 1000)
        insert_fund_entry(fund_id, first_of_month(0), 800, contribution=-200, source="spend")
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 1300
        assert fetch_fund_entries_with_source(fund_id)[-1] == (
            first_of_month(0),
            1300,
            500,
            "monthly_plan",
        )

    def test_a_fund_with_no_entries_is_skipped(self, client):
        # Direct SQL can create an entry-less fund; with no anchor there is
        # no schedule to catch up. Funds created through the API always
        # carry their creation anchor entry.
        insert_fund("Bare fund", monthly_plan=500)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 0
        assert fetch_fund_entries_with_source(fund["id"]) == []

    def test_a_fund_at_target_receives_no_contribution(self, client):
        # A fully funded goal stops parking money: the plan suspends at the
        # target instead of contributing forever.
        fund_id = insert_fund("Emergency fund", target_amount=10000, monthly_plan=500)
        insert_fund_entry(fund_id, first_of_month(1), 10000)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 10000
        assert len(fetch_fund_entries_with_source(fund_id)) == 1

    def test_a_fund_above_target_receives_no_contribution(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=10000, monthly_plan=500)
        insert_fund_entry(fund_id, first_of_month(1), 12000)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 12000
        assert len(fetch_fund_entries_with_source(fund_id)) == 1

    def test_the_final_contribution_caps_at_the_remaining_amount(self, client):
        # The fund lands exactly on target, never past it — "fully funded"
        # means exactly funded, and no extra money gets parked.
        fund_id = insert_fund("Emergency fund", target_amount=10000, monthly_plan=500)
        insert_fund_entry(fund_id, first_of_month(1), 9800)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 10000
        assert fetch_fund_entries_with_source(fund_id) == [
            (first_of_month(1), 9800, 0, None),
            (first_of_month(0), 10000, 200, "monthly_plan"),
        ]

    def test_the_catch_up_stops_once_the_target_is_reached(self, client):
        # A multi-month catch-up caps the crossing month and appends nothing
        # for the months after it.
        fund_id = insert_fund("Emergency fund", target_amount=1150, monthly_plan=100)
        insert_fund_entry(fund_id, first_of_month(3), 1000)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 1150
        assert fetch_fund_entries_with_source(fund_id) == [
            (first_of_month(3), 1000, 0, None),
            (first_of_month(2), 1100, 100, "monthly_plan"),
            (first_of_month(1), 1150, 50, "monthly_plan"),
        ]

    def test_an_open_ended_fund_keeps_funding(self, client):
        # No target means no finish line: the stop never applies to an
        # open-ended fund.
        fund_id = insert_fund("Travel fund", monthly_plan=300)
        insert_fund_entry(fund_id, first_of_month(1), 4200)
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 4500
        assert fetch_fund_entries_with_source(fund_id)[-1] == (
            first_of_month(0),
            4500,
            300,
            "monthly_plan",
        )

    def test_a_drawdown_after_months_at_target_resumes_funding_forward(self, client):
        # Months spent at target are forgiven, not owed: after a drawdown
        # the plan resumes from the drawdown month forward at its normal
        # pace. Backfilling the quiet months would date contribution rows
        # before the spend row, where the date-ordered balance query never
        # sees them — charged to past budget months, invisible in the fund.
        fund_id = insert_fund("Emergency fund", target_amount=10000, monthly_plan=500)
        insert_fund_entry(fund_id, first_of_month(3), 10000)
        insert_fund_entry(fund_id, first_of_month(0), 9000, contribution=-1000, source="spend")
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 9500
        assert fetch_fund_entries_with_source(fund_id) == [
            (first_of_month(3), 10000, 0, None),
            (first_of_month(0), 9000, -1000, "spend"),
            (first_of_month(0), 9500, 500, "monthly_plan"),
        ]


class TestUpdateFund:
    def test_revises_the_monthly_plan_in_place(self, client):
        fund_id = insert_fund("Emergency fund", target_amount=30000, monthly_plan=500)
        insert_fund_entry(fund_id, first_of_month(), 10000)
        response = client.put(f"/api/funds/{fund_id}", json={"monthly_plan": 1000})
        assert response.status_code == 200
        fund = response.json()
        assert fund["id"] == fund_id
        assert fund["monthly_plan"] == 1000
        assert fund["note"] == "$1,000 / mo · ~1.7 yrs to target"
        (listed,) = client.get("/api/funds").json()
        assert listed["monthly_plan"] == 1000

    def test_a_null_plan_pauses_the_fund(self, client):
        # Setting the plan to blank pauses funding without archiving: the
        # fund keeps its balance and drops out of the monthly catch-up.
        fund_id = insert_fund("Emergency fund", target_amount=30000, monthly_plan=500)
        insert_fund_entry(fund_id, first_of_month(1), 10000)
        response = client.put(f"/api/funds/{fund_id}", json={"monthly_plan": None})
        assert response.status_code == 200
        assert response.json()["monthly_plan"] is None
        (fund,) = client.get("/api/funds").json()
        assert fund["balance"] == 10000
        assert len(fetch_fund_entries_with_source(fund_id)) == 1

    def test_a_zero_plan_is_stored_as_null(self, client):
        # 0 and blank both mean "no plan": normalizing keeps "$0 / mo" from
        # ever rendering and makes pause a single state.
        fund_id = insert_fund("Travel fund", monthly_plan=300)
        insert_fund_entry(fund_id, first_of_month(), 4200)
        response = client.put(f"/api/funds/{fund_id}", json={"monthly_plan": 0})
        assert response.status_code == 200
        assert response.json()["monthly_plan"] is None

    def test_the_entry_history_is_untouched(self, client):
        # The fund row is a dimension, like a category rename: revising the
        # plan never touches the append-only fund_entry history.
        fund_id = insert_fund("Emergency fund", target_amount=30000, monthly_plan=500)
        insert_fund_entry(fund_id, first_of_month(), 10000)
        client.put(f"/api/funds/{fund_id}", json={"monthly_plan": 250})
        assert fetch_fund_entries_with_source(fund_id) == [
            (first_of_month(), 10000, 0, None),
        ]

    def test_rejects_a_negative_plan(self, client):
        fund_id = insert_fund("Emergency fund", monthly_plan=500)
        response = client.put(f"/api/funds/{fund_id}", json={"monthly_plan": -5})
        assert response.status_code == 422

    def test_an_unknown_fund_is_a_404(self, client):
        response = client.put("/api/funds/999", json={"monthly_plan": 100})
        assert response.status_code == 404


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
