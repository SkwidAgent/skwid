ALTER TABLE skwid.runs ADD COLUMN IF NOT EXISTS base_commit text;
ALTER TABLE skwid.runs DROP CONSTRAINT IF EXISTS runs_base_commit_check;
ALTER TABLE skwid.runs ADD CONSTRAINT runs_base_commit_check
  CHECK (base_commit IS NULL OR base_commit ~ '^[0-9a-f]{40,64}$');
