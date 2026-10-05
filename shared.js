import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';

export function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function enabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

export function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

export const config = Object.freeze({
  port: positiveInteger(process.env.PORT, 3000, 65535),
  workerConcurrency: positiveInteger(process.env.WORKER_CONCURRENCY, 2, 20),
  workerNakDelayMs: positiveInteger(process.env.NATS_NAK_DELAY_MS, 1000, 60000),
  submitRateLimit: positiveInteger(process.env.SUBMIT_RATE_LIMIT, 10, 1000),
  maximumPendingTasks: positiveInteger(process.env.MAX_PENDING_TASKS, 100, 10000),
  submitToken: process.env.TEST_SUBMIT_TOKEN || '',
});

export function validTaskId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
