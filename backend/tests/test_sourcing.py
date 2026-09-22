"""The tax-aware withdrawal sourcing engine: target net spend minus
non-portfolio income leaves a gap, filled bucket by bucket in waterfall
order. The 0% LTCG headroom is measured in gain dollars — the ceiling
minus taxable ordinary income, plus whatever standard deduction that
income left unused — and converts to sale proceeds through
each bucket's gain fraction, so a low-basis bucket sells little before
the headroom is spent while a full-basis bucket is unbounded. The
headroom bounds the tax-free leg, not the bucket: every LTCG bucket
keeps selling past it at 15% on the gain portion. The engine solves
for net spendable; it never draws 4% per bucket.
"""

from dataclasses import replace

import pytest

from sereno.engine.sourcing import (
    NO_STATE_TAX,
    Bracket,
    Bucket,
    StateTax,
    source_withdrawals,
)


def eth(balance=400_000.0, basis=4_000.0):
    return Bucket(
        name="ETH",
        balance=balance,
        basis=basis,
        treatment="LTCG",
        is_eth=True,
    )


def run(**overrides):
    defaults = {
        "target_spend": 45_000.0,
        "age": 38.0,
        "income": 8_000.0,
        "ordinary_income": 3_000.0,
        "buckets": [eth()],
        "ltcg_0_ceiling": 98_900.0,
        "std_deduction": 30_000.0,
        "ordinary_brackets": None,
        "state": NO_STATE_TAX,
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
        assert result.headroom == pytest.approx(98_900 - 10_000)

    def test_unused_standard_deduction_extends_the_headroom(self):
        # The 0% bracket is a taxable-income threshold: 10,000 of
        # ordinary income leaves 20,000 of the deduction to shelter gain.
        assert run(ordinary_income=10_000).headroom == pytest.approx(98_900 + 20_000)

    def test_no_ordinary_income_adds_the_whole_deduction(self):
        # 80% of every sale is gain, so 130,000 of gain headroom buys
        # 162,500 of proceeds tax-free; only the last 37,500 of the
        # 200,000 gap is grossed up at 15% on the gain portion.
        result = run(
            target_spend=200_000,
            income=0,
            ordinary_income=0,
            buckets=[eth(balance=500_000, basis=100_000)],
            ltcg_0_ceiling=100_000,
        )
        draw = result.draws[0]
        assert result.headroom == pytest.approx(130_000)
        assert draw.gross == pytest.approx(162_500 + 37_500 / 0.88)
        assert draw.tax == pytest.approx(37_500 / 0.88 * 0.8 * 0.15)
        assert draw.net == pytest.approx(200_000)

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

    def test_sells_past_the_headroom_at_fifteen_percent_on_the_gain(self):
        # basis 200k on 400k → half of every sale is gain, so 10,000 of
        # gain headroom buys 20,000 of proceeds tax-free. The remaining
        # 17,000 of the gap keeps selling at 15% on the gain half:
        # net N costs N / (1 − 0.15·0.5).
        result = run(
            buckets=[eth(balance=400_000, basis=200_000)],
            ordinary_income=118_900,  # taxable 88,900 → headroom 10,000
        )
        draw = result.draws[0]
        assert result.headroom == pytest.approx(10_000)
        assert draw.gross == pytest.approx(20_000 + 17_000 / 0.925)
        assert draw.tax == pytest.approx(17_000 / 0.925 * 0.075)
        assert draw.net == pytest.approx(37_000)
        assert result.shortfall == 0
        assert result.net_delivered == pytest.approx(45_000)

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

    def test_zero_headroom_taxes_the_whole_draw_rather_than_blocking_it(self):
        # 99% of every sale is gain and no headroom shelters any of it,
        # so the entire 37,000 is grossed up at 15% on that gain.
        result = run(ordinary_income=500_000)
        draw = result.draws[0]
        assert result.headroom == 0
        assert draw.gross == pytest.approx(37_000 / (1 - 0.99 * 0.15))
        assert draw.tax == pytest.approx(37_000 / (1 - 0.99 * 0.15) * 0.99 * 0.15)
        assert draw.net == pytest.approx(37_000)
        assert result.shortfall == 0

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

    def test_eth_drains_before_the_brokerage_is_touched(self):
        # No headroom shelters either bucket, so nothing is free — but
        # ETH still empties first and the brokerage covers only what is
        # left. Unwinding the concentration outranks the tax saving.
        result = run(
            buckets=[eth(balance=20_000, basis=200), brokerage()],
            ordinary_income=500_000,
        )
        eth_draw, brokerage_draw = result.draws
        assert eth_draw.gross == pytest.approx(20_000)
        assert eth_draw.tax == pytest.approx(20_000 * 0.99 * 0.15)
        assert eth_draw.net == pytest.approx(20_000 * (1 - 0.99 * 0.15))
        remaining = 37_000 - 20_000 * (1 - 0.99 * 0.15)
        assert brokerage_draw.gross == pytest.approx(remaining / 0.97)
        assert brokerage_draw.net == pytest.approx(remaining)
        assert result.shortfall == 0

    def test_grosses_up_at_fifteen_percent_beyond_the_headroom(self):
        # taxable ordinary income eats the whole ceiling → every gain
        # dollar is taxed at 15%, so net N costs N / (1 − 0.15·g)
        result = run(buckets=[brokerage()], ordinary_income=128_900)
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
            ordinary_income=118_900,  # taxable 88,900 → headroom 10,000
        )
        draw = result.draws[0]
        assert draw.gross == pytest.approx(50_000 + 50_000 / 0.97)
        assert draw.tax == pytest.approx(50_000 / 0.97 * 0.2 * 0.15)
        assert draw.net == pytest.approx(100_000)
        assert result.shortfall == 0

    def test_the_balance_caps_a_taxed_draw_and_its_net(self):
        result = run(
            buckets=[brokerage(balance=20_000, basis=16_000)],
            ordinary_income=128_900,  # headroom 0
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
            ordinary_income=112_900,  # taxable 82,900 → headroom 16,000
        )
        assert result.draws[0].gross == pytest.approx(20_000)
        assert result.draws[0].tax == 0
        assert result.draws[1].gross == pytest.approx(17_000 / 0.97)
        assert result.draws[1].tax == pytest.approx(17_000 / 0.97 * 0.2 * 0.15)
        assert result.shortfall == 0


