"""Tax-aware withdrawal sourcing: the sequencing waterfall from the
design handoff's Sourcing screen. Target net spend minus non-portfolio
income leaves a gap, filled bucket by bucket in the caller's order —
ETH to exhaustion, then taxable brokerage, then 401(k). The ordinary
part of that income — staking rewards — owes tax in the year it lands,
sheltered by the standard deduction and then walked up the brackets,
and only its after-tax amount is credited against the gap; the same
figure shrinks the headroom, so the two halves of the trade stay
consistent. The headroom
is measured in gain dollars (the 0% ceiling minus taxable ordinary
income, plus whatever standard deduction that income left unused)
and converts to sale proceeds through each bucket's gain
fraction; it bounds what a bucket sells tax-free, never how much it
sells, so an LTCG bucket keeps going at 15% on the gain portion once
the free ceiling is spent. A tax-free bucket — a Roth, or an HSA spent on
qualified expenses — is neither taxed as gain nor stacked on ordinary
income, so it comes out whole. Any bucket may carry an access_age,
which gates it whatever its treatment, read against its owner's age —
age_offset carries how far that owner sits from the caller's age axis,
so two people of different ages share one simulation without the
engine ever learning whose bucket is whose. The engine solves for net
spendable — never a flat 4% per bucket. State tax rides on the same
walk: under CA_ordinary the state taxes ordinary income and realized
gains alike, so every draw is grossed up for the federal leg and the
state leg together — each from its own position in its own table,
with its own deduction — and reports the two halves apart, because a
year the federal 0% bracket covers still owes the state. Pure math
over the caller's numbers; loading balances, basis, and tax
parameters is the API layer's job.

v1 simplifications, on purpose: no NIIT (0%-headroom scenarios sit
far below the threshold), no per-bucket state exemption (Treasury
interest is state-exempt, but no bucket says so yet), one-pass (a
401(k) draw does not retroactively shrink the headroom earlier steps
used — so in a year that sells past the headroom and then taps the
401(k), both claim the same unused standard deduction), and Social
Security reduces the gap without counting as ordinary income.
"""

from dataclasses import dataclass
from typing import Literal

BucketTreatment = Literal["LTCG", "ORDINARY", "TAX_FREE"]

# How the state prices the year: CA_ordinary taxes ordinary income and
# realized gains alike, walked up one table; NONE is a state with no
# income tax at all.
StateTreatment = Literal["CA_ordinary", "NONE"]

# The federal rate above the 0% bracket. Flat by design: a gap big
# enough to push realized gains past the 15% → 20% threshold
# (tax_param.ltcg_15_ceiling) is out of scope for v1.
LTCG_RATE = 0.15


@dataclass(frozen=True)
class Bracket:
    rate: float
    upto: float | None


@dataclass(frozen=True)
class StateTax:
    """The year's state schedule. Absent brackets under CA_ordinary mean
    no schedule entered — nothing is charged, and the API layer is what
    says so — the same null-safety ordinary_brackets has. The exemption
    credit is flat and non-refundable: it comes off the year's first
    state tax, whichever income owes it."""

    treatment: StateTreatment
    brackets: list[Bracket] | None
    std_deduction: float
    exemption_credit: float

    @property
    def modelled(self) -> bool:
        return self.treatment == "CA_ordinary" and bool(self.brackets)


NO_STATE_TAX = StateTax(treatment="NONE", brackets=None, std_deduction=0.0, exemption_credit=0.0)


@dataclass(frozen=True)
class Bucket:
    name: str
    balance: float
    basis: float
    treatment: BucketTreatment
    access_age: float | None = None
    # The owner's age minus the caller's: 0 when the bucket is gated on
    # the age passed in, negative when its owner is younger than that.
    age_offset: float = 0.0
    # Which bucket is ETH: the forecast grows it at the ETH rate and
    # the staking rule reads its balance. Identity, not draw policy —
    # the waterfall sells it like any other LTCG bucket.
    is_eth: bool = False


@dataclass(frozen=True)
class BucketDraw:
    name: str
    treatment: BucketTreatment
    gross: float
    # The whole tax cost of the draw, and its two halves: the split is
    # the interesting part in a year the federal 0% bracket covers.
    tax: float
    federal_tax: float
    state_tax: float
    net: float
    note: str | None = None


