from datetime import date

import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import connect
from sereno.main import app
from sereno.money import to_cents


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SERENO_DB_PATH", str(tmp_path / "sereno.db"))
    with TestClient(app) as client:
        yield client


# Dollars in, cents stored — the same boundary the API keeps, so test
# bodies stay in the dollars the JSON contract speaks.
def execute(sql, *params):
    conn = connect()
    try:
        cursor = conn.execute(sql, params)
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def insert_fund(name, emoji=None, active=1):
    return execute(
        "INSERT INTO fund (name, emoji, kind, active) VALUES (?, ?, 'sinking', ?)",
        name,
        emoji,
        active,
    )


def insert_entry(fund_id, as_of_date, balance, source=None, expense_id=None, income_id=None):
    return execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, source, expense_id, income_id)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        fund_id,
        as_of_date,
        to_cents(balance),
        source,
        expense_id,
        income_id,
    )


def insert_category(name):
    return execute("INSERT INTO category (name) VALUES (?)", name)


def insert_expense(fund_id, amount, note=None, category_id=None, txn_date="2026-06-10"):
    return execute(
        "INSERT INTO expense_line (txn_date, budget_month, category_id, amount,"
        " funded_from, fund_id, note) VALUES (?, ?, ?, ?, 'fund', ?, ?)",
        txn_date,
        txn_date[:7],
        category_id,
        to_cents(amount),
        fund_id,
        note,
    )


def insert_income(fund_id, amount, source="transfer_in", source_label=None, note=None):
    return execute(
        "INSERT INTO income_event (txn_date, budget_month, source, amount, source_label,"
        " note, drawn_from_fund_id) VALUES ('2026-06-01', '2026-06', ?, ?, ?, ?, ?)",
        source,
        to_cents(amount),
        source_label,
        note,
        fund_id,
    )


def fund_log(client, **params):
    response = client.get("/api/fund-entries", params=params)
    assert response.status_code == 200
    return response.json()


class TestFundLog:
    def test_returns_the_months_entries_newest_first(self, client):
        car_id = insert_fund("Car")
        insert_entry(car_id, "2026-05-20", 1000, "top_up")
        june_first = insert_entry(car_id, "2026-06-01", 1200, "top_up")
        june_later = insert_entry(car_id, "2026-06-15", 1100, "spend")
        insert_entry(car_id, "2026-07-01", 1300, "top_up")
        entries = fund_log(client, month="2026-06")
        assert [entry["id"] for entry in entries] == [june_later, june_first]

    def test_same_day_entries_order_by_id(self, client):
        car_id = insert_fund("Car")
        first = insert_entry(car_id, "2026-06-01", 1200, "top_up")
        second = insert_entry(car_id, "2026-06-01", 1100, "spend")
        assert [entry["id"] for entry in fund_log(client, month="2026-06")] == [second, first]

    def test_the_month_defaults_to_the_current_one(self, client):
        car_id = insert_fund("Car")
        today = insert_entry(car_id, date.today().isoformat(), 500, "top_up")
        assert [entry["id"] for entry in fund_log(client)] == [today]

    def test_each_entry_carries_its_fund_date_source_and_balance(self, client):
        car_id = insert_fund("1st Year Fund", emoji="🛟")
        insert_entry(car_id, "2026-06-01", 1200, "top_up")
        [entry] = fund_log(client, month="2026-06")
        assert entry["fund"] == {
            "id": car_id,
            "name": "1st Year Fund",
            "emoji": "🛟",
            "archived": False,
        }
        assert entry["as_of_date"] == "2026-06-01"
        assert entry["source"] == "top_up"
        assert entry["balance"] == 1200

    def test_the_delta_comes_from_the_funds_previous_snapshot(self, client):
        # The previous snapshot can sit in an earlier month, and another
        # fund's entries in between never count.
        car_id = insert_fund("Car")
        bike_id = insert_fund("Bike")
        insert_entry(car_id, "2026-05-20", 1000, "top_up")
        insert_entry(bike_id, "2026-06-02", 9000, "top_up")
        insert_entry(car_id, "2026-06-03", 967.8, "spend")
        entries = fund_log(client, month="2026-06", fund_id=car_id)
        assert [entry["delta"] for entry in entries] == [-32.2]

    def test_a_funds_first_entry_moves_it_by_its_whole_balance(self, client):
        car_id = insert_fund("Car")
        insert_entry(car_id, "2026-06-01", 1200)
        assert [entry["delta"] for entry in fund_log(client, month="2026-06")] == [1200]

    def test_entries_that_move_nothing_are_hidden(self, client):
        # A new fund's opening $0 row and a restatement to the same balance
        # carry no information worth a log line.
        car_id = insert_fund("Car")
        insert_entry(car_id, "2026-06-01", 0)
        moved = insert_entry(car_id, "2026-06-02", 500, "top_up")
        insert_entry(car_id, "2026-06-03", 500)
        assert [entry["id"] for entry in fund_log(client, month="2026-06")] == [moved]

    def test_monthly_contributions_are_left_out_of_the_unfiltered_log(self, client):
        car_id = insert_fund("Car")
        insert_entry(car_id, "2026-06-01", 500, "monthly_plan")
        top_up = insert_entry(car_id, "2026-06-02", 700, "top_up")
        assert [entry["id"] for entry in fund_log(client, month="2026-06")] == [top_up]

    def test_filtering_to_a_fund_keeps_its_monthly_contributions(self, client):
        car_id = insert_fund("Car")
        bike_id = insert_fund("Bike")
        plan = insert_entry(car_id, "2026-06-01", 500, "monthly_plan")
        insert_entry(bike_id, "2026-06-01", 300, "top_up")
        entries = fund_log(client, month="2026-06", fund_id=car_id)
        assert [entry["id"] for entry in entries] == [plan]

    def test_archived_funds_entries_are_included_and_marked(self, client):
        old_id = insert_fund("Old car", active=0)
        insert_entry(old_id, "2026-06-01", 500, "top_up")
        insert_entry(old_id, "2026-06-20", 0)
        entries = fund_log(client, month="2026-06")
        assert [entry["fund"]["archived"] for entry in entries] == [True, True]

    def test_an_unlinked_entry_has_no_link(self, client):
        car_id = insert_fund("Car")
        insert_entry(car_id, "2026-06-01", 1000, "top_up")
        insert_entry(car_id, "2026-06-03", 900, "spend")
        entries = fund_log(client, month="2026-06")
        assert [entry["link"] for entry in entries] == [None, None]

    def test_unlinked_true_returns_only_unlinked_spend_entries(self, client):
        car_id = insert_fund("Car")
        expense_id = insert_expense(car_id, 100, note="Tires")
        insert_entry(car_id, "2026-06-01", 1000, "top_up")
        insert_entry(car_id, "2026-06-02", 900, "spend", expense_id=expense_id)
        unlinked = insert_entry(car_id, "2026-06-03", 800, "spend")
        entries = fund_log(client, month="2026-06", unlinked="true")
        assert [entry["id"] for entry in entries] == [unlinked]

    def test_a_malformed_month_is_rejected(self, client):
        assert client.get("/api/fund-entries", params={"month": "June"}).status_code == 422


