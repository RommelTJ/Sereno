-- The age-banded spend schedule (issue #118). The longevity forecast
-- assumed one flat spend level from the current age to 100, but real
-- spending steps up through peak years, down as activity declines, ends
-- when a mortgage is paid off, and rises again for late-life care —
-- modelled flat, a forecast can report running out decades early purely
-- because it never stops charging for expenses with a known end date.
--
-- Effective-dated and append-only like assumption and spend_plan, but a
-- schedule is a *set* of rows, so versions get their own parent table
-- rather than grouping by effective_date alone: two saves on the same
-- day stay distinct versions (the latest id wins, the config tie-break),
-- and a version with no bands is a real "cleared back to flat" instead
-- of an unrepresentable empty set. The latest version on or before
-- today is the schedule; years the schedule does not cover fall back to
-- the spend plan's annual_target — a gap means "no change from
-- baseline", never an error.
--
-- Money stays dollars, like the other config tables: these are
-- projection inputs in today's dollars (the forecast runs in real
-- terms), not append-only chains that must sum exactly. end_year NULL
-- means open-ended — the final band. note is required in spirit, not in
-- schema: "mortgage gone" is what makes the plan re-readable later.
CREATE TABLE spend_band_version (
    id             INTEGER PRIMARY KEY,
    effective_date TEXT    NOT NULL
);

CREATE TABLE spend_band (
    id            INTEGER PRIMARY KEY,
    version_id    INTEGER NOT NULL REFERENCES spend_band_version(id),
    start_year    INTEGER NOT NULL,                       -- calendar year, inclusive
    end_year      INTEGER,                                -- inclusive; NULL = open-ended
    annual_amount NUMERIC NOT NULL,                       -- today's dollars
    note          TEXT                                    -- the band's rationale
);
