"""Balances and net worth: accounts, append-only balance entries, ledger, net worth.

All reads go through the SQL views (v_account_monthly, v_net_worth) so the
"latest entry in a month wins" rule lives in one place — the schema.
"""

import sqlite3
from datetime import date, datetime
from typing import Annotated, Self

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator

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


class BalanceEntryCreate(BaseModel):
    """Either balance_usd alone (USD accounts), or quantity + unit_price (ETH-style,
    balance_usd derived server-side as quantity × unit_price)."""

    account_id: int
    as_of_date: date
    balance_usd: float | None = None
    quantity: float | None = None
    unit_price: float | None = None

    @model_validator(mode="after")
    def one_form_only(self) -> Self:
        has_pair = self.quantity is not None and self.unit_price is not None
        if (self.quantity is None) != (self.unit_price is None):
            raise ValueError("quantity and unit_price must be provided together")
        if has_pair == (self.balance_usd is not None):
            raise ValueError("provide either balance_usd or quantity + unit_price")
        return self


class BalanceEntry(BaseModel):
    id: int
    account_id: int
    as_of_date: date
    balance_usd: float
    quantity: float | None
    unit_price: float | None
    created_at: datetime


@router.get("/accounts")
def list_accounts(db: Db) -> list[Account]:
    rows = db.execute(
        "SELECT id, name, kind, tax_treatment, owner, is_liability, is_investable, active"
        " FROM account ORDER BY id"
    )
    return [Account(**dict(row)) for row in rows]


@router.post("/balance-entries", status_code=201)
def create_balance_entry(entry: BalanceEntryCreate, db: Db) -> BalanceEntry:
    if db.execute("SELECT 1 FROM account WHERE id = ?", (entry.account_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="account not found")
    balance_usd = (
        entry.quantity * entry.unit_price
        if entry.quantity is not None and entry.unit_price is not None
        else entry.balance_usd
    )
    cursor = db.execute(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd, quantity, unit_price)"
        " VALUES (?, ?, ?, ?, ?)",
        (
            entry.account_id,
            entry.as_of_date.isoformat(),
            balance_usd,
            entry.quantity,
            entry.unit_price,
        ),
    )
    db.commit()
    row = db.execute(
        "SELECT id, account_id, as_of_date, balance_usd, quantity, unit_price, created_at"
        " FROM balance_entry WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return BalanceEntry(**dict(row))
