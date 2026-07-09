"""The longevity forecast engine: a year-by-year simulation from the
caller's start age to 100 in today's dollars. Each year the buckets
grow by the real rate
(return minus inflation) — except the ETH bucket, which grows at its
own nominal rate minus inflation when eth_growth_pct is given (null
keeps the blended rate, and a rate at or below −100% real empties the
bucket rather than inverting it) — the balances are recorded, and the
year's
spending need is withdrawn through the sourcing engine's waterfall —
so the 59½ gate, the 0% LTCG headroom, and the gross-ups all apply per
simulated year. Growth is all gain (basis stays put); sales reduce
basis pro-rata. The first year the need can't be met is the run-out
age; a portfolio that always delivers never runs out.
"""

from collections.abc import Sequence

import pytest

from sereno.engine.forecast import ForecastResult, SocialSecurityBenefit, simulate_forecast
from sereno.engine.sourcing import Bracket, Bucket


def eth(balance: float, basis: float | None = None) -> Bucket:
    return Bucket(
        name="ETH",
        balance=balance,
        basis=balance if basis is None else basis,
        treatment="LTCG",
        headroom_only=True,
    )


def brokerage(balance: float, basis: float | None = None) -> Bucket:
    # Full basis by default: nothing is gain, so draws stay tax-free
    # and the core mechanics can be asserted with exact arithmetic.
    return Bucket(
        name="Brokerage",
        balance=balance,
        basis=balance if basis is None else basis,
        treatment="LTCG",
    )


def four01k(balance: float) -> Bucket:
    return Bucket(name="401(k)", balance=balance, basis=0.0, treatment="ORDINARY", access_age=59.5)


def run(
    *,
    start_age: int = 38,
    spend: float = 40_000.0,
    return_pct: float = 7.0,
    inflation_pct: float = 3.0,
    eth_growth_pct: float | None = None,
    buckets: list[Bucket] | None = None,
    social_security: Sequence[SocialSecurityBenefit] = (),
    ltcg_0_ceiling: float = 96_700.0,
    std_deduction: float = 30_000.0,
    ordinary_brackets: list[Bracket] | None = None,
) -> ForecastResult:
    return simulate_forecast(
        start_age=start_age,
        spend=spend,
        return_pct=return_pct,
        inflation_pct=inflation_pct,
        eth_growth_pct=eth_growth_pct,
        buckets=buckets if buckets is not None else [brokerage(2_000_000)],
        social_security=social_security,
        ltcg_0_ceiling=ltcg_0_ceiling,
        std_deduction=std_deduction,
        ordinary_brackets=ordinary_brackets,
    )


class TestSeries:
    def test_series_spans_the_start_age_to_100(self):
        result = run()
        assert [point.age for point in result.series] == list(range(38, 101))

    def test_the_series_starts_at_the_callers_start_age(self):
        # The engine is pure math over the caller's numbers — deriving
        # the age from the birthdate is the API layer's job.
        result = run(start_age=40)
        assert result.series[0].age == 40

    def test_buckets_grow_by_the_real_rate_before_recording(self):
        # 7% return − 3% inflation = 4% real, applied before the first
        # point is recorded — age 38 already shows one year of growth.
        result = run(spend=0, buckets=[brokerage(100_000)])
        assert result.series[0].balances == (pytest.approx(104_000),)
        assert result.series[1].balances == (pytest.approx(104_000 * 1.04),)

    def test_the_withdrawal_reduces_the_next_years_recorded_balance(self):
        result = run(buckets=[brokerage(1_000_000)])
        assert result.series[0].balances == (pytest.approx(1_040_000),)
        assert result.series[1].balances == (pytest.approx((1_040_000 - 40_000) * 1.04),)

    def test_earlier_buckets_drain_before_later_ones(self):
        # ETH's 20,800 goes first; the brokerage covers the remaining
        # 19,200 of the 40,000 need.
        result = run(buckets=[eth(20_000), brokerage(500_000)])
        assert result.series[0].balances == (pytest.approx(20_800), pytest.approx(520_000))
        assert result.series[1].balances == (
            pytest.approx(0),
            pytest.approx((520_000 - 19_200) * 1.04),
        )


