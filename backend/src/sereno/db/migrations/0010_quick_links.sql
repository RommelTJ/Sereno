-- Quick links: user-managed institution URLs rendered next to the Ledger's
-- balance form, so the monthly update ritual doesn't detour through browser
-- bookmarks. Navigation utility rows, not financial facts — no history to
-- protect, so rows may be edited and hard-deleted. A new table (nothing to
-- backfill, unlike 0009), so sort_order is NOT NULL from the start: every
-- insert sets it explicitly (MAX + 1 — SQLite sorts NULLs first, so an
-- unset order would jump to the top).
CREATE TABLE quick_link (
    id         INTEGER PRIMARY KEY,
    label      TEXT    NOT NULL,                 -- 'Chase', 'Vanguard'
    url        TEXT    NOT NULL,                 -- opened in a new tab, stored verbatim
    sort_order INTEGER NOT NULL
);
