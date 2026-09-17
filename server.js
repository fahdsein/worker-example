'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { Queue } = require('bullmq');
const { config, createRedisConnection } = require('./shared');
const { normalizeDuration } = require('./task');

const app = express();
const redis = createRedisConnection({ worker: false });
const queue = new Queue(config.queueName, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400, count: 1000 },
  },
});

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', role: 'web' });
});

app.get('/readyz', async (_req, res) => {
  try {
    await redis.ping();
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not-ready' });
  }
});

app.post('/api/tasks', async (req, res, next) => {
  try {
    const durationMs = normalizeDuration(req.body?.durationMs);
    const job = await queue.add('simulate-heavy-job', { durationMs });
    res.status(202).json({ id: job.id });
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

app.get('/api/tasks/:id', async (req, res, next) => {
  try {
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid job ID.' });
    }

    const job = await queue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Task not found.' });

    const state = await job.getState();
    return res.json({
      id: job.id,
      state,
      progress: typeof job.progress === 'number' ? job.progress : 0,
      finishedAt: job.finishedOn || null,
      failedReason: state === 'failed' ? job.failedReason : undefined,
      result: state === 'completed' ? job.returnvalue : undefined,
    });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error('[web] Request failed:', error instanceof Error ? error.message : 'Unknown error');
  res.status(503).json({ error: 'The task service is temporarily unavailable.' });
});

const server = app.listen(config.port, () => {
  console.log(`[web] Listening on port ${config.port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[web] Received ${signal}; shutting down.`);

  server.close(async () => {
    await queue.close();
    await redis.quit();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
