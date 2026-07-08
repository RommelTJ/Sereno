-- Safe-to-spend counts only discretionary spending: a fund-funded expense
-- was paid from parked money (the fund draws down instead), so counting it
-- in total_spent would lower safe_to_spend = funded_in - total_spent twice.
-- fund_spent keeps the month's fund-funded total queryable on its own.
DROP VIEW v_budget_month;
CREATE VIEW v_budget_month AS
SELECT budget_month AS month,
       (SELECT COALESCE(SUM(amount),0) FROM income_event  i WHERE i.budget_month = e.budget_month) AS funded_in,
       SUM(CASE WHEN is_fixed = 1 AND funded_from = 'discretionary' THEN amount ELSE 0 END) AS fixed_spent,
       SUM(CASE WHEN is_fixed = 0 AND funded_from = 'discretionary' THEN amount ELSE 0 END) AS variable_spent,
       SUM(CASE WHEN funded_from = 'discretionary' THEN amount ELSE 0 END) AS total_spent,
       SUM(CASE WHEN funded_from = 'fund' THEN amount ELSE 0 END) AS fund_spent
FROM expense_line e
GROUP BY budget_month;
