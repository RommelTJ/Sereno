"""Budget facts: categories with planned envelopes, append-only expense and
income entry, and the computed budget month powering Safe-to-spend.

The Safe-to-spend baseline is funded_in from v_budget_month — the sum of the
month's stored income events. It moves only when a funding row is appended,
never when spending lands, so safe_to_spend = funded_in − fund_contributions
− total_spent: total_spent counts only discretionary lines (fund-funded
spending was paid from parked money and never lowers the headline), and
fund_contributions is the month's automatic monthly-plan funding plus its
one-time top-ups — money moved into a fund is parked, so it stops being
spendable the moment it lands, and a release's negative contribution makes
it spendable again.
"""

import sqlite3
from datetime import date, datetime
from typing import Annotated, Literal, Self

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, PositiveFloat, StringConstraints, model_validator

from sereno.api.funds import apply_monthly_plans
from sereno.db.connection import get_db
from sereno.money import to_cents, to_dollars

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


class CategoryCreate(BaseModel):
    """effective_month dates the initial plan row; it defaults to the current
    month. planned may be 0 — an envelope can exist before it's funded."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    emoji: str | None = None
    planned: float = Field(ge=0)
    effective_month: str | None = Field(None, pattern=r"^\d{4}-\d{2}$")


class CategoryUpdate(BaseModel):
    """The rename body — name and emoji replace the stored values (a null
    or omitted emoji clears it). planned stays on the /plan endpoint."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    emoji: str | None = None


class CategoryPlanCreate(BaseModel):
    planned: float = Field(ge=0)
    effective_month: str | None = Field(None, pattern=r"^\d{4}-\d{2}$")


class CategoryPlan(BaseModel):
    id: int
    category_id: int
    effective_month: str
    planned: float


class ExpenseCreate(BaseModel):
    """budget_month defaults to the txn's month; pass a later month to prepay
    (June pay funds July). fund_id goes with funded_from='fund', never alone.
    pending marks a provisional amount to true up after it settles — a feed
    reminder that never excludes the row from the math."""

    txn_date: date
    budget_month: str | None = Field(None, pattern=r"^\d{4}-\d{2}$")
    category_id: int | None = None
    amount: PositiveFloat
    is_fixed: bool = False
    funded_from: Literal["discretionary", "fund"] = "discretionary"
    fund_id: int | None = None
    account_id: int | None = None
    note: str | None = None
    pending: bool = False

    @model_validator(mode="after")
    def fund_id_iff_fund_spending(self) -> Self:
        if (self.funded_from == "fund") != (self.fund_id is not None):
            raise ValueError("funded_from='fund' and fund_id go together")
        return self


class Expense(BaseModel):
    id: int
    txn_date: date
    budget_month: str
    category_id: int | None
    amount: float
    is_fixed: bool
    funded_from: str
    fund_id: int | None
    account_id: int | None
    note: str | None
    pending: bool
    created_at: datetime


class IncomeCreate(BaseModel):
    """budget_month is the month this inflow funds; it defaults to the txn's
    month — the prepay pattern passes the next month (June pay funds July).
    source_label is the row's display title ("Spouse paycheck") — the context
    the source enum can't carry — leaving note to be a true note. pending
    marks a provisional amount to true up after it settles."""

    txn_date: date
    budget_month: str | None = Field(None, pattern=r"^\d{4}-\d{2}$")
    source: Literal["paycheck", "transfer_in", "staking", "dividend", "interest", "soc_sec"]
    amount: PositiveFloat
    tax_treatment: Literal["ORDINARY", "LTCG", "TAX_FREE"] | None = None
    account_id: int | None = None
    source_label: str | None = None
    note: str | None = None
    pending: bool = False


class Income(BaseModel):
    id: int
    txn_date: date
    budget_month: str
    source: str
    amount: float
    tax_treatment: str | None
    account_id: int | None
    source_label: str | None
    note: str | None
    pending: bool
    created_at: datetime


class Envelope(BaseModel):
    id: int
    name: str
    emoji: str | None
    planned: float
    spent: float
    remaining: float


