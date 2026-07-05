"""The tax-aware withdrawal sourcing engine: target net spend minus
non-portfolio income leaves a gap, filled bucket by bucket in waterfall
order. The 0% LTCG headroom is measured in gain dollars — the ceiling
minus taxable ordinary income — and converts to sale proceeds through
each bucket's gain fraction, so a low-basis bucket can sell little
before the headroom is spent while a full-basis bucket is unbounded.
The engine solves for net spendable; it never draws 4% per bucket.
"""

import pytest

from sereno.engine.sourcing import Bucket, source_withdrawals


def eth(balance=400_000.0, basis=4_000.0):
    return Bucket(
        name="ETH",
        balance=balance,
        basis=basis,
        treatment="LTCG",
        headroom_only=True,
    )


def run(**overrides):
    defaults = {
        "target_spend": 45_000.0,
        "age": 38.0,
        "income": 8_000.0,
        "ordinary_income": 3_000.0,
        "buckets": [eth()],
        "ltcg_0_ceiling": 96_700.0,
        "std_deduction": 30_000.0,
        "ordinary_brackets": None,
    }
    defaults.update(overrides)
    return source_withdrawals(**defaults)


class TestGap:
    def test_gap_is_target_spend_minus_non_portfolio_income(self):
        assert run(target_spend=45_000, income=8_000).gap == pytest.approx(37_000)

    def test_income_covering_the_target_leaves_no_gap_and_no_draws(self):
        result = run(target_spend=45_000, income=50_000)
        assert result.gap == 0
        assert [draw.gross for draw in result.draws] == [0]
        assert result.net_delivered == pytest.approx(45_000)
        assert result.shortfall == 0

    def test_without_income_the_gap_is_the_whole_target(self):
        assert run(income=0).gap == pytest.approx(45_000)


class TestHeadroom:
    def test_headroom_is_the_ceiling_minus_taxable_ordinary_income(self):
        # 40,000 ordinary − 30,000 standard deduction = 10,000 taxable
        result = run(ordinary_income=40_000)
        assert result.headroom == pytest.approx(96_700 - 10_000)

    def test_ordinary_income_under_the_deduction_leaves_the_full_ceiling(self):
        assert run(ordinary_income=10_000).headroom == pytest.approx(96_700)

    def test_headroom_never_goes_negative(self):
        assert run(ordinary_income=500_000).headroom == 0


class TestEthStep:
    def test_fills_the_gap_at_zero_tax_inside_the_headroom(self):
        result = run()
        draw = result.draws[0]
        assert draw.name == "ETH"
        assert draw.treatment == "LTCG"
        assert draw.gross == pytest.approx(37_000)
        assert draw.tax == 0
        assert draw.net == pytest.approx(37_000)
        assert result.net_delivered == pytest.approx(45_000)
        assert result.shortfall == 0

    def test_the_headroom_caps_proceeds_grossed_up_by_the_gain_fraction(self):
        # basis 200k on 400k → half of every sale is gain, so 10,000 of
        # gain headroom buys 20,000 of proceeds against a 37,000 gap.
        result = run(
            buckets=[eth(balance=400_000, basis=200_000)],
            ordinary_income=116_700,  # taxable 86,700 → headroom 10,000
        )
        draw = result.draws[0]
        assert result.headroom == pytest.approx(10_000)
        assert draw.gross == pytest.approx(20_000)
        assert draw.tax == 0
        assert result.shortfall == pytest.approx(17_000)
        assert result.net_delivered == pytest.approx(28_000)

    def test_the_balance_caps_the_draw_before_the_headroom_does(self):
        result = run(buckets=[eth(balance=10_000)])
        assert result.draws[0].gross == pytest.approx(10_000)
        assert result.shortfall == pytest.approx(27_000)

    def test_a_bucket_with_no_gain_ignores_the_headroom(self):
        # basis ≥ balance → nothing is gain, so zero headroom can't bind
        result = run(
            buckets=[eth(balance=400_000, basis=500_000)],
            ordinary_income=500_000,  # headroom 0
        )
        draw = result.draws[0]
        assert draw.gross == pytest.approx(37_000)
        assert draw.tax == 0
        assert result.shortfall == 0

    def test_zero_headroom_blocks_an_appreciated_bucket_entirely(self):
        result = run(ordinary_income=500_000)
        assert result.draws[0].gross == 0
        assert result.shortfall == pytest.approx(37_000)

    def test_an_empty_bucket_draws_nothing(self):
        result = run(buckets=[eth(balance=0)])
        assert result.draws[0].gross == 0
        assert result.shortfall == pytest.approx(37_000)


