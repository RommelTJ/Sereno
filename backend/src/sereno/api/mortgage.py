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

from sereno.api.config import effective_row, get_assumptions
from sereno.api.sourcing import current_age
from sereno.db.connection import get_db
from sereno.engine.mortgage import amortize
from sereno.money import to_dollars

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]

_COLUMNS = "id, effective_date, account_id, annual_rate, monthly_pi, monthly_extra, monthly_escrow"

_LATEST_BALANCE = (
    "SELECT as_of_date, balance_usd FROM balance_entry WHERE account_id = ?"
    " ORDER BY as_of_date DESC, id DESC LIMIT 1"
)


class MortgageDerived(BaseModel):
    """Everything the stored terms and the ledger balance imply. Null as a
    whole when the account has no balance to amortize, or when the payment
    cannot cover one month's interest — there is no payoff to report."""

    balance: float
    balance_as_of: date
    payoff_date: date
    payoff_age: int
    remaining_months: int
    remaining_interest: float
    months_saved: int | None
    interest_saved: float | None
    payment_real_at_payoff: float | None


class Mortgage(BaseModel):
    id: int
    effective_date: date
    account_id: int
    annual_rate: float
    monthly_pi: float
    monthly_extra: float
    monthly_escrow: float
    derived: MortgageDerived | None


class MortgageCreate(BaseModel):
    effective_date: date
    account_id: int
    annual_rate: float = Field(ge=0)
    monthly_pi: float = Field(gt=0)
    monthly_extra: float = Field(default=0, ge=0)
    monthly_escrow: float = Field(default=0, ge=0)


def _month_after(start: date, months: int) -> date:
    """The first of the month ``months`` on from ``start`` — the month the
    last payment lands in, counting from the balance's own month."""
    total = start.year * 12 + start.month - 1 + months
    return date(total // 12, total % 12 + 1, 1)


def _derive(db: sqlite3.Connection, terms: Mortgage) -> MortgageDerived | None:
    row = db.execute(_LATEST_BALANCE, (terms.account_id,)).fetchone()
    if row is None:
        return None
    balance = to_dollars(row["balance_usd"])
    payment = terms.monthly_pi + terms.monthly_extra
    schedule = amortize(balance=balance, annual_rate=terms.annual_rate, monthly_payment=payment)
    if schedule is None:
        return None
    # The P&I-only schedule the extra principal is measured against. None
    # when P&I alone would never amortize: no baseline, so nothing saved.
    baseline = amortize(
        balance=balance, annual_rate=terms.annual_rate, monthly_payment=terms.monthly_pi
    )
    assumption = get_assumptions(db)
    balance_as_of = date.fromisoformat(row["as_of_date"])
    payoff_date = _month_after(balance_as_of, schedule.months)
    return MortgageDerived(
        balance=balance,
        balance_as_of=balance_as_of,
        payoff_date=payoff_date,
        payoff_age=current_age(payoff_date),
        remaining_months=schedule.months,
        remaining_interest=schedule.total_interest,
        months_saved=None if baseline is None else baseline.months - schedule.months,
        interest_saved=(
            None if baseline is None else baseline.total_interest - schedule.total_interest
        ),
        # Escrow is excluded: it survives payoff, so it is not part of the
        # payment that stops. A fixed nominal payment is worth less every
        # year, and this says how much less by the time it ends.
        payment_real_at_payoff=(
            None
            if assumption is None
            else payment / (1 + assumption.inflation_pct / 100) ** (schedule.months / 12)
        ),
    )


def _mortgage(db: sqlite3.Connection, row: sqlite3.Row) -> Mortgage:
    terms = Mortgage(**dict(row), derived=None)
    terms.derived = _derive(db, terms)
    return terms


@router.get("/mortgage")
def get_mortgage(db: Db) -> Mortgage | None:
    row = effective_row(db, "mortgage", _COLUMNS)
    return _mortgage(db, row) if row else None


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
    return _mortgage(db, row)
