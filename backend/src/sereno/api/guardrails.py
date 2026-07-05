"""The guardrails slice: the Guyton-Klinger engine fed by live balances
and the effective spend plan. ?spend= tests a what-if level; without it
the plan's annual target is evaluated. Null until a spend plan with an
initial rate and at least one balance month exist — the frontend shows
an empty state, matching the config GETs.
"""

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from sereno.api.config import get_spend_plan
from sereno.db.connection import get_db
from sereno.engine.guardrails import Zone, evaluate_guardrails

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]

Spend = Annotated[float | None, Query(gt=0)]


class Guardrails(BaseModel):
    investable: float
    spend: float
    annual_target: float
    rate: float
    initial_rate: float
    band: float
    lower: float
    upper: float
    zone: Zone
    raise_trigger: float
    cut_trigger: float
    four_percent_spend: float


def _latest_investable(db: sqlite3.Connection) -> float | None:
    row = db.execute("SELECT investable FROM v_net_worth ORDER BY month DESC LIMIT 1").fetchone()
    return row["investable"] if row else None


@router.get("/guardrails")
def get_guardrails(db: Db, spend: Spend = None) -> Guardrails | None:
    plan = get_spend_plan(db)
    if plan is None or plan.initial_rate is None:
        return None
    investable = _latest_investable(db)
    if not investable or investable <= 0:
        return None
    tested_spend = spend if spend is not None else plan.annual_target
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
