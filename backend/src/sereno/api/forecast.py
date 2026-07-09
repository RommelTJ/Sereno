"""The forecast slice: the longevity simulation fed by live buckets
and the stored planning config. The start age derives from the
sanitized BIRTHDATE constant (today's date against January 1, 1988)
and is echoed in the response so the frontend never hardcodes it.
Spend defaults to the plan's annual
target, return, inflation, and ETH growth to the assumptions row (a
null ETH growth keeps the ETH bucket on the blended rate — the column
is optional, never a prerequisite), and Social
Security to the per-person stored rows (each on its own start age);
the query params override each transiently — the Forecast screen's
sliders are what-ifs, only Settings persists config. The sensitivity
table simulates whole percentages of the latest month's net worth
from 2% to 6%, each level rounded to the nearest $1,000, so the 4%
rule of thumb sits dead center. Null until a tax year, balances, a
spend target, and return/inflation figures exist.
"""

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from sereno.api.config import get_assumptions, get_social_security, get_spend_plan
from sereno.api.sourcing import current_age, current_tax_param, load_buckets
from sereno.db.connection import get_db
from sereno.engine.forecast import ForecastResult, SocialSecurityBenefit, simulate_forecast
from sereno.engine.sourcing import Bracket, Bucket

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]

Spend = Annotated[float | None, Query(gt=0)]

Rate = Annotated[float | None, Query()]

Monthly = Annotated[float | None, Query(ge=0)]

StartAge = Annotated[float | None, Query(ge=0)]

SENSITIVITY_PERCENTAGES = (2, 3, 4, 5, 6)

# The handoff's Social Security start age — the fallback when neither
# a stored row nor ?ss_start= supplies one (the panel needs a value).
DEFAULT_SS_START_AGE = 67.0

_LATEST_NET_WORTH = "SELECT net_worth FROM v_net_worth ORDER BY month DESC LIMIT 1"


class ForecastPointOut(BaseModel):
    age: int
    eth: float
    brokerage: float
    retirement: float
    ss_income: float


class SensitivityRow(BaseModel):
    spend: float
    run_out_age: int | None
    balance_at_100: float


class Forecast(BaseModel):
    spend: float
    annual_target: float | None
    start_age: int
    return_pct: float
    inflation_pct: float
    eth_growth_pct: float | None
    ss_you: float
    ss_spouse: float
    ss_start: float
    tax_year: int
    series: list[ForecastPointOut]
    run_out_age: int | None
    balance_at_100: float
    sensitivity: list[SensitivityRow]


def _series(result: ForecastResult, buckets: list[Bucket]) -> list[ForecastPointOut]:
    by_name = {bucket.name: index for index, bucket in enumerate(buckets)}

    def balance(balances: tuple[float, ...], name: str) -> float:
        index = by_name.get(name)
        return balances[index] if index is not None else 0.0

    return [
        ForecastPointOut(
            age=point.age,
            eth=balance(point.balances, "ETH"),
            brokerage=balance(point.balances, "Brokerage"),
            retirement=balance(point.balances, "401(k)"),
            ss_income=point.ss_income,
        )
        for point in result.series
    ]


def _sensitivity_levels(db: sqlite3.Connection) -> list[float]:
    row = db.execute(_LATEST_NET_WORTH).fetchone()
    net_worth = row["net_worth"] if row else 0.0
    return [round(net_worth * pct / 100 / 1_000) * 1_000.0 for pct in SENSITIVITY_PERCENTAGES]


@router.get("/forecast")
def get_forecast(
    db: Db,
    spend: Spend = None,
    return_pct: Rate = None,
    inflation_pct: Rate = None,
    eth_growth_pct: Rate = None,
    ss_you: Monthly = None,
    ss_spouse: Monthly = None,
    ss_start: StartAge = None,
) -> Forecast | None:
    tax = current_tax_param(db)
    if tax is None:
        return None
    plan = get_spend_plan(db)
    target = spend if spend is not None else (plan.annual_target if plan else None)
    assumptions = get_assumptions(db)
    resolved_return = (
        return_pct if return_pct is not None else (assumptions.return_pct if assumptions else None)
    )
    resolved_inflation = (
        inflation_pct
        if inflation_pct is not None
        else (assumptions.inflation_pct if assumptions else None)
    )
    resolved_eth_growth = (
        eth_growth_pct
        if eth_growth_pct is not None
        else (assumptions.eth_growth_pct if assumptions else None)
    )
    if target is None or resolved_return is None or resolved_inflation is None:
        return None
    buckets = load_buckets(db)
    if not buckets:
        return None

    stored = {entry.person: entry for entry in get_social_security(db)}
    you = stored.get("you")
    spouse = stored.get("spouse")
    resolved_you = ss_you if ss_you is not None else (you.monthly_amount if you else 0.0)
    resolved_spouse = (
        ss_spouse if ss_spouse is not None else (spouse.monthly_amount if spouse else 0.0)
    )
    # The panel's single "from age": ?ss_start= moves both people;
    # otherwise each keeps their stored start age and the echoed
    # ss_start shows the "you" row's (the panel's starting value).
    stored_start = you.start_age if you else (spouse.start_age if spouse else None)
    if ss_start is not None:
        resolved_start = ss_start
    elif stored_start is not None:
        resolved_start = stored_start
    else:
        resolved_start = DEFAULT_SS_START_AGE

    def benefit_start(entry_start: float | None) -> float:
        if ss_start is not None:
            return ss_start
        return entry_start if entry_start is not None else resolved_start

    benefits = [
        SocialSecurityBenefit(
            monthly_amount=resolved_you, start_age=benefit_start(you.start_age if you else None)
        ),
        SocialSecurityBenefit(
            monthly_amount=resolved_spouse,
            start_age=benefit_start(spouse.start_age if spouse else None),
        ),
    ]

    brackets = (
        [Bracket(rate=b.rate, upto=b.upto) for b in tax.ordinary_brackets]
        if tax.ordinary_brackets is not None
        else None
    )

    start_age = current_age()

    def simulate(spend_level: float) -> ForecastResult:
        return simulate_forecast(
            start_age=start_age,
            spend=spend_level,
            return_pct=resolved_return,
            inflation_pct=resolved_inflation,
            eth_growth_pct=resolved_eth_growth,
            buckets=buckets,
            social_security=benefits,
            ltcg_0_ceiling=tax.ltcg_0_ceiling,
            std_deduction=tax.std_deduction or 0.0,
            ordinary_brackets=brackets,
        )

    def sensitivity_row(level: float) -> SensitivityRow:
        outcome = simulate(level)
        return SensitivityRow(
            spend=level,
            run_out_age=outcome.run_out_age,
            balance_at_100=outcome.balance_at_100,
        )

    result = simulate(target)
    return Forecast(
        spend=target,
        annual_target=plan.annual_target if plan else None,
        start_age=start_age,
        return_pct=resolved_return,
        inflation_pct=resolved_inflation,
        eth_growth_pct=resolved_eth_growth,
        ss_you=resolved_you,
        ss_spouse=resolved_spouse,
        ss_start=resolved_start,
        tax_year=tax.tax_year,
        series=_series(result, buckets),
        run_out_age=result.run_out_age,
        balance_at_100=result.balance_at_100,
        sensitivity=[sensitivity_row(level) for level in _sensitivity_levels(db)],
    )
