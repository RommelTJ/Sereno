-- Every account gets an emoji for the Settings Assets/Liabilities lists.
-- Free TEXT — the curated choices constrain only the frontend select.
ALTER TABLE account ADD COLUMN emoji TEXT;

-- Backfill the seed accounts by name on databases migrated before this
-- file existed; fresh databases are seeded with emojis directly.
UPDATE account SET emoji = '⚡' WHERE name = 'Ethereum';
UPDATE account SET emoji = '📈' WHERE name = 'VFIAX';
UPDATE account SET emoji = '🌍' WHERE name = 'VTIAX';
UPDATE account SET emoji = '🏦' WHERE name = 'VGSH';
UPDATE account SET emoji = '🏖️' WHERE name = 'Retirement';
UPDATE account SET emoji = '🏠' WHERE name = 'Home';
UPDATE account SET emoji = '💵' WHERE name IN ('Chase checking', 'Vanguard Cash Plus');
UPDATE account SET emoji = '🚗' WHERE name = 'Car';
UPDATE account SET emoji = '🏡' WHERE name = 'Mortgage';
