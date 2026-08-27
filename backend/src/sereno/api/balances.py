"""Balances and net worth: accounts, append-only balance entries, ledger, net worth.

All reads go through the SQL views (v_account_monthly, v_net_worth) so the
"latest entry in a month wins" rule lives in one place — the schema.
"""

import sqlite3
from datetime import date, datetime
from typing import Annotated, Literal, Self

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StringConstraints, model_validator

from sereno.db.connection import get_db
from sereno.money import to_cents, to_dollars

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]

# The ledger's paging cursor and page size. The limit is bounded because an
# unbounded one is the thing paging exists to close — every extra month is a
# whole row of accounts over the wire and another pass of the monthly view.
# 120 is ten years, past any page a person scrolls to.
Before = Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")]
Limit = Annotated[int, Query(ge=1, le=120)]

_ACCOUNT_COLUMNS = (
    "id, name, kind, tax_treatment, owner, is_liability, is_investable,"
    " withdrawal_priority, access_age, active, emoji"
)


class Account(BaseModel):
    id: int
    name: str
    kind: str
    tax_treatment: str
    owner: str | None
    is_liability: bool
    is_investable: bool
    withdrawal_priority: int | None
    access_age: float | None
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


class AccountClassification(BaseModel):
    """The planner-facing dimensions of an account: is_investable feeds the
    guardrails portfolio, withdrawal_priority orders the sourcing and
    forecast waterfall (1 ETH, 2 brokerage, 3 401(k), 4 HSA), and
    access_age gates a bucket until its owner reaches that age."""

    kind: Literal[
        "eth",
        "brokerage_fund",
        "401k",
        "roth",
        "hsa",
        "cash",
        "cash_plus",
        "home",
        "car",
        "mortgage",
        "other",
    ]
    tax_treatment: Literal["LTCG", "ORDINARY", "TAX_FREE", "NONE"]
    is_investable: bool
    withdrawal_priority: Annotated[int, Field(ge=1, le=4)] | None
    access_age: Annotated[float, Field(ge=0)] | None


def _account(db: sqlite3.Connection, account_id: int | None) -> Account:
    row = db.execute(
        f"SELECT {_ACCOUNT_COLUMNS} FROM account WHERE id = ?", (account_id,)
    ).fetchone()
    return Account(**dict(row))


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


class LedgerPage(BaseModel):
    """One page of months, newest first. has_more says whether older months
    remain, so a caller paging backwards knows when to stop asking."""

    months: list[LedgerMonth]
    has_more: bool


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
    rows = db.execute(f"SELECT {_ACCOUNT_COLUMNS} FROM account ORDER BY sort_order, id")
    return [Account(**dict(row)) for row in rows]


@router.post("/accounts", status_code=201)
def create_account(account: AccountCreate, db: Db) -> Account:
    """Inserts the dimension row plus its initial balance_entry for today.

    New accounts start net-worth-only: kind 'other', not investable, no
    withdrawal priority — PUT /accounts/{id} classifies them for the
    planners afterwards."""
    duplicate = db.execute(
        "SELECT 1 FROM account WHERE active = 1 AND LOWER(name) = LOWER(?)",
        (account.name,),
    ).fetchone()
    if duplicate:
        raise HTTPException(status_code=409, detail=f"account {account.name!r} exists")
    cursor = db.execute(
        "INSERT INTO account (name, emoji, kind, tax_treatment, is_liability, is_investable,"
        " sort_order)"
        " VALUES (?, ?, 'other', 'NONE', ?, 0,"
        " (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM account))",
        (account.name, account.emoji, account.is_liability),
    )
    account_id = cursor.lastrowid
    db.execute(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd, source)"
        " VALUES (?, ?, ?, 'manual')",
        (account_id, date.today().isoformat(), to_cents(account.initial_value)),
    )
    db.commit()
    return _account(db, account_id)


class AccountOrder(BaseModel):
    """The complete ordered list of active account ids — total, so a partial
    update can never interleave two reorders."""

    ids: list[int]


@router.put("/accounts/order")
def reorder_accounts(order: AccountOrder, db: Db) -> list[Account]:
    """Persists a user-defined display order: position in the list becomes
    sort_order (1-based). Declared before /accounts/{account_id} so "order"
    is never parsed as an account id. Inactive accounts keep their stale
    sort_order — they never render in an ordered surface."""
    active_ids = {row["id"] for row in db.execute("SELECT id FROM account WHERE active = 1")}
    if len(order.ids) != len(active_ids) or set(order.ids) != active_ids:
        raise HTTPException(status_code=422, detail="ids must be exactly the active account ids")
    db.executemany(
        "UPDATE account SET sort_order = ? WHERE id = ?",
        list(enumerate(order.ids, start=1)),
    )
    db.commit()
    rows = db.execute(
        f"SELECT {_ACCOUNT_COLUMNS} FROM account WHERE active = 1 ORDER BY sort_order, id"
    )
    return [Account(**dict(row)) for row in rows]


