"""The cents boundary: dollars cross the API as floats, cents live in the
database as integers, and these two helpers are the only translation."""

from sereno.money import to_cents, to_dollars


class TestToCents:
    def test_converts_two_decimal_dollars_exactly(self):
        assert to_cents(99.33) == 9933
        assert to_cents(14.82) == 1482
        assert to_cents(0.01) == 1

    def test_heals_accumulated_float_drift(self):
        # The exact floats the issue's reproduction accumulates:
        # 14.82 + 68.57 + 90.89 - 74.95 chained one entry at a time.
        assert to_cents(83.38999999999999) == 8339
        assert to_cents(174.27999999999997) == 17428
        assert to_cents(99.32999999999997) == 9933

    def test_negative_amounts_release_money(self):
        assert to_cents(-99.33) == -9933

    def test_zero(self):
        assert to_cents(0) == 0
        assert to_cents(0.0) == 0

    def test_none_passes_through(self):
        assert to_cents(None) is None


class TestToDollars:
    def test_converts_cents_to_dollars(self):
        assert to_dollars(9933) == 99.33
        assert to_dollars(1) == 0.01
        assert to_dollars(0) == 0.0

    def test_negative_cents(self):
        assert to_dollars(-9933) == -99.33

    def test_none_passes_through(self):
        assert to_dollars(None) is None


def test_round_trips_two_decimal_values():
    for dollars in (0.01, 0.99, 14.82, 99.33, 174.28, 1_744_000.00):
        assert to_dollars(to_cents(dollars)) == dollars
