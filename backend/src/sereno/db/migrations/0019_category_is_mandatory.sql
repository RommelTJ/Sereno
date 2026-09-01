-- The mandatory-spend flag: is_mandatory=1 marks a category that can't
-- be cut (Groceries, Mortgage…) — the axis the budget report splits real
-- spending on; 0 = discretionary, adjustable if needed. Renames the
-- dormant is_fixed, designed for a fixed-bill auto-fill that was never
-- built and never settable through the API — so 0 on every row — rather
-- than carrying two confusable flags. expense_line.is_fixed, a per-line
-- axis, stays.
ALTER TABLE category RENAME COLUMN is_fixed TO is_mandatory;
