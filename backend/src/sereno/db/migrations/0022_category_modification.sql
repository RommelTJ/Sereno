-- The last modification per envelope and budget month (issue #179). The
-- Safe-to-spend envelopes card lists the most recently changed envelope
-- first, and expense_line cannot say which that is: an edit leaves no
-- timestamp and a delete leaves no row. The expense endpoints upsert one
-- row here per (category, budget month) whenever a discretionary line in
-- that envelope is added, edited, or deleted.
--
-- seq is the ordering authority — it rises by one with every change, so
-- larger means more recent. datetime('now') alone resolves to a second,
-- and a move between envelopes must rank its destination above its
-- source within one request. modified_at says when, for anyone reading
-- the table.
CREATE TABLE category_modification (
    category_id  INTEGER NOT NULL REFERENCES category(id),
    budget_month TEXT    NOT NULL,                       -- 'YYYY-MM'
    seq          INTEGER NOT NULL,                       -- larger = more recent
    modified_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (category_id, budget_month)
);

-- Backfill from the only history there is: each envelope's newest
-- discretionary expense per budget month, by when the row was entered.
-- Fund-funded and uncategorized lines never moved an envelope bar, so
-- they leave no row. A same-second tie falls to the later row.
INSERT INTO category_modification (category_id, budget_month, seq, modified_at)
SELECT category_id,
       budget_month,
       ROW_NUMBER() OVER (ORDER BY MAX(created_at), MAX(id)),
       MAX(created_at)
FROM expense_line
WHERE category_id IS NOT NULL AND funded_from = 'discretionary'
GROUP BY category_id, budget_month;