@dataclass(frozen=True)
class SourcingResult:
    target_net: float
    income: float
    # The tax owed on the caller's own ordinary income, charged against
    # the income before it is credited to the gap — federal and state
    # together, and each on its own.
    ordinary_tax: float
    federal_ordinary_tax: float
    state_ordinary_tax: float
    gap: float
    headroom: float
    draws: tuple[BucketDraw, ...]
    net_delivered: float
    shortfall: float


def staking_income(eth_balance: float, staking_yield_pct: float | None) -> float:
    """The year's staking income: the yield on the balance actually
    staked, so it falls with the stack as the position is drawn down
    and reaches zero when the stack does. The rate is effective-dated
    config like the other rates; a null one models no staking income."""
    if staking_yield_pct is None:
        return 0.0
    return eth_balance * staking_yield_pct / 100


def _gain_fraction(bucket: Bucket) -> float:
    if bucket.balance <= 0:
        return 0.0
    return max(0.0, 1.0 - bucket.basis / bucket.balance)


# Below this much net still owed, a draw is filled: a closed-form take
# leaves float dust, never a dollar.
_NET_EPSILON = 1e-9


def _segments(position: float, brackets: list[Bracket] | None) -> list[tuple[float, float]]:
    """A rate schedule read from where the taxpayer already stands, as
    (rate, room) pairs: a negative position is deduction still unused —
    a leading 0% segment — then each bracket's remaining room, the open
    top bracket unbounded. Absent brackets are one unbounded 0%."""
    if not brackets:
        return [(0.0, float("inf"))]
    segments: list[tuple[float, float]] = []
    if position < 0:
        segments.append((0.0, -position))
        position = 0.0
    for bracket in brackets:
        ceiling = bracket.upto if bracket.upto is not None else float("inf")
        room = ceiling - position
        if room <= 0:
            continue
        segments.append((bracket.rate, room))
        position = ceiling
    return segments


@dataclass
class _Leg:
    """One tax's view of a draw: the share of each gross dollar it sees
    (the gain fraction for a sale, all of it for an ordinary draw), the
    schedule ahead of it, any flat credit still to take off the next
    tax it would owe, and the tax it has accrued."""

    fraction: float
    segments: list[tuple[float, float]]
    credit: float = 0.0
    tax: float = 0.0

    def taxed(self, gross: float) -> float:
        return gross * self.fraction


@dataclass(frozen=True)
class _StatePosition:
    """Where the state walk stands between draws: the taxable income
    reached so far (negative while the deduction is unused) and the
    exemption credit not yet consumed."""

    taxable: float
    credit: float


def _state_leg(position: _StatePosition, state: StateTax, fraction: float) -> _Leg | None:
    if not state.modelled:
        return None
    return _Leg(fraction, _segments(position.taxable, state.brackets), credit=position.credit)


def _walk(needed: float, balance: float, legs: list[_Leg]) -> float:
    """The net delivered for `needed` out of `balance` under every leg
    at once, each leg left holding its tax. Each step runs to the
    nearest boundary — a leg's next bracket, the balance, or the need —
    at a closed-form net rate of 1 − Σ rate·fraction, then every leg
    advances by its share. A leg with no schedule left ends the draw,
    as an ordinary walk always has: a table without an open top bracket
    caps what it can price. A filled need is reported whole, not less
    the float dust the last step leaves."""
    remaining_net = needed
    remaining_balance = balance
    while remaining_net > _NET_EPSILON and remaining_balance > 0:
        if any(not leg.segments for leg in legs):
            break
        net_rate = 1.0
        cap = remaining_balance
        for leg in legs:
            rate, room = leg.segments[0]
            if leg.fraction <= 0:
                continue
            if leg.credit > 0 and rate > 0:
                # A credit is a stretch of the schedule at an effective
                # 0%: it lasts credit/rate of taxable dollars, and the
                # gross-up runs to that boundary like any other.
                cap = min(cap, min(room, leg.credit / rate) / leg.fraction)
            else:
                net_rate -= rate * leg.fraction
                cap = min(cap, room / leg.fraction)
        take = min(remaining_net / net_rate, cap)
        remaining_net -= take * net_rate
        remaining_balance -= take
        for leg in legs:
            rate, room = leg.segments[0]
            used = leg.taxed(take)
            owed = used * rate
            covered = min(owed, leg.credit)
            leg.credit -= covered
            leg.tax += owed - covered
            if leg.fraction > 0 and room - used <= _NET_EPSILON:
                leg.segments.pop(0)
            else:
                leg.segments[0] = (rate, room - used)
    return needed - max(0.0, remaining_net) if remaining_net > _NET_EPSILON else needed


