-- A user-defined display order for accounts and envelopes, driving every
-- list the Settings drag-and-drop reorder should reach (ledger columns,
-- the balance form picker, envelope bars). Backfilled from id so existing
-- installs keep their insertion order. Rows inserted later must set
-- sort_order explicitly (MAX + 1): SQLite sorts NULLs first, so a NULL
-- would jump to the top of any list that has been reordered.
ALTER TABLE account ADD COLUMN sort_order INTEGER;
UPDATE account SET sort_order = id;

ALTER TABLE category ADD COLUMN sort_order INTEGER;
UPDATE category SET sort_order = id;
