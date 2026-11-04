-- Invariant: every note has at most one OWNER membership.
-- Enforced by the database (partial unique index) rather than only by application code,
-- so a race between two concurrent "share" requests can never produce two owners.
CREATE UNIQUE INDEX "note_members_one_owner_per_note"
  ON "note_members" ("note_id")
  WHERE "role" = 'OWNER';

-- Fast dashboard listing / search on derived text columns.
CREATE INDEX "notes_updated_at_idx" ON "notes" ("updated_at" DESC);
