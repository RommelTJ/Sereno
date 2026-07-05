"""The Guyton-Klinger guardrails engine: the ±band around the stored
at-retirement rate is the trigger, the ~10% adjustment is the response.
Band comparisons are strict — a rate sitting exactly on a guardrail
holds — and the trigger portfolios answer "at what portfolio level
would the next rule fire?".
"""

import pytest

from sereno.engine.guardrails import evaluate_guardrails


def decide(spend=45000, investable=1_530_000, initial_rate=0.0294, band=0.20):
    return evaluate_guardrails(
        spend=spend,
        investable=investable,
        initial_rate=initial_rate,
        band=band,
    )


class TestRateAndBands:
    def test_rate_is_spend_over_investable(self):
        assert decide(spend=45000, investable=1_530_000).rate == pytest.approx(45000 / 1_530_000)

    def test_bands_are_the_initial_rate_plus_and_minus_the_band(self):
        decision = decide(initial_rate=0.0294, band=0.20)
        assert decision.lower == pytest.approx(0.0294 * 0.80)
        assert decision.upper == pytest.approx(0.0294 * 1.20)

    def test_the_band_width_comes_from_config_not_a_constant(self):
        decision = decide(initial_rate=0.0300, band=0.10)
        assert decision.lower == pytest.approx(0.0270)
        assert decision.upper == pytest.approx(0.0330)


class TestZones:
    def test_a_rate_inside_the_band_holds(self):
        # 45,000 / 1,530,000 ≈ 2.94% — between 2.352% and 3.528%
        assert decide().zone == "hold"

    def test_a_rate_above_the_upper_guardrail_cuts(self):
        # 60,000 / 1,530,000 ≈ 3.92% — the capital-preservation rule fires
        assert decide(spend=60000).zone == "cut"

    def test_a_rate_below_the_lower_guardrail_raises(self):
        # 30,000 / 1,530,000 ≈ 1.96% — the prosperity rule fires
        assert decide(spend=30000).zone == "raise"

    def test_a_rate_exactly_on_the_upper_guardrail_holds(self):
        # investable = 1 makes the rate equal the spend bit-for-bit, so the
        # edge is computed with the same float ops as the implementation.
        upper = 0.0294 * (1 + 0.20)
        assert decide(spend=upper, investable=1).zone == "hold"

    def test_a_rate_exactly_on_the_lower_guardrail_holds(self):
        lower = 0.0294 * (1 - 0.20)
        assert decide(spend=lower, investable=1).zone == "hold"

    def test_a_narrower_band_can_turn_a_hold_into_a_cut(self):
        # ≈3.27% holds inside ±20% but breaches the ±10% upper rail (3.234%)
        assert decide(spend=50000, investable=1_530_000, band=0.20).zone == "hold"
        assert decide(spend=50000, investable=1_530_000, band=0.10).zone == "cut"


class TestTriggers:
    def test_raise_trigger_is_the_portfolio_where_the_rate_hits_the_lower_rail(self):
        decision = decide(spend=45000)
        assert decision.raise_trigger == pytest.approx(45000 / (0.0294 * 0.80))

    def test_cut_trigger_is_the_portfolio_where_the_rate_hits_the_upper_rail(self):
        decision = decide(spend=45000)
        assert decision.cut_trigger == pytest.approx(45000 / (0.0294 * 1.20))

    def test_triggers_scale_with_the_spend_being_tested(self):
        assert decide(spend=90000).raise_trigger == pytest.approx(2 * decide().raise_trigger)
