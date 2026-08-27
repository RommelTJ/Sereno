"""The guardrails slice: the Guyton-Klinger engine fed by live balances
and the effective spend plan.

Guardrails are a monitoring tool — given what was actually spent and
what the portfolio is actually worth, am I on track? — so the default
numerator is the trailing twelve complete months of actual spending,
not the plan's annual target. Funding source is deliberately ignored:
money that left the household counts whether it came from income, a
cash buffer, or a portfolio sale, which keeps the measure continuous
across a buffer-to-portfolio transition where literal withdrawals
would read 0% and then spike. Composition: discretionary spend plus
fund outflows, never fund contributions — contributions are the
smoothed plan, outflows the realisation, and counting both would
double-count the same dollar. Until twelve complete months of history
exist the target stands in, with spend_months telling the frontend
how much history backs the figure. ?spend= tests a what-if level.

The denominator excludes non-investable accounts on purpose, not as an
artifact of flags: sinking-fund cash is an earmarked obligation, not a
retirement asset, so a buffer set aside for near-term spending never
counts as backing that spending — which also means depleting it moves
neither term, by design. A consequence of the trailing numerator: the
raise/cut trigger portfolios (spend ÷ rail) drift as actual spending
moves instead of standing still; the twelve-month window damps this,
and it is expected, not a bug.

Null until a spend plan with an initial rate and at least one balance
month exist — the frontend shows an empty state, matching the config
GETs.
"""

import sqlite3
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from sereno.api.config import SpendPlan, get_spend_plan
from sereno.db.connection import get_db
from sereno.engine.guardrails import Zone, evaluate_guardrails
from sereno.money import to_dollars

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]

Spend = Annotated[float | None, Query(gt=0)]

TRAILING_MONTHS = 12


class Guardrails(BaseModel):
    investable: float
    spend: float
    annual_target: float
    spend_source: Literal["actual", "target", "what_if"]
    spend_months: int
    drawdown_start: date | None
    rate: float
    initial_rate: float
    band: float
    lower: float
    upper: float
    zone: Zone
    raise_trigger: float
    cut_trigger: float
    four_percent_spend: float


def _latest_investable(db: sqlite3.Connection, on_or_before: str | None = None) -> float | None:
    """The latest v_net_worth month's investable total, optionally capped
    at a month — the portfolio as it stood then, carry-forward included."""
    row = db.execute(
        "SELECT investable FROM v_net_worth WHERE month <= ? ORDER BY month DESC LIMIT 1",
        (on_or_before or "9999-12",),
    ).fetchone()
    return to_dollars(row["investable"]) if row else None


def _month_str(anchor: date, months_back: int) -> str:
    """'YYYY-MM' for the month months_back before the anchor's month."""
    total = anchor.year * 12 + anchor.month - 1 - months_back
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def _month_index(month: str) -> int:
    year, mon = month.split("-")
    return int(year) * 12 + int(mon) - 1


def _months_available(db: sqlite3.Connection, current_month: str) -> int:
    """Complete months of spending history before current_month, from
    data-start (the first logged expense's budget month, the budget-year
    rule), capped at the window size. The in-progress month never counts:
    it undercounts until it closes."""
    data_start = db.execute("SELECT MIN(budget_month) FROM expense_line").fetchone()[0]
    if data_start is None or data_start >= current_month:
        return 0
    return min(TRAILING_MONTHS, _month_index(current_month) - _month_index(data_start))


def _trailing_spend(db: sqlite3.Connection, window_start: str, window_end: str) -> float:
    """Actual spending over [window_start, window_end): discretionary
    lines plus fund outflows, both keyed by budget month. Fund
    contributions live in fund_entry, which this sum never reads —
    the exclusion is structural. A month with no expense rows inside
    the window simply contributes nothing."""
    total = db.execute(
        "SELECT COALESCE(SUM(total_spent + fund_spent), 0) FROM v_budget_month"
        " WHERE month >= ? AND month < ?",
        (window_start, window_end),
    ).fetchone()[0]
    return to_dollars(total)