# A flat 5% state with a deduction the default 3,000 of ordinary income
# exactly uses up, so every gain dollar sold is state-taxable from the
# first — the arithmetic stays closed-form.
FLAT_STATE = StateTax(
    treatment="CA_ordinary",
    brackets=[Bracket(rate=0.05, upto=None)],
    std_deduction=3_000.0,
    exemption_credit=0.0,
)


class TestStateTaxOnGains:
    def test_the_state_taxes_a_sale_the_federal_headroom_leaves_free(self):
        # The whole 37,000 gap sits inside the 0% federal bracket, so
        # federal tax is zero and the state is the entire bill: net N
        # costs N / (1 − 0.05·g) with g = 1 on a zero-basis stack.
        result = run(buckets=[eth(basis=0)], state=FLAT_STATE)
        draw = result.draws[0]
        assert draw.federal_tax == 0
        assert draw.state_tax == pytest.approx(37_000 / 0.95 * 0.05)
        assert draw.tax == pytest.approx(draw.federal_tax + draw.state_tax)
        assert draw.gross == pytest.approx(37_000 / 0.95)
        assert draw.net == pytest.approx(37_000)
        assert result.net_delivered == pytest.approx(45_000)

    def test_the_gain_fraction_scales_the_state_tax(self):
        # Half of every sale is basis, so the state sees half the gross.
        result = run(buckets=[eth(basis=200_000)], state=FLAT_STATE)
        draw = result.draws[0]
        assert draw.gross == pytest.approx(37_000 / 0.975)
        assert draw.state_tax == pytest.approx(37_000 / 0.975 * 0.5 * 0.05)

    def test_a_full_basis_sale_owes_the_state_nothing(self):
        result = run(buckets=[eth(basis=400_000)], state=FLAT_STATE)
        draw = result.draws[0]
        assert draw.gross == pytest.approx(37_000)
        assert draw.state_tax == 0

    def test_past_the_federal_headroom_both_rates_apply_together(self):
        # No headroom at all (the federal deduction is spent too): 15%
        # federal and 5% state on every gain dollar, so net N costs
        # N / 0.80.
        result = run(
            buckets=[eth(basis=0)], ltcg_0_ceiling=0, std_deduction=3_000, state=FLAT_STATE
        )
        draw = result.draws[0]
        assert result.headroom == 0
        assert draw.gross == pytest.approx(37_000 / 0.80)
        assert draw.federal_tax == pytest.approx(37_000 / 0.80 * 0.15)
        assert draw.state_tax == pytest.approx(37_000 / 0.80 * 0.05)
        assert draw.net == pytest.approx(37_000)

    def test_a_straddling_sale_keeps_the_federal_break_where_it_was(self):
        # 10,000 of headroom: the first 10,000 of gain is state-only
        # (nets 9,500), the rest is grossed up at both rates. State tax
        # never widens or narrows the federal headroom.
        result = run(
            buckets=[eth(basis=0)], ltcg_0_ceiling=10_000, std_deduction=3_000, state=FLAT_STATE
        )
        draw = result.draws[0]
        assert result.headroom == pytest.approx(10_000)
        taxed_gross = (37_000 - 9_500) / 0.80
        assert draw.gross == pytest.approx(10_000 + taxed_gross)
        assert draw.federal_tax == pytest.approx(taxed_gross * 0.15)
        assert draw.state_tax == pytest.approx((10_000 + taxed_gross) * 0.05)
        assert draw.net == pytest.approx(37_000)

    def test_the_brokerage_continues_in_the_state_bracket_eth_left_off(self):
        # A two-rate state: ETH's 20,000 of gain fills the 1% band
        # exactly, so the brokerage's first dollar is already at 5%.
        stepped = StateTax(
            treatment="CA_ordinary",
            brackets=[Bracket(rate=0.01, upto=20_000), Bracket(rate=0.05, upto=None)],
            std_deduction=3_000.0,
            exemption_credit=0.0,
        )
        result = run(buckets=[eth(balance=20_000, basis=0), brokerage(basis=0)], state=stepped)
        eth_draw, brokerage_draw = result.draws
        assert eth_draw.gross == pytest.approx(20_000)
        assert eth_draw.state_tax == pytest.approx(200)
        assert eth_draw.net == pytest.approx(19_800)
        remaining = 37_000 - 19_800
        assert brokerage_draw.gross == pytest.approx(remaining / 0.95)
        assert brokerage_draw.state_tax == pytest.approx(remaining / 0.95 * 0.05)
        assert brokerage_draw.federal_tax == 0
        assert result.shortfall == 0

    def test_a_state_with_no_income_tax_leaves_the_sale_untouched(self):
        none = StateTax(
            treatment="NONE",
            brackets=[Bracket(rate=0.05, upto=None)],
            std_deduction=3_000.0,
            exemption_credit=0.0,
        )
        result = run(buckets=[eth(basis=0)], state=none)
        draw = result.draws[0]
        assert draw.gross == pytest.approx(37_000)
        assert draw.state_tax == 0
        assert draw.federal_tax == 0
        assert draw.tax == 0


