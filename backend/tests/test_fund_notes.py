"""The fund note derivation: notes are computed from a fund's own numbers,
never hand-typed, so they can't go stale. Ported from the design handoff's
"Fund note derivation" rules; dates in notes stay ISO (YYYY-MM) — display
formatting is the frontend's job.
"""

from datetime import date

from sereno.engine.funds import derive_note

TODAY = date(2026, 6, 15)


def note(
    target_amount=None,
    target_date=None,
    monthly_plan=None,
    balance=0,
    today=TODAY,
):
    return derive_note(
        target_amount=target_amount,
        target_date=target_date,
        monthly_plan=monthly_plan,
        balance=balance,
        today=today,
    )


class TestFullyFunded:
    def test_balance_at_target_is_fully_funded(self):
        assert note(target_amount=10000, balance=10000) == "✓ fully funded — ready to spend"

    def test_balance_over_target_is_fully_funded(self):
        assert note(target_amount=10000, balance=12500) == "✓ fully funded — ready to spend"

    def test_fully_funded_wins_over_a_goal_date(self):
        assert (
            note(target_amount=10000, target_date="2027-08-01", balance=10000)
            == "✓ fully funded — ready to spend"
        )


class TestGoalWithDate:
    def test_future_date_needs_remaining_over_months_until(self):
        # 9,000 remaining ÷ 14 months (Jun 2026 → Aug 2027)
        assert (
            note(target_amount=14000, target_date="2027-08-01", balance=5000)
            == "needs $643 / mo to finish by 2027-08"
        )

    def test_date_in_the_current_month_shows_whats_left(self):
        assert (
            note(target_amount=14000, target_date="2026-06-01", balance=5000)
            == "$9,000 left · 2026-06"
        )

    def test_past_date_shows_whats_left(self):
        assert (
            note(target_amount=14000, target_date="2026-05-01", balance=5000)
            == "$9,000 left · 2026-05"
        )


class TestSinkingWithMonthlyPlan:
    def test_a_year_or_more_out_shows_years(self):
        # 20,000 remaining at $500/mo = 3.3 years
        assert (
            note(target_amount=30000, monthly_plan=500, balance=10000)
            == "$500 / mo · ~3.3 yrs to target"
        )

    def test_under_a_year_shows_months(self):
        # 16,000 remaining at $2,166/mo = 8 months (rounded up)
        assert (
            note(target_amount=26000, monthly_plan=2166, balance=10000)
            == "$2,166 / mo · ~8 mo to target"
        )


class TestNoMonthlyPlan:
    def test_missing_plan_asks_for_one(self):
        assert note(target_amount=14000, balance=5000) == "$9,000 to target · add a monthly plan"

    def test_zero_plan_asks_for_one(self):
        assert (
            note(target_amount=14000, monthly_plan=0, balance=5000)
            == "$9,000 to target · add a monthly plan"
        )


class TestOpenEnded:
    def test_no_target_with_a_plan_is_open_ended(self):
        assert note(monthly_plan=300, balance=4200) == "$300 / mo · open-ended"

    def test_no_target_and_no_plan_asks_for_one(self):
        assert note(balance=4200) == "open-ended · add a monthly plan"

    def test_zero_plan_asks_for_one(self):
        assert note(monthly_plan=0, balance=4200) == "open-ended · add a monthly plan"

    def test_a_date_without_a_target_is_still_open_ended(self):
        assert (
            note(target_date="2027-08-01", monthly_plan=300, balance=4200)
            == "$300 / mo · open-ended"
        )