def _draw_ltcg(
    bucket: Bucket, needed: float, headroom: float, position: _StatePosition, state: StateTax
) -> tuple[BucketDraw, float, _StatePosition]:
    """Sell inside the 0% headroom first — gain headroom buys headroom/g
    of proceeds (unbounded when nothing is gain), free of federal tax —
    then keep selling at 15% on the gain portion. The state, where it
    taxes gains as ordinary income, walks the same gain dollars up its
    own table from wherever the year's income already put it, so a sale
    the federal headroom leaves free still nets less than it grosses.
    The headroom is where the bucket stops being free, not where it
    stops: only the balance and the need bound the draw."""
    gain_fraction = _gain_fraction(bucket)
    federal = _Leg(gain_fraction, [(0.0, headroom), (LTCG_RATE, float("inf"))])
    state_leg = _state_leg(position, state, gain_fraction)
    net = _walk(needed, bucket.balance, [federal] + ([state_leg] if state_leg else []))
    federal_tax = federal.tax
    state_tax = state_leg.tax if state_leg else 0.0
    tax = federal_tax + state_tax
    gross = net + tax
    draw = BucketDraw(
        name=bucket.name,
        treatment="LTCG",
        gross=gross,
        tax=tax,
        federal_tax=federal_tax,
        state_tax=state_tax,
        net=net,
    )
    gain = gross * gain_fraction
    credit = state_leg.credit if state_leg else position.credit
    return draw, max(0.0, headroom - gain), _StatePosition(position.taxable + gain, credit)


def _draw_tax_free(bucket: Bucket, needed: float) -> BucketDraw:
    """A Roth or an HSA spent on qualified expenses: the withdrawal
    realizes no gain and stacks on no ordinary income, so gross is net
    and the balance is the only limit. It leaves the 0% LTCG headroom
    untouched for the buckets behind it."""
    gross = max(0.0, min(needed, bucket.balance))
    return BucketDraw(
        name=bucket.name,
        treatment="TAX_FREE",
        gross=gross,
        tax=0.0,
        federal_tax=0.0,
        state_tax=0.0,
        net=gross,
    )


def _gross_up_ordinary(
    needed: float,
    balance: float,
    ordinary_income: float,
    std_deduction: float,
    brackets: list[Bracket] | None,
    position: _StatePosition,
    state: StateTax,
) -> tuple[float, float, float, float]:
    """Net, federal tax, state tax, and the state credit left for an
    ordinary-income withdrawal delivering `needed`, stacked on the
    caller's ordinary income: the
    unused standard deduction shelters the first gross dollars, then a
    closed-form walk up the brackets — both tables at once where the
    state is modelled, each from its own position, since the state's
    shelter is smaller and its walk already counts the year's gains.
    Absent federal brackets mean no federal tax to model — the config
    column is nullable — not an error."""
    federal = _Leg(1.0, _segments(ordinary_income - std_deduction, brackets))
    state_leg = _state_leg(position, state, 1.0)
    net = _walk(needed, balance, [federal] + ([state_leg] if state_leg else []))
    if state_leg is None:
        return net, federal.tax, 0.0, position.credit
    return net, federal.tax, state_leg.tax, state_leg.credit


