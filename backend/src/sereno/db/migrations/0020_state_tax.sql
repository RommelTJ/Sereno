-- The state schedule beside the federal one (issue #162). state_treatment
-- has said "CA taxes gains as ordinary" since the first schema, but
-- nothing read it: the engines were federal-only, so a California plan
-- reported zero tax in exactly the low-income years the 0% federal
-- bracket makes attractive — the years state tax is the whole bill.
-- state_brackets is a JSON array of {rate, upto} like ordinary_brackets,
-- walked over ordinary income plus realized gains under CA_ordinary;
-- state_std_deduction is the state's own, smaller shelter; and
-- state_exemption_credit is the flat non-refundable credit taken off the
-- year's first state tax. All three are nullable and additive: NULL
-- means no state schedule is entered — the API flags it — not a state
-- with no income tax, which is state_treatment = 'NONE'.
ALTER TABLE tax_param ADD COLUMN state_brackets TEXT;
ALTER TABLE tax_param ADD COLUMN state_std_deduction NUMERIC;
ALTER TABLE tax_param ADD COLUMN state_exemption_credit NUMERIC;
