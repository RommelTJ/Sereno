"""The mortgage slice: the loan's terms as effective-dated planning config,
plus everything derivable from them and the balance the ledger already
tracks.

Terms resolve like the rest of the config slice — the latest effective_date
on or before today, ties broken by insertion order — and POST appends a
revision rather than updating, so a refinance and every change to the extra
payment stay queryable. account_id links the liability account instead of
duplicating its balance, which is also why no maturity date is stored: a
date typed by hand goes stale the moment the extra payment changes.
"""

import sqlite3
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from sereno.api.config import effective_row
from sereno.db.connection import get_db

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]

_COLUMNS = "id, effective_date, account_id, annual_rate, monthly_pi, monthly_extra, monthly_escrow"


class Mortgage(BaseModel):
    id: int
    effective_date: date
    account_id: int
    annual_rate: float
    monthly_pi: float
    monthly_extra: float
    monthly_escrow: float


class MortgageCreate(BaseModel):
    effective_date: date
    account_id: int
    annual_rate: float = Field(ge=0)
    monthly_pi: float = Field(gt=0)
    monthly_extra: float = Field(default=0, ge=0)
    monthly_escrow: float = Field(default=0, ge=0)


def _mortgage(row: sqlite3.Row) -> Mortgage:
    return Mortgage(**dict(row))


@router.get("/mortgage")
def get_mortgage(db: Db) -> Mortgage | None:
    row = effective_row(db, "mortgage", _COLUMNS)
    return _mortgage(row) if row else None


@router.post("/mortgage", status_code=201)
def create_mortgage(terms: MortgageCreate, db: Db) -> Mortgage:
    account = db.execute(
        "SELECT is_liability, active FROM account WHERE id = ?", (terms.account_id,)
    ).fetchone()
    if account is None:
        raise HTTPException(status_code=404, detail="account not found")
    if not account["is_liability"]:
        raise HTTPException(status_code=422, detail="mortgage terms need a liability account")
    if not account["active"]:
        raise HTTPException(status_code=422, detail="account is not active")
    cursor = db.execute(
        "INSERT INTO mortgage (effective_date, account_id, annual_rate, monthly_pi,"
        " monthly_extra, monthly_escrow) VALUES (?, ?, ?, ?, ?, ?)",
        (
            terms.effective_date.isoformat(),
            terms.account_id,
            terms.annual_rate,
            terms.monthly_pi,
            terms.monthly_extra,
            terms.monthly_escrow,
        ),
    )
    db.commit()
    row = db.execute(
        f"SELECT {_COLUMNS} FROM mortgage WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    return _mortgage(row)
