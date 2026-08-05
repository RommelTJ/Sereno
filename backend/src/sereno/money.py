"""The cents boundary: dollars cross the API as floats, ledger money lives
in the database as integer cents (migration 0013), and these two helpers
are the only translation. Converting on the way in — before any arithmetic
or guard — is what makes balance drift structurally impossible: integer
sums are exact, so a stored balance can never sit a fraction of a cent
away from the figure the UI displays.
"""

from typing import overload


@overload
def to_cents(dollars: float) -> int: ...
@overload
def to_cents(dollars: None) -> None: ...
def to_cents(dollars: float | None) -> int | None:
    """Dollars as they arrive from the API, rounded to the nearest cent."""
    if dollars is None:
        return None
    return round(dollars * 100)


@overload
def to_dollars(cents: int) -> float: ...
@overload
def to_dollars(cents: None) -> None: ...
def to_dollars(cents: int | None) -> float | None:
    """Stored cents back to the dollars the JSON contract speaks."""
    if cents is None:
        return None
    return cents / 100