def four01k(balance=500_000.0):
    return Bucket(name="401(k)", balance=balance, basis=0.0, treatment="ORDINARY", access_age=59.5)


# The seed's 2026 MFJ brackets
BRACKETS = [
    Bracket(rate=0.10, upto=24_800),
    Bracket(rate=0.12, upto=100_800),
    Bracket(rate=0.22, upto=211_400),
    Bracket(rate=0.24, upto=None),
]

# A short graduated state table — CA-shaped, not CA's figures — with a
# deduction a third the size of the federal one, so the two shelters
# run out at different incomes.
STATE_BRACKETS = [
    Bracket(rate=0.01, upto=20_000),
    Bracket(rate=0.02, upto=50_000),
    Bracket(rate=0.05, upto=None),
]

CA = StateTax(
    treatment="CA_ordinary",
    brackets=STATE_BRACKETS,
    std_deduction=10_000.0,
    exemption_credit=0.0,
)


class TestOrdinaryIncomeTax:
    def test_the_tax_on_ordinary_income_comes_off_the_income_credited(self):
        # 40,000 of staking − 30,000 deduction = 10,000 taxable at 10%:
        # the reward is spendable at 39,000, not 40,000, and the
        # headroom still shrinks by the same taxable 10,000
        result = run(income=40_000, ordinary_income=40_000, ordinary_brackets=BRACKETS)
        assert result.ordinary_tax == pytest.approx(1_000)
        assert result.gap == pytest.approx(6_000)
        assert result.headroom == pytest.approx(88_900)

    def test_the_tax_walks_the_brackets(self):
        # 30,000 taxable: 24,800 at 10%, then 5,200 at 12%
        result = run(
            target_spend=80_000, income=60_000, ordinary_income=60_000, ordinary_brackets=BRACKETS
        )
        assert result.ordinary_tax == pytest.approx(2_480 + 5_200 * 0.12)
        assert result.gap == pytest.approx(80_000 - (60_000 - 3_104))

    def test_the_deduction_shelters_ordinary_income_first(self):
        result = run(income=20_000, ordinary_income=20_000, ordinary_brackets=BRACKETS)
        assert result.ordinary_tax == 0
        assert result.gap == pytest.approx(25_000)

    def test_without_brackets_ordinary_income_is_untaxed(self):
        result = run(income=40_000, ordinary_income=40_000, ordinary_brackets=None)
        assert result.ordinary_tax == 0
        assert result.gap == pytest.approx(5_000)


