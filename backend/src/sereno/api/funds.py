"""The funds & goals slice: sinking funds and dated goals as one concept.

Each fund carries its latest balance from fund_entry (append-only, like
balance_entry) and a note derived from its own numbers — never hand-typed.
"""

import sqlite3
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, NonNegativeFloat, PositiveFloat

from sereno.db.connection import get_db
from sereno.engine.funds import derive_note

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]


class Fund(BaseModel):
    id: int
    name: str
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
    target_amount: PositiveFloat | None = None
    target_date: date | None = None
    monthly_plan: NonNegativeFloat | None = None


_FUND_QUERY = (
    "SELECT id, name, kind, target_amount, target_date, monthly_plan,"
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
        "INSERT INTO fund (name, kind, target_amount, target_date, monthly_plan)"
        " VALUES (?, ?, ?, ?, ?)",
        (
            fund.name,
            "goal" if fund.target_date else "sinking",
            fund.target_amount,
            fund.target_date.isoformat() if fund.target_date else None,
            fund.monthly_plan,
        ),
    )
    db.commit()
    row = db.execute(_FUND_QUERY + " WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _fund(row)
