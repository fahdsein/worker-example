import pg from 'pg';
import { enabled, positiveInteger } from './shared.js';

const { Pool } = pg;
let pool;
let schemaPromise;

const STATES = new Set(['queued', 'running', 'retrying', 'completed', 'failed']);

export async function openDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Attach a NEO DB to this service.');
  if (!pool) {
    const ssl = enabled(process.env.DATABASE_SSL)
      ? { rejectUnauthorized: !/^(0|false|no|off)$/i.test(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true') }
      : undefined;
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
      max: positiveInteger(process.env.DATABASE_POOL_SIZE, 5, 30),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });
  }

  if (enabled(process.env.DATABASE_AUTO_MIGRATE)) {
    schemaPromise ||= pool.query(`
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
      )
    `);
    await schemaPromise;
  }
  return pool;
}

function publicTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    durationMs: row.duration_ms,
    state: row.state,
    progress: row.progress,
    result: row.result,
    failedReason: row.failed_reason,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

export async function createTask(id, durationMs) {
  const db = await openDatabase();
  const result = await db.query(
    `INSERT INTO worker_tasks (id, duration_ms, state) VALUES ($1, $2, 'queued') RETURNING *`,
    [id, durationMs],
  );
  return publicTask(result.rows[0]);
}

export async function getTask(id) {
  const db = await openDatabase();
  const result = await db.query('SELECT * FROM worker_tasks WHERE id = $1', [id]);
  return publicTask(result.rows[0]);
}

export async function updateTask(id, { state, progress = 0, result = null, failedReason = null }) {
  if (!STATES.has(state)) throw new Error(`Unsupported task state: ${state}`);
  const db = await openDatabase();
  const response = await db.query(`
    UPDATE worker_tasks SET
      state = $2,
      progress = $3,
      result = $4::jsonb,
      failed_reason = $5,
      started_at = CASE WHEN $2 = 'running' AND started_at IS NULL THEN NOW() ELSE started_at END,
      finished_at = CASE WHEN $2 IN ('completed', 'failed') THEN NOW() ELSE NULL END,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [id, state, progress, result ? JSON.stringify(result) : null, failedReason]);
  return publicTask(response.rows[0]);
}

export async function countPendingTasks() {
  const db = await openDatabase();
  const result = await db.query("SELECT COUNT(*)::int AS count FROM worker_tasks WHERE state IN ('queued','running','retrying')");
  return result.rows[0].count;
}

export async function checkDatabase() {
  const db = await openDatabase();
  await db.query('SELECT COUNT(*) FROM worker_tasks');
}

export async function closeDatabase() {
  if (pool) await pool.end();
  pool = undefined;
  schemaPromise = undefined;
}
