"""The longevity forecast: a year-by-year simulation from the caller's
start age to 95 in today's dollars, composing the sourcing engine.
Each year the
buckets grow by the real rate (return minus inflation), the balances
are recorded, and the year's spending need is withdrawn through the
sourcing waterfall — so the 0% LTCG headroom, the gross-ups, and the
59½ gate all apply per simulated year. Growth is all gain (the basis
stays put); a sale reduces the basis pro-rata, so the gain fraction
rises as an appreciating bucket is drawn down. The first year the
waterfall cannot deliver the need is the run-out age. Pure math over
the caller's numbers; loading buckets and config is the API layer's
job.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace

from sereno.engine.sourcing import (
    STAKING_INCOME,
    STAKING_MIN_ETH_BALANCE,
    Bracket,
    Bucket,
    BucketDraw,
    source_withdrawals,
)

END_AGE = 95
BALANCE_CHECK_AGE = 90

# The waterfall's gross-up arithmetic can leave a float residue; a
# shortfall under a cent is a met year, not a run-out.
_SHORTFALL_TOLERANCE = 0.01


@dataclass(frozen=True)
class SocialSecurityBenefit:
    monthly_amount: float
    start_age: float


@dataclass(frozen=True)
class ForecastPoint:
    age: int
    balances: tuple[float, ...]
    ss_income: float


@dataclass(frozen=True)
class ForecastResult:
    series: tuple[ForecastPoint, ...]
    run_out_age: int | None
    balance_at_90: float


def _grow(bucket: Bucket, real_rate: float) -> Bucket:
    return replace(bucket, balance=bucket.balance * (1 + real_rate))


def _after_draw(bucket: Bucket, draw: BucketDraw) -> Bucket:
    if draw.gross <= 0 or bucket.balance <= 0:
        return bucket
    sold = draw.gross / bucket.balance
    return replace(bucket, balance=bucket.balance - draw.gross, basis=bucket.basis * (1 - sold))


def simulate_forecast(
    *,
    start_age: int,
    spend: float,
    return_pct: float,
    inflation_pct: float,
    buckets: list[Bucket],
    social_security: Sequence[SocialSecurityBenefit] = (),
    ltcg_0_ceiling: float,
    std_deduction: float,
    ordinary_brackets: list[Bracket] | None,
) -> ForecastResult:
    real_rate = (return_pct - inflation_pct) / 100
    current = list(buckets)
    series: list[ForecastPoint] = []
    run_out_age: int | None = None
    for age in range(start_age, END_AGE + 1):
        current = [_grow(bucket, real_rate) for bucket in current]
        ss_income = sum(
            12 * benefit.monthly_amount for benefit in social_security if age >= benefit.start_age
        )
        series.append(
            ForecastPoint(age=age, balances=tuple(b.balance for b in current), ss_income=ss_income)
        )
        eth_balance = sum(b.balance for b in current if b.headroom_only)
        staking_income = STAKING_INCOME if eth_balance > STAKING_MIN_ETH_BALANCE else 0.0
        year = source_withdrawals(
            target_spend=spend,
            age=age,
            income=ss_income + staking_income,
            ordinary_income=staking_income,
            buckets=current,
            ltcg_0_ceiling=ltcg_0_ceiling,
            std_deduction=std_deduction,
            ordinary_brackets=ordinary_brackets,
        )
        current = [
            _after_draw(bucket, draw) for bucket, draw in zip(current, year.draws, strict=True)
        ]
        if run_out_age is None and year.shortfall > _SHORTFALL_TOLERANCE:
            run_out_age = age

    balance_at_90 = sum(sum(point.balances) for point in series if point.age == BALANCE_CHECK_AGE)
    return ForecastResult(
        series=tuple(series), run_out_age=run_out_age, balance_at_90=balance_at_90
    )