def brokerage(balance=600_000.0, basis=480_000.0):
    # basis 80% of balance → a fifth of every sale is gain
    return Bucket(name="Brokerage", balance=balance, basis=basis, treatment="LTCG")


class TestBrokerageStep:
    def test_inherits_the_headroom_eth_left_behind(self):
        # ETH is all basis, so its 10,000 sale spends no headroom and
        # the brokerage's 27,000 remainder still fits the 0% bracket.
        result = run(buckets=[eth(balance=10_000, basis=10_000), brokerage()])
        draw = result.draws[1]
        assert draw.name == "Brokerage"
        assert draw.gross == pytest.approx(27_000)
        assert draw.tax == 0
        assert result.shortfall == 0

    def test_grosses_up_at_fifteen_percent_beyond_the_headroom(self):
        # taxable ordinary income eats the whole ceiling → every gain
        # dollar is taxed at 15%, so net N costs N / (1 − 0.15·g)
        result = run(buckets=[brokerage()], ordinary_income=126_700)
        draw = result.draws[0]
        assert result.headroom == 0
        assert draw.gross == pytest.approx(37_000 / 0.97)
        assert draw.tax == pytest.approx(37_000 / 0.97 * 0.2 * 0.15)
        assert draw.net == pytest.approx(37_000)
        assert result.shortfall == 0
        assert result.net_delivered == pytest.approx(45_000)

    def test_a_draw_straddling_the_headroom_taxes_only_the_excess(self):
        # headroom 10,000 → the first 50,000 of proceeds (gain 10,000)
        # is tax-free; the remaining 50,000 net is grossed up at 15%.
        result = run(
            target_spend=100_000,
            income=0,
            buckets=[brokerage()],
            ordinary_income=116_700,  # taxable 86,700 → headroom 10,000
        )
        draw = result.draws[0]
        assert draw.gross == pytest.approx(50_000 + 50_000 / 0.97)
        assert draw.tax == pytest.approx(50_000 / 0.97 * 0.2 * 0.15)
        assert draw.net == pytest.approx(100_000)
        assert result.shortfall == 0

    def test_the_balance_caps_a_taxed_draw_and_its_net(self):
        result = run(
            buckets=[brokerage(balance=20_000, basis=16_000)],
            ordinary_income=126_700,  # headroom 0
        )
        draw = result.draws[0]
        assert draw.gross == pytest.approx(20_000)
        assert draw.tax == pytest.approx(20_000 * 0.2 * 0.15)
        assert draw.net == pytest.approx(19_400)
        assert result.shortfall == pytest.approx(37_000 - 19_400)
        assert result.net_delivered == pytest.approx(45_000 - result.shortfall)

    def test_draws_nothing_when_eth_already_filled_the_gap(self):
        result = run(buckets=[eth(), brokerage()])
        assert result.draws[1].gross == 0
        assert result.shortfall == 0

    def test_headroom_spent_by_eth_is_gone_for_the_brokerage(self):
        # ETH's 20,000 sale carries 16,000 of gain — exactly the
        # headroom — so the brokerage's 17,000 remainder is all taxed.
        result = run(
            buckets=[eth(balance=20_000), brokerage()],
            ordinary_income=110_700,  # taxable 80,700 → headroom 16,000
        )
        assert result.draws[0].gross == pytest.approx(20_000)
        assert result.draws[0].tax == 0
        assert result.draws[1].gross == pytest.approx(17_000 / 0.97)
        assert result.draws[1].tax == pytest.approx(17_000 / 0.97 * 0.2 * 0.15)
        assert result.shortfall == 0
