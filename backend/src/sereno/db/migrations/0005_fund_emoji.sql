-- Every fund gets an optional emoji for the Funds & goals cards and the
-- safe-to-spend "Funded from" picker, like account and category already have.
-- Free TEXT — the curated choices constrain only the frontend select.
ALTER TABLE fund ADD COLUMN emoji TEXT;

-- Backfill the seed funds by name on databases migrated before this
-- file existed; fresh databases are seeded with emojis directly.
UPDATE fund SET emoji = '🚨' WHERE name = 'Emergency fund';
UPDATE fund SET emoji = '🛠️' WHERE name = 'House maintenance';
UPDATE fund SET emoji = '🛟' WHERE name = '1st-year fund';
UPDATE fund SET emoji = '🏊' WHERE name = 'Pool fund';
UPDATE fund SET emoji = '🚲' WHERE name = 'Bike fund';
