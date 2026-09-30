-- The expense or income row behind a fund entry (issue #169). A 'spend'
-- entry has always pointed at its fund, but not back at the row that drew
-- it, so a log read from fund_entry alone could say "−$32.20" and never
-- "The Home Depot". The server links every 'spend' entry it writes; rows
-- written before this migration stay NULL until a deliberate backfill
-- through PUT /api/fund-entries/{id}/link. ON DELETE SET NULL because
-- expense and income rows are hard-deleted, and with foreign keys on a
-- linked delete would otherwise fail — the entry stays as history, the
-- link goes.
ALTER TABLE fund_entry ADD COLUMN expense_id INTEGER
    REFERENCES expense_line(id) ON DELETE SET NULL;
ALTER TABLE fund_entry ADD COLUMN income_id INTEGER
    REFERENCES income_event(id) ON DELETE SET NULL;