class TestStateOrdinaryIncomeTax:
    def test_the_state_walks_its_own_table_over_the_same_income(self):
        # Federal: 40,000 − 30,000 = 10,000 at 10%. State: 40,000 −
        # 10,000 = 30,000, of which 20,000 at 1% and 10,000 at 2%. Both
        # come off the income before it fills the gap; the federal
        # headroom only ever sees the federal figure.
        result = run(income=40_000, ordinary_income=40_000, ordinary_brackets=BRACKETS, state=CA)
        assert result.federal_ordinary_tax == pytest.approx(1_000)
        assert result.state_ordinary_tax == pytest.approx(400)
        assert result.ordinary_tax == pytest.approx(1_400)
        assert result.gap == pytest.approx(6_400)
        assert result.headroom == pytest.approx(88_900)

    def test_a_state_with_no_income_tax_charges_nothing(self):
        none = StateTax(
            treatment="NONE", brackets=STATE_BRACKETS, std_deduction=10_000.0, exemption_credit=0.0
        )
        result = run(income=40_000, ordinary_income=40_000, ordinary_brackets=BRACKETS, state=none)
        assert result.state_ordinary_tax == 0
        assert result.ordinary_tax == pytest.approx(1_000)

    def test_without_state_brackets_nothing_is_modelled(self):
        # The column is nullable like ordinary_brackets: absent means no
        # schedule entered, and the API is what says so.
        blank = StateTax(
            treatment="CA_ordinary", brackets=None, std_deduction=10_000.0, exemption_credit=0.0
        )
        result = run(income=40_000, ordinary_income=40_000, ordinary_brackets=BRACKETS, state=blank)
        assert result.state_ordinary_tax == 0
        assert result.ordinary_tax == pytest.approx(1_000)

    def test_the_state_is_charged_even_when_the_federal_table_is_missing(self):
        result = run(income=40_000, ordinary_income=40_000, ordinary_brackets=None, state=CA)
        assert result.federal_ordinary_tax == 0
        assert result.state_ordinary_tax == pytest.approx(400)
        assert result.gap == pytest.approx(5_400)

    def test_the_state_deduction_shelters_its_income_first(self):
        result = run(income=8_000, ordinary_income=8_000, ordinary_brackets=BRACKETS, state=CA)
        assert result.state_ordinary_tax == 0