@router.put("/accounts/{account_id}")
def update_account(account_id: int, classification: AccountClassification, db: Db) -> Account:
    """Classifies an account for the planners — in place, like the other
    dimension edits (PUT /categories/{id}): what an account *is* is metadata,
    not an effective-dated fact. A liability can never be investable or hold
    a withdrawal priority — it would add its positive stored balance to the
    investable sum and enter the withdrawal buckets."""
    row = db.execute("SELECT is_liability FROM account WHERE id = ?", (account_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="account not found")
    if row["is_liability"] and (
        classification.is_investable or classification.withdrawal_priority is not None
    ):
        raise HTTPException(
            status_code=422, detail="a liability cannot join the withdrawal portfolio"
        )
    db.execute(
        "UPDATE account SET kind = ?, tax_treatment = ?, is_investable = ?,"
        " withdrawal_priority = ?, access_age = ? WHERE id = ?",
        (
            classification.kind,
            classification.tax_treatment,
            classification.is_investable,
            classification.withdrawal_priority,
            classification.access_age,
            account_id,
        ),
    )
    db.commit()
    return _account(db, account_id)


@router.post("/accounts/{account_id}/deactivate")
def deactivate_account(account_id: int, db: Db) -> Account:
    """Soft remove: the account drops out of listings and stops carrying
    forward, but its append-only history keeps counting in the months it
    was really entered. There is no hard delete."""
    if db.execute("SELECT 1 FROM account WHERE id = ?", (account_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="account not found")
    db.execute("UPDATE account SET active = 0 WHERE id = ?", (account_id,))
    db.commit()
    return _account(db, account_id)


@router.get("/ledger")
def ledger(db: Db, limit: Limit = 12, before: Before = None) -> LedgerPage:
    """One page of the monthly ledger, newest month first — the twelve newest
    by default, older ones by passing the page's oldest month as `before`.

    The page's months come from balance_entry rather than from the view: it is
    the same set of months (the view builds its month list the same way, and a
    month with an entry always keeps at least that entry's row), but reading it
    directly costs one scan instead of a pass of the month x entry join. A page
    is whole months, never rows — one month is one row per account, so a row
    limit would cut a month in half — and both reads below are bounded to the
    page's contiguous month range.
    """
    months = [
        row["ym"]
        for row in db.execute(
            "SELECT DISTINCT substr(as_of_date, 1, 7) AS ym FROM balance_entry"
            " WHERE ? IS NULL OR substr(as_of_date, 1, 7) < ?"
            " ORDER BY ym DESC LIMIT ?",
            (before, before, limit + 1),
        )
    ]
    # One month more than asked for is the only "are there older months?"
    # signal needed — no second count, and no empty page at the end.
    has_more = len(months) > limit
    months = months[:limit]
    if not months:
        return LedgerPage(months=[], has_more=False)
    oldest, newest = months[-1], months[0]
    net_worth = {
        row["month"]: to_dollars(row["net_worth"])
        for row in db.execute(
            "SELECT month, net_worth FROM v_net_worth WHERE month BETWEEN ? AND ?",
            (oldest, newest),
        )
    }
    balances: dict[str, list[LedgerBalance]] = {month: [] for month in months}
    rows = db.execute(
        "SELECT month, account_id, as_of_date, balance_usd, quantity, unit_price"
        " FROM v_account_monthly WHERE month BETWEEN ? AND ?"
        " ORDER BY month DESC, account_id",
        (oldest, newest),
    )
    for row in rows:
        balances[row["month"]].append(
            LedgerBalance(
                account_id=row["account_id"],
                as_of_date=row["as_of_date"],
                balance_usd=to_dollars(row["balance_usd"]),
                quantity=row["quantity"],
                unit_price=row["unit_price"],
            )
        )
    return LedgerPage(
        months=[
            LedgerMonth(month=month, net_worth=net_worth[month], balances=balances[month])
            for month in months
        ],
        has_more=has_more,
    )


@router.get("/net-worth")
def net_worth(db: Db) -> NetWorth:
    points = [
        NetWorthPoint(month=row["month"], net_worth=to_dollars(row["net_worth"]))
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
    # quantity × price rarely lands on a cent boundary; rounding here keeps
    # the stored ledger in whole cents (quantity and price stay fractional).
    balance_cents = (
        round(entry.quantity * entry.unit_price * 100)
        if entry.quantity is not None and entry.unit_price is not None
        else to_cents(entry.balance_usd)
    )
    cursor = db.execute(
        "INSERT INTO balance_entry (account_id, as_of_date, balance_usd, quantity, unit_price)"
        " VALUES (?, ?, ?, ?, ?)",
        (
            entry.account_id,
            entry.as_of_date.isoformat(),
            balance_cents,
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
    return BalanceEntry(**(dict(row) | {"balance_usd": to_dollars(row["balance_usd"])}))
