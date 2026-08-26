-- Mortgage terms as planning config (issue #117). The mortgage was stored
-- as one undifferentiated budget category amount, which lost three facts
-- that matter: when the payment stops, that escrow survives payoff while
-- principal & interest does not, and that a fixed nominal payment costs
-- less in real terms every year.
--
-- Effective-dated and append-only, like assumption and spend_plan: a rate
-- refinance or a change to the extra payment is a new row, and the latest
-- row on or before today wins. account_id links the existing liability
-- account, so the outstanding balance comes from the ledger and is never
-- entered twice — which is also why no maturity date is stored. Any date
-- typed by hand goes stale the moment the extra payment changes, so the
-- payoff is solved from balance, rate, and payment instead.
--
-- Money stays dollars here, not the integer cents migration 0013 moved the
-- ledger to: like the other config tables, these are projection inputs
-- rather than append-only chains that must sum exactly. annual_rate is a
-- fraction (0.03, not 3.0) — the schema's convention is that _pct columns
-- hold percent and bare rate columns hold fractions (spend_plan.initial_rate,
-- tax_param.niit_rate).
CREATE TABLE mortgage (
    id             INTEGER PRIMARY KEY,
    effective_date TEXT    NOT NULL,
    account_id     INTEGER NOT NULL REFERENCES account(id),
    annual_rate    NUMERIC NOT NULL,                      -- fraction, e.g. 0.03
    monthly_pi     NUMERIC NOT NULL,                      -- principal & interest, dollars
    monthly_extra  NUMERIC NOT NULL DEFAULT 0,            -- extra principal, dollars
    monthly_escrow NUMERIC NOT NULL DEFAULT 0             -- tax + insurance; survives payoff
);
