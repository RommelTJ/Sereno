"""Mortgage amortization: a balance, a rate, and a monthly payment solved
to a month count and the interest paid getting there. Pure math over the
caller's numbers — fetching the balance from the ledger and the terms from
config is the API layer's job.

Escrow never appears here. Property tax and insurance ride along with the
payment but pay down no principal, so folding them in would shorten the
schedule that the payoff date depends on.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Amortization:
    months: int
    total_interest: float


def amortize(
    *,
    balance: float,
    annual_rate: float,
    monthly_payment: float,
) -> Amortization | None:
    """Months to payoff and total interest, or None when the payment never
    amortizes — a payment at or below one month's interest leaves the
    balance flat or growing, so there is no payoff date to report."""
    monthly_rate = annual_rate / 12
    months = 0
    total_interest = 0.0
    while balance > 0:
        interest = balance * monthly_rate
        if monthly_payment <= interest:
            return None
        # The last month owes the stub, not another full payment.
        payment = min(monthly_payment, balance + interest)
        total_interest += interest
        balance = balance + interest - payment
        months += 1
    return Amortization(months=months, total_interest=total_interest)
