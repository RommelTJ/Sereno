"""Balances and net worth: accounts, append-only balance entries, ledger, net worth.

All reads go through the SQL views (v_account_monthly, v_net_worth) so the
"latest entry in a month wins" rule lives in one place — the schema.
"""

import sqlite3
from datetime import date, datetime
from typing import Annotated, Self

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints, model_validator

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
    emoji: str | None


class AccountCreate(BaseModel):
    """The initial value is set here only — subsequent values go through the
    ledger's append-only entries. Liabilities are stored positive (the views
    subtract them), so a negative initial value is rejected."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    emoji: str | None = None
    is_liability: bool = False
    initial_value: float = Field(ge=0)


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


class LedgerBalance(BaseModel):
    account_id: int
    as_of_date: date
    balance_usd: float
    quantity: float | None
    unit_price: float | None


class LedgerMonth(BaseModel):
    month: str
    net_worth: float
    balances: list[LedgerBalance]


class NetWorthPoint(BaseModel):
    month: str
    net_worth: float


class NetWorth(BaseModel):
    current: float | None
    yoy: float | None
    series: list[NetWorthPoint]


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
        "SELECT id, name, kind, tax_treatment, owner, is_liability, is_investable, active, emoji"
        " FROM account ORDER BY id"
    )
    return [Account(**dict(row)) for row in rows]


@router.post("/accounts", status_code=201)
def create_account(account: AccountCreate, db: Db) -> Account:
    """Inserts the dimension row plus its initial balance_entry for today.

    New accounts are net-worth-only: kind 'other', not investable, no
    withdrawal priority — planner wiring for arbitrary accounts is its own
    slice."""
    duplicate = db.execute(
        "SELECT 1 FROM account WHERE active = 1 AND LOWER(name) = LOWER(?)",
        (account.name,),
    ).fetchone()
    if duplicate:
        raise HTTPException(status_code=409, detail=f"account {account.name!r} exists")
    cursor = db.execute(
        "INSERT INTO account (name, emoji, kind, tax_treatment, is_liability, is_investable)"
        " VALUES (?, ?, 'other', 'NONE', ?, 0)",
        (account.name, account.emoji, account.is_liability),
    )
    account_id = cursor.lastrowid
    db.execute(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd, source)"
        " VALUES (?, ?, ?, 'manual')",
        (account_id, date.today().isoformat(), account.initial_value),
    )
    db.commit()
    row = db.execute(
        "SELECT id, name, kind, tax_treatment, owner, is_liability, is_investable, active, emoji"
        " FROM account WHERE id = ?",
        (account_id,),
    ).fetchone()
    return Account(**dict(row))


@router.post("/accounts/{account_id}/deactivate")
def deactivate_account(account_id: int, db: Db) -> Account:
    """Soft remove: the account drops out of listings and stops carrying
    forward, but its append-only history keeps counting in the months it
    was really entered. There is no hard delete."""
    if db.execute("SELECT 1 FROM account WHERE id = ?", (account_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="account not found")
    db.execute("UPDATE account SET active = 0 WHERE id = ?", (account_id,))
    db.commit()
    row = db.execute(
        "SELECT id, name, kind, tax_treatment, owner, is_liability, is_investable, active, emoji"
        " FROM account WHERE id = ?",
        (account_id,),
    ).fetchone()
    return Account(**dict(row))


@router.get("/ledger")
def ledger(db: Db) -> list[LedgerMonth]:
    net_worth = {
        row["month"]: row["net_worth"]
        for row in db.execute("SELECT month, net_worth FROM v_net_worth")
    }
    months: dict[str, list[LedgerBalance]] = {}
    rows = db.execute(
        "SELECT month, account_id, as_of_date, balance_usd, quantity, unit_price"
        " FROM v_account_monthly ORDER BY month DESC, account_id"
    )
    for row in rows:
        months.setdefault(row["month"], []).append(
            LedgerBalance(
                account_id=row["account_id"],
                as_of_date=row["as_of_date"],
                balance_usd=row["balance_usd"],
                quantity=row["quantity"],
                unit_price=row["unit_price"],
            )
        )
    return [
        LedgerMonth(month=month, net_worth=net_worth[month], balances=balances)
        for month, balances in months.items()
    ]


@router.get("/net-worth")
def net_worth(db: Db) -> NetWorth:
    points = [
        NetWorthPoint(month=row["month"], net_worth=row["net_worth"])
        for row in db.execute("SELECT month, net_worth FROM v_net_worth ORDER BY month")
    ]
    if not points:
        return NetWorth(current=None, yoy=None, series=[])
    current = points[-1]
    baseline_month = f"{int(current.month[:4]) - 1}{current.month[4:]}"
    baseline = next((p.net_worth for p in points if p.month == baseline_month), None)
    yoy = current.net_worth / baseline - 1 if baseline else None
    return NetWorth(current=current.net_worth, yoy=yoy, series=points[-12:])


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
