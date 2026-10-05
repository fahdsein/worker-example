import { config } from './shared.js';
import { closeDatabase, getTask, openDatabase, updateTask } from './database.js';
import { decodeTask, ensureConsumer, ensureStream, openQueue } from './queue.js';
import { normalizeDuration } from './task.js';

const queue = await openQueue('worker-example-consumer');
await openDatabase();
await ensureStream(queue);
await ensureConsumer(queue);

const consumer = await queue.js.consumers.get(queue.settings.stream, queue.settings.consumer);
const messages = await consumer.consume({ max_messages: config.workerConcurrency });
const active = new Set();
let stopping = false;

async function processMessage(message) {
  let job;
  let progress = 0;
  try {
    job = decodeTask(message);
    const task = await getTask(job.id);
    if (!task) throw new Error(`Task ${job.id} does not exist in NEO DB.`);
    if (task.state === 'completed') {
      message.ack();
      return;
    }

    const duration = normalizeDuration(job.durationMs);
    await updateTask(job.id, { state: 'running', progress: 0 });
    console.log(`[worker] Starting task ${job.id}; delivery ${message.info?.deliveryCount || 1}.`);

    const steps = 10;
    const delay = Math.max(1, Math.floor(duration / steps));
    for (let step = 1; step <= steps; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      progress = step * 10;
      await updateTask(job.id, { state: 'running', progress });
      message.working();
    }

    const result = { finishedAt: new Date().toISOString(), message: `Task ${job.id} completed` };
    await updateTask(job.id, { state: 'completed', progress: 100, result });
    message.ack();
    console.log(`[worker] Completed task ${job.id}.`);
  } catch (error) {
    const deliveryCount = message.info?.deliveryCount || 1;
    const finalAttempt = deliveryCount >= queue.settings.maxDeliver;
    console.error(`[worker] Task ${job?.id || 'unknown'} failed:`, error.message);
    if (job?.id) {
      await updateTask(job.id, {
        state: finalAttempt ? 'failed' : 'retrying',
        progress,
        failedReason: error.message,
      }).catch((databaseError) => console.error('[worker] Could not record failure:', databaseError.message));
    }
    if (finalAttempt) message.term();
    else message.nak(config.workerNakDelayMs);
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] Received ${signal}; draining active tasks.`);
  await messages.close();
  await Promise.allSettled(active);
  await queue.nc.drain();
  await closeDatabase();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

console.log(`[worker] Consuming ${queue.settings.stream}/${queue.settings.consumer} on ${queue.settings.subject}.`);
for await (const message of messages) {
  if (stopping) break;
  while (active.size >= config.workerConcurrency) await Promise.race(active);
  const task = processMessage(message).finally(() => active.delete(task));
  active.add(task);
}
await Promise.allSettled(active);
