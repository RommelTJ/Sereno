-- Drawdown start on the spend plan (issue #119). initial_rate is
-- documented as the at-retirement Guyton-Klinger anchor, but it has only
-- ever been a hand-set constant — nothing captures it from reality at
-- the moment it becomes meaningful. drawdown_start is that moment as an
-- explicit effective-dated field, set once: while it is NULL or in the
-- future the guardrail zone is a readiness metric, and when the date
-- arrives the guardrails read stamps a new plan row whose initial_rate
-- is computed from trailing actual spending as of that date.
--
-- initial_rate_stamped marks the stamped row apart from hand-set ones —
-- the gate that makes "stamp once" checkable without guessing from
-- dates, since a hand-set rate can share any effective_date. Existing
-- rows default to 0: every rate stored so far was typed by hand.
ALTER TABLE spend_plan ADD COLUMN drawdown_start TEXT;
ALTER TABLE spend_plan ADD COLUMN initial_rate_stamped INTEGER NOT NULL DEFAULT 0;