class ActivityItem(BaseModel):
    """Rows carry every column their edit form pre-fills — the feed is the
    only read, so a tap costs no GET-by-id round trip. Expense rows carry
    the first six extras, income rows budget_month / tax_treatment /
    account_id, both the pending flag behind the feed's ⚠️; fund rows (no
    edit affordance) carry all-null extras."""

    type: Literal["expense", "income", "fund"]
    id: int
    txn_date: date
    amount: float
    category: str | None
    source: str | None
    source_label: str | None
    note: str | None
    category_id: int | None
    funded_from: str | None
    fund_id: int | None
    account_id: int | None
    is_fixed: bool | None
    budget_month: str | None
    tax_treatment: str | None
    pending: bool | None


class BudgetMonth(BaseModel):
    """rollover_assigned sums the month's 'rollover' fund entries — last
    month's leftover being given a job. It never joins the safe-to-spend
    subtraction: the client computes the unassigned leftover as the
    previous month's safe_to_spend minus this total."""

    month: str
    baseline: float
    fund_contributions: float
    rollover_assigned: float
    total_spent: float
    safe_to_spend: float
    categories: list[Envelope]
    activity: list[ActivityItem]


class BudgetYearMonth(BaseModel):
    month: str
    planned: float | None
    actual: float | None
    variance: float | None
    cumulative_variance: float | None
    provisional: bool


class BudgetYear(BaseModel):
    year: int
    data_start: str | None
    months: list[BudgetYearMonth]


def _require(db: sqlite3.Connection, table: str, row_id: int | None, label: str) -> None:
    if row_id is None:
        return
    if db.execute(f"SELECT 1 FROM {table} WHERE id = ?", (row_id,)).fetchone() is None:  # noqa: S608
        raise HTTPException(status_code=404, detail=f"{label} not found")


def _category(db: sqlite3.Connection, category_id: int, month: str) -> Category:
    row = db.execute(
        "SELECT c.id, c.name, c.emoji, c.is_fixed,"
        " COALESCE((SELECT p.planned FROM category_plan p"
        "           WHERE p.category_id = c.id AND p.effective_month <= ?"
        "           ORDER BY p.effective_month DESC, p.id DESC LIMIT 1), 0) AS planned"
        " FROM category c WHERE c.id = ?",
        (month, category_id),
    ).fetchone()
    return Category(**(dict(row) | {"planned": to_dollars(row["planned"])}))


@router.get("/categories")
def list_categories(db: Db, month: Month = None) -> list[Category]:
    rows = db.execute(
        "SELECT c.id, c.name, c.emoji, c.is_fixed,"
        " COALESCE((SELECT p.planned FROM category_plan p"
        "           WHERE p.category_id = c.id AND p.effective_month <= ?"
        "           ORDER BY p.effective_month DESC, p.id DESC LIMIT 1), 0) AS planned"
        " FROM category c WHERE c.active = 1 ORDER BY c.sort_order, c.id",
        (month or _current_month(),),
    )
    return [Category(**(dict(row) | {"planned": to_dollars(row["planned"])})) for row in rows]


@router.post("/categories", status_code=201)
def create_category(category: CategoryCreate, db: Db) -> Category:
    duplicate = db.execute(
        "SELECT 1 FROM category WHERE active = 1 AND LOWER(name) = LOWER(?)",
        (category.name,),
    ).fetchone()
    if duplicate:
        raise HTTPException(status_code=409, detail=f"category {category.name!r} exists")
    cursor = db.execute(
        "INSERT INTO category (name, emoji, sort_order)"
        " VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM category))",
        (category.name, category.emoji),
    )
    category_id = cursor.lastrowid
    db.execute(
        "INSERT INTO category_plan (category_id, effective_month, planned) VALUES (?, ?, ?)",
        (category_id, category.effective_month or _current_month(), to_cents(category.planned)),
    )
    db.commit()
    row = db.execute(
        "SELECT id, name, emoji, is_fixed FROM category WHERE id = ?", (category_id,)
    ).fetchone()
    return Category(**dict(row), planned=category.planned)


