"""The mortgage amortization engine: balance, rate, and payment solved to
a month count and the interest paid getting there. The final month is a
partial payment, never an overshoot, and a payment that cannot cover one
month's interest never amortizes at all — it returns None rather than
looping forever. Escrow is deliberately absent: property tax and
insurance ride along with the payment but pay down no principal.
"""

import pytest

from sereno.engine.mortgage import amortize


def solve(balance=1000.0, annual_rate=0.12, monthly_payment=500.0):
    return amortize(
        balance=balance,
        annual_rate=annual_rate,
        monthly_payment=monthly_payment,
    )


class TestSchedule:
    def test_solves_a_hand_checkable_schedule(self):
        # $1,000 at 12% (1%/mo), paying $500: interest 10.00 on a $1,000
        # balance, then 5.10 on 510.00, then 0.151 on the 15.10 stub.
        schedule = solve()
        assert schedule.months == 3
        assert schedule.total_interest == pytest.approx(15.251)

    def test_counts_the_final_partial_month(self):
        # The third month owes $15.25, not another $500 — a schedule that
        # dropped the stub would report two months and understate the term.
        assert solve().months == 3

    def test_a_zero_rate_is_the_balance_over_the_payment(self):
        schedule = solve(balance=12000, annual_rate=0.0, monthly_payment=1000)
        assert schedule.months == 12
        assert schedule.total_interest == 0.0

    def test_a_payment_larger_than_the_balance_takes_one_month(self):
        schedule = solve(monthly_payment=5000)
        assert schedule.months == 1
        assert schedule.total_interest == pytest.approx(10.0)

    def test_a_paid_off_balance_has_nothing_left_to_run(self):
        schedule = solve(balance=0.0)
        assert schedule.months == 0
        assert schedule.total_interest == 0.0

    def test_solves_a_full_length_mortgage(self):
        # $150,000 at 3% paying $1,075: the closed form puts the term at
        # 171.81 months, so the schedule runs 172 with the last one partial.
        schedule = solve(balance=150000, annual_rate=0.03, monthly_payment=1075)
        assert schedule.months == 172
        assert schedule.total_interest == pytest.approx(34698.80, abs=0.01)


class TestExtraPrincipal:
    def test_a_bigger_payment_shortens_the_term(self):
        assert solve(monthly_payment=1000).months < solve(monthly_payment=500).months

    def test_a_bigger_payment_costs_less_interest(self):
        assert (
            solve(balance=150000, annual_rate=0.03, monthly_payment=1275).total_interest
            < solve(balance=150000, annual_rate=0.03, monthly_payment=1075).total_interest
        )

    def test_extra_principal_on_a_full_length_mortgage(self):
        # $200/mo on top of $1,075 P&I: 172 months becomes 140.
        schedule = solve(balance=150000, annual_rate=0.03, monthly_payment=1275)
        assert schedule.months == 140
        assert schedule.total_interest == pytest.approx(27858.77, abs=0.01)


class TestPaymentsThatNeverAmortize:
    def test_a_payment_equal_to_the_interest_never_pays_off(self):
        # $1,000 at 12% owes exactly $10 of interest a month.
        assert solve(monthly_payment=10) is None

    def test_a_payment_below_the_interest_never_pays_off(self):
        assert solve(monthly_payment=9.99) is None

    def test_a_zero_payment_never_pays_off(self):
        assert solve(annual_rate=0.0, monthly_payment=0) is None
