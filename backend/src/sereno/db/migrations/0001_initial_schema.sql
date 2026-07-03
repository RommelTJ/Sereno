-- ============================================================================
--  HOME BUDGET — append-only finance schema
--  Target: SQLite / Postgres on the LAN (no auth; two users only)
--  Design rules:
--    1. APPEND-ONLY  — never UPDATE a balance; INSERT a new dated row.
--    2. EFFECTIVE-DATED — every fact carries a date; reconstruct any month.
--    3. TIDY LONG — one fact per row. Months are rows, never columns.
--    4. DIM / FACT / CONFIG — separate what things ARE, what HAPPENED,
--       and the year's tax/assumption settings.
--  This shape lets an AI agent diff any two dates, replay history, and
--  explain *what changed and when*.
-- ============================================================================

-- Use TEXT ISO-8601 dates for SQLite portability; switch to DATE on Postgres.
-- (PRAGMA foreign_keys is per-connection and set by sereno.db.connection.)

-- ---------------------------------------------------------------------------
-- DIMENSIONS — slowly-changing reference data
-- ---------------------------------------------------------------------------

-- Every net-worth bucket: investment buckets, cash, real assets, liabilities.
CREATE TABLE account (
    id                  INTEGER PRIMARY KEY,
    name                TEXT    NOT NULL,                 -- 'Ethereum', 'VFIAX', 'Chase checking'
    kind                TEXT    NOT NULL,                 -- eth | brokerage_fund | 401k | roth | hsa
                                                          -- | cash | cash_plus | home | car | mortgage
    tax_treatment       TEXT    NOT NULL DEFAULT 'none',  -- LTCG | ORDINARY | TAX_FREE | NONE
    owner               TEXT,                             -- 'you' | 'spouse' | 'joint'
    is_liability        INTEGER NOT NULL DEFAULT 0,       -- 1 for mortgage etc.
    is_investable       INTEGER NOT NULL DEFAULT 0,       -- 1 if it counts toward the withdrawal portfolio
    withdrawal_priority INTEGER,                          -- 1=ETH, 2=brokerage, 3=tax-advantaged; NULL if n/a
    access_age          REAL,                             -- 59.5 for 401k; NULL if unrestricted
    penalty_rate        REAL,                             -- 0.10 early-withdrawal penalty; NULL if none
    access_workaround   TEXT,                             -- 'roth_ladder' | '72t' | NULL
    active              INTEGER NOT NULL DEFAULT 1
);

-- Goals and sinking funds are ONE concept: a fund with an optional target date.
-- kind='goal' when target_date IS NOT NULL, else 'sinking'.
CREATE TABLE fund (
    id            INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL,                       -- 'Emergency fund', 'Pool fund'
    kind          TEXT    NOT NULL,                       -- goal | sinking
    target_amount NUMERIC,                                -- NULL = open-ended sinking fund
    target_date   TEXT,                                   -- NULL = no deadline (sinking)
    monthly_plan  NUMERIC,                                -- intended contribution / month
    active        INTEGER NOT NULL DEFAULT 1
);

