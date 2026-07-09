"""The funds & goals slice: sinking funds and dated goals as one concept.

Each fund carries its latest balance from fund_entry (append-only, like
balance_entry) and a note derived from its own numbers — never hand-typed.
"""

import sqlite3
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import (
    BaseModel,
    Field,
    NonNegativeFloat,
    PositiveFloat,
    StringConstraints,
    field_validator,
)

from sereno.db.connection import get_db
from sereno.engine.funds import derive_note, due_contribution_months

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


class FundUpdate(BaseModel):
    """A partial update: only the fields present in the body are written,
    so a plan-only edit leaves the name and emoji alone and a rename leaves
    the plan funding. An explicit null emoji clears it. A 0 or blank plan is
    stored as NULL — pausing and clearing are the same state, and "$0 / mo"
    never renders anywhere."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)] | None = None
    emoji: str | None = None
    monthly_plan: NonNegativeFloat | None = None


class FundTopUp(BaseModel):
    """A one-time move between the month's safe-to-spend and the fund — the
    one-off sibling of the automatic monthly contribution. A positive amount
    parks money; a negative amount is a partial release. The server computes
    the new balance from the latest entry, so nobody types an absolute
    figure, and a zero amount moves nothing and is rejected."""

    amount: float

    @field_validator("amount")
    @classmethod
    def nonzero(cls, amount: float) -> float:
        if amount == 0:
            raise ValueError("amount must be nonzero")
        return amount


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


def apply_monthly_plans(db: sqlite3.Connection, today: date) -> None:
    """The lazy catch-up behind monthly funding: with no scheduler in the
    stack, each active fund with a monthly plan receives it as contribution
    entries dated the 1st of each month, appended whenever funds are read.
    The schedule anchors on the fund's latest planned or hand-entered row
    ('spend' drawdowns are not contributions), so a re-read appends nothing
    and a fund with no entries at all has no schedule to catch up. Each due
    month funds from the fund's balance as of that 1st, so the plan
    suspends at the target — the crossing month's contribution is capped at
    the remaining amount, a fund at or past it receives nothing, and an
    open-ended fund has no finish line — and months spent at target are
    forgiven rather than owed: a drawdown resumes funding from its own
    month forward instead of backfilling rows the date-ordered balance
    query would never see."""
    funds = db.execute(
        "SELECT f.id, f.monthly_plan, f.target_amount,"
        " (SELECT e.as_of_date FROM fund_entry e WHERE e.fund_id = f.id"
        "  AND COALESCE(e.source, '') != 'spend'"
        "  ORDER BY e.as_of_date DESC, e.id DESC LIMIT 1) AS anchor"
        " FROM fund f WHERE f.active = 1 AND f.monthly_plan > 0"
    ).fetchall()
    appended = False
    for fund in funds:
        if fund["anchor"] is None:
            continue
        anchor = date.fromisoformat(fund["anchor"])
        for first in due_contribution_months(anchor=anchor, today=today):
            (balance,) = db.execute(
                "SELECT COALESCE((SELECT e.balance FROM fund_entry e"
                "                 WHERE e.fund_id = ? AND e.as_of_date <= ?"
                "                 ORDER BY e.as_of_date DESC, e.id DESC LIMIT 1), 0)",
                (fund["id"], first.isoformat()),
            ).fetchone()
            contribution = fund["monthly_plan"]
            if fund["target_amount"] is not None:
                contribution = min(contribution, fund["target_amount"] - balance)
            if contribution <= 0:
                continue
            db.execute(
                "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
                " VALUES (?, ?, ?, ?, 'monthly_plan')",
                (fund["id"], first.isoformat(), balance + contribution, contribution),
            )
            appended = True
    if appended:
        db.commit()


@router.get("/funds")
def list_funds(db: Db) -> list[Fund]:
    apply_monthly_plans(db, date.today())
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


@router.put("/funds/{fund_id}")
def update_fund(fund_id: int, update: FundUpdate, db: Db) -> Fund:
    """Revises the fund row in place — it is a dimension, not a fact, like
    a category rename, so its identity fields are mutable and the
    append-only entry history is untouched. Only the fields the body
    carries are written: a plan-only edit keeps the name and emoji, and a
    rename keeps the fund funding. A NULL plan pauses funding without
    archiving: the balance stays parked and the fund drops out of the
    monthly catch-up."""
    if db.execute("SELECT 1 FROM fund WHERE id = ?", (fund_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="fund not found")
    # exclude_unset, not exclude_none: an omitted emoji keeps the stored
    # one, while an explicit null clears it — and an omitted plan cannot
    # coalesce an active fund's funding into a pause.
    fields = update.model_dump(exclude_unset=True)
    if "monthly_plan" in fields:
        fields["monthly_plan"] = fields["monthly_plan"] or None
    if fields:
        assignments = ", ".join(f"{column} = ?" for column in fields)
        db.execute(f"UPDATE fund SET {assignments} WHERE id = ?", (*fields.values(), fund_id))
        db.commit()
    row = db.execute(_FUND_QUERY + " WHERE id = ?", (fund_id,)).fetchone()
    return _fund(row)


@router.post("/funds/{fund_id}/top-up", status_code=201)
def top_up_fund(fund_id: int, top_up: FundTopUp, db: Db) -> Fund:
    """Appends a 'top_up' entry with the delta as its contribution, dated
    today. The budget month counts these alongside the monthly-plan rows,
    so a top-up trims safe-to-spend the moment it lands and a release
    raises it back. A release may not exceed the balance (the mirror of
    the overdraw guard on fund-funded expenses), and an archived fund
    takes no top-ups — it is invisible everywhere money is displayed, so
    parking money in one would trim the headline with no surface showing
    where it went."""
    fund = db.execute("SELECT active FROM fund WHERE id = ?", (fund_id,)).fetchone()
    if fund is None:
        raise HTTPException(status_code=404, detail="fund not found")
    if not fund["active"]:
        raise HTTPException(status_code=422, detail="fund is archived")
    (balance,) = db.execute(
        "SELECT COALESCE((SELECT e.balance FROM fund_entry e WHERE e.fund_id = ?"
        "                 ORDER BY e.as_of_date DESC, e.id DESC LIMIT 1), 0)",
        (fund_id,),
    ).fetchone()
    if top_up.amount < 0 and -top_up.amount > balance:
        raise HTTPException(status_code=422, detail="release exceeds fund balance")
    db.execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
        " VALUES (?, ?, ?, ?, 'top_up')",
        (fund_id, date.today().isoformat(), balance + top_up.amount, top_up.amount),
    )
    db.commit()
    row = db.execute(_FUND_QUERY + " WHERE id = ?", (fund_id,)).fetchone()
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
