"""The funds & goals slice: sinking funds and dated goals as one concept.

Each fund carries its latest balance from fund_entry (append-only, like
balance_entry) and a note derived from its own numbers — never hand-typed.
"""

import sqlite3
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import (
    BaseModel,
    Field,
    NonNegativeFloat,
    PositiveFloat,
    StringConstraints,
    field_validator,
    model_validator,
)

from sereno.db.connection import get_db
from sereno.engine.funds import derive_note, due_contribution_months
from sereno.money import to_cents, to_dollars

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
    # The row carries stored cents; the model — and derive_note, which
    # formats display strings — speak dollars.
    fields = dict(row) | {
        "target_amount": to_dollars(row["target_amount"]),
        "monthly_plan": to_dollars(row["monthly_plan"]),
        "balance": to_dollars(row["balance"]),
    }
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
    figure, and a zero amount moves nothing and is rejected.

    source='rollover' assigns last month's leftover instead: the
    contribution is recorded identically, but the headline, the activity
    feed, and the yearly actual all filter on ('monthly_plan', 'top_up'),
    so the current month is never charged for money the old month already
    earned. fund_entry has no CHECK constraint on source, so the Literal
    gates the accepted values here.

    as_of_date lands the move in the calendar month it belongs to — the
    budget month scopes fund entries by substr(as_of_date, 1, 7) — and
    defaults to today when omitted."""

    amount: float
    source: Literal["top_up", "rollover"] = "top_up"
    as_of_date: date | None = None

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


class FundLogFund(BaseModel):
    id: int
    name: str
    emoji: str | None
    archived: bool


class FundLogLink(BaseModel):
    """The expense or income row behind a 'spend' entry. kind reads the
    entry against the row's other entries on the same fund: its first is
    the draw; a later one is an edit while the row still draws from this
    fund, or a reversal once it has moved off it."""

    type: Literal["expense", "income"]
    id: int
    label: str
    kind: Literal["draw", "edit", "reversal"]


class FundLogEntry(BaseModel):
    """One line of the fund log: delta is the move from the fund's previous
    snapshot, so every source — spend, contribution, top-up, rollover, or a
    hand correction — reads as a signed amount."""

    id: int
    fund: FundLogFund
    as_of_date: date
    source: str | None
    delta: float
    balance: float
    link: FundLogLink | None


class FundEntryLink(BaseModel):
    """Exactly one of the two: the row a 'spend' entry is linked to."""

    expense_id: int | None = None
    income_id: int | None = None

    @model_validator(mode="after")
    def exactly_one(self) -> "FundEntryLink":
        if (self.expense_id is None) == (self.income_id is None):
            raise ValueError("give exactly one of expense_id or income_id")
        return self


# Every entry with its delta and its place among its row's entries on the
# fund, computed over the whole table before any filter so the previous
# snapshot can sit in an earlier month. The order is _fund_balance's.
_FUND_LOG_QUERY = """
WITH chain AS (
    SELECT e.*,
           e.balance - COALESCE(LAG(e.balance) OVER (
               PARTITION BY e.fund_id ORDER BY e.as_of_date, e.id), 0) AS delta,
           ROW_NUMBER() OVER (PARTITION BY e.fund_id, e.expense_id ORDER BY e.id) AS expense_seq,
           ROW_NUMBER() OVER (PARTITION BY e.fund_id, e.income_id ORDER BY e.id) AS income_seq
    FROM fund_entry e
)
SELECT c.id, c.fund_id, f.name, f.emoji, f.active, c.as_of_date, c.source, c.delta,
       c.balance, c.expense_id, c.income_id, c.expense_seq, c.income_seq,
       COALESCE(x.note, cat.name, 'Expense') AS expense_label,
       CASE WHEN x.funded_from = 'fund' THEN x.fund_id END AS expense_fund_id,
       COALESCE(i.source_label, i.note, i.source) AS income_label,
       i.drawn_from_fund_id AS income_fund_id
