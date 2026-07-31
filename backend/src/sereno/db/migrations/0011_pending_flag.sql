-- A reminder flag for provisional amounts: Lyft consolidates a day's
-- rides into one charge, bars add tips after settlement. A pending row
-- wears a ⚠️ in the activity feed until the settled amount is trued up
-- through the edit form. The flag never excludes a row from the math —
-- the money has already moved, and the known amount is a floor.
ALTER TABLE expense_line ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE income_event ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