class CategoryOrder(BaseModel):
    """The complete ordered list of active category ids — total, so a partial
    update can never interleave two reorders."""

    ids: list[int]


@router.put("/categories/order")
def reorder_categories(order: CategoryOrder, db: Db) -> list[Category]:
    """Persists a user-defined envelope order: position in the list becomes
    sort_order (1-based). Declared before /categories/{category_id} so
    "order" is never parsed as a category id. Archived categories keep their
    stale sort_order — they never render in an ordered surface."""
    active_ids = {row["id"] for row in db.execute("SELECT id FROM category WHERE active = 1")}
    if len(order.ids) != len(active_ids) or set(order.ids) != active_ids:
        raise HTTPException(status_code=422, detail="ids must be exactly the active category ids")
    db.executemany(
        "UPDATE category SET sort_order = ? WHERE id = ?",
        list(enumerate(order.ids, start=1)),
    )
    db.commit()
    return list_categories(db, None)


@router.put("/categories/{category_id}")
def update_category(category_id: int, update: CategoryUpdate, db: Db) -> Category:
    """Renames the dimension row in place — category is a dimension, not a
    fact, so its identity fields are mutable; plans and expense lines keep
    their history untouched."""
    _require(db, "category", category_id, "category")
    duplicate = db.execute(
        "SELECT 1 FROM category WHERE active = 1 AND LOWER(name) = LOWER(?) AND id != ?",
        (update.name, category_id),
    ).fetchone()
    if duplicate:
        raise HTTPException(status_code=409, detail=f"category {update.name!r} exists")
    db.execute(
        "UPDATE category SET name = ?, emoji = ? WHERE id = ?",
        (update.name, update.emoji, category_id),
    )
    db.commit()
    return _category(db, category_id, _current_month())


@router.post("/categories/{category_id}/archive")
def archive_category(category_id: int, db: Db) -> Category:
    """Soft remove, like account deactivation: the envelope drops out of
    listings and the budget month, but its plans and expense lines keep
    counting in history, and its name frees up for reuse. No hard delete."""
    _require(db, "category", category_id, "category")
    db.execute("UPDATE category SET active = 0 WHERE id = ?", (category_id,))
    db.commit()
    return _category(db, category_id, _current_month())


@router.post("/categories/{category_id}/plan", status_code=201)
def create_category_plan(category_id: int, plan: CategoryPlanCreate, db: Db) -> CategoryPlan:
    """Appends a new effective-dated plan row — revisions never update in
    place; the latest row per month wins, like every config table."""
    _require(db, "category", category_id, "category")
    cursor = db.execute(
        "INSERT INTO category_plan (category_id, effective_month, planned) VALUES (?, ?, ?)",
        (category_id, plan.effective_month or _current_month(), to_cents(plan.planned)),
    )
    db.commit()
    row = db.execute(
        "SELECT id, category_id, effective_month, planned FROM category_plan WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return CategoryPlan(**(dict(row) | {"planned": to_dollars(row["planned"])}))


def _fund_balance(db: sqlite3.Connection, fund_id: int | None) -> int:
    """The fund's latest stored balance, in cents like everything below:
    the draw-down guards compare and recompute in integers, so spending a
    fund down to exactly its displayed balance can never miss by a float
    fraction."""
    return db.execute(
        "SELECT COALESCE((SELECT e.balance FROM fund_entry e WHERE e.fund_id = ?"
        "                 ORDER BY e.as_of_date DESC, e.id DESC LIMIT 1), 0)",
        (fund_id,),
    ).fetchone()[0]


def _draw_down_fund(
    db: sqlite3.Connection, fund_id: int, amount: float, txn_date: date, detail: str
) -> None:
    """The other half of a fund-funded transaction: append a 'spend'
    fund_entry so the earmark releases as the row lands — appends, never
    updates. detail names the caller in the overdraw 422."""
    balance = _fund_balance(db, fund_id)
    cents = to_cents(amount)
    if cents > balance:
        raise HTTPException(status_code=422, detail=detail)
    db.execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
        " VALUES (?, ?, ?, ?, 'spend')",
        (fund_id, txn_date.isoformat(), balance - cents, -cents),
    )