class TestFour01kStep:
    def test_blocked_under_the_access_age(self):
        result = run(age=38, buckets=[four01k()], ordinary_brackets=BRACKETS)
        draw = result.draws[0]
        assert draw.gross == 0
        assert draw.note == "locked until age 59.5"
        assert result.shortfall == pytest.approx(37_000)

    def test_the_access_age_itself_unlocks_the_bucket(self):
        result = run(age=59.5, buckets=[four01k()], ordinary_brackets=BRACKETS)
        assert result.draws[0].gross > 0
        assert result.draws[0].note is None

    def test_the_unused_standard_deduction_shelters_the_first_dollars(self):
        # 3,000 ordinary income leaves 27,000 of the deduction: that
        # much gross is tax-free, the last 10,000 net costs 10,000/0.9
        result = run(age=60, buckets=[four01k()], ordinary_brackets=BRACKETS)
        draw = result.draws[0]
        assert draw.gross == pytest.approx(27_000 + 10_000 / 0.9)
        assert draw.tax == pytest.approx(10_000 / 0.9 * 0.10)
        assert draw.net == pytest.approx(37_000)
        assert result.shortfall == 0

    def test_a_draw_crossing_a_bracket_boundary_pays_each_rate(self):
        # deduction fully used → the 10% bracket's 24,800 nets 22,320,
        # and the remaining 37,680 net is grossed up at 12%
        result = run(
            target_spend=60_000,
            income=0,
            age=60,
            ordinary_income=30_000,
            buckets=[four01k()],
            ordinary_brackets=BRACKETS,
        )
        draw = result.draws[0]
        assert draw.gross == pytest.approx(24_800 + 37_680 / 0.88)
        assert draw.tax == pytest.approx(2_480 + 37_680 / 0.88 * 0.12)
        assert draw.net == pytest.approx(60_000)

    def test_existing_taxable_income_starts_the_walk_mid_bracket(self):
        # 54,800 ordinary − 30,000 deduction = 24,800 taxable: the 10%
        # bracket is already full, so the whole draw is taxed at 12%.
        # The income's own 2,480 of tax leaves 52,320 credited, so the
        # target is set to keep the gap at 37,000.
        result = run(
            target_spend=89_320,
            income=54_800,
            age=60,
            ordinary_income=54_800,
            buckets=[four01k()],
            ordinary_brackets=BRACKETS,
        )
        draw = result.draws[0]
        assert result.ordinary_tax == pytest.approx(2_480)
        assert result.gap == pytest.approx(37_000)
        assert draw.gross == pytest.approx(37_000 / 0.88)
        assert draw.tax == pytest.approx(37_000 / 0.88 * 0.12)

    def test_the_open_top_bracket_absorbs_any_remainder(self):
        # the first three brackets net 175,468; the rest is at 24%
        brackets_net = 24_800 * 0.9 + 76_000 * 0.88 + 110_600 * 0.78
        result = run(
            target_spend=400_000,
            income=0,
            age=60,
            ordinary_income=30_000,
            buckets=[four01k(balance=1_000_000)],
            ordinary_brackets=BRACKETS,
        )
        draw = result.draws[0]
        assert draw.gross == pytest.approx(211_400 + (400_000 - brackets_net) / 0.76)
        assert draw.tax == pytest.approx(draw.gross - 400_000)
        assert draw.net == pytest.approx(400_000)

    def test_the_balance_caps_the_ordinary_draw(self):
        result = run(
            age=60,
            ordinary_income=30_000,
            buckets=[four01k(balance=10_000)],
            ordinary_brackets=BRACKETS,
        )
        draw = result.draws[0]
        assert draw.gross == pytest.approx(10_000)
        assert draw.tax == pytest.approx(1_000)
        assert draw.net == pytest.approx(9_000)
        assert result.shortfall == pytest.approx(28_000)

    def test_without_brackets_the_draw_is_untaxed(self):
        # ordinary_brackets is a nullable config column; absent brackets
        # mean no tax to model, not an error
        result = run(age=60, buckets=[four01k()], ordinary_brackets=None)
        draw = result.draws[0]
        assert draw.gross == pytest.approx(37_000)
        assert draw.tax == 0


