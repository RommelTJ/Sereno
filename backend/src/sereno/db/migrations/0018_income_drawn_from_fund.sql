-- The fund an income row drew its inflow from, for funding a budget month
-- out of a sinking fund in one action: POST /api/income appends the paired
-- 'spend' fund_entry alongside the row, and edits and deletes need to know
-- which draw to reverse. NULL = an ordinary inflow that touched no fund —
-- every existing row.
ALTER TABLE income_event ADD COLUMN drawn_from_fund_id INTEGER REFERENCES fund(id);