def _reverse_draw_down(db: sqlite3.Connection, fund_id: int, amount: int) -> None:
    """The compensating half of an expense delete or edit, amount in cents.
    The paired 'spend' entry stays — each entry snapshots the balance, so
    pulling a mid-chain row would not restore it — and the correction
    appends, dated today: snapshots resolve newest-first, so a backdated
    entry carrying the current balance would corrupt the chain.
    'spend'-source entries stay out of the headline, the feed, and the
    budget-year actual, so a correction never moves safe-to-spend."""
    db.execute(
        "INSERT INTO fund_entry (fund_id, as_of_date, balance, contribution, source)"
        " VALUES (?, ?, ?, ?, 'spend')",
        (fund_id, date.today().isoformat(), _fund_balance(db, fund_id) + amount, amount),
    )


@router.post("/expenses", status_code=201)
def create_expense(expense: ExpenseCreate, db: Db) -> Expense:
    _require(db, "category", expense.category_id, "category")
    _require(db, "fund", expense.fund_id, "fund")
    _require(db, "account", expense.account_id, "account")
    if expense.funded_from == "fund" and expense.fund_id is not None:
        _draw_down_fund(
            db, expense.fund_id, expense.amount, expense.txn_date, "expense exceeds fund balance"
        )
    cursor = db.execute(
        "INSERT INTO expense_line (txn_date, budget_month, category_id, amount,"
        " is_fixed, funded_from, fund_id, account_id, note, pending)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            expense.txn_date.isoformat(),
            expense.budget_month or expense.txn_date.strftime("%Y-%m"),
            expense.category_id,
            to_cents(expense.amount),
            expense.is_fixed,
            expense.funded_from,
            expense.fund_id,
            expense.account_id,
            expense.note,
            expense.pending,
        ),
    )
    db.commit()
    row = db.execute(
        "SELECT id, txn_date, budget_month, category_id, amount, is_fixed,"
        " funded_from, fund_id, account_id, note, pending, created_at"
        " FROM expense_line WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return Expense(**(dict(row) | {"amount": to_dollars(row["amount"])}))


@router.put("/expenses/{expense_id}")
def update_expense(expense_id: int, expense: ExpenseCreate, db: Db) -> Expense:
    """Revises the row in place — a full replace under the create body's
    validation, budget_month defaulting from the txn month, so an item can
    be reassigned to the right month (the prepay pattern). Fund funding is
    corrected with compensating entries (see _reverse_draw_down): a
    same-fund amount change appends one delta entry, a changed funding
    source reverses the old draw-down and freshly draws the new. The
    overdraw guard re-applies either way, checked before anything is
    written, so a 422 changes nothing."""
    old = db.execute(
        "SELECT funded_from, fund_id, amount FROM expense_line WHERE id = ?", (expense_id,)
    ).fetchone()
    if old is None:
        raise HTTPException(status_code=404, detail="expense not found")
    _require(db, "category", expense.category_id, "category")
    _require(db, "fund", expense.fund_id, "fund")
    _require(db, "account", expense.account_id, "account")
    old_fund = old["fund_id"] if old["funded_from"] == "fund" else None
    new_fund = expense.fund_id if expense.funded_from == "fund" else None
    amount = to_cents(expense.amount)
    if old_fund is not None and old_fund == new_fund:
        delta = amount - old["amount"]
        if delta > _fund_balance(db, old_fund):
            raise HTTPException(status_code=422, detail="expense exceeds fund balance")
        if delta != 0:
            _reverse_draw_down(db, old_fund, -delta)
    else:
        if new_fund is not None and amount > _fund_balance(db, new_fund):
            raise HTTPException(status_code=422, detail="expense exceeds fund balance")
        if old_fund is not None:
            _reverse_draw_down(db, old_fund, old["amount"])
        if new_fund is not None:
            _reverse_draw_down(db, new_fund, -amount)
    db.execute(
        "UPDATE expense_line SET txn_date = ?, budget_month = ?, category_id = ?, amount = ?,"
        " is_fixed = ?, funded_from = ?, fund_id = ?, account_id = ?, note = ?, pending = ?"
        " WHERE id = ?",
        (
            expense.txn_date.isoformat(),
            expense.budget_month or expense.txn_date.strftime("%Y-%m"),
            expense.category_id,
            amount,
            expense.is_fixed,
            expense.funded_from,
            expense.fund_id,
            expense.account_id,
            expense.note,
            expense.pending,
            expense_id,
        ),
    )
    db.commit()
    row = db.execute(
        "SELECT id, txn_date, budget_month, category_id, amount, is_fixed,"
        " funded_from, fund_id, account_id, note, pending, created_at"
        " FROM expense_line WHERE id = ?",
        (expense_id,),
    ).fetchone()
    return Expense(**(dict(row) | {"amount": to_dollars(row["amount"])}))


@router.delete("/expenses/{expense_id}", status_code=204)
def delete_expense(expense_id: int, db: Db) -> None:
    """Hard delete: nothing references an expense row, so a provisional or
    mistaken entry can simply go. A fund-funded row gets its draw-down
    fully reversed in the same transaction — see _reverse_draw_down."""
    row = db.execute(
        "SELECT funded_from, fund_id, amount FROM expense_line WHERE id = ?", (expense_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="expense not found")
    if row["funded_from"] == "fund" and row["fund_id"] is not None:
        _reverse_draw_down(db, row["fund_id"], row["amount"])
    db.execute("DELETE FROM expense_line WHERE id = ?", (expense_id,))
    db.commit()


@router.post("/income", status_code=201)
def create_income(income: IncomeCreate, db: Db) -> Income:
    _require(db, "account", income.account_id, "account")
    cursor = db.execute(
        "INSERT INTO income_event (txn_date, budget_month, source, amount,"
        " tax_treatment, account_id, source_label, note, pending)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            income.txn_date.isoformat(),
            income.budget_month or income.txn_date.strftime("%Y-%m"),
            income.source,
            to_cents(income.amount),
            income.tax_treatment,
            income.account_id,
            income.source_label,
            income.note,
            income.pending,
        ),
    )
    db.commit()
    row = db.execute(
        "SELECT id, txn_date, budget_month, source, amount, tax_treatment,"
        " account_id, source_label, note, pending, created_at FROM income_event WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return Income(**(dict(row) | {"amount": to_dollars(row["amount"])}))


@router.put("/income/{income_id}")
def update_income(income_id: int, income: IncomeCreate, db: Db) -> Income:
    """Revises the row in place — a full replace under the create body's
    validation, so a blanked title or note really clears. Income rows are
    facts nothing references: fixing an entry mistake is a correction, not
    new history, so the append-only rule stays with the balance tables."""
    _require(db, "income_event", income_id, "income")
    _require(db, "account", income.account_id, "account")
    db.execute(
        "UPDATE income_event SET txn_date = ?, budget_month = ?, source = ?, amount = ?,"
        " tax_treatment = ?, account_id = ?, source_label = ?, note = ?, pending = ?"
        " WHERE id = ?",
        (
            income.txn_date.isoformat(),
            income.budget_month or income.txn_date.strftime("%Y-%m"),
            income.source,
            to_cents(income.amount),
            income.tax_treatment,
            income.account_id,
            income.source_label,
            income.note,
            income.pending,
            income_id,
        ),
    )
    db.commit()
    row = db.execute(
        "SELECT id, txn_date, budget_month, source, amount, tax_treatment,"
        " account_id, source_label, note, pending, created_at FROM income_event WHERE id = ?",
        (income_id,),
    ).fetchone()
    return Income(**(dict(row) | {"amount": to_dollars(row["amount"])}))


@router.delete("/income/{income_id}", status_code=204)
def delete_income(income_id: int, db: Db) -> None:
    """Hard delete: nothing references an income row, so removing a
    provisional or mistaken entry leaves nothing dangling."""
    _require(db, "income_event", income_id, "income")
    db.execute("DELETE FROM income_event WHERE id = ?", (income_id,))
    db.commit()


@router.get("/budget-month")
def budget_month(db: Db, month: Month = None) -> BudgetMonth:
    target = month or _current_month()
    # The headline must see this month's automatic funding even when the
    # funds list was never read, so the lazy catch-up runs here too.
    apply_monthly_plans(db, date.today())
    totals = db.execute(
        "SELECT funded_in, total_spent FROM v_budget_month WHERE month = ?", (target,)
    ).fetchone()
    if totals:
        baseline, total_spent = totals["funded_in"], totals["total_spent"]
    else:
        # No expense rows yet, so no v_budget_month row — but the month may
        # already be funded ahead (prepay); the baseline is still stored income.
        baseline = db.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM income_event WHERE budget_month = ?",
            (target,),
        ).fetchone()[0]
        total_spent = 0

    fund_contributions = db.execute(
        "SELECT COALESCE(SUM(contribution), 0) FROM fund_entry"
        " WHERE source IN ('monthly_plan', 'top_up') AND substr(as_of_date, 1, 7) = ?",
        (target,),
    ).fetchone()[0]

    rollover_assigned = db.execute(
        "SELECT COALESCE(SUM(contribution), 0) FROM fund_entry"
        " WHERE source = 'rollover' AND substr(as_of_date, 1, 7) = ?",
        (target,),
    ).fetchone()[0]

    envelopes = [
        Envelope(
            **(
                dict(row)
                | {"planned": to_dollars(row["planned"]), "spent": to_dollars(row["spent"])}
            ),
            remaining=to_dollars(row["planned"] - row["spent"]),
        )
        for row in db.execute(
            "SELECT c.id, c.name, c.emoji,"
            " COALESCE((SELECT p.planned FROM category_plan p"
            "           WHERE p.category_id = c.id AND p.effective_month <= ?"
            "           ORDER BY p.effective_month DESC, p.id DESC LIMIT 1), 0) AS planned,"
            " COALESCE((SELECT SUM(e.amount) FROM expense_line e"
            "           WHERE e.category_id = c.id AND e.budget_month = ?"
            "           AND e.funded_from = 'discretionary'), 0) AS spent"
            " FROM category c WHERE c.active = 1 ORDER BY c.sort_order, c.id",
            (target, target),
        )
    ]

    # A fund-funded expense posts no category — the fund itself says what
    # the spend was for — so its name rides where the category's would
    # have been; rows carrying both keep the category name.
    expenses = db.execute(
        "SELECT e.id, e.txn_date, e.amount, COALESCE(c.name, f.name) AS category,"
        " e.note, e.created_at, e.category_id, e.funded_from, e.fund_id,"
        " e.account_id, e.is_fixed, e.budget_month, e.pending"
        " FROM expense_line e LEFT JOIN category c ON c.id = e.category_id"
        " LEFT JOIN fund f ON f.id = e.fund_id"
        " WHERE e.budget_month = ?",
        (target,),
    )
    incomes = db.execute(
        "SELECT id, txn_date, amount, source, source_label, note, created_at,"
        " budget_month, tax_treatment, account_id, pending"
        " FROM income_event WHERE budget_month = ?",
        (target,),
    )
    # The feed lists exactly the sources the fund_contributions headline
    # subtracts, so it reconciles with the number above it: a 'spend' row
    # would double-count its expense line, and hand-entered (NULL-source)
    # rows are balance restatements that never touched safe-to-spend.
    # fund_entry has no budget_month, so it scopes by calendar month like
    # the headline does.
    fund_entries = db.execute(
        "SELECT e.id, e.as_of_date AS txn_date, e.contribution AS amount,"
        " f.name AS category, e.source, e.created_at"
        " FROM fund_entry e JOIN fund f ON f.id = e.fund_id"
        " WHERE e.source IN ('monthly_plan', 'top_up') AND substr(e.as_of_date, 1, 7) = ?",
        (target,),
    )
    no_expense_fields = {
        "category_id": None,
        "funded_from": None,
        "fund_id": None,
        "is_fixed": None,
    }
    no_income_fields = {"tax_treatment": None}
    # Each row's stored-cents amount converts as it joins the feed.
    merged = sorted(
        [
            dict(row)
            | {"type": "expense", "source": None, "source_label": None}
            | no_income_fields
            | {"amount": to_dollars(row["amount"])}
            for row in expenses
        ]
        + [
            dict(row)
            | {"type": "income", "category": None}
            | no_expense_fields
            | {"amount": to_dollars(row["amount"])}
            for row in incomes
        ]
        + [
            dict(row)
            | {"type": "fund", "source_label": None, "note": None}
            | no_expense_fields
            | no_income_fields
            | {"account_id": None, "budget_month": None, "pending": None}
            | {"amount": to_dollars(row["amount"])}
            for row in fund_entries
        ],
        key=lambda row: (row["txn_date"], row["created_at"], row["id"]),
        reverse=True,
    )

    # Stored cents all the way down: the headline subtraction happens in
    # integers, and dollars appear only at the response boundary.
    return BudgetMonth(
        month=target,
        baseline=to_dollars(baseline),
        fund_contributions=to_dollars(fund_contributions),
        rollover_assigned=to_dollars(rollover_assigned),
        total_spent=to_dollars(total_spent),
        safe_to_spend=to_dollars(baseline - fund_contributions - total_spent),
        categories=envelopes,
        activity=[ActivityItem.model_validate(row) for row in merged],
    )


@router.get("/budget-year")
def budget_year(db: Db, year: int | None = None) -> BudgetYear:
    """One row per month: planned (annual_target / 12 from the spend plan
    effective for that month — the latest effective_date on or before the
    month's end, so a mid-year revision splits the year) vs actual — the
    month's discretionary spending plus its monthly_plan/top_up fund
    contributions, the money-leaving-the-spendable-pool definition the
    Safe-to-spend headline uses — with the variance (positive = under plan)
    and its within-year running total.

    Months outside data-start → the current month are entirely null — the
    app cannot distinguish "no data" from "spent nothing", so a partial
    year must be visibly partial. The current month rides along flagged
    provisional, since it undercounts until it closes."""
    target_year = year if year is not None else date.today().year
    # Like the budget month, the report must see this month's automatic
    # funding even when the funds list was never read.
    apply_monthly_plans(db, date.today())
    current = _current_month()
    data_start = db.execute("SELECT MIN(budget_month) FROM expense_line").fetchone()[0]

    spent = {
        row["month"]: row["total_spent"]
        for row in db.execute(
            "SELECT month, total_spent FROM v_budget_month WHERE month LIKE ?",
            (f"{target_year:04d}-%",),
        )
    }
    contributed = {
        row["month"]: row["contribution"]
        for row in db.execute(
            "SELECT substr(as_of_date, 1, 7) AS month, SUM(contribution) AS contribution"
            " FROM fund_entry WHERE source IN ('monthly_plan', 'top_up')"
            " AND substr(as_of_date, 1, 4) = ? GROUP BY month",
            (f"{target_year:04d}",),
        )
    }
    plans = db.execute(
        "SELECT substr(effective_date, 1, 7) AS effective_month, annual_target"
        " FROM spend_plan ORDER BY effective_date, id"
    ).fetchall()

    months: list[BudgetYearMonth] = []
    cumulative = 0.0
    for number in range(1, 13):
        month = f"{target_year:04d}-{number:02d}"
        if data_start is None or not data_start <= month <= current:
            months.append(
                BudgetYearMonth(
                    month=month,
                    planned=None,
                    actual=None,
                    variance=None,
                    cumulative_variance=None,
                    provisional=False,
                )
            )
            continue
        planned = next(
            (
                row["annual_target"] / 12
                for row in reversed(plans)
                if row["effective_month"] <= month
            ),
            None,
        )
        actual = to_dollars(spent.get(month, 0) + contributed.get(month, 0))
        variance = planned - actual if planned is not None else None
        if variance is not None:
            cumulative += variance
        months.append(
            BudgetYearMonth(
                month=month,
                planned=planned,
                actual=actual,
                variance=variance,
                cumulative_variance=cumulative if variance is not None else None,
                provisional=month == current,
            )
        )
    return BudgetYear(year=target_year, data_start=data_start, months=months)
