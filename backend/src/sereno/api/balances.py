"""Balances and net worth: accounts, append-only balance entries, ledger, net worth.

All reads go through the SQL views (v_account_monthly, v_net_worth) so the
"latest entry in a month wins" rule lives in one place — the schema.
"""

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from sereno.db.connection import get_db

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]


class Account(BaseModel):
    id: int
    name: str
    kind: str
    tax_treatment: str
    owner: str | None
    is_liability: bool
    is_investable: bool
    active: bool


@router.get("/accounts")
def list_accounts(db: Db) -> list[Account]:
    rows = db.execute(
        "SELECT id, name, kind, tax_treatment, owner, is_liability, is_investable, active"
        " FROM account ORDER BY id"
    )
    return [Account(**dict(row)) for row in rows]
