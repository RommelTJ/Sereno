"""Budget facts: categories with planned envelopes, append-only expense and
income entry, and the computed budget month powering Safe-to-spend.

The Safe-to-spend baseline is funded_in from v_budget_month — the sum of the
month's stored income events. It moves only when a funding row is appended,
never when spending lands, so safe_to_spend = funded_in − total_spent.
"""

import sqlite3
from datetime import date, datetime
from typing import Annotated, Literal, Self

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, PositiveFloat, StringConstraints, model_validator

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
    (June pay funds July). fund_id goes with funded_from='fund', never alone."""

    txn_date: date
    budget_month: str | None = Field(None, pattern=r"^\d{4}-\d{2}$")
    category_id: int | None = None
    amount: PositiveFloat
    is_fixed: bool = False
    funded_from: Literal["discretionary", "fund"] = "discretionary"
    fund_id: int | None = None
    account_id: int | None = None
    note: str | None = None

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
    created_at: datetime


class IncomeCreate(BaseModel):
    """budget_month is the month this inflow funds; it defaults to the txn's
    month — the prepay pattern passes the next month (June pay funds July)."""

    txn_date: date
    budget_month: str | None = Field(None, pattern=r"^\d{4}-\d{2}$")
    source: Literal["paycheck", "transfer_in", "staking", "dividend", "interest", "soc_sec"]
    amount: PositiveFloat
    tax_treatment: Literal["ORDINARY", "LTCG", "TAX_FREE"] | None = None
    account_id: int | None = None
    note: str | None = None


class Income(BaseModel):
    id: int
    txn_date: date
    budget_month: str
    source: str
    amount: float
    tax_treatment: str | None
    account_id: int | None
    note: str | None
    created_at: datetime


class Envelope(BaseModel):
    id: int
    name: str
    emoji: str | None
    planned: float
    spent: float
    remaining: float


class ActivityItem(BaseModel):
    type: Literal["expense", "income"]
    id: int
    txn_date: date
    amount: float
    category: str | None
    source: str | None
    note: str | None


class BudgetMonth(BaseModel):
    month: str
    baseline: float
    total_spent: float
    safe_to_spend: float
    categories: list[Envelope]
    activity: list[ActivityItem]


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
    return Category(**dict(row))


@router.get("/categories")
def list_categories(db: Db, month: Month = None) -> list[Category]:
    rows = db.execute(
        "SELECT c.id, c.name, c.emoji, c.is_fixed,"
        " COALESCE((SELECT p.planned FROM category_plan p"
        "           WHERE p.category_id = c.id AND p.effective_month <= ?"
        "           ORDER BY p.effective_month DESC, p.id DESC LIMIT 1), 0) AS planned"
        " FROM category c WHERE c.active = 1 ORDER BY c.id",
        (month or _current_month(),),
    )
    return [Category(**dict(row)) for row in rows]


@router.post("/categories", status_code=201)
def create_category(category: CategoryCreate, db: Db) -> Category:
    duplicate = db.execute(
        "SELECT 1 FROM category WHERE active = 1 AND LOWER(name) = LOWER(?)",
        (category.name,),
    ).fetchone()
    if duplicate:
        raise HTTPException(status_code=409, detail=f"category {category.name!r} exists")
    cursor = db.execute(
        "INSERT INTO category (name, emoji) VALUES (?, ?)",
        (category.name, category.emoji),
    )
    category_id = cursor.lastrowid
    db.execute(
        "INSERT INTO category_plan (category_id, effective_month, planned) VALUES (?, ?, ?)",
        (category_id, category.effective_month or _current_month(), category.planned),
    )
    db.commit()
    row = db.execute(
        "SELECT id, name, emoji, is_fixed FROM category WHERE id = ?", (category_id,)
    ).fetchone()
    return Category(**dict(row), planned=category.planned)


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


@router.post("/categories/{category_id}/plan", status_code=201)
def create_category_plan(category_id: int, plan: CategoryPlanCreate, db: Db) -> CategoryPlan:
    """Appends a new effective-dated plan row — revisions never update in
    place; the latest row per month wins, like every config table."""
    _require(db, "category", category_id, "category")
    cursor = db.execute(
        "INSERT INTO category_plan (category_id, effective_month, planned) VALUES (?, ?, ?)",
        (category_id, plan.effective_month or _current_month(), plan.planned),
    )
    db.commit()
    row = db.execute(
        "SELECT id, category_id, effective_month, planned FROM category_plan WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return CategoryPlan(**dict(row))


@router.post("/expenses", status_code=201)
def create_expense(expense: ExpenseCreate, db: Db) -> Expense:
    _require(db, "category", expense.category_id, "category")
    _require(db, "fund", expense.fund_id, "fund")
    _require(db, "account", expense.account_id, "account")
    cursor = db.execute(
        "INSERT INTO expense_line (txn_date, budget_month, category_id, amount,"
        " is_fixed, funded_from, fund_id, account_id, note)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            expense.txn_date.isoformat(),
            expense.budget_month or expense.txn_date.strftime("%Y-%m"),
            expense.category_id,
            expense.amount,
            expense.is_fixed,
            expense.funded_from,
            expense.fund_id,
            expense.account_id,
            expense.note,
        ),
    )
    db.commit()
    row = db.execute(
        "SELECT id, txn_date, budget_month, category_id, amount, is_fixed,"
        " funded_from, fund_id, account_id, note, created_at"
        " FROM expense_line WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return Expense(**dict(row))


@router.post("/income", status_code=201)
def create_income(income: IncomeCreate, db: Db) -> Income:
    _require(db, "account", income.account_id, "account")
    cursor = db.execute(
        "INSERT INTO income_event (txn_date, budget_month, source, amount,"
        " tax_treatment, account_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            income.txn_date.isoformat(),
            income.budget_month or income.txn_date.strftime("%Y-%m"),
            income.source,
            income.amount,
            income.tax_treatment,
            income.account_id,
            income.note,
        ),
    )
    db.commit()
    row = db.execute(
        "SELECT id, txn_date, budget_month, source, amount, tax_treatment,"
        " account_id, note, created_at FROM income_event WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return Income(**dict(row))


@router.get("/budget-month")
def budget_month(db: Db, month: Month = None) -> BudgetMonth:
    target = month or _current_month()
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

    envelopes = [
        Envelope(**dict(row), remaining=row["planned"] - row["spent"])
        for row in db.execute(
            "SELECT c.id, c.name, c.emoji,"
            " COALESCE((SELECT p.planned FROM category_plan p"
            "           WHERE p.category_id = c.id AND p.effective_month <= ?"
            "           ORDER BY p.effective_month DESC, p.id DESC LIMIT 1), 0) AS planned,"
            " COALESCE((SELECT SUM(e.amount) FROM expense_line e"
            "           WHERE e.category_id = c.id AND e.budget_month = ?), 0) AS spent"
            " FROM category c WHERE c.active = 1 ORDER BY c.id",
            (target, target),
        )
    ]

    expenses = db.execute(
        "SELECT e.id, e.txn_date, e.amount, c.name AS category, e.note, e.created_at"
        " FROM expense_line e LEFT JOIN category c ON c.id = e.category_id"
        " WHERE e.budget_month = ?",
        (target,),
    )
    incomes = db.execute(
        "SELECT id, txn_date, amount, source, note, created_at"
        " FROM income_event WHERE budget_month = ?",
        (target,),
    )
    merged = sorted(
        [dict(row) | {"type": "expense", "source": None} for row in expenses]
        + [dict(row) | {"type": "income", "category": None} for row in incomes],
        key=lambda row: (row["txn_date"], row["created_at"], row["id"]),
        reverse=True,
    )

    return BudgetMonth(
        month=target,
        baseline=baseline,
        total_spent=total_spent,
        safe_to_spend=baseline - total_spent,
        categories=envelopes,
        activity=[ActivityItem.model_validate(row) for row in merged],
    )