class TestStateTaxOn401k:
    def test_the_smaller_state_shelter_runs_out_first(self):
        # No other income at 60: the federal deduction covers the whole
        # 20,000 draw, but the state's 10,000 runs out halfway, so the
        # second half is grossed up at the state's 1%.
        result = run(
            target_spend=20_000,
            age=60,
            income=0,
            ordinary_income=0,
            buckets=[four01k()],
            ordinary_brackets=BRACKETS,
            state=CA,
        )
        draw = result.draws[0]
        assert draw.federal_tax == 0
        assert draw.state_tax == pytest.approx(10_000 / 0.99 * 0.01)
        assert draw.gross == pytest.approx(10_000 + 10_000 / 0.99)
        assert draw.net == pytest.approx(20_000)
        assert draw.tax == pytest.approx(draw.federal_tax + draw.state_tax)

    def test_both_tables_are_walked_together_past_their_shelters(self):
        # 40,000 of staking puts the federal walk 10,000 into its 10%
        # bracket (14,800 of room) and the state 30,000 into its 2%
        # (20,000 of room). The draw crosses the federal boundary first,
        # then the state's, so three net rates apply in turn.
        result = run(
            target_spend=60_000,
            age=60,
            income=40_000,
            ordinary_income=40_000,
            buckets=[four01k()],
            ordinary_brackets=BRACKETS,
            state=CA,
        )
        assert result.gap == pytest.approx(21_400)
        draw = result.draws[0]
        first = 14_800  # 10% + 2% → nets 13,024
        second = 5_200  # 12% + 2% → nets 4,472
        third = (21_400 - 13_024 - 4_472) / 0.83  # 12% + 5%
        assert draw.gross == pytest.approx(first + second + third)
        assert draw.federal_tax == pytest.approx(first * 0.10 + second * 0.12 + third * 0.12)
        assert draw.state_tax == pytest.approx(first * 0.02 + second * 0.02 + third * 0.05)
        assert draw.net == pytest.approx(21_400)
        assert result.shortfall == 0

    def test_the_state_walk_stacks_on_gains_realized_earlier_in_the_year(self):
        # ETH's 20,000 of gain used the state's shelter and half its 1%
        # band; the 401(k) draw starts the state walk there while the
        # federal ordinary walk still has its whole deduction, since
        # federal brackets never see capital gains.
        result = run(
            target_spend=40_000,
            age=60,
            income=0,
            ordinary_income=0,
            buckets=[eth(balance=20_000, basis=0), four01k()],
            ordinary_brackets=BRACKETS,
            state=CA,
        )
        eth_draw, retirement_draw = result.draws
        assert eth_draw.state_tax == pytest.approx(100)
        assert eth_draw.net == pytest.approx(19_900)
        assert retirement_draw.federal_tax == 0
        in_first_band = 10_000  # nets 9,900 at 1%
        rest = (20_100 - 9_900) / 0.98  # at 2%
        assert retirement_draw.state_tax == pytest.approx(100 + rest * 0.02)
        assert retirement_draw.gross == pytest.approx(in_first_band + rest)
        assert retirement_draw.net == pytest.approx(20_100)

    def test_the_balance_caps_the_draw_inside_the_state_shelter(self):
        result = run(
            target_spend=20_000,
            age=60,
            income=0,
            ordinary_income=0,
            buckets=[four01k(balance=5_000)],
            ordinary_brackets=BRACKETS,
            state=CA,
        )
        draw = result.draws[0]
        assert draw.gross == pytest.approx(5_000)
        assert draw.state_tax == 0
        assert draw.net == pytest.approx(5_000)
        assert result.shortfall == pytest.approx(15_000)


