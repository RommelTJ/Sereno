"""The sourcing slice: the tax-aware withdrawal waterfall fed by live
balances, lot-level basis, and the year's tax parameters. Buckets
aggregate accounts by withdrawal_priority; each account contributes
its newest balance row from any month — unlike guardrails'
latest-month total, a bucket last updated months ago still sources
withdrawals — and its basis from open tax lots, falling back to that
balance row's cost_basis, then to zero (all gain, the conservative
read). ?age= is required because no birthdate lives in the schema;
?spend= tests a what-if level and stands in for a missing spend plan.
Null until a tax year, a balance, and a spend target exist.
"""

import sqlite3
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from sereno.api.config import TaxParam, get_social_security, get_spend_plan, list_tax_params
from sereno.db.connection import get_db
from sereno.engine.sourcing import (
    STAKING_INCOME,
    STAKING_MIN_ETH_BALANCE,
    Bracket,
    Bucket,
    source_withdrawals,
)

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]

Spend = Annotated[float | None, Query(gt=0)]

Age = Annotated[float, Query(ge=0)]

ETH_PRIORITY = 1

_PRIORITY_LABELS = {1: "ETH", 2: "Brokerage", 3: "401(k)"}

_LATEST_BALANCES = """
    SELECT a.withdrawal_priority AS priority, a.tax_treatment, a.access_age,
           b.balance_usd, b.cost_basis, b.account_id
    FROM account a
    JOIN (
        SELECT *, ROW_NUMBER() OVER (
            PARTITION BY account_id ORDER BY as_of_date DESC, id DESC
        ) AS rn
        FROM balance_entry
    ) b ON b.account_id = a.id AND b.rn = 1
    WHERE a.withdrawal_priority IS NOT NULL AND a.active = 1 AND a.is_liability = 0
    ORDER BY a.withdrawal_priority
"""

_OPEN_LOT_BASIS = (
    "SELECT COALESCE(SUM(cost_basis), 0) AS basis, COUNT(*) AS lots"
    " FROM tax_lot WHERE account_id = ? AND closed_on IS NULL"
)


class SourcingStep(BaseModel):
    name: str
    treatment: Literal["LTCG", "ORDINARY"]
    gross: float
    tax: float
    net: float
    note: str | None


class Sourcing(BaseModel):
    target_net: float
    annual_target: float | None
    age: float
    tax_year: int
    ss_income: float
    staking_income: float
    income: float
    gap: float
    headroom: float
    steps: list[SourcingStep]
    net_delivered: float
    shortfall: float


def current_tax_param(db: sqlite3.Connection) -> TaxParam | None:
    """The latest loaded year that has started; future years stay staged."""
    current = None
    for param in list_tax_params(db):
        if param.tax_year <= date.today().year:
            current = param
    return current


def _account_basis(db: sqlite3.Connection, account_id: int, cost_basis: float | None) -> float:
    row = db.execute(_OPEN_LOT_BASIS, (account_id,)).fetchone()
    if row["lots"]:
        return row["basis"]
    return cost_basis if cost_basis is not None else 0.0


def load_buckets(db: sqlite3.Connection) -> list[Bucket]:
    grouped: dict[int, Bucket] = {}
    for row in db.execute(_LATEST_BALANCES):
        priority = row["priority"]
        basis = _account_basis(db, row["account_id"], row["cost_basis"])
        existing = grouped.get(priority)
        grouped[priority] = Bucket(
            name=_PRIORITY_LABELS.get(priority, f"Priority {priority}"),
            balance=(existing.balance if existing else 0.0) + row["balance_usd"],
            basis=(existing.basis if existing else 0.0) + basis,
            treatment="ORDINARY" if row["tax_treatment"] == "ORDINARY" else "LTCG",
            access_age=row["access_age"] if existing is None else existing.access_age,
            headroom_only=priority == ETH_PRIORITY,
        )
    return [grouped[priority] for priority in sorted(grouped)]


@router.get("/sourcing")
def get_sourcing(db: Db, age: Age, spend: Spend = None) -> Sourcing | None:
    tax = current_tax_param(db)
    if tax is None:
        return None
    plan = get_spend_plan(db)
    target = spend if spend is not None else (plan.annual_target if plan else None)
    if target is None:
        return None
    buckets = load_buckets(db)
    if not buckets:
        return None

    ss_income = sum(
        12 * entry.monthly_amount for entry in get_social_security(db) if age >= entry.start_age
    )
    eth_balance = sum(b.balance for b in buckets if b.headroom_only)
    staking_income = STAKING_INCOME if eth_balance > STAKING_MIN_ETH_BALANCE else 0.0

    brackets = (
        [Bracket(rate=b.rate, upto=b.upto) for b in tax.ordinary_brackets]
        if tax.ordinary_brackets is not None
        else None
    )
    result = source_withdrawals(
        target_spend=target,
        age=age,
        income=ss_income + staking_income,
        ordinary_income=staking_income,
        buckets=buckets,
        ltcg_0_ceiling=tax.ltcg_0_ceiling,
        std_deduction=tax.std_deduction or 0.0,
        ordinary_brackets=brackets,
    )
    return Sourcing(
        target_net=result.target_net,
        annual_target=plan.annual_target if plan else None,
        age=age,
        tax_year=tax.tax_year,
        ss_income=ss_income,
        staking_income=staking_income,
        income=result.income,
        gap=result.gap,
        headroom=result.headroom,
        steps=[
            SourcingStep(
                name=draw.name,
                treatment=draw.treatment,
                gross=draw.gross,
                tax=draw.tax,
                net=draw.net,
                note=draw.note,
            )
            for draw in result.draws
        ],
        net_delivered=result.net_delivered,
        shortfall=result.shortfall,
    )