-- Budget categories. is_fixed=1 auto-fills monthly (Housing, Insurance…);
-- is_fixed=0 = variable envelope (Groceries, Gas…) you add to as you reconcile.
CREATE TABLE category (
    id        INTEGER PRIMARY KEY,
    name      TEXT    NOT NULL,
    emoji     TEXT,
    is_fixed  INTEGER NOT NULL DEFAULT 0,
    active    INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- FACTS — append-only, effective-dated event rows
-- ---------------------------------------------------------------------------

-- Monthly portfolio snapshot. You may insert MANY rows for one calendar month
-- (you check often); reporting uses the LATEST as_of_date within the month.
-- See view v_account_monthly below. quantity/unit_price let the app translate
-- ETH→USD automatically (balance_usd = quantity * unit_price when present).
CREATE TABLE balance_entry (
    id          INTEGER PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES account(id),
    as_of_date  TEXT    NOT NULL,                         -- the date you recorded it
    balance_usd NUMERIC NOT NULL,
    quantity    NUMERIC,                                  -- e.g. ETH held (NULL for USD accounts)
    unit_price  NUMERIC,                                  -- e.g. $/ETH at as_of_date
    cost_basis  NUMERIC,                                  -- for LTCG buckets; lot detail in tax_lot
    source      TEXT,                                     -- 'manual' | 'zillow' | 'vanguard'
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_balance_account_date ON balance_entry(account_id, as_of_date);

-- Optional lot-level basis for the taxable brokerage (sourcing engine reads this).
CREATE TABLE tax_lot (
    id          INTEGER PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES account(id),
    acquired_on TEXT    NOT NULL,
    quantity    NUMERIC NOT NULL,
    cost_basis  NUMERIC NOT NULL,
    closed_on   TEXT                                      -- NULL while open
);

-- Every spending item = one row (a debit). Reconciled from Chase statements.
-- budget_month = the month this draws from (prepay: June pay funds July).
-- funded_from = 'discretionary' or a fund id (then log the matching Cash Plus
-- withdrawal as a transfer, below). Amounts are positive; sign is implied by type.
CREATE TABLE expense_line (
    id            INTEGER PRIMARY KEY,
    txn_date      TEXT    NOT NULL,                       -- date on the bank statement
    budget_month  TEXT    NOT NULL,                       -- 'YYYY-MM' the spend is charged to
    category_id   INTEGER REFERENCES category(id),
    amount        NUMERIC NOT NULL,                       -- positive dollars spent
    is_fixed      INTEGER NOT NULL DEFAULT 0,
    funded_from   TEXT    NOT NULL DEFAULT 'discretionary', -- 'discretionary' | 'fund'
    fund_id       INTEGER REFERENCES fund(id),            -- set when funded_from='fund'
    account_id    INTEGER REFERENCES account(id),         -- which card/checking it hit
    note          TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_expense_month ON expense_line(budget_month);

-- Every inflow = one row (a credit): paychecks now, account withdrawals later.
-- budget_month tags which month it funds. Split a quarterly/yearly withdrawal
-- into N rows (one per month) for month-by-month budgeting.
CREATE TABLE income_event (
    id            INTEGER PRIMARY KEY,
    txn_date      TEXT    NOT NULL,
    budget_month  TEXT    NOT NULL,                       -- 'YYYY-MM' this inflow funds
    source        TEXT    NOT NULL,                       -- paycheck | transfer_in | staking
                                                          -- | dividend | interest | soc_sec
    amount        NUMERIC NOT NULL,
    tax_treatment TEXT,                                   -- ORDINARY | LTCG | TAX_FREE | NULL
    account_id    INTEGER REFERENCES account(id),         -- bucket it was drawn from (if a withdrawal)
    note          TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_income_month ON income_event(budget_month);

-- Fund balance / contribution snapshots (append-only, like balance_entry).
CREATE TABLE fund_entry (
    id           INTEGER PRIMARY KEY,
    fund_id      INTEGER NOT NULL REFERENCES fund(id),
    as_of_date   TEXT    NOT NULL,
    balance      NUMERIC NOT NULL,
    contribution NUMERIC NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_fund_entry ON fund_entry(fund_id, as_of_date);

-- Money moved between accounts (e.g. fund-sourced buy → Vanguard Cash Plus
-- withdrawal that mirrors it). Keeps fund + cash drawing down together.
CREATE TABLE transfer (
    id            INTEGER PRIMARY KEY,
    txn_date      TEXT    NOT NULL,
    from_account  INTEGER REFERENCES account(id),
    to_account    INTEGER REFERENCES account(id),
    amount        NUMERIC NOT NULL,
    linked_expense INTEGER REFERENCES expense_line(id),   -- the spend it backs, if any
    note          TEXT
);

-- ---------------------------------------------------------------------------
-- CONFIG — effective-dated settings (revise over 20+ years; history kept)
-- ---------------------------------------------------------------------------

-- Forecast assumptions. Insert a new row to change them; old rows stay.
CREATE TABLE assumption (
    id             INTEGER PRIMARY KEY,
    effective_date TEXT    NOT NULL,
    return_pct     NUMERIC NOT NULL,                      -- nominal, e.g. 7.0 (conservative vs ~11 expected)
    inflation_pct  NUMERIC NOT NULL,                      -- e.g. 3.0
    eth_growth_pct NUMERIC                                -- placeholder, refined from tracked data
);

-- Planned annual spend (the guardrail target). Dated so raises/cuts are logged.
CREATE TABLE spend_plan (
    id             INTEGER PRIMARY KEY,
    effective_date TEXT    NOT NULL,
    annual_target  NUMERIC NOT NULL,                      -- e.g. 45000
    initial_rate   NUMERIC,                               -- Guyton-Klinger anchor rate at retirement
    guardrail_band NUMERIC NOT NULL DEFAULT 0.20          -- ±20%
);

-- Social Security estimates per person; editable, dated (will shift over decades).
CREATE TABLE social_security (
    id             INTEGER PRIMARY KEY,
    person         TEXT    NOT NULL,                       -- 'you' | 'spouse'
    effective_date TEXT    NOT NULL,
    start_age      REAL    NOT NULL,                       -- 67
    monthly_amount NUMERIC NOT NULL                        -- today's dollars
);

-- Tax parameters per year — NEVER hardcode in app code; feed them here.
-- Reconcile against the CPA's numbers; TCJA sunset makes 2026 worth confirming.
CREATE TABLE tax_param (
    tax_year         INTEGER PRIMARY KEY,
    filing_status    TEXT    NOT NULL DEFAULT 'MFJ',
    ltcg_0_ceiling   NUMERIC NOT NULL,                     -- top of the 0% LTCG bracket
    ltcg_15_ceiling  NUMERIC,                              -- 15% → 20% threshold
    niit_rate        NUMERIC NOT NULL DEFAULT 0.038,
    niit_threshold   NUMERIC,
    state_treatment  TEXT    NOT NULL DEFAULT 'CA_ordinary',-- CA taxes cap gains as ordinary
    std_deduction    NUMERIC,
    ordinary_brackets TEXT                                 -- JSON array of {rate, upto}
);

-- ============================================================================
--  VIEWS — the "latest row per month wins" rule, done once.
-- ============================================================================

-- Canonical monthly balance per account: pick the latest as_of_date inside
-- each calendar month (so a Jun 28 entry supersedes a Jun 26 entry for June).
CREATE VIEW v_account_monthly AS
WITH ranked AS (
    SELECT b.*,
           substr(b.as_of_date, 1, 7) AS ym,
           ROW_NUMBER() OVER (
               PARTITION BY b.account_id, substr(b.as_of_date, 1, 7)
               ORDER BY b.as_of_date DESC, b.id DESC
           ) AS rn
    FROM balance_entry b
)
SELECT account_id, ym AS month, as_of_date, balance_usd, quantity, unit_price, cost_basis
FROM ranked
WHERE rn = 1;

-- Net worth per month = assets − liabilities, from the canonical monthly rows.
-- Liability balances are entered as POSITIVE numbers (mortgage = 300000);
-- the view subtracts them.
CREATE VIEW v_net_worth AS
SELECT m.month,
       SUM(CASE WHEN a.is_liability = 0 THEN m.balance_usd ELSE 0 END)
     - SUM(CASE WHEN a.is_liability = 1 THEN m.balance_usd ELSE 0 END) AS net_worth,
       SUM(CASE WHEN a.is_investable = 1 THEN m.balance_usd ELSE 0 END) AS investable
FROM v_account_monthly m
JOIN account a ON a.id = m.account_id
GROUP BY m.month;

-- Safe-to-spend inputs per budget month: cash in vs. earmarked out.
-- (Discretionary categories can go negative — overspend just reduces this.)
CREATE VIEW v_budget_month AS
SELECT budget_month AS month,
       (SELECT COALESCE(SUM(amount),0) FROM income_event  i WHERE i.budget_month = e.budget_month) AS funded_in,
       SUM(CASE WHEN is_fixed = 1 THEN amount ELSE 0 END) AS fixed_spent,
       SUM(CASE WHEN is_fixed = 0 THEN amount ELSE 0 END) AS variable_spent,
       SUM(amount) AS total_spent
FROM expense_line e
GROUP BY budget_month;

-- ============================================================================
--  EXAMPLE QUERIES your AI agent can run straight off these rows
-- ============================================================================
-- Net worth, month over month, last 12 months:
--   SELECT month, net_worth,
--          net_worth - LAG(net_worth) OVER (ORDER BY month) AS mom_change
--   FROM v_net_worth ORDER BY month DESC LIMIT 12;
--
-- Year-over-year (Jan 1 → Jan 1):
--   SELECT (SELECT net_worth FROM v_net_worth WHERE month='2026-01')
--        / (SELECT net_worth FROM v_net_worth WHERE month='2025-01') - 1 AS yoy;
--
-- Did we stay inside the guardrail each month?  (rate = annual_target / investable)
--   SELECT month, investable,
--          (SELECT annual_target FROM spend_plan ORDER BY effective_date DESC LIMIT 1)
--          / investable AS withdrawal_rate
--   FROM v_net_worth ORDER BY month;
--
-- This month's safe-to-spend:
--   SELECT funded_in - total_spent AS safe_to_spend
--   FROM v_budget_month WHERE month = '2026-07';
