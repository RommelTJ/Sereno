from datetime import date

from sereno.engine.funds import due_contribution_months


class TestDueContributionMonths:
    def test_every_first_after_the_anchor_through_today(self):
        assert due_contribution_months(anchor=date(2026, 6, 15), today=date(2026, 8, 7)) == [
            date(2026, 7, 1),
            date(2026, 8, 1),
        ]

    def test_nothing_due_within_the_anchor_month(self):
        # An anchor on the 1st is that month's contribution (or a manual
        # entry standing in for it) — the next one is due on the next 1st.
        assert due_contribution_months(anchor=date(2026, 6, 1), today=date(2026, 6, 30)) == []

    def test_todays_own_first_counts(self):
        assert due_contribution_months(anchor=date(2026, 6, 1), today=date(2026, 7, 1)) == [
            date(2026, 7, 1)
        ]

    def test_nothing_due_when_the_anchor_is_today(self):
        assert due_contribution_months(anchor=date(2026, 7, 7), today=date(2026, 7, 7)) == []

    def test_catches_up_across_a_year_boundary(self):
        assert due_contribution_months(anchor=date(2025, 11, 30), today=date(2026, 2, 3)) == [
            date(2025, 12, 1),
            date(2026, 1, 1),
            date(2026, 2, 1),
        ]
