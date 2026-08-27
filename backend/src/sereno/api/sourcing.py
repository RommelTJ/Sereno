"""The sourcing slice: the tax-aware withdrawal waterfall fed by live
balances, lot-level basis, and the year's tax parameters. Buckets
aggregate accounts by withdrawal_priority; each account contributes
its newest balance row from any month — unlike guardrails'
latest-month total, a bucket last updated months ago still sources
withdrawals — and its basis from open tax lots, falling back to that
balance row's cost_basis, then to zero (all gain, the conservative
read). Each account's tax_treatment maps to how the engine prices the
bucket — ordinary income, capital gains, or tax-free — with LTCG the
fallback for anything unrecognised. ?age= defaults to the current age derived from the sanitized
BIRTHDATE constant (no birthdate lives in the schema) and evaluates a
what-if age;
?spend= tests a what-if level and stands in for a missing spend plan.
Null until a tax year, a balance, and a spend target exist.
"""

import sqlite3
from dataclasses import dataclass
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
    BucketTreatment,
    source_withdrawals,
)
from sereno.money import to_dollars

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]

Spend = Annotated[float | None, Query(gt=0)]

Age = Annotated[float | None, Query(ge=0)]

ETH_PRIORITY = 1

# Deliberately sanitized — the repo is public, so this is not a real
# birthday. It anchors the planners' derived current age; no birthdate
# lives in the schema.
BIRTHDATE = date(1988, 1, 1)

_PRIORITY_LABELS = {1: "ETH", 2: "Brokerage", 3: "401(k)", 4: "HSA"}

# The account dimension's tax_treatment mapped onto what the engine can
# price. LTCG is the fallback rather than a fourth branch: NONE — and
# anything unrecognised — on an account someone gave a withdrawal
# priority is a taxable holding, which is the conservative read.
_BUCKET_TREATMENTS: dict[str, BucketTreatment] = {
    "LTCG": "LTCG",
    "ORDINARY": "ORDINARY",
    "TAX_FREE": "TAX_FREE",
}

_TREATMENT_LABELS: dict[BucketTreatment, str] = {
    "LTCG": "capital gains",
    "ORDINARY": "ordinary",
    "TAX_FREE": "tax-free",
}

# Display order inside a tier: whose money it is, read the way a person
# reads it. An unrecognised or missing owner sorts last.
_OWNER_ORDER = {"you": 0, "spouse": 1, "joint": 2}

_LATEST_BALANCES = """
    SELECT a.withdrawal_priority AS priority, a.tax_treatment, a.access_age, a.owner,
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
    treatment: Literal["LTCG", "ORDINARY", "TAX_FREE"]
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


def current_age(today: date | None = None) -> int:
    """Whole years since BIRTHDATE — the planners' derived age."""
    today = today or date.today()
    before_birthday = (today.month, today.day) < (BIRTHDATE.month, BIRTHDATE.day)
    return today.year - BIRTHDATE.year - int(before_birthday)


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


@dataclass(frozen=True)
class _BucketKey:
    """What makes two accounts one bucket: the tier they sit in, how the
    engine prices them, when they unlock, and — only where there is a
    gate to read against an age — whose they are. Owner is deliberately
    dropped from the key for an ungated account: it cannot change that
    account's answer, so it must not fragment the tier either."""

    priority: int
    treatment: BucketTreatment
    access_age: float | None
    owner: str | None


def _bucket_key(row: sqlite3.Row) -> _BucketKey:
    access_age = row["access_age"]
    return _BucketKey(
        priority=row["priority"],
        treatment=_BUCKET_TREATMENTS.get(row["tax_treatment"], "LTCG"),
        access_age=access_age,
        owner=row["owner"] if access_age is not None else None,
    )


def _bucket_order(key: _BucketKey) -> tuple[int, float, int, str]:
    """Tier first, then the money that unlocks soonest — an ungated
    bucket is reachable now — then the owner, then the treatment so two
    otherwise identical keys still order deterministically."""
    return (
        key.priority,
        key.access_age if key.access_age is not None else float("-inf"),
        _OWNER_ORDER.get(key.owner or "", len(_OWNER_ORDER)),
        key.treatment,
    )


def _bucket_names(keys: list[_BucketKey]) -> dict[_BucketKey, str]:
    """A tier that yields one bucket keeps its plain label; where it
    splits, each name carries only the parts that actually differ, so
    "401(k)" becomes "401(k) · you" and "401(k) · spouse" without
    naming a treatment or a gate age they share."""
    by_priority: dict[int, list[_BucketKey]] = {}
    for key in keys:
        by_priority.setdefault(key.priority, []).append(key)

    names: dict[_BucketKey, str] = {}
    for priority, group in by_priority.items():
        label = _PRIORITY_LABELS.get(priority, f"Priority {priority}")
        vary_owner = len({key.owner for key in group}) > 1
        vary_treatment = len({key.treatment for key in group}) > 1
        vary_access_age = len({key.access_age for key in group}) > 1
        for key in group:
            parts = [label]
            if vary_owner:
                parts.append(key.owner or "unassigned")
            if vary_treatment:
                parts.append(_TREATMENT_LABELS[key.treatment])
            if vary_access_age:
                parts.append("no gate" if key.access_age is None else f"from {key.access_age:g}")
            names[key] = " · ".join(parts)
    return names


def load_buckets(db: sqlite3.Connection) -> list[Bucket]:
    totals: dict[_BucketKey, tuple[float, float]] = {}
    for row in db.execute(_LATEST_BALANCES):
        key = _bucket_key(row)
        balance, basis = totals.get(key, (0.0, 0.0))
        totals[key] = (
            balance + to_dollars(row["balance_usd"]),
            basis + _account_basis(db, row["account_id"], row["cost_basis"]),
        )

    keys = sorted(totals, key=_bucket_order)
    names = _bucket_names(keys)
    return [
        Bucket(
            name=names[key],
            balance=totals[key][0],
            basis=totals[key][1],
            treatment=key.treatment,
            access_age=key.access_age,
            headroom_only=key.priority == ETH_PRIORITY,
        )
        for key in keys
    ]


@router.get("/sourcing")
def get_sourcing(db: Db, age: Age = None, spend: Spend = None) -> Sourcing | None:
    resolved_age = age if age is not None else float(current_age())
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
        12 * entry.monthly_amount
        for entry in get_social_security(db)
        if resolved_age >= entry.start_age
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
        age=resolved_age,
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
        age=resolved_age,
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
