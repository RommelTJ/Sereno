"""Fund dimension listing: the active sinking funds and goals.

Read-only for now — the Safe-to-spend screen needs fund ids for
funded_from='fund' spending. The Funds & goals slice (#15) extends this
with latest balances from fund_entry and the POST endpoints.
"""

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from sereno.db.connection import get_db

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]


class Fund(BaseModel):
    id: int
    name: str
    kind: str
    target_amount: float | None
    target_date: str | None
    monthly_plan: float | None


@router.get("/funds")
def list_funds(db: Db) -> list[Fund]:
    rows = db.execute(
        "SELECT id, name, kind, target_amount, target_date, monthly_plan"
        " FROM fund WHERE active = 1 ORDER BY id"
    )
    return [Fund(**dict(row)) for row in rows]