class TestRunOut:
    def test_run_out_is_the_first_year_the_need_cannot_be_met(self):
        # Zero real return: 100,000 covers two 40,000 years, then the
        # third year can deliver only 20,000.
        result = run(return_pct=5, inflation_pct=5, buckets=[brokerage(100_000)])
        assert result.run_out_age == 40
        # The simulation still records the full series after running out.
        assert result.series[-1].age == 100

    def test_a_surviving_portfolio_never_runs_out(self):
        result = run()
        assert result.run_out_age is None

    def test_balance_at_100_sums_the_buckets_at_age_100(self):
        # Untouched, the bucket compounds once per simulated age: 63
        # steps from 38 through 100.
        result = run(spend=0, buckets=[brokerage(100_000)])
        assert result.balance_at_100 == pytest.approx(100_000 * 1.04**63)


class TestBasis:
    def test_growth_is_gain_and_sales_reduce_basis_pro_rata(self):
        # No headroom, half-basis bucket: every draw pays 15% on its
        # gain fraction. Growth raises the balance but not the basis,
        # so the second year's draw is taxed at a higher gain fraction
        # than a constant-fraction model would use.
        result = run(
            spend=10_000,
            buckets=[brokerage(100_000, basis=50_000)],
            ltcg_0_ceiling=0,
        )
        bal_38 = 104_000.0
        gain_38 = 1 - 50_000 / bal_38
        gross_38 = 10_000 / (1 - 0.15 * gain_38)
        basis_39 = 50_000 * (1 - gross_38 / bal_38)
        bal_39 = (bal_38 - gross_38) * 1.04
        assert result.series[1].balances == (pytest.approx(bal_39),)

        gain_39 = 1 - basis_39 / bal_39
        gross_39 = 10_000 / (1 - 0.15 * gain_39)
        assert result.series[2].balances == (pytest.approx((bal_39 - gross_39) * 1.04),)


class TestEthGrowth:
    def test_the_eth_bucket_grows_at_its_own_real_rate(self):
        # 15% nominal − 3% inflation = 12% real for ETH; the brokerage
        # keeps the blended 7 − 3 = 4%.
        result = run(spend=0, eth_growth_pct=15, buckets=[eth(100_000), brokerage(100_000)])
        assert result.series[0].balances == (pytest.approx(112_000), pytest.approx(104_000))

    def test_eth_growth_is_nominal_and_inflation_subtracts(self):
        # 3% nominal against 3% inflation is 0% real: the bucket holds
        # flat in today's dollars, exactly how return_pct is treated.
        result = run(spend=0, eth_growth_pct=3, buckets=[eth(100_000)])
        assert result.series[0].balances == (pytest.approx(100_000),)

    def test_a_null_eth_growth_keeps_the_blended_rate(self):
        result = run(spend=0, eth_growth_pct=None, buckets=[eth(100_000)])
        assert result.series[0].balances == (pytest.approx(104_000),)

    def test_a_rate_below_minus_one_hundred_real_empties_rather_than_inverts(self):
        # −120 nominal − 3 inflation = −123% real: the multiplier would
        # go negative, so the bucket floors at zero instead.
        result = run(spend=0, eth_growth_pct=-120, buckets=[eth(100_000)])
        assert result.series[0].balances == (0.0,)