class TestStateExemptionCredit:
    def test_the_credit_comes_off_the_tax_on_ordinary_income_first(self):
        result = run(
            income=40_000,
            ordinary_income=40_000,
            ordinary_brackets=BRACKETS,
            state=replace(CA, exemption_credit=300),
        )
        assert result.state_ordinary_tax == pytest.approx(100)
        assert result.ordinary_tax == pytest.approx(1_100)
        assert result.gap == pytest.approx(6_100)

    def test_what_the_income_leaves_covers_the_first_draw_exactly(self):
        # No state tax on the income, so the whole 300 reaches the sale:
        # at 5% it makes the first 6,000 of gain free, and the gross-up
        # solves for that rather than refunding it after the fact.
        result = run(buckets=[eth(basis=0)], state=replace(FLAT_STATE, exemption_credit=300))
        draw = result.draws[0]
        assert draw.gross == pytest.approx(6_000 + 31_000 / 0.95)
        assert draw.state_tax == pytest.approx(draw.gross * 0.05 - 300)
        assert draw.net == pytest.approx(37_000)

    def test_the_credit_is_split_across_the_income_and_the_draw_in_order(self):
        # 37,000 of state-taxable income owes 1,850; a 2,000 credit clears
        # it and leaves 150 for the sale — 3,000 of gain at 5%.
        result = run(
            target_spend=60_000,
            income=40_000,
            ordinary_income=40_000,
            ordinary_brackets=BRACKETS,
            buckets=[eth(basis=0)],
            state=replace(FLAT_STATE, exemption_credit=2_000),
        )
        assert result.state_ordinary_tax == 0
        assert result.gap == pytest.approx(21_000)
        draw = result.draws[0]
        assert draw.gross == pytest.approx(3_000 + 18_000 / 0.95)
        assert draw.state_tax == pytest.approx(draw.gross * 0.05 - 150)

    def test_the_credit_never_refunds(self):
        result = run(buckets=[eth(basis=0)], state=replace(FLAT_STATE, exemption_credit=10_000))
        draw = result.draws[0]
        assert result.state_ordinary_tax == 0
        assert draw.state_tax == 0
        assert draw.gross == pytest.approx(37_000)
        assert result.gap == pytest.approx(37_000)


class TestUnfillableGap:
    def test_the_waterfall_reports_what_it_could_not_deliver(self):
        # ETH 5,000 + brokerage 10,000 inside the headroom, 401(k)
        # gated at 38 → 22,000 of the 37,000 gap goes unfilled
        result = run(
            buckets=[
                eth(balance=5_000),
                brokerage(balance=10_000, basis=8_000),
                four01k(),
            ],
            ordinary_brackets=BRACKETS,
        )
        assert [draw.net for draw in result.draws] == [
            pytest.approx(5_000),
            pytest.approx(10_000),
            0,
        ]
        assert result.draws[2].note == "locked until age 59.5"
        assert result.shortfall == pytest.approx(22_000)
        assert result.net_delivered == pytest.approx(23_000)


def hsa(balance=500_000.0, access_age=65.0):
    # A tax-advantaged bucket that is not taxed as ordinary income:
    # its gate has to hold on the bucket, not on the treatment.
    return Bucket(name="HSA", balance=balance, basis=0.0, treatment="LTCG", access_age=access_age)


