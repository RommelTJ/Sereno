-- A dedicated title for income rows ("Spouse paycheck"), separate from a
-- true note. Until now the bold row title WAS the note column — the seed
-- and the income form both wrote title-style notes — so the backfill moves
-- every existing note into source_label, keeping each row's rendered title
-- unchanged while freeing note to be a real note.
ALTER TABLE income_event ADD COLUMN source_label TEXT;
UPDATE income_event SET source_label = note, note = NULL;
