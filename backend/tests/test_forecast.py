"""The longevity forecast engine: a year-by-year simulation from age 38
to 95 in today's dollars. Each year the buckets grow by the real rate
(return minus inflation), the balances are recorded, and the year's
spending need is withdrawn through the sourcing engine's waterfall —
so the 59½ gate, the 0% LTCG headroom, and the gross-ups all apply per
simulated year. Growth is all gain (basis stays put); sales reduce
basis pro-rata. The first year the need can't be met is the run-out
age; a portfolio that always delivers never runs out.
"""

import pytest

from sereno.engine.forecast import simulate_forecast
from sereno.engine.sourcing import Bucket


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


def run(**overrides):
    defaults = {
        "spend": 40_000.0,
        "return_pct": 7.0,
        "inflation_pct": 3.0,
        "buckets": [brokerage(2_000_000)],
        "ltcg_0_ceiling": 96_700.0,
        "std_deduction": 30_000.0,
        "ordinary_brackets": None,
    }
    defaults.update(overrides)
    return simulate_forecast(**defaults)


class TestSeries:
    def test_series_spans_ages_38_to_95(self):
        result = run()
        assert [point.age for point in result.series] == list(range(38, 96))

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
        assert result.series[-1].age == 95

    def test_a_surviving_portfolio_never_runs_out(self):
        result = run()
        assert result.run_out_age is None

    def test_balance_at_90_sums_the_buckets_at_age_90(self):
        # Untouched, the bucket compounds once per simulated age: 53
        # steps from 38 through 90.
        result = run(spend=0, buckets=[brokerage(100_000)])
        assert result.balance_at_90 == pytest.approx(100_000 * 1.04**53)


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
