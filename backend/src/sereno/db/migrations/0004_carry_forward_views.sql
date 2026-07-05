-- Carry balances forward: a month's canonical balance for an account is the
-- latest entry on or before that month's end, not just an entry within the
-- month. An account entered in January still counts in February's net worth.
--
-- Inactive accounts do not carry forward — with no deactivation date in the
-- schema, a deactivated account reports only the months it was really
-- entered, so its history stays and its tail stops.
--
-- v_net_worth needs no change: it reads v_account_monthly by name and SQLite
-- resolves views at query time.
DROP VIEW v_account_monthly;
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
