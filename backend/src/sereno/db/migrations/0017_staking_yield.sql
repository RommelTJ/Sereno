-- Staking yield on the assumptions row (issue #139). Staking income was a
-- flat constant in the engine with a threshold under it, so it kept paying
-- full freight until the stake was nearly gone instead of decaying with it.
-- The rate belongs here for the same reason return_pct, inflation_pct, and
-- eth_growth_pct do: it describes the actual portfolio, it is revised over
-- decades, and this repository is public. Percent units, like its
-- neighbours. NULL means no staking income is modeled at all — the way a
-- null eth_growth_pct means the ETH bucket stays on the blended rate.
ALTER TABLE assumption ADD COLUMN staking_yield_pct NUMERIC;
