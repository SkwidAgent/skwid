ALTER TABLE skwid.proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE skwid.proposals ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('pending','approved','queued','review_ready','failed','published','rejected'));
