CREATE TABLE IF NOT EXISTS worker_tasks (
  id TEXT PRIMARY KEY,
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 1000 AND 60000),
  state TEXT NOT NULL CHECK (state IN ('queued','running','retrying','completed','failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result JSONB,
  failed_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
