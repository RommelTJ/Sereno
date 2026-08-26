"""The spend band slice: the age-banded schedule as versioned config.

A save is a version — a spend_band_version row with the band rows
hanging off it — and GET resolves the latest version effective on or
before today, ties broken by insertion order, like every other config
read. An empty list means "no schedule": unconfigured and cleared read
the same, because both mean flat spending at the plan's annual_target.
"""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from sereno.db.connection import connect
from sereno.main import app

TODAY = date.today()
BIRTH_YEAR = 1988  # the sanitized birthdate constant the planners share


def days_ago(days):
    return (TODAY - timedelta(days=days)).isoformat()


def days_ahead(days):
    return (TODAY + timedelta(days=days)).isoformat()


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SERENO_DB_PATH", str(tmp_path / "sereno.db"))
    with TestClient(app) as client:
        yield client


def execute(sql, params):
    conn = connect()
    try:
        cursor = conn.execute(sql, params)
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def count_rows(table):
    conn = connect()
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: S608
    finally:
        conn.close()


def insert_version(effective_date):
    return execute("INSERT INTO spend_band_version (effective_date) VALUES (?)", (effective_date,))


def insert_band(version_id, start_year, end_year=None, annual_amount=55_000, note=None):
    return execute(
        "INSERT INTO spend_band (version_id, start_year, end_year, annual_amount, note)"
        " VALUES (?, ?, ?, ?, ?)",
        (version_id, start_year, end_year, annual_amount, note),
    )


def band(start_year, end_year=None, annual_amount=55_000, note=None):
    return {
        "start_year": start_year,
        "end_year": end_year,
        "annual_amount": annual_amount,
        "note": note,
    }


def post_bands(client, bands, effective_date=None):
    return client.post(
        "/api/spend-bands",
        json={"effective_date": effective_date or TODAY.isoformat(), "bands": bands},
    )


def test_returns_empty_list_when_nothing_saved(client):
    response = client.get("/api/spend-bands")
    assert response.status_code == 200
    assert response.json() == []


def test_post_creates_a_version_and_returns_its_rows_ordered(client):
    response = post_bands(
        client,
        [
            band(2045, annual_amount=38_000),
            band(2030, 2044, note="peak travel years"),
        ],
    )
    assert response.status_code == 201
    rows = response.json()
    assert [
        (row["start_year"], row["end_year"], row["annual_amount"], row["note"]) for row in rows
    ] == [
        (2030, 2044, 55_000, "peak travel years"),
        (2045, None, 38_000, None),
    ]
    assert all(row["id"] for row in rows)
    assert client.get("/api/spend-bands").json() == rows


def test_get_resolves_the_latest_effective_version(client):
    old = insert_version(days_ago(30))
    insert_band(old, 2030, 2044, annual_amount=60_000)
    assert post_bands(client, [band(2032, 2040)]).status_code == 201
    rows = client.get("/api/spend-bands").json()
    assert [(row["start_year"], row["end_year"]) for row in rows] == [(2032, 2040)]


def test_future_dated_versions_stay_staged(client):
    assert post_bands(client, [band(2030, 2044)]).status_code == 201
    staged = insert_version(days_ahead(30))
    insert_band(staged, 2050, annual_amount=30_000)
    rows = client.get("/api/spend-bands").json()
    assert [(row["start_year"], row["end_year"]) for row in rows] == [(2030, 2044)]


def test_same_day_second_save_wins(client):
    assert post_bands(client, [band(2030, 2044)]).status_code == 201
    assert post_bands(client, [band(2035, 2050, annual_amount=48_000)]).status_code == 201
    rows = client.get("/api/spend-bands").json()
    assert [(row["start_year"], row["end_year"], row["annual_amount"]) for row in rows] == [
        (2035, 2050, 48_000)
    ]


def test_empty_save_clears_the_schedule(client):
    assert post_bands(client, [band(2030, 2044)]).status_code == 201
    response = post_bands(client, [])
    assert response.status_code == 201
    assert response.json() == []
    assert client.get("/api/spend-bands").json() == []


def test_overlapping_bands_are_rejected_naming_both(client):
    response = post_bands(client, [band(2031, 2040), band(2035)])
    assert response.status_code == 422
    assert response.json()["detail"] == "bands 2031-2040 and 2035+ overlap"
    # The rejected save writes nothing — not even the version row.
    assert count_rows("spend_band_version") == 0
    assert count_rows("spend_band") == 0
    # Inclusive ends: adjacent bands do not overlap.
    assert post_bands(client, [band(2030, 2034), band(2035, 2040)]).status_code == 201


def test_a_band_ending_before_it_starts_is_rejected(client):
    response = post_bands(client, [band(2040, 2030)])
    assert response.status_code == 422
    assert response.json()["detail"] == "band 2040-2030 ends before it starts"


def test_negative_amounts_are_rejected(client):
    assert post_bands(client, [band(2030, 2044, annual_amount=-1)]).status_code == 422


def test_a_band_entirely_in_the_past_is_rejected(client):
    start, end = TODAY.year - 7, TODAY.year - 3
    response = post_bands(client, [band(start, end)])
    assert response.status_code == 422
    assert response.json()["detail"] == f"band {start}-{end} is in the past"
    # A band that started in the past but still covers this year is a
    # legitimate schedule aging forward, not an error.
    assert post_bands(client, [band(TODAY.year - 5, TODAY.year)]).status_code == 201


def test_a_band_starting_beyond_age_100_is_rejected(client):
    beyond = BIRTH_YEAR + 101
    response = post_bands(client, [band(beyond)])
    assert response.status_code == 422
    assert response.json()["detail"] == f"band {beyond}+ falls beyond age 100"
    assert post_bands(client, [band(BIRTH_YEAR + 100)]).status_code == 201
