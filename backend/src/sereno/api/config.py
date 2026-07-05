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

from fastapi import APIRouter, Depends, HTTPException
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


class AssumptionCreate(BaseModel):
    effective_date: date
    return_pct: float
    inflation_pct: float
    eth_growth_pct: float | None = None


class SpendPlanCreate(BaseModel):
    effective_date: date
    annual_target: float
    initial_rate: float | None = None
    guardrail_band: float = 0.20


class SocialSecurityCreate(BaseModel):
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


class TaxParamUpdate(BaseModel):
    """A year's revision (CPA reconciliation). Defaults mirror the schema:
    MFJ, 3.8% NIIT, CA taxes gains as ordinary."""

    filing_status: str = "MFJ"
    ltcg_0_ceiling: float
    ltcg_15_ceiling: float | None = None
    niit_rate: float = 0.038
    niit_threshold: float | None = None
    state_treatment: str = "CA_ordinary"
    std_deduction: float | None = None
    ordinary_brackets: list[Bracket] | None = None


class TaxParamCreate(TaxParamUpdate):
    tax_year: int


_SOCIAL_SECURITY_QUERY = (
    "SELECT id, person, effective_date, start_age, monthly_amount FROM ("
    "  SELECT s.*, ROW_NUMBER() OVER ("
    "    PARTITION BY person ORDER BY effective_date DESC, id DESC) AS rn"
    "  FROM social_security s WHERE effective_date <= ?)"
    " WHERE rn = 1 ORDER BY person = 'you' DESC"
)

_TAX_PARAM_COLUMNS = (
    "tax_year, filing_status, ltcg_0_ceiling, ltcg_15_ceiling, niit_rate,"
    " niit_threshold, state_treatment, std_deduction, ordinary_brackets"
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


def _brackets_json(brackets: list[Bracket] | None) -> str | None:
    return json.dumps([b.model_dump() for b in brackets]) if brackets is not None else None


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
    rows = db.execute(f"SELECT {_TAX_PARAM_COLUMNS} FROM tax_param ORDER BY tax_year")
    return [_tax_param(row) for row in rows]


@router.post("/assumptions", status_code=201)
def create_assumption(assumption: AssumptionCreate, db: Db) -> Assumption:
    cursor = db.execute(
        "INSERT INTO assumption (effective_date, return_pct, inflation_pct, eth_growth_pct)"
        " VALUES (?, ?, ?, ?)",
        (
            assumption.effective_date.isoformat(),
            assumption.return_pct,
            assumption.inflation_pct,
            assumption.eth_growth_pct,
        ),
    )
    db.commit()
    row = db.execute(
        "SELECT id, effective_date, return_pct, inflation_pct, eth_growth_pct"
        " FROM assumption WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return Assumption(**dict(row))


@router.post("/spend-plan", status_code=201)
def create_spend_plan(plan: SpendPlanCreate, db: Db) -> SpendPlan:
    cursor = db.execute(
        "INSERT INTO spend_plan (effective_date, annual_target, initial_rate, guardrail_band)"
        " VALUES (?, ?, ?, ?)",
        (
            plan.effective_date.isoformat(),
            plan.annual_target,
            plan.initial_rate,
            plan.guardrail_band,
        ),
    )
    db.commit()
    row = db.execute(
        "SELECT id, effective_date, annual_target, initial_rate, guardrail_band"
        " FROM spend_plan WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return SpendPlan(**dict(row))


@router.post("/social-security", status_code=201)
def create_social_security(entry: SocialSecurityCreate, db: Db) -> SocialSecurity:
    cursor = db.execute(
        "INSERT INTO social_security (person, effective_date, start_age, monthly_amount)"
        " VALUES (?, ?, ?, ?)",
        (
            entry.person,
            entry.effective_date.isoformat(),
            entry.start_age,
            entry.monthly_amount,
        ),
    )
    db.commit()
    row = db.execute(
        "SELECT id, person, effective_date, start_age, monthly_amount"
        " FROM social_security WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return SocialSecurity(**dict(row))


@router.post("/tax-params", status_code=201)
def create_tax_param(param: TaxParamCreate, db: Db) -> TaxParam:
    brackets = param.ordinary_brackets
    try:
        db.execute(
            "INSERT INTO tax_param (tax_year, filing_status, ltcg_0_ceiling, ltcg_15_ceiling,"
            " niit_rate, niit_threshold, state_treatment, std_deduction, ordinary_brackets)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                param.tax_year,
                param.filing_status,
                param.ltcg_0_ceiling,
                param.ltcg_15_ceiling,
                param.niit_rate,
                param.niit_threshold,
                param.state_treatment,
                param.std_deduction,
                _brackets_json(brackets),
            ),
        )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail=f"tax year {param.tax_year} exists") from exc
    db.commit()
    row = db.execute(
        f"SELECT {_TAX_PARAM_COLUMNS} FROM tax_param WHERE tax_year = ?",
        (param.tax_year,),
    ).fetchone()
    return _tax_param(row)


@router.put("/tax-params/{tax_year}")
def update_tax_param(tax_year: int, param: TaxParamUpdate, db: Db) -> TaxParam:
    """Replace a year's row in place — the one config table keyed by year,
    so a CPA reconciliation is a revision, not an append."""
    cursor = db.execute(
        "UPDATE tax_param SET filing_status = ?, ltcg_0_ceiling = ?, ltcg_15_ceiling = ?,"
        " niit_rate = ?, niit_threshold = ?, state_treatment = ?, std_deduction = ?,"
        " ordinary_brackets = ? WHERE tax_year = ?",
        (
            param.filing_status,
            param.ltcg_0_ceiling,
            param.ltcg_15_ceiling,
            param.niit_rate,
            param.niit_threshold,
            param.state_treatment,
            param.std_deduction,
            _brackets_json(param.ordinary_brackets),
            tax_year,
        ),
    )
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"tax year {tax_year} not found")
    db.commit()
    row = db.execute(
        f"SELECT {_TAX_PARAM_COLUMNS} FROM tax_param WHERE tax_year = ?", (tax_year,)
    ).fetchone()
    return _tax_param(row)