FROM chain c
JOIN fund f ON f.id = c.fund_id
LEFT JOIN expense_line x ON x.id = c.expense_id
LEFT JOIN category cat ON cat.id = x.category_id
LEFT JOIN income_event i ON i.id = c.income_id
"""


def _fund_log_link(row: sqlite3.Row) -> FundLogLink | None:
    if row["expense_id"] is not None:
        link_type, link_id, label = "expense", row["expense_id"], row["expense_label"]
        seq, current_fund = row["expense_seq"], row["expense_fund_id"]
    elif row["income_id"] is not None:
        link_type, link_id, label = "income", row["income_id"], row["income_label"]
        seq, current_fund = row["income_seq"], row["income_fund_id"]
    else:
        return None
    if seq == 1:
        kind = "draw"
    elif current_fund == row["fund_id"]:
        kind = "edit"
    else:
        kind = "reversal"
    return FundLogLink(type=link_type, id=link_id, label=label, kind=kind)


def _fund_log_entry(row: sqlite3.Row) -> FundLogEntry:
    return FundLogEntry(
        id=row["id"],
        fund=FundLogFund(
            id=row["fund_id"], name=row["name"], emoji=row["emoji"], archived=not row["active"]
        ),
        as_of_date=row["as_of_date"],
        source=row["source"],
        delta=to_dollars(row["delta"]),
        balance=to_dollars(row["balance"]),
        link=_fund_log_link(row),
    )


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
    query would never see. Parallel reads race this catch-up on separate
    connections — both can read the anchors before either commits — so the
    insert is OR IGNORE against 0012's one-planned-row-per-fund-per-date
    unique index: a losing racer is a silent no-op."""
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
            cursor = db.execute(
                "INSERT OR IGNORE INTO fund_entry"
                " (fund_id, as_of_date, balance, contribution, source)"
                " VALUES (?, ?, ?, ?, 'monthly_plan')",
                (fund["id"], first.isoformat(), balance + contribution, contribution),
            )
            appended = appended or cursor.rowcount == 1
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
            to_cents(fund.target_amount),
            fund.target_date.isoformat() if fund.target_date else None,
            to_cents(fund.monthly_plan),
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
        fields["monthly_plan"] = to_cents(fields["monthly_plan"] or None)
    if fields:
        assignments = ", ".join(f"{column} = ?" for column in fields)
        db.execute(f"UPDATE fund SET {assignments} WHERE id = ?", (*fields.values(), fund_id))
        db.commit()
    row = db.execute(_FUND_QUERY + " WHERE id = ?", (fund_id,)).fetchone()
    return _fund(row)


@router.post("/funds/{fund_id}/top-up", status_code=201)
def top_up_fund(fund_id: int, top_up: FundTopUp, db: Db) -> Fund:
    """Appends a 'top_up' entry with the delta as its contribution, dated
    as_of_date (today when omitted). The budget month counts these
    alongside the monthly-plan rows, so a top-up trims its month's
    safe-to-spend the moment it lands and a release raises it back. A
    date behind the fund's latest entry is a 422 — snapshots resolve
    newest-first, so a mid-chain insert would corrupt the balance chain.
    A release may not exceed the balance (the mirror of the overdraw
    guard on fund-funded expenses), and an archived fund takes no
    top-ups — it is invisible everywhere money is displayed, so parking
    money in one would trim the headline with no surface showing where
    it went."""
    fund = db.execute("SELECT active FROM fund WHERE id = ?", (fund_id,)).fetchone()
    if fund is None:
        raise HTTPException(status_code=404, detail="fund not found")
    if not fund["active"]:
        raise HTTPException(status_code=422, detail="fund is archived")
    as_of = top_up.as_of_date or date.today()
    # Due plans land before the one-off: a top-up dated on a 1st would
    # otherwise become the anchor and stand for its month, silently
    # swallowing the planned contribution. The catch-up runs through the
    # top-up's date — a future-dated move writes its month's planned
    # contribution eagerly — and the balance below then includes it.
    apply_monthly_plans(db, max(date.today(), as_of))
    latest = db.execute(
        "SELECT as_of_date, balance FROM fund_entry WHERE fund_id = ?"
        " ORDER BY as_of_date DESC, id DESC LIMIT 1",
        (fund_id,),
    ).fetchone()
    balance = latest["balance"] if latest is not None else 0
    # Entries snapshot absolute balances resolved newest-first, so a date
    # behind the latest entry would slot mid-chain and silently drop out
    # of the displayed balance — the same reason expense corrections are
    # dated today. Same-day ties break by insertion order, so the latest
    # entry's own day is still fair game.
    if latest is not None and as_of.isoformat() < latest["as_of_date"]:
        raise HTTPException(status_code=422, detail="date precedes the fund's latest entry")
    # The guard compares integer cents against integer cents, so releasing
    # exactly the displayed balance can never be off by a float fraction.
    amount = to_cents(top_up.amount)
    if amount < 0 and -amount > balance:
        raise HTTPException(status_code=422, detail="release exceeds fund balance")
    db.execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
        " VALUES (?, ?, ?, ?, ?)",
        (
            fund_id,
            as_of.isoformat(),
            balance + amount,
            amount,
            top_up.source,
        ),
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
        (
            entry.fund_id,
            entry.as_of_date.isoformat(),
            to_cents(entry.balance),
            to_cents(entry.contribution),
        ),
    )
    db.commit()
    row = db.execute(
        "SELECT id, fund_id, as_of_date, balance, contribution, source"
        " FROM fund_entry WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return FundEntry(
        **(
            dict(row)
            | {
                "balance": to_dollars(row["balance"]),
                "contribution": to_dollars(row["contribution"]),
            }
        )
    )


