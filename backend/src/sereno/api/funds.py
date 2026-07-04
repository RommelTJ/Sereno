"""The funds & goals slice: sinking funds and dated goals as one concept.

Each fund carries its latest balance from fund_entry (append-only, like
balance_entry) and a note derived from its own numbers — never hand-typed.
"""

import sqlite3
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

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


@router.get("/funds")
def list_funds(db: Db) -> list[Fund]:
    rows = db.execute(
        "SELECT id, name, kind, target_amount, target_date, monthly_plan,"
        " COALESCE((SELECT e.balance FROM fund_entry e WHERE e.fund_id = fund.id"
        "           ORDER BY e.as_of_date DESC, e.id DESC LIMIT 1), 0) AS balance"
        " FROM fund WHERE active = 1 ORDER BY id"
    )
    return [_fund(row) for row in rows]
