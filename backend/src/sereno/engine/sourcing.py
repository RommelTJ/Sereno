"""Tax-aware withdrawal sourcing: the sequencing waterfall from the
design handoff's Sourcing screen. Target net spend minus non-portfolio
income leaves a gap, filled bucket by bucket in the caller's order —
ETH inside the 0% LTCG headroom, then taxable brokerage, then 401(k).
The headroom is measured in gain dollars (the 0% ceiling minus taxable
ordinary income) and converts to sale proceeds through each bucket's
gain fraction. The engine solves for net spendable — never a flat 4%
per bucket. Pure math over the caller's numbers; loading balances,
basis, and tax parameters is the API layer's job.

v1 simplifications, on purpose: federal only (state_treatment and the
prototype's CA gross-up are out of scope until state brackets exist),
no NIIT (0%-headroom scenarios sit far below the threshold), one-pass
(a 401(k) draw does not retroactively shrink the headroom earlier
steps used), and Social Security reduces the gap without counting as
ordinary income.
"""

from dataclasses import dataclass
from typing import Literal

BucketTreatment = Literal["LTCG", "ORDINARY"]

# The federal rate above the 0% bracket. Flat by design: a gap big
# enough to push realized gains past the 15% → 20% threshold
# (tax_param.ltcg_15_ceiling) is out of scope for v1.
LTCG_RATE = 0.15


@dataclass(frozen=True)
class Bracket:
    rate: float
    upto: float | None


@dataclass(frozen=True)
class Bucket:
    name: str
    balance: float
    basis: float
    treatment: BucketTreatment
    access_age: float | None = None
    headroom_only: bool = False


@dataclass(frozen=True)
class BucketDraw:
    name: str
    treatment: BucketTreatment
    gross: float
    tax: float
    net: float
    note: str | None = None


@dataclass(frozen=True)
class SourcingResult:
    target_net: float
    income: float
    gap: float
    headroom: float
    draws: tuple[BucketDraw, ...]
    net_delivered: float
    shortfall: float


def _gain_fraction(bucket: Bucket) -> float:
    if bucket.balance <= 0:
        return 0.0
    return max(0.0, 1.0 - bucket.basis / bucket.balance)


def _draw_ltcg(bucket: Bucket, needed: float, headroom: float) -> tuple[BucketDraw, float]:
    """Sell inside the 0% headroom first — gain headroom buys headroom/g
    of proceeds (unbounded when nothing is gain), tax-free — then, unless
    the bucket is headroom-only, keep selling at 15% on the gain portion:
    net N costs N / (1 − 0.15·g)."""
    gain_fraction = _gain_fraction(bucket)
    cap = headroom / gain_fraction if gain_fraction > 0 else float("inf")
    free_gross = max(0.0, min(needed, bucket.balance, cap))
    gross, tax, net = free_gross, 0.0, free_gross

    still_needed = needed - free_gross
    balance_left = bucket.balance - free_gross
    if not bucket.headroom_only and still_needed > 0 and balance_left > 0:
        net_rate = 1.0 - gain_fraction * LTCG_RATE
        taxed_gross = min(still_needed / net_rate, balance_left)
        gross += taxed_gross
        tax = taxed_gross * gain_fraction * LTCG_RATE
        net += taxed_gross - tax

    draw = BucketDraw(name=bucket.name, treatment="LTCG", gross=gross, tax=tax, net=net)
    return draw, headroom - free_gross * gain_fraction


def _gross_up_ordinary(
    needed: float,
    balance: float,
    ordinary_income: float,
    std_deduction: float,
    brackets: list[Bracket] | None,
) -> tuple[float, float]:
    """Gross and tax for an ordinary-income withdrawal delivering
    `needed` net, stacked on the caller's ordinary income: the unused
    standard deduction shelters the first gross dollars, then a
    closed-form walk up the brackets. Absent brackets mean no tax to
    model — the config column is nullable — not an error."""
    if not brackets:
        brackets = [Bracket(rate=0.0, upto=None)]
    shelter = max(0.0, std_deduction - ordinary_income)
    gross = min(needed, shelter, balance)
    tax = 0.0
    remaining_net = needed - gross
    remaining_balance = balance - gross
    taxable = max(0.0, ordinary_income - std_deduction)
    for bracket in brackets:
        if remaining_net <= 0 or remaining_balance <= 0:
            break
        capacity = bracket.upto - taxable if bracket.upto is not None else float("inf")
        if capacity <= 0:
            continue
        net_rate = 1.0 - bracket.rate
        take = min(remaining_net / net_rate, capacity, remaining_balance)
        gross += take
        tax += take * bracket.rate
        remaining_net -= take * net_rate
        remaining_balance -= take
        taxable += take
    return gross, tax


def source_withdrawals(
    *,
    target_spend: float,
    age: float,
    income: float,
    ordinary_income: float,
    buckets: list[Bucket],
    ltcg_0_ceiling: float,
    std_deduction: float,
    ordinary_brackets: list[Bracket] | None,
) -> SourcingResult:
    taxable_ordinary = max(0.0, ordinary_income - std_deduction)
    headroom = max(0.0, ltcg_0_ceiling - taxable_ordinary)
    gap = max(0.0, target_spend - income)

    remaining = gap
    remaining_headroom = headroom
    ordinary_running = ordinary_income
    draws: list[BucketDraw] = []
    for bucket in buckets:
        if bucket.treatment == "LTCG":
            draw, remaining_headroom = _draw_ltcg(bucket, remaining, remaining_headroom)
        elif bucket.access_age is not None and age < bucket.access_age:
            draw = BucketDraw(
                name=bucket.name,
                treatment="ORDINARY",
                gross=0.0,
                tax=0.0,
                net=0.0,
                note=f"locked until age {bucket.access_age:g}",
            )
        else:
            gross, tax = _gross_up_ordinary(
                remaining, bucket.balance, ordinary_running, std_deduction, ordinary_brackets
            )
            draw = BucketDraw(
                name=bucket.name, treatment="ORDINARY", gross=gross, tax=tax, net=gross - tax
            )
            ordinary_running += gross
        draws.append(draw)
        remaining -= draw.net

    shortfall = max(0.0, remaining)
    return SourcingResult(
        target_net=target_spend,
        income=income,
        gap=gap,
        headroom=headroom,
        draws=tuple(draws),
        net_delivered=target_spend - shortfall,
        shortfall=shortfall,
    )