class TestBridge:
    def test_a_locked_401k_cannot_prevent_an_early_run_out(self):
        # The taxable bucket dies at 40; the 5M in the 401(k) is gated
        # until 59½ and never reached.
        result = run(
            return_pct=5,
            inflation_pct=5,
            buckets=[brokerage(100_000), four01k(5_000_000)],
        )
        assert result.run_out_age == 40

    def test_the_401k_rescues_the_portfolio_from_age_sixty(self):
        # 880,000 covers exactly the 22 bridge years (38 through 59);
        # from 60 the unlocked 401(k) takes over and the money lasts.
        result = run(
            return_pct=5,
            inflation_pct=5,
            buckets=[brokerage(880_000), four01k(5_000_000)],
        )
        assert result.run_out_age is None
        age_59 = result.series[59 - 38]
        assert age_59.balances[1] == pytest.approx(5_000_000)
        age_61 = result.series[61 - 38]
        assert age_61.balances[1] == pytest.approx(5_000_000 - 40_000)

    def test_one_bridge_year_short_runs_out_at_fifty_nine(self):
        # 840,000 covers only 21 years (38 through 58): age 59 goes
        # unmet even though the 401(k) unlocks the very next year.
        result = run(
            return_pct=5,
            inflation_pct=5,
            buckets=[brokerage(840_000), four01k(5_000_000)],
        )
        assert result.run_out_age == 59


class TestSocialSecurity:
    def test_ss_income_starts_at_the_start_age(self):
        # 1,500 + 1,400 monthly from 67 → 34,800/yr, cutting the
        # portfolio draw from 40,000 to 5,200 that year on.
        result = run(
            return_pct=5,
            inflation_pct=5,
            social_security=[
                SocialSecurityBenefit(monthly_amount=1_500, start_age=67),
                SocialSecurityBenefit(monthly_amount=1_400, start_age=67),
            ],
        )
        age_66 = result.series[66 - 38]
        age_67 = result.series[67 - 38]
        age_68 = result.series[68 - 38]
        assert age_66.ss_income == 0
        assert age_67.ss_income == pytest.approx(34_800)
        # 29 full-spend draws land before the 67 point is recorded...
        assert age_67.balances[0] == pytest.approx(2_000_000 - 29 * 40_000)
        # ...and the first SS-subsidized draw shows up at 68.
        assert age_68.balances[0] == pytest.approx(2_000_000 - 29 * 40_000 - 5_200)

    def test_each_person_starts_on_their_own_age(self):
        result = run(
            social_security=[
                SocialSecurityBenefit(monthly_amount=1_500, start_age=65),
                SocialSecurityBenefit(monthly_amount=1_400, start_age=67),
            ],
        )
        assert result.series[64 - 38].ss_income == 0
        assert result.series[65 - 38].ss_income == pytest.approx(18_000)
        assert result.series[67 - 38].ss_income == pytest.approx(34_800)

    def test_ss_covering_the_spend_prevents_a_run_out(self):
        # 870,000 lasts exactly the 29 years to 67 (38 through 66);
        # from then on Social Security alone covers the 30,000 spend.
        result = run(
            spend=30_000,
            return_pct=5,
            inflation_pct=5,
            buckets=[brokerage(870_000)],
            social_security=[
                SocialSecurityBenefit(monthly_amount=1_500, start_age=67),
                SocialSecurityBenefit(monthly_amount=1_400, start_age=67),
            ],
        )
        assert result.run_out_age is None
        assert result.balance_at_100 == pytest.approx(0)


class TestStaking:
    def test_staking_income_flows_while_eth_stays_meaningful(self):
        # ETH above 50,000 stakes 3,000/yr, so the draw is 37,000 —
        # until the stake is spent below the threshold at age 40.
        result = run(
            return_pct=5,
            inflation_pct=5,
            buckets=[eth(100_000), brokerage(1_000_000)],
        )
        assert result.series[39 - 38].balances[0] == pytest.approx(100_000 - 37_000)
        assert result.series[40 - 38].balances[0] == pytest.approx(100_000 - 2 * 37_000)
        # At 40 the 26,000 stake is under the threshold: the full
        # 40,000 need drains ETH and takes 14,000 from the brokerage.
        assert result.series[41 - 38].balances == (
            pytest.approx(0),
            pytest.approx(1_000_000 - 14_000),
        )

    def test_staking_needs_strictly_more_than_the_threshold(self):
        result = run(
            return_pct=5,
            inflation_pct=5,
            buckets=[eth(50_000), brokerage(1_000_000)],
        )
        # No staking at exactly 50,000: the first draw is the full
        # 40,000, not 37,000.
        assert result.series[39 - 38].balances[0] == pytest.approx(10_000)
