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
sliders are what-ifs, only Settings persists config. Planned
purchases ride along the same way: repeated
purchase=year:amount[:ongoing_delta] params map through the derived
age onto the simulation, echo back resolved, and report the years
whose lump didn't fit as unaffordable. The sensitivity
table simulates whole percentages of the latest month's net worth
from 2% to 6%, each level rounded to the nearest $1,000, so the 4%
rule of thumb sits dead center. GET /forecast/max-affordable turns
the same simulation into a solver: the largest $1,000-rounded lump at
?year= that never runs out (or lasts past ?last_to_age=, or keeps
?min_balance_at_100=), under the same overrides and fixed purchase=
params, naming whether the purchase year's own liquidity or long-run
longevity binds. Null until a tax year, balances, a
spend target, and return/inflation figures exist.
"""

import math
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from sereno.api.config import get_assumptions, get_social_security, get_spend_plan
from sereno.api.sourcing import current_age, current_tax_param, load_buckets
from sereno.db.connection import get_db
from sereno.engine.forecast import (
    END_AGE,
    ForecastResult,
    PlannedPurchase,
    SocialSecurityBenefit,
    simulate_forecast,
)
from sereno.engine.sourcing import Bracket, Bucket

router = APIRouter()

Db = Annotated[sqlite3.Connection, Depends(get_db)]

Spend = Annotated[float | None, Query(gt=0)]

Rate = Annotated[float | None, Query()]

Monthly = Annotated[float | None, Query(ge=0)]

StartAge = Annotated[float | None, Query(ge=0)]

Purchases = Annotated[list[str] | None, Query()]

SENSITIVITY_PERCENTAGES = (2, 3, 4, 5, 6)

# The solver's precision: a purchase ceiling is a planning figure, not
# an invoice — $1,000 keeps the search around a dozen simulations.
SOLVER_STEP = 1_000.0

BindingConstraint = Literal["purchase_year_liquidity", "longevity"]

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


class PurchaseOut(BaseModel):
    year: int
    age: int
    amount: float
    ongoing_delta: float


class UnaffordableOut(BaseModel):
    year: int
    age: int
    short: float


class SensitivityRow(BaseModel):
    spend: float
    run_out_age: int | None
    balance_at_100: float


class BaselineOut(BaseModel):
    """The purchase-free outcome, series included, so one call carries
    both where the plan lands and what the purchases cost it."""

    run_out_age: int | None
    balance_at_100: float
    series: list[ForecastPointOut]


class PurchaseCostRow(BaseModel):
    """The outcome with this one purchase dropped — its marginal cost
    given the others stay, the shape of a sensitivity row."""

    year: int
    amount: float
    run_out_age: int | None
    balance_at_100: float


class MaxAffordable(BaseModel):
    """The largest lump at the solve year satisfying the criterion,
    with the outcome at that amount and the constraint that stopped
    anything bigger — the purchase year's own liquidity (it wouldn't
    fit the buckets reachable that year) versus longevity (the plan
    fails its criterion somewhere downstream)."""

    year: int
    age: int
    max_amount: float
    binding_constraint: BindingConstraint
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
    purchases: list[PurchaseOut]
    series: list[ForecastPointOut]
    run_out_age: int | None
    balance_at_100: float
    unaffordable: list[UnaffordableOut]
    baseline: BaselineOut
    purchase_costs: list[PurchaseCostRow]
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


def _parse_purchases(raw: list[str], start_age: int) -> list[PurchaseOut]:
    """purchase=year:amount[:ongoing_delta], the year mapped onto the
    simulation's age axis through the birthdate-derived current age.
    Malformed values, past years, and years beyond the age-100 horizon
    are 422s — a repeated scalar param should be hard to malform
    silently."""
    current_year = date.today().year
    purchases: list[PurchaseOut] = []
    for value in raw:
        parts = value.split(":")
        try:
            if len(parts) not in (2, 3):
                raise ValueError
            year = int(parts[0])
            amount = float(parts[1])
            ongoing_delta = float(parts[2]) if len(parts) == 3 else 0.0
        except ValueError:
            detail = f"malformed purchase {value!r}: use year:amount[:ongoing_delta]"
            raise HTTPException(status_code=422, detail=detail) from None
        age = start_age + (year - current_year)
        if year < current_year:
            detail = f"purchase year {year} is in the past"
            raise HTTPException(status_code=422, detail=detail)
        if age > END_AGE:
            detail = f"purchase year {year} falls beyond age {END_AGE}"
            raise HTTPException(status_code=422, detail=detail)
        purchases.append(
            PurchaseOut(year=year, age=age, amount=amount, ongoing_delta=ongoing_delta)
        )
    return purchases


@dataclass(frozen=True)
class _Resolved:
    """The simulation inputs after config resolution — shared by the
    forecast and the max-affordable solver, so a solve is exactly a
    forecast run over different purchase lists."""

    target: float
    annual_target: float | None
    start_age: int
    return_pct: float
    inflation_pct: float
    eth_growth_pct: float | None
    ss_you: float
    ss_spouse: float
    ss_start: float
    benefits: tuple[SocialSecurityBenefit, ...]
    brackets: list[Bracket] | None
    buckets: list[Bucket]
    tax_year: int
    ltcg_0_ceiling: float
    std_deduction: float

    def simulate(self, spend_level: float, purchases: Sequence[PlannedPurchase]) -> ForecastResult:
        return simulate_forecast(
            start_age=self.start_age,
            spend=spend_level,
            return_pct=self.return_pct,
            inflation_pct=self.inflation_pct,
            eth_growth_pct=self.eth_growth_pct,
            buckets=self.buckets,
            social_security=self.benefits,
            purchases=purchases,
            ltcg_0_ceiling=self.ltcg_0_ceiling,
            std_deduction=self.std_deduction,
            ordinary_brackets=self.brackets,
        )


def _resolve_inputs(
    db: sqlite3.Connection,
    spend: float | None,
    return_pct: float | None,
    inflation_pct: float | None,
    eth_growth_pct: float | None,
    ss_you: float | None,
    ss_spouse: float | None,
    ss_start: float | None,
) -> _Resolved | None:
    """Stored config with the transient overrides applied — None while
    a tax year, balances, a spend target, or the rates are missing."""
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

    return _Resolved(
        target=target,
        annual_target=plan.annual_target if plan else None,
        start_age=current_age(),
        return_pct=resolved_return,
        inflation_pct=resolved_inflation,
        eth_growth_pct=resolved_eth_growth,
        ss_you=resolved_you,
        ss_spouse=resolved_spouse,
        ss_start=resolved_start,
        benefits=(
            SocialSecurityBenefit(
                monthly_amount=resolved_you,
                start_age=benefit_start(you.start_age if you else None),
            ),
            SocialSecurityBenefit(
                monthly_amount=resolved_spouse,
                start_age=benefit_start(spouse.start_age if spouse else None),
            ),
        ),
        brackets=(
            [Bracket(rate=b.rate, upto=b.upto) for b in tax.ordinary_brackets]
            if tax.ordinary_brackets is not None
            else None
        ),
        buckets=buckets,
        tax_year=tax.tax_year,
        ltcg_0_ceiling=tax.ltcg_0_ceiling,
        std_deduction=tax.std_deduction or 0.0,
    )


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
    purchase: Purchases = None,
) -> Forecast | None:
    # Parsed before the prerequisite checks: a malformed purchase is a
    # 422 even on an empty database, like any other invalid param.
    purchases = _parse_purchases(purchase or [], current_age())
    inputs = _resolve_inputs(
        db, spend, return_pct, inflation_pct, eth_growth_pct, ss_you, ss_spouse, ss_start
    )
    if inputs is None:
        return None
    target = inputs.target
    start_age = inputs.start_age
    buckets = inputs.buckets

    engine_purchases = [
        PlannedPurchase(age=p.age, amount=p.amount, ongoing_delta=p.ongoing_delta)
        for p in purchases
    ]

    def sensitivity_row(level: float) -> SensitivityRow:
        outcome = inputs.simulate(level, engine_purchases)
        return SensitivityRow(
            spend=level,
            run_out_age=outcome.run_out_age,
            balance_at_100=outcome.balance_at_100,
        )

    def cost_row(index: int) -> PurchaseCostRow:
        others = engine_purchases[:index] + engine_purchases[index + 1 :]
        outcome = inputs.simulate(target, others)
        return PurchaseCostRow(
            year=purchases[index].year,
            amount=purchases[index].amount,
            run_out_age=outcome.run_out_age,
            balance_at_100=outcome.balance_at_100,
        )

    result = inputs.simulate(target, engine_purchases)
    # With no purchases the headline already is the baseline — no
    # second simulation needed.
    baseline_result = inputs.simulate(target, []) if engine_purchases else result
    return Forecast(
        spend=target,
        annual_target=inputs.annual_target,
        start_age=start_age,
        return_pct=inputs.return_pct,
        inflation_pct=inputs.inflation_pct,
        eth_growth_pct=inputs.eth_growth_pct,
        ss_you=inputs.ss_you,
        ss_spouse=inputs.ss_spouse,
        ss_start=inputs.ss_start,
        tax_year=inputs.tax_year,
        purchases=purchases,
        series=_series(result, buckets),
        run_out_age=result.run_out_age,
        balance_at_100=result.balance_at_100,
        unaffordable=[
            UnaffordableOut(
                year=date.today().year + (miss.age - start_age), age=miss.age, short=miss.short
            )
            for miss in result.unaffordable
        ],
        baseline=BaselineOut(
            run_out_age=baseline_result.run_out_age,
            balance_at_100=baseline_result.balance_at_100,
            series=_series(baseline_result, buckets),
        ),
        purchase_costs=[cost_row(index) for index in range(len(purchases))],
        sensitivity=[sensitivity_row(level) for level in _sensitivity_levels(db)],
    )


@router.get("/forecast/max-affordable")
def get_max_affordable(
    db: Db,
    year: int,
    last_to_age: Annotated[float | None, Query(ge=0, le=END_AGE)] = None,
    min_balance_at_100: Annotated[float | None, Query(ge=0)] = None,
    spend: Spend = None,
    return_pct: Rate = None,
    inflation_pct: Rate = None,
    eth_growth_pct: Rate = None,
    ss_you: Monthly = None,
    ss_spouse: Monthly = None,
    ss_start: StartAge = None,
    purchase: Purchases = None,
) -> MaxAffordable | None:
    start_age = current_age()
    # The solve year validates like any purchase year, and the fixed
    # purchases compose exactly as GET /api/forecast takes them.
    (solve,) = _parse_purchases([f"{year}:0"], start_age)
    fixed = [
        PlannedPurchase(age=p.age, amount=p.amount, ongoing_delta=p.ongoing_delta)
        for p in _parse_purchases(purchase or [], start_age)
    ]
    inputs = _resolve_inputs(
        db, spend, return_pct, inflation_pct, eth_growth_pct, ss_you, ss_spouse, ss_start
    )
    if inputs is None:
        return None

    def outcome(amount: float) -> ForecastResult:
        candidate = PlannedPurchase(age=solve.age, amount=amount)
        return inputs.simulate(inputs.target, [*fixed, candidate])

    def satisfies(result: ForecastResult) -> bool:
        if any(miss.age == solve.age for miss in result.unaffordable):
            return False
        lasts = result.run_out_age is None or (
            last_to_age is not None and result.run_out_age > last_to_age
        )
        if not lasts:
            return False
        return min_balance_at_100 is None or result.balance_at_100 >= min_balance_at_100

    def respond(amount: float, at_amount: ForecastResult, failing: ForecastResult) -> MaxAffordable:
        liquidity = any(miss.age == solve.age for miss in failing.unaffordable)
        return MaxAffordable(
            year=year,
            age=solve.age,
            max_amount=amount,
            binding_constraint="purchase_year_liquidity" if liquidity else "longevity",
            run_out_age=at_amount.run_out_age,
            balance_at_100=at_amount.balance_at_100,
        )

    at_zero = outcome(0.0)
    if not satisfies(at_zero):
        # Nothing is affordable: the plan already fails its criterion
        # with no purchase at all.
        return respond(0.0, at_zero, at_zero)

    # A step above everything owned in the solve year is a safe first
    # failing bracket — except when income above the spend subsidizes
    # the lump, so keep doubling until the criterion truly breaks.
    point = next(p for p in at_zero.series if p.age == solve.age)
    hi = (math.floor(sum(point.balances) / SOLVER_STEP) + 1) * SOLVER_STEP
    failing = outcome(hi)
    while satisfies(failing):
        hi *= 2
        failing = outcome(hi)

    lo, best = 0.0, at_zero
    while hi - lo > SOLVER_STEP:
        mid = round((lo + hi) / 2 / SOLVER_STEP) * SOLVER_STEP
        result = outcome(mid)
        if satisfies(result):
            lo, best = mid, result
        else:
            hi, failing = mid, result
    return respond(lo, best, failing)
