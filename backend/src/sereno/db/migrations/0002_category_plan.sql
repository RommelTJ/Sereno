-- Planned envelope amounts per category, effective-dated: revising a plan
-- inserts a new row for the month it takes effect; old rows stay as history.
CREATE TABLE category_plan (
    id              INTEGER PRIMARY KEY,
    category_id     INTEGER NOT NULL REFERENCES category(id),
    effective_month TEXT    NOT NULL,                      -- 'YYYY-MM' the plan starts
    planned         NUMERIC NOT NULL
);
CREATE INDEX ix_category_plan ON category_plan(category_id, effective_month);
