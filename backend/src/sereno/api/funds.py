"""The funds & goals slice: sinking funds and dated goals as one concept.

Each fund carries its latest balance from fund_entry (append-only, like
balance_entry) and a note derived from its own numbers — never hand-typed.
"""

import sqlite3
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, NonNegativeFloat, PositiveFloat

from sereno.db.connection import get_db
from sereno.engine.funds import derive_note

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]


class Fund(BaseModel):
    id: int
    name: str
    emoji: str | None
    kind: str
    target_amount: float | None
    target_date: str | None
    monthly_plan: float | None
    balance: float
    note: str


def _fund(row: sqlite3.Row) -> Fund:
    fields = dict(row)
    return Fund(
        **fields,
        note=derive_note(
            target_amount=fields["target_amount"],
            target_date=fields["target_date"],
            monthly_plan=fields["monthly_plan"],
            balance=fields["balance"],
            today=date.today(),
        ),
    )


class FundCreate(BaseModel):
    """kind is derived, never sent: a blank target_date means a sinking fund,
    a set date means a goal. A blank target_amount is an open-ended fund."""

    name: str = Field(min_length=1)
    emoji: str | None = None
    target_amount: PositiveFloat | None = None
    target_date: date | None = None
    monthly_plan: NonNegativeFloat | None = None


class FundEntryCreate(BaseModel):
    fund_id: int
    as_of_date: date
    balance: NonNegativeFloat
    contribution: float = 0


class FundEntry(BaseModel):
    """source tells entry kinds apart: 'spend' for the drawdown behind a
    fund-funded expense, 'monthly_plan' for an automatic contribution,
    None for a hand-entered row (the only kind this endpoint appends)."""

    id: int
    fund_id: int
    as_of_date: date
    balance: float
    contribution: float
    source: str | None


_FUND_QUERY = (
    "SELECT id, name, emoji, kind, target_amount, target_date, monthly_plan,"
    " COALESCE((SELECT e.balance FROM fund_entry e WHERE e.fund_id = fund.id"
    "           ORDER BY e.as_of_date DESC, e.id DESC LIMIT 1), 0) AS balance"
    " FROM fund"
)


@router.get("/funds")
def list_funds(db: Db) -> list[Fund]:
    rows = db.execute(_FUND_QUERY + " WHERE active = 1 ORDER BY id")
    return [_fund(row) for row in rows]


@router.post("/funds", status_code=201)
def create_fund(fund: FundCreate, db: Db) -> Fund:
    cursor = db.execute(
        "INSERT INTO fund (name, emoji, kind, target_amount, target_date, monthly_plan)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (
            fund.name,
            fund.emoji,
            "goal" if fund.target_date else "sinking",
            fund.target_amount,
            fund.target_date.isoformat() if fund.target_date else None,
            fund.monthly_plan,
        ),
    )
    # The zero entry anchors the fund's history at creation, the way a new
    # account gets its first balance_entry — the monthly-plan catch-up dates
    # its contributions from here even before any saved amount is posted.
    db.execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance) VALUES (?, ?, 0)",
        (cursor.lastrowid, date.today().isoformat()),
    )
    db.commit()
    row = db.execute(_FUND_QUERY + " WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _fund(row)


@router.post("/funds/{fund_id}/archive")
def archive_fund(fund_id: int, db: Db) -> Fund:
    """Soft remove, like envelope archiving: the fund drops out of listings
    (GET /api/funds filters on active), while past expense lines keep their
    fund_id. A final zeroing entry — skipped when the balance is already
    zero, so archiving twice appends nothing — releases the parked balance
    back to spendable without breaking the append-only history."""
    row = db.execute(_FUND_QUERY + " WHERE id = ?", (fund_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="fund not found")
    if row["balance"] != 0:
        db.execute(
            "INSERT INTO fund_entry (fund_id, as_of_date, balance) VALUES (?, ?, 0)",
            (fund_id, date.today().isoformat()),
        )
    db.execute("UPDATE fund SET active = 0 WHERE id = ?", (fund_id,))
    db.commit()
    row = db.execute(_FUND_QUERY + " WHERE id = ?", (fund_id,)).fetchone()
    return _fund(row)


@router.post("/fund-entries", status_code=201)
def create_fund_entry(entry: FundEntryCreate, db: Db) -> FundEntry:
    if db.execute("SELECT 1 FROM fund WHERE id = ?", (entry.fund_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="fund not found")
    cursor = db.execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution) VALUES (?, ?, ?, ?)",
        (entry.fund_id, entry.as_of_date.isoformat(), entry.balance, entry.contribution),
    )
    db.commit()
    row = db.execute(
        "SELECT id, fund_id, as_of_date, balance, contribution, source"
        " FROM fund_entry WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return FundEntry(**dict(row))
