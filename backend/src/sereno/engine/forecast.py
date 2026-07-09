"""The longevity forecast: a year-by-year simulation from the caller's
start age to 100 in today's dollars, composing the sourcing engine.
Each year the
buckets grow by the real rate (return minus inflation) — except the
ETH bucket, which grows at its own nominal rate minus inflation when
eth_growth_pct is given (null keeps the blended rate, so the stored
column stays optional) — the balances
are recorded, and the year's spending need is withdrawn through the
sourcing waterfall — so the 0% LTCG headroom, the gross-ups, and the
59½ gate all apply per simulated year. Growth is all gain (the basis
stays put); a sale reduces the basis pro-rata, so the gain fraction
rises as an appreciating bucket is drawn down. Planned purchases add
their lump to the due year's target and their ongoing delta to every
year from then on, so a lumpy year meets the same non-linear tax
machinery as any other. The first year the
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

END_AGE = 100
BALANCE_CHECK_AGE = 100

# The waterfall's gross-up arithmetic can leave a float residue; a
# shortfall under a cent is a met year, not a run-out.
_SHORTFALL_TOLERANCE = 0.01


@dataclass(frozen=True)
class SocialSecurityBenefit:
    monthly_amount: float
    start_age: float


@dataclass(frozen=True)
class PlannedPurchase:
    """A dated one-off outflow — car, house, gift — with an optional
    ongoing change to annual spend from its year onward. Both amounts
    may be negative (a sale, a cost that ends); a windfall beyond the
    year's need floors the draw at zero without reinvesting the
    surplus. Keyed by age: the engine has no calendar — mapping years
    to ages is the API layer's job."""

    age: int
    amount: float
    ongoing_delta: float = 0.0


@dataclass(frozen=True)
class ForecastPoint:
    age: int
    balances: tuple[float, ...]
    ss_income: float


@dataclass(frozen=True)
class UnaffordablePurchase:
    """A year whose lump didn't fit while the base spend still cleared:
    short is how far the full-target attempt fell — you simply don't
    buy it, which is a different fact from running out of money."""

    age: int
    short: float


@dataclass(frozen=True)
class ForecastResult:
    series: tuple[ForecastPoint, ...]
    run_out_age: int | None
    balance_at_100: float
    unaffordable: tuple[UnaffordablePurchase, ...]


def _grow(bucket: Bucket, real_rate: float) -> Bucket:
    # A real rate at or below −100% empties the bucket; a negative
    # multiplier would invert the balance and corrupt the waterfall.
    return replace(bucket, balance=bucket.balance * max(0.0, 1 + real_rate))


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
    eth_growth_pct: float | None = None,
    buckets: list[Bucket],
    social_security: Sequence[SocialSecurityBenefit] = (),
    purchases: Sequence[PlannedPurchase] = (),
    ltcg_0_ceiling: float,
    std_deduction: float,
    ordinary_brackets: list[Bracket] | None,
) -> ForecastResult:
    real_rate = (return_pct - inflation_pct) / 100
    eth_rate = real_rate if eth_growth_pct is None else (eth_growth_pct - inflation_pct) / 100
    current = list(buckets)
    series: list[ForecastPoint] = []
    run_out_age: int | None = None
    unaffordable: list[UnaffordablePurchase] = []
    for age in range(start_age, END_AGE + 1):
        current = [
            _grow(bucket, eth_rate if bucket.headroom_only else real_rate) for bucket in current
        ]
        ss_income = sum(
            12 * benefit.monthly_amount for benefit in social_security if age >= benefit.start_age
        )
        series.append(
            ForecastPoint(age=age, balances=tuple(b.balance for b in current), ss_income=ss_income)
        )
        eth_balance = sum(b.balance for b in current if b.headroom_only)
        staking_income = STAKING_INCOME if eth_balance > STAKING_MIN_ETH_BALANCE else 0.0
        lump = sum(p.amount for p in purchases if p.age == age)
        ongoing = sum(p.ongoing_delta for p in purchases if age >= p.age)

        year = source_withdrawals(
            target_spend=spend + ongoing + lump,
            age=age,
            income=ss_income + staking_income,
            ordinary_income=staking_income,
            buckets=current,
            ltcg_0_ceiling=ltcg_0_ceiling,
            std_deduction=std_deduction,
            ordinary_brackets=ordinary_brackets,
        )
        if lump > 0 and year.shortfall > _SHORTFALL_TOLERANCE:
            # An unaffordable purchase, not a run-out: the lump simply
            # isn't bought, and the year re-sources at the base target
            # so later years aren't corrupted by a draw that never
            # happens. When even the base target shorts, the run-out
            # below wins and no unaffordable entry is recorded.
            short = year.shortfall
            year = source_withdrawals(
                target_spend=spend + ongoing,
                age=age,
                income=ss_income + staking_income,
                ordinary_income=staking_income,
                buckets=current,
                ltcg_0_ceiling=ltcg_0_ceiling,
                std_deduction=std_deduction,
                ordinary_brackets=ordinary_brackets,
            )
            if year.shortfall <= _SHORTFALL_TOLERANCE:
                unaffordable.append(UnaffordablePurchase(age=age, short=short))
        current = [
            _after_draw(bucket, draw) for bucket, draw in zip(current, year.draws, strict=True)
        ]
        if run_out_age is None and year.shortfall > _SHORTFALL_TOLERANCE:
            run_out_age = age

    balance_at_100 = sum(sum(point.balances) for point in series if point.age == BALANCE_CHECK_AGE)
    return ForecastResult(
        series=tuple(series),
        run_out_age=run_out_age,
        balance_at_100=balance_at_100,
        unaffordable=tuple(unaffordable),
    )
