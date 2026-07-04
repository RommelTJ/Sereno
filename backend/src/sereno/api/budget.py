"""Budget facts: categories with planned envelopes, append-only expense and
income entry, and the computed budget month powering Safe-to-spend.

The Safe-to-spend baseline is funded_in from v_budget_month — the sum of the
month's stored income events. It moves only when a funding row is appended,
never when spending lands, so safe_to_spend = funded_in − total_spent.
"""

import sqlite3
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from sereno.db.connection import get_db

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]
Month = Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")]


def _current_month() -> str:
    return date.today().strftime("%Y-%m")


class Category(BaseModel):
    id: int
    name: str
    emoji: str | None
    is_fixed: bool
    planned: float


@router.get("/categories")
def list_categories(db: Db, month: Month = None) -> list[Category]:
    rows = db.execute(
        "SELECT c.id, c.name, c.emoji, c.is_fixed,"
        " COALESCE((SELECT p.planned FROM category_plan p"
        "           WHERE p.category_id = c.id AND p.effective_month <= ?"
        "           ORDER BY p.effective_month DESC LIMIT 1), 0) AS planned"
        " FROM category c WHERE c.active = 1 ORDER BY c.id",
        (month or _current_month(),),
    )
    return [Category(**dict(row)) for row in rows]
