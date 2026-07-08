-- Where a fund entry came from, like balance_entry.source: 'spend' for the
-- drawdown appended alongside a fund-funded expense, 'monthly_plan' for an
-- automatic monthly contribution, NULL for a hand-entered row. Lets the
-- monthly catch-up find its own entries without guessing from dates.
ALTER TABLE fund_entry ADD COLUMN source TEXT;