class TestFundLogLinks:
    def test_a_linked_expense_is_labelled_by_its_note(self, client):
        car_id = insert_fund("Car")
        expense_id = insert_expense(car_id, 32.2, note="The Home Depot")
        insert_entry(car_id, "2026-06-01", 1000, "top_up")
        insert_entry(car_id, "2026-06-10", 967.8, "spend", expense_id=expense_id)
        link = fund_log(client, month="2026-06")[0]["link"]
        assert link == {
            "type": "expense",
            "id": expense_id,
            "label": "The Home Depot",
            "kind": "draw",
        }

    def test_an_expense_without_a_note_falls_back_to_its_category(self, client):
        car_id = insert_fund("Car")
        expense_id = insert_expense(car_id, 50, category_id=insert_category("Auto"))
        insert_entry(car_id, "2026-06-01", 1000, "top_up")
        insert_entry(car_id, "2026-06-10", 950, "spend", expense_id=expense_id)
        assert fund_log(client, month="2026-06")[0]["link"]["label"] == "Auto"

    def test_a_linked_income_is_labelled_by_its_source_label(self, client):
        cash_id = insert_fund("1st Year Fund")
        income_id = insert_income(cash_id, 5000, source_label="September draw", note="ignored")
        insert_entry(cash_id, "2026-05-01", 60000, "top_up")
        insert_entry(cash_id, "2026-06-01", 55000, "spend", income_id=income_id)
        link = fund_log(client, month="2026-06")[0]["link"]
        assert link == {
            "type": "income",
            "id": income_id,
            "label": "September draw",
            "kind": "draw",
        }

    def test_an_income_label_falls_back_to_its_note_then_its_source(self, client):
        cash_id = insert_fund("1st Year Fund")
        noted = insert_income(cash_id, 100, note="Top-up for rent")
        bare = insert_income(cash_id, 100)
        insert_entry(cash_id, "2026-05-01", 60000, "top_up")
        insert_entry(cash_id, "2026-06-01", 59900, "spend", income_id=noted)
        insert_entry(cash_id, "2026-06-02", 59800, "spend", income_id=bare)
        labels = [entry["link"]["label"] for entry in fund_log(client, month="2026-06")]
        assert labels == ["transfer_in", "Top-up for rent"]

    def test_a_later_entry_on_the_rows_current_fund_is_an_edit(self, client):
        car_id = insert_fund("Car")
        expense_id = insert_expense(car_id, 150, note="Tires")
        insert_entry(car_id, "2026-06-01", 1000, "top_up")
        insert_entry(car_id, "2026-06-10", 900, "spend", expense_id=expense_id)
        insert_entry(car_id, "2026-06-12", 850, "spend", expense_id=expense_id)
        kinds = [entry["link"]["kind"] for entry in fund_log(client, month="2026-06")[:2]]
        assert kinds == ["edit", "draw"]

    def test_a_later_entry_on_a_fund_the_row_left_is_a_reversal(self, client):
        # The expense moved from Car to Bike: Car's draw is reversed, and
        # Bike's first entry for the row is a fresh draw.
        car_id = insert_fund("Car")
        bike_id = insert_fund("Bike")
        expense_id = insert_expense(bike_id, 100, note="Tires")
        insert_entry(car_id, "2026-06-01", 1000, "top_up")
        insert_entry(bike_id, "2026-06-01", 1000, "top_up")
        insert_entry(car_id, "2026-06-10", 900, "spend", expense_id=expense_id)
        insert_entry(car_id, "2026-06-12", 1000, "spend", expense_id=expense_id)
        insert_entry(bike_id, "2026-06-12", 900, "spend", expense_id=expense_id)
        entries = fund_log(client, month="2026-06")
        kinds = [(entry["fund"]["name"], entry["link"]["kind"]) for entry in entries[:3]]
        assert kinds == [("Bike", "draw"), ("Car", "reversal"), ("Car", "draw")]