class TestAccessGate:
    """The gate belongs to the bucket, not to its tax treatment — a Roth
    or an HSA locks exactly the way a traditional 401(k) does."""

    def test_a_capital_gains_bucket_below_its_access_age_is_locked(self):
        result = run(age=40, buckets=[hsa()])
        draw = result.draws[0]
        assert draw.gross == 0
        assert draw.net == 0
        assert draw.note == "locked until age 65"
        assert result.shortfall == pytest.approx(37_000)

    def test_a_locked_bucket_reports_its_own_treatment(self):
        assert run(age=40, buckets=[hsa()]).draws[0].treatment == "LTCG"

    def test_a_locked_bucket_spends_none_of_the_headroom(self):
        # The gate runs first, so the brokerage behind it still meets
        # the full 0% headroom rather than one the locked sale spent.
        result = run(age=40, buckets=[hsa(), brokerage()])
        assert result.draws[1].gross == pytest.approx(37_000)
        assert result.draws[1].tax == 0
        assert result.shortfall == 0


def tax_free(balance=500_000.0, access_age=None):
    return Bucket(
        name="HSA", balance=balance, basis=0.0, treatment="TAX_FREE", access_age=access_age
    )


class TestTaxFreeStep:
    """A Roth or an HSA spent on qualified expenses comes out whole:
    no gain to realize, and nothing to stack on ordinary income."""

    def test_the_draw_is_delivered_untaxed(self):
        result = run(age=70, buckets=[tax_free()], ordinary_brackets=BRACKETS)
        draw = result.draws[0]
        assert draw.treatment == "TAX_FREE"
        assert draw.gross == pytest.approx(37_000)
        assert draw.tax == 0
        assert draw.net == pytest.approx(37_000)
        assert result.shortfall == 0

    def test_the_balance_caps_the_draw(self):
        result = run(age=70, buckets=[tax_free(balance=10_000)], ordinary_brackets=BRACKETS)
        assert result.draws[0].gross == pytest.approx(10_000)
        assert result.shortfall == pytest.approx(27_000)

    def test_it_spends_none_of_the_capital_gains_headroom(self):
        # 20,000 comes out tax-free; the brokerage behind it still meets
        # the whole 0% headroom rather than one the draw ate into.
        result = run(age=70, buckets=[tax_free(balance=20_000), brokerage()])
        assert result.draws[0].net == pytest.approx(20_000)
        assert result.draws[1].gross == pytest.approx(17_000)
        assert result.draws[1].tax == 0


def spouse_hsa(age_offset=-3.0):
    # The caller simulates on one age axis; a bucket owned by someone
    # younger sits that many years behind it.
    return Bucket(
        name="HSA · spouse",
        balance=500_000.0,
        basis=0.0,
        treatment="TAX_FREE",
        access_age=65.0,
        age_offset=age_offset,
    )


class TestOwnerAgeOffset:
    """A gate is measured against its owner's age, which need not be the
    age the caller passes. The offset carries the difference, so the
    engine never has to know whose bucket it is."""

    def test_a_younger_owners_bucket_is_locked_past_the_gate_age(self):
        result = run(age=65, buckets=[spouse_hsa()], ordinary_brackets=BRACKETS)
        draw = result.draws[0]
        assert draw.gross == 0
        assert draw.note == "locked until age 65"

    def test_it_unlocks_when_the_owner_reaches_the_gate(self):
        result = run(age=68, buckets=[spouse_hsa()], ordinary_brackets=BRACKETS)
        draw = result.draws[0]
        assert draw.gross == pytest.approx(37_000)
        assert draw.note is None

    def test_an_unoffset_bucket_keeps_its_gate_on_the_callers_axis(self):
        result = run(age=65, buckets=[spouse_hsa(age_offset=0.0)], ordinary_brackets=BRACKETS)
        assert result.draws[0].note is None
