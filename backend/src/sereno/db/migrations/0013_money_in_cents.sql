-- Ledger money becomes integer cents (issue #112). Every money column held
-- Python floats over NUMERIC affinity, and the append-only chains
-- (fund_entry, balance_entry) recompute each row as previous + delta, so
-- representation error accumulated until a stored balance sat a fraction
-- of a cent below the figure the UI displays — and the overdraw guards
-- compared those raw floats, rejecting a full release or a spend-to-zero
-- with a false 422. Integer cents make the drift structurally impossible:
-- the sums are exact, and ROUND(value * 100) here heals any drift already
-- stored.
--
-- Converted: fund.target_amount, fund.monthly_plan, fund_entry.balance,
-- fund_entry.contribution, expense_line.amount, income_event.amount,
-- balance_entry.balance_usd, category_plan.planned. Fractional precision
-- stays where it is real: quantity, unit_price, and cost_basis (dollars —
-- basis feeds tax math, never ledger sums), tax_lot, transfer, and the
-- config tables (spend_plan, social_security, assumption, tax_param) are
-- projection inputs, not ledger arithmetic. JSON stays dollars: the API
-- converts at the boundary (sereno.money).
--
-- SQLite cannot ALTER a column's type, so each table is rebuilt via the
-- documented dance: foreign keys off, create the new shape under a temp
-- name, copy with ids preserved (no FK edge moves), drop, rename, and
-- recreate the indexes. The three money views are dropped first — ALTER
-- TABLE RENAME re-parses dependent views, which would fail over a
-- mid-rebuild table — and recreated verbatim at the end: their SUMs are
-- unit-agnostic, so they now total cents.
PRAGMA foreign_keys = OFF;

BEGIN;

DROP VIEW v_account_monthly;
DROP VIEW v_net_worth;
DROP VIEW v_budget_month;

CREATE TABLE fund_cents (
    id            INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL,                       -- 'Emergency fund', 'Pool fund'
    kind          TEXT    NOT NULL,                       -- goal | sinking
    target_amount INTEGER,                                -- cents; NULL = open-ended sinking fund
    target_date   TEXT,                                   -- NULL = no deadline (sinking)
    monthly_plan  INTEGER,                                -- intended contribution / month, cents
    active        INTEGER NOT NULL DEFAULT 1,
    emoji         TEXT
);
INSERT INTO fund_cents (id, name, kind, target_amount, target_date, monthly_plan, active, emoji)
SELECT id, name, kind,
       CAST(ROUND(target_amount * 100) AS INTEGER),
       target_date,
       CAST(ROUND(monthly_plan * 100) AS INTEGER),
       active, emoji
FROM fund;
DROP TABLE fund;
ALTER TABLE fund_cents RENAME TO fund;

CREATE TABLE fund_entry_cents (
    id           INTEGER PRIMARY KEY,
    fund_id      INTEGER NOT NULL REFERENCES fund(id),
    as_of_date   TEXT    NOT NULL,
    balance      INTEGER NOT NULL,                        -- cents
    contribution INTEGER NOT NULL DEFAULT 0,              -- cents
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    source       TEXT                                     -- 'spend' | 'monthly_plan' | 'top_up'
                                                          -- | 'rollover' | NULL (hand-entered)
);
INSERT INTO fund_entry_cents (id, fund_id, as_of_date, balance, contribution, created_at, source)
SELECT id, fund_id, as_of_date,
       CAST(ROUND(balance * 100) AS INTEGER),
       CAST(ROUND(contribution * 100) AS INTEGER),
       created_at, source
FROM fund_entry;
DROP TABLE fund_entry;
ALTER TABLE fund_entry_cents RENAME TO fund_entry;
CREATE INDEX ix_fund_entry ON fund_entry(fund_id, as_of_date);
CREATE UNIQUE INDEX ux_fund_entry_monthly_plan
    ON fund_entry(fund_id, as_of_date) WHERE source = 'monthly_plan';

CREATE TABLE expense_line_cents (
    id            INTEGER PRIMARY KEY,
    txn_date      TEXT    NOT NULL,                       -- date on the bank statement
    budget_month  TEXT    NOT NULL,                       -- 'YYYY-MM' the spend is charged to
    category_id   INTEGER REFERENCES category(id),
    amount        INTEGER NOT NULL,                       -- positive cents spent
    is_fixed      INTEGER NOT NULL DEFAULT 0,
    funded_from   TEXT    NOT NULL DEFAULT 'discretionary', -- 'discretionary' | 'fund'
    fund_id       INTEGER REFERENCES fund(id),            -- set when funded_from='fund'
    account_id    INTEGER REFERENCES account(id),         -- which card/checking it hit
    note          TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    pending       INTEGER NOT NULL DEFAULT 0
);
INSERT INTO expense_line_cents (id, txn_date, budget_month, category_id, amount, is_fixed,
                                funded_from, fund_id, account_id, note, created_at, pending)
SELECT id, txn_date, budget_month, category_id,
       CAST(ROUND(amount * 100) AS INTEGER),
       is_fixed, funded_from, fund_id, account_id, note, created_at, pending
FROM expense_line;
DROP TABLE expense_line;
ALTER TABLE expense_line_cents RENAME TO expense_line;
CREATE INDEX ix_expense_month ON expense_line(budget_month);

CREATE TABLE income_event_cents (
    id            INTEGER PRIMARY KEY,
    txn_date      TEXT    NOT NULL,
    budget_month  TEXT    NOT NULL,                       -- 'YYYY-MM' this inflow funds
    source        TEXT    NOT NULL,                       -- paycheck | transfer_in | staking
                                                          -- | dividend | interest | soc_sec
    amount        INTEGER NOT NULL,                       -- cents
    tax_treatment TEXT,                                   -- ORDINARY | LTCG | TAX_FREE | NULL
    account_id    INTEGER REFERENCES account(id),         -- bucket it was drawn from (if a withdrawal)
    note          TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    source_label  TEXT,
    pending       INTEGER NOT NULL DEFAULT 0
);
INSERT INTO income_event_cents (id, txn_date, budget_month, source, amount, tax_treatment,
                                account_id, note, created_at, source_label, pending)
SELECT id, txn_date, budget_month, source,
       CAST(ROUND(amount * 100) AS INTEGER),
       tax_treatment, account_id, note, created_at, source_label, pending
FROM income_event;
DROP TABLE income_event;
ALTER TABLE income_event_cents RENAME TO income_event;
CREATE INDEX ix_income_month ON income_event(budget_month);

CREATE TABLE balance_entry_cents (
    id          INTEGER PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES account(id),
    as_of_date  TEXT    NOT NULL,                         -- the date you recorded it
    balance_usd INTEGER NOT NULL,                         -- cents
    quantity    NUMERIC,                                  -- e.g. ETH held (NULL for USD accounts)
    unit_price  NUMERIC,                                  -- e.g. $/ETH at as_of_date, dollars
    cost_basis  NUMERIC,                                  -- dollars; feeds tax math, not ledger sums
    source      TEXT,                                     -- 'manual' | 'zillow' | 'vanguard'
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO balance_entry_cents (id, account_id, as_of_date, balance_usd, quantity, unit_price,
                                 cost_basis, source, created_at)
SELECT id, account_id, as_of_date,
       CAST(ROUND(balance_usd * 100) AS INTEGER),
       quantity, unit_price, cost_basis, source, created_at
FROM balance_entry;
DROP TABLE balance_entry;
ALTER TABLE balance_entry_cents RENAME TO balance_entry;
CREATE INDEX ix_balance_account_date ON balance_entry(account_id, as_of_date);

CREATE TABLE category_plan_cents (
    id              INTEGER PRIMARY KEY,
    category_id     INTEGER NOT NULL REFERENCES category(id),
    effective_month TEXT    NOT NULL,                      -- 'YYYY-MM' the plan starts
    planned         INTEGER NOT NULL                       -- cents
);
INSERT INTO category_plan_cents (id, category_id, effective_month, planned)
SELECT id, category_id, effective_month, CAST(ROUND(planned * 100) AS INTEGER)
FROM category_plan;
DROP TABLE category_plan;
ALTER TABLE category_plan_cents RENAME TO category_plan;
CREATE INDEX ix_category_plan ON category_plan(category_id, effective_month);

-- The views, verbatim from 0004 (v_account_monthly), 0001 (v_net_worth),
-- and 0006 (v_budget_month) — now summing cents.
CREATE VIEW v_account_monthly AS
WITH month AS (
    SELECT DISTINCT substr(as_of_date, 1, 7) AS ym FROM balance_entry
),
ranked AS (
    SELECT month.ym, b.*,
           ROW_NUMBER() OVER (
               PARTITION BY b.account_id, month.ym
               ORDER BY b.as_of_date DESC, b.id DESC
           ) AS rn
    FROM month
    JOIN balance_entry b ON substr(b.as_of_date, 1, 7) <= month.ym
)
SELECT r.account_id, r.ym AS month, r.as_of_date, r.balance_usd,
       r.quantity, r.unit_price, r.cost_basis
FROM ranked r
JOIN account a ON a.id = r.account_id
WHERE r.rn = 1
  AND (a.active = 1 OR substr(r.as_of_date, 1, 7) = r.ym);

CREATE VIEW v_net_worth AS
SELECT m.month,
       SUM(CASE WHEN a.is_liability = 0 THEN m.balance_usd ELSE 0 END)
     - SUM(CASE WHEN a.is_liability = 1 THEN m.balance_usd ELSE 0 END) AS net_worth,
       SUM(CASE WHEN a.is_investable = 1 THEN m.balance_usd ELSE 0 END) AS investable
FROM v_account_monthly m
JOIN account a ON a.id = m.account_id
GROUP BY m.month;

CREATE VIEW v_budget_month AS
SELECT budget_month AS month,
       (SELECT COALESCE(SUM(amount),0) FROM income_event  i WHERE i.budget_month = e.budget_month) AS funded_in,
       SUM(CASE WHEN is_fixed = 1 AND funded_from = 'discretionary' THEN amount ELSE 0 END) AS fixed_spent,
       SUM(CASE WHEN is_fixed = 0 AND funded_from = 'discretionary' THEN amount ELSE 0 END) AS variable_spent,
       SUM(CASE WHEN funded_from = 'discretionary' THEN amount ELSE 0 END) AS total_spent,
       SUM(CASE WHEN funded_from = 'fund' THEN amount ELSE 0 END) AS fund_spent
FROM expense_line e
GROUP BY budget_month;

COMMIT;

PRAGMA foreign_keys = ON;
