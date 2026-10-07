CREATE SCHEMA IF NOT EXISTS skwid;

CREATE TABLE IF NOT EXISTS skwid.proposals (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 3000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','queued','published','rejected')),
  submitter_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skwid.runs (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES skwid.proposals(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','review_ready','failed','rejected','published')),
  input_source text NOT NULL CHECK (input_source IN ('owner','model')),
  candidate_changes jsonb,
  candidate_patch text,
  candidate_commit text,
  check_status text CHECK (check_status IS NULL OR check_status IN ('passed','failed','unavailable')),
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_code text,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_queue_idx ON skwid.runs (status, created_at);
CREATE INDEX IF NOT EXISTS runs_proposal_idx ON skwid.runs (proposal_id);

CREATE TABLE IF NOT EXISTS skwid.releases (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL UNIQUE REFERENCES skwid.runs(id) ON DELETE RESTRICT,
  commit_sha text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skwid.journal (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL UNIQUE REFERENCES skwid.runs(id) ON DELETE RESTRICT,
  title text NOT NULL,
  summary text NOT NULL,
  commit_sha text NOT NULL,
  checks jsonb NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skwid.treasury_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address text NOT NULL,
  balance_wei numeric(78,0) NOT NULL CHECK (balance_wei >= 0),
  block_number bigint NOT NULL CHECK (block_number >= 0),
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (address, block_number)
);
CREATE INDEX IF NOT EXISTS treasury_observed_idx ON skwid.treasury_observations (observed_at DESC);

REVOKE ALL ON SCHEMA skwid FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA skwid FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA skwid FROM PUBLIC;