@router.get("/fund-entries")
def list_fund_entries(
    db: Db,
    month: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
    fund_id: int | None = None,
    unlinked: bool = False,
) -> list[FundLogEntry]:
    """The fund log: a calendar month of entries (by as_of_date), newest
    first, archived funds included. Entries that move nothing — a new
    fund's opening $0, a restatement to the same balance — are skipped.
    Unfiltered, the monthly contributions stay out, since every fund
    gets one each month; filtered to a fund, they're part of its story.
    unlinked narrows to the 'spend' entries no row claims, for the
    backfill."""
    target = month or date.today().strftime("%Y-%m")
    where = ["substr(c.as_of_date, 1, 7) = ?", "c.delta != 0"]
    params: list[object] = [target]
    if fund_id is None:
        where.append("COALESCE(c.source, '') != 'monthly_plan'")
    else:
        where.append("c.fund_id = ?")
        params.append(fund_id)
    if unlinked:
        where.append("c.source = 'spend' AND c.expense_id IS NULL AND c.income_id IS NULL")
    rows = db.execute(
        _FUND_LOG_QUERY
        + " WHERE "
        + " AND ".join(where)
        + " ORDER BY c.as_of_date DESC, c.id DESC",
        params,
    )
    return [_fund_log_entry(row) for row in rows]


@router.put("/fund-entries/{entry_id}/link")
def link_fund_entry(entry_id: int, link: FundEntryLink, db: Db) -> FundLogEntry:
    """The post-deploy backfill: points an existing 'spend' entry at the
    expense or income row behind it. The row must draw from the entry's
    fund. Relinking replaces the old link — a matching mistake can be
    undone — and no balance is ever touched."""
    entry = db.execute(
        "SELECT fund_id, source FROM fund_entry WHERE id = ?", (entry_id,)
    ).fetchone()
    if entry is None:
        raise HTTPException(status_code=404, detail="fund entry not found")
    if entry["source"] != "spend":
        raise HTTPException(status_code=422, detail="only spend entries can be linked")
    if link.expense_id is not None:
        row = db.execute(
            "SELECT 1 FROM expense_line WHERE id = ? AND funded_from = 'fund' AND fund_id = ?",
            (link.expense_id, entry["fund_id"]),
        ).fetchone()
        detail = "expense is not funded by this fund"
    else:
        row = db.execute(
            "SELECT 1 FROM income_event WHERE id = ? AND drawn_from_fund_id = ?",
            (link.income_id, entry["fund_id"]),
        ).fetchone()
        detail = "income is not drawn from this fund"
    if row is None:
        raise HTTPException(status_code=422, detail=detail)
    db.execute(
        "UPDATE fund_entry SET expense_id = ?, income_id = ? WHERE id = ?",
        (link.expense_id, link.income_id, entry_id),
    )
    db.commit()
    return _fund_log_entry(db.execute(_FUND_LOG_QUERY + " WHERE c.id = ?", (entry_id,)).fetchone())