def _ordinary_tax(
    ordinary_income: float, std_deduction: float, brackets: list[Bracket] | None
) -> float:
    """Tax on ordinary income the caller already holds — a known gross,
    so a plain walk up the brackets rather than the gross-up solve an
    ordinary draw needs. Absent brackets mean no tax to model."""
    if not brackets:
        return 0.0
    taxable = max(0.0, ordinary_income - std_deduction)
    tax = 0.0
    floor = 0.0
    for bracket in brackets:
        ceiling = bracket.upto if bracket.upto is not None else float("inf")
        tax += max(0.0, min(taxable, ceiling) - floor) * bracket.rate
        if taxable <= ceiling:
            break
        floor = ceiling
    return tax


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
    state: StateTax = NO_STATE_TAX,
) -> SourcingResult:
    taxable_ordinary = max(0.0, ordinary_income - std_deduction)
    # The 0% bracket is a taxable-income threshold, so the deduction
    # ordinary income leaves unused shelters gain — the same shelter
    # _gross_up_ordinary gives an ordinary draw.
    unused_shelter = max(0.0, std_deduction - ordinary_income)
    headroom = max(0.0, ltcg_0_ceiling - taxable_ordinary + unused_shelter)
    # The ordinary income is part of the income, and its tax is owed
    # whether or not a bucket is sold: only the after-tax dollars fill
    # the gap. The state walks the same income up its own table from
    # its own, smaller shelter.
    federal_ordinary_tax = _ordinary_tax(ordinary_income, std_deduction, ordinary_brackets)
    # The flat credit is taken off the year's first state tax, which
    # this is — what it leaves carries into the draws, in order.
    state_owed = (
        _ordinary_tax(ordinary_income, state.std_deduction, state.brackets)
        if state.modelled
        else 0.0
    )
    credit = state.exemption_credit if state.modelled else 0.0
    state_ordinary_tax = max(0.0, state_owed - credit)
    ordinary_tax = federal_ordinary_tax + state_ordinary_tax
    gap = max(0.0, target_spend - (income - ordinary_tax))

    remaining = gap
    remaining_headroom = headroom
    ordinary_running = ordinary_income
    # Where the year's income leaves the state walk: negative while the
    # state deduction is not yet used up. Gains and ordinary draws both
    # move it, since the state taxes them alike.
    position = _StatePosition(
        taxable=ordinary_income - state.std_deduction, credit=max(0.0, credit - state_owed)
    )
    draws: list[BucketDraw] = []
    for bucket in buckets:
        if bucket.access_age is not None and age + bucket.age_offset < bucket.access_age:
            # The gate belongs to the bucket, not to its tax treatment:
            # a Roth or an HSA locks the way a traditional 401(k) does.
            # A locked bucket sells nothing, so it also spends none of
            # the headroom the buckets behind it inherit.
            draw = BucketDraw(
                name=bucket.name,
                treatment=bucket.treatment,
                gross=0.0,
                tax=0.0,
                federal_tax=0.0,
                state_tax=0.0,
                net=0.0,
                note=f"locked until age {bucket.access_age:g}",
            )
        elif bucket.treatment == "LTCG":
            draw, remaining_headroom, position = _draw_ltcg(
                bucket, remaining, remaining_headroom, position, state
            )
        elif bucket.treatment == "TAX_FREE":
            draw = _draw_tax_free(bucket, remaining)
        else:
            net, federal_tax, state_tax, credit_left = _gross_up_ordinary(
                remaining,
                bucket.balance,
                ordinary_running,
                std_deduction,
                ordinary_brackets,
                position,
                state,
            )
            gross = net + federal_tax + state_tax
            draw = BucketDraw(
                name=bucket.name,
                treatment="ORDINARY",
                gross=gross,
                tax=federal_tax + state_tax,
                federal_tax=federal_tax,
                state_tax=state_tax,
                net=net,
            )
            ordinary_running += gross
            position = _StatePosition(position.taxable + gross, credit_left)
        draws.append(draw)
        remaining -= draw.net

    shortfall = max(0.0, remaining)
    return SourcingResult(
        target_net=target_spend,
        income=income,
        ordinary_tax=ordinary_tax,
        federal_ordinary_tax=federal_ordinary_tax,
        state_ordinary_tax=state_ordinary_tax,
        gap=gap,
        headroom=headroom,
        draws=tuple(draws),
        net_delivered=target_spend - shortfall,
        shortfall=shortfall,
    )
