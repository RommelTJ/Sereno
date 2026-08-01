-- One planned contribution per fund per date, enforced where a race can't
-- dodge it: two first-of-month requests can both run the monthly catch-up
-- before either commits (the dashboard fires /api/budget-month and
-- /api/funds in parallel), and nothing else stops the second batch.
-- Partial on purpose — same-date duplicates with source NULL (Correct
-- balance twice in a day), 'top_up', or 'spend' are real usage.
CREATE UNIQUE INDEX ux_fund_entry_monthly_plan
    ON fund_entry(fund_id, as_of_date) WHERE source = 'monthly_plan';