def _spend_basis(
    db: sqlite3.Connection, plan: SpendPlan, anchor: date
) -> tuple[float, Literal["actual", "target"], int]:
    """The default numerator as of the anchor date: trailing actual spend
    over the twelve complete months before the anchor's month once that
    much history exists, the plan's annual target until then."""
    anchor_month = _month_str(anchor, 0)
    months = _months_available(db, anchor_month)
    if months >= TRAILING_MONTHS:
        window_start = _month_str(anchor, TRAILING_MONTHS)
        return _trailing_spend(db, window_start, anchor_month), "actual", months
    return plan.annual_target, "target", months


def _stamp_initial_rate(db: sqlite3.Connection, plan: SpendPlan) -> SpendPlan:
    """Capture the anchor from actuals once real drawdown has begun: the
    first read on or after drawdown_start appends a stamped plan row whose
    initial_rate is the resolved rate *as of that date* — deterministic
    however late the server first looks — effective today, since a row
    backdated to drawdown_start would be shadowed by the plan row that
    scheduled it. Set once: the append is fenced on no stamped row since
    drawdown_start (atomically, so racing reads stamp a single row), and
    a later hand revision out-resolves the stamp by insertion order. With
    no balance month on or before drawdown_start yet, the stamp waits."""
    today = date.today()
    if plan.drawdown_start is None or plan.drawdown_start > today:
        return plan
    start = plan.drawdown_start.isoformat()
    already = db.execute(
        "SELECT 1 FROM spend_plan WHERE initial_rate_stamped = 1 AND effective_date >= ?",
        (start,),
    ).fetchone()
    if already:
        return plan
    investable = _latest_investable(db, _month_str(plan.drawdown_start, 0))
    if not investable or investable <= 0:
        return plan
    spend, _, _ = _spend_basis(db, plan, plan.drawdown_start)
    db.execute(
        "INSERT INTO spend_plan (effective_date, annual_target, initial_rate,"
        " guardrail_band, drawdown_start, initial_rate_stamped)"
        " SELECT ?, ?, ?, ?, ?, 1 WHERE NOT EXISTS"
        " (SELECT 1 FROM spend_plan WHERE initial_rate_stamped = 1 AND effective_date >= ?)",
        (
            today.isoformat(),
            plan.annual_target,
            spend / investable,
            plan.guardrail_band,
            start,
            start,
        ),
    )
    db.commit()
    return get_spend_plan(db) or plan


@router.get("/guardrails")
def get_guardrails(db: Db, spend: Spend = None) -> Guardrails | None:
    plan = get_spend_plan(db)
    if plan is None:
        return None
    plan = _stamp_initial_rate(db, plan)
    if plan.initial_rate is None:
        return None
    investable = _latest_investable(db)
    if not investable or investable <= 0:
        return None
    resolved_spend, basis, spend_months = _spend_basis(db, plan, date.today())
    source: Literal["actual", "target", "what_if"] = basis
    if spend is not None:
        tested_spend, source = spend, "what_if"
    else:
        tested_spend = resolved_spend
    decision = evaluate_guardrails(
        spend=tested_spend,
        investable=investable,
        initial_rate=plan.initial_rate,
        band=plan.guardrail_band,
    )
    return Guardrails(
        investable=investable,
        spend=tested_spend,
        annual_target=plan.annual_target,
        spend_source=source,
        spend_months=spend_months,
        drawdown_start=plan.drawdown_start,
        rate=decision.rate,
        initial_rate=plan.initial_rate,
        band=plan.guardrail_band,
        lower=decision.lower,
        upper=decision.upper,
        zone=decision.zone,
        raise_trigger=decision.raise_trigger,
        cut_trigger=decision.cut_trigger,
        four_percent_spend=0.04 * investable,
    )
