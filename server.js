import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config, safeEqual, validTaskId } from './shared.js';
import { normalizeDuration } from './task.js';
import {
  checkDatabase,
  closeDatabase,
  countPendingTasks,
  createTask,
  getTask,
  updateTask,
} from './database.js';
import { ensureStream, openQueue, publishTask } from './queue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const submissions = new Map();
let queuePromise;

function getQueue() {
  queuePromise ||= openQueue('worker-example-web').then(async (queue) => {
    await ensureStream(queue);
    return queue;
  });
  return queuePromise;
}

function submitAuthorized(request) {
  if (!config.submitToken) return true;
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  return safeEqual(request.headers['x-test-token'] || bearer, config.submitToken);
}

function applyRateLimit(request, response, next) {
  const now = Date.now();
  if (submissions.size > 10000) {
    for (const [address, window] of submissions) {
      if (now - window.startedAt >= 60000) submissions.delete(address);
    }
  }
  const key = request.ip || request.socket.remoteAddress || 'unknown';
  const current = submissions.get(key);
  if (!current || now - current.startedAt >= 60000) {
    submissions.set(key, { startedAt: now, count: 1 });
    return next();
  }
  current.count += 1;
  if (current.count > config.submitRateLimit) {
    return response.status(429).json({ error: 'Too many task submissions. Try again in one minute.' });
  }
  return next();
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (_request, response) => {
  response.json({ status: 'ok', role: 'web' });
});

app.get('/readyz', async (_request, response) => {
  const checks = {};
  try {
    await checkDatabase();
    checks.database = 'ready';
    const queue = await getQueue();
    await queue.nc.flush();
    checks.queue = 'ready';
    response.json({ status: 'ready', checks });
  } catch (error) {
    console.error('[web] Readiness check failed:', error.message);
    response.status(503).json({ status: 'not-ready', checks });
  }
});

app.get('/api/config', (_request, response) => {
  response.json({ requiresSubmitToken: Boolean(config.submitToken), maximumDurationSeconds: 60 });
});

app.post('/api/tasks', applyRateLimit, async (request, response, next) => {
  try {
    if (!submitAuthorized(request)) return response.status(401).json({ error: 'A valid testing token is required.' });
    const durationMs = normalizeDuration(request.body?.durationMs);
    if (await countPendingTasks() >= config.maximumPendingTasks) {
      return response.status(429).json({ error: 'The testing queue is currently full. Try again later.' });
    }

    const id = randomUUID();
    const task = await createTask(id, durationMs);
    try {
      await publishTask(await getQueue(), { id, durationMs, createdAt: task.createdAt });
    } catch (error) {
      await updateTask(id, { state: 'failed', progress: 0, failedReason: 'The task could not be published to NEO Queue.' });
      throw error;
    }
    return response.status(202).json({ id });
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return response.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

app.get('/api/tasks/:id', async (request, response, next) => {
  try {
    if (!validTaskId(request.params.id)) return response.status(400).json({ error: 'Invalid task ID.' });
    const task = await getTask(request.params.id);
    if (!task) return response.status(404).json({ error: 'Task not found.' });
    return response.json(task);
  } catch (error) {
    return next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error('[web] Request failed:', error instanceof Error ? error.message : 'Unknown error');
  response.status(503).json({ error: 'The task service is temporarily unavailable.' });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[web] Listening on 0.0.0.0:${config.port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[web] Received ${signal}; shutting down.`);
  server.close(async () => {
    const queue = await queuePromise?.catch(() => null);
    await queue?.nc?.drain().catch(() => undefined);
    await closeDatabase().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
