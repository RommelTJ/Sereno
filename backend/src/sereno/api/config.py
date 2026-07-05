"""The planning-config slice: effective-dated settings the Plan engines read.

Config rows are append-only; each GET resolves the effective row — the
latest effective_date on or before today, ties broken by insertion order —
the same rule category_plan uses for envelopes. tax_param is keyed by
tax_year instead, so its GET returns every year.
"""

import json
import sqlite3
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from sereno.db.connection import get_db

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]


class Assumption(BaseModel):
    id: int
    effective_date: date
    return_pct: float
    inflation_pct: float
    eth_growth_pct: float | None


class SpendPlan(BaseModel):
    id: int
    effective_date: date
    annual_target: float
    initial_rate: float | None
    guardrail_band: float


class SocialSecurity(BaseModel):
    id: int
    person: Literal["you", "spouse"]
    effective_date: date
    start_age: float
    monthly_amount: float


class Bracket(BaseModel):
    rate: float
    upto: float | None


class TaxParam(BaseModel):
    tax_year: int
    filing_status: str
    ltcg_0_ceiling: float
    ltcg_15_ceiling: float | None
    niit_rate: float
    niit_threshold: float | None
    state_treatment: str
    std_deduction: float | None
    ordinary_brackets: list[Bracket] | None


_SOCIAL_SECURITY_QUERY = (
    "SELECT id, person, effective_date, start_age, monthly_amount FROM ("
    "  SELECT s.*, ROW_NUMBER() OVER ("
    "    PARTITION BY person ORDER BY effective_date DESC, id DESC) AS rn"
    "  FROM social_security s WHERE effective_date <= ?)"
    " WHERE rn = 1 ORDER BY person = 'you' DESC"
)

_TAX_PARAM_QUERY = (
    "SELECT tax_year, filing_status, ltcg_0_ceiling, ltcg_15_ceiling, niit_rate,"
    " niit_threshold, state_treatment, std_deduction, ordinary_brackets"
    " FROM tax_param ORDER BY tax_year"
)


def _effective(db: sqlite3.Connection, table: str, columns: str) -> sqlite3.Row | None:
    return db.execute(
        f"SELECT {columns} FROM {table} WHERE effective_date <= ?"
        " ORDER BY effective_date DESC, id DESC LIMIT 1",
        (date.today().isoformat(),),
    ).fetchone()


def _tax_param(row: sqlite3.Row) -> TaxParam:
    fields = dict(row)
    raw = fields.pop("ordinary_brackets")
    return TaxParam(**fields, ordinary_brackets=json.loads(raw) if raw is not None else None)


@router.get("/assumptions")
def get_assumptions(db: Db) -> Assumption | None:
    row = _effective(
        db, "assumption", "id, effective_date, return_pct, inflation_pct, eth_growth_pct"
    )
    return Assumption(**dict(row)) if row else None


@router.get("/spend-plan")
def get_spend_plan(db: Db) -> SpendPlan | None:
    row = _effective(
        db, "spend_plan", "id, effective_date, annual_target, initial_rate, guardrail_band"
    )
    return SpendPlan(**dict(row)) if row else None


@router.get("/social-security")
def get_social_security(db: Db) -> list[SocialSecurity]:
    rows = db.execute(_SOCIAL_SECURITY_QUERY, (date.today().isoformat(),))
    return [SocialSecurity(**dict(row)) for row in rows]


@router.get("/tax-params")
def list_tax_params(db: Db) -> list[TaxParam]:
    return [_tax_param(row) for row in db.execute(_TAX_PARAM_QUERY)]
