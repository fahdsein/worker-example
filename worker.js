'use strict';

const { Worker } = require('bullmq');
const { config, createRedisConnection } = require('./shared');
const { normalizeDuration } = require('./task');

const redis = createRedisConnection({ worker: true });

const worker = new Worker(
  config.queueName,
  async (job) => {
    const duration = normalizeDuration(job.data?.durationMs);
    const steps = 10;
    const delay = Math.max(1, Math.floor(duration / steps));

    console.log(`[worker] Starting job ${job.id}.`);
    for (let step = 1; step <= steps; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      await job.updateProgress(step * 10);
    }

    console.log(`[worker] Completed job ${job.id}.`);
    return {
      finishedAt: new Date().toISOString(),
      message: `Task ${job.id} completed`,
    };
  },
  {
    connection: redis,
    concurrency: config.workerConcurrency,
  },
);

worker.on('ready', () => console.log('[worker] Ready for jobs.'));
worker.on('failed', (job, error) => {
  console.error(`[worker] Job ${job?.id || 'unknown'} failed:`, error.message);
});
worker.on('error', (error) => console.error('[worker] Redis/worker error:', error.message));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] Received ${signal}; finishing active work.`);

  const forceExit = setTimeout(() => process.exit(1), 15000);
  forceExit.unref();

  await worker.close();
  await redis.quit();
  clearTimeout(forceExit);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
