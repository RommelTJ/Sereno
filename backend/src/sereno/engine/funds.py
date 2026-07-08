"""Fund note derivation: a fund's note is computed from its own numbers,
never hand-typed, so it can't go stale. Ported from the design handoff's
"Fund note derivation" rules, plus the open-ended case (no target amount)
the prototype never exercises. Dates in notes stay ISO (YYYY-MM) — display
formatting is the frontend's job.
"""

import math
from datetime import date


def _usd(amount: float) -> str:
    return f"${amount:,.0f}"


def _months_until(target: date, today: date) -> int:
    return (target.year - today.year) * 12 + (target.month - today.month)


def due_contribution_months(*, anchor: date, today: date) -> list[date]:
    """Every 1st-of-month strictly after the anchor, up to and including
    today — the contribution dates a monthly plan still owes. An anchor on
    a 1st already stands for that month, so its own 1st is never due."""
    months: list[date] = []
    year, month = anchor.year, anchor.month
    while True:
        month += 1
        if month > 12:
            year, month = year + 1, 1
        first = date(year, month, 1)
        if first > today:
            return months
        months.append(first)


def derive_note(
    *,
    target_amount: float | None,
    target_date: str | None,
    monthly_plan: float | None,
    balance: float,
    today: date,
) -> str:
    if target_amount is None:
        if monthly_plan:
            return f"{_usd(monthly_plan)} / mo · open-ended"
        return "open-ended · add a monthly plan"

    remaining = max(0, target_amount - balance)
    if remaining <= 0:
        return "✓ fully funded — ready to spend"

    if target_date is not None:
        target = date.fromisoformat(target_date)
        months_left = _months_until(target, today)
        month_label = target.strftime("%Y-%m")
        if months_left > 0:
            return f"needs {_usd(remaining / months_left)} / mo to finish by {month_label}"
        return f"{_usd(remaining)} left · {month_label}"

    if monthly_plan:
        years = remaining / monthly_plan / 12
        label = f"~{years:.1f} yrs" if years >= 1 else f"~{math.ceil(remaining / monthly_plan)} mo"
        return f"{_usd(monthly_plan)} / mo · {label} to target"

    return f"{_usd(remaining)} to target · add a monthly plan"
