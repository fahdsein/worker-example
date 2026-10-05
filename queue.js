import { readFile } from 'node:fs/promises';
import { connect, credsAuthenticator } from '@nats-io/transport-node';
import {
  AckPolicy,
  DeliverPolicy,
  RetentionPolicy,
  StorageType,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import { enabled, positiveInteger } from './shared.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function queueSettings() {
  return {
    stream: process.env.NATS_STREAM || 'NEO_WORKER_TASKS',
    subject: process.env.NATS_SUBJECT || 'neo.worker.tasks',
    consumer: process.env.NATS_CONSUMER || 'neo-worker-example',
    maxDeliver: positiveInteger(process.env.NATS_MAX_DELIVER, 3, 20),
    ackWaitMs: positiveInteger(process.env.NATS_ACK_WAIT_MS, 120000, 600000),
    manageResources: enabled(process.env.NATS_MANAGE_RESOURCES),
  };
}

export async function openQueue(clientName) {
  const configuredServers = process.env.NATS_URL || process.env.QUEUE_URL;
  if (!configuredServers) throw new Error('NATS_URL is required. Attach a NEO Queue to this service.');

  const options = {
    servers: configuredServers.split(',').map((value) => value.trim()).filter(Boolean),
    name: clientName,
    timeout: positiveInteger(process.env.NATS_CONNECT_TIMEOUT_MS, 5000, 30000),
    reconnect: true,
    maxReconnectAttempts: -1,
    waitOnFirstConnect: true,
  };

  if (process.env.NATS_CREDS_FILE) {
    options.authenticator = credsAuthenticator(await readFile(process.env.NATS_CREDS_FILE));
  } else if (process.env.NATS_TOKEN) {
    options.token = process.env.NATS_TOKEN;
  } else if (process.env.NATS_USER) {
    options.user = process.env.NATS_USER;
    options.pass = process.env.NATS_PASSWORD || '';
  }

  if (enabled(process.env.NATS_TLS) || process.env.NATS_CA_FILE) {
    options.tls = process.env.NATS_CA_FILE ? { caFile: process.env.NATS_CA_FILE } : {};
  }

  const nc = await connect(options);
  return { nc, js: jetstream(nc), jsm: await jetstreamManager(nc), settings: queueSettings() };
}

export async function ensureStream(queue) {
  const { stream, subject, manageResources } = queue.settings;
  try {
    return await queue.jsm.streams.info(stream);
  } catch (error) {
    if (!manageResources) {
      throw new Error(`JetStream stream ${stream} is unavailable. Use the NEO Queue binding values.`, { cause: error });
    }
  }
  try {
    return await queue.jsm.streams.add({
      name: stream,
      subjects: [subject],
      retention: RetentionPolicy.Workqueue,
      storage: StorageType.File,
    });
  } catch {
    return queue.jsm.streams.info(stream);
  }
}

export async function ensureConsumer(queue) {
  const { stream, subject, consumer, maxDeliver, ackWaitMs, manageResources } = queue.settings;
  try {
    return await queue.jsm.consumers.info(stream, consumer);
  } catch (error) {
    if (!manageResources) {
      throw new Error(`JetStream consumer ${consumer} is unavailable. Attach the configured NEO Queue to the Worker.`, { cause: error });
    }
  }
  try {
    return await queue.jsm.consumers.add(stream, {
      durable_name: consumer,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      filter_subject: subject,
      max_deliver: maxDeliver,
      ack_wait: ackWaitMs * 1_000_000,
    });
  } catch {
    return queue.jsm.consumers.info(stream, consumer);
  }
}

export async function publishTask(queue, task) {
  await ensureStream(queue);
  return queue.js.publish(queue.settings.subject, encoder.encode(JSON.stringify(task)), {
    msgID: task.id,
    timeout: positiveInteger(process.env.NATS_PUBLISH_TIMEOUT_MS, 5000, 30000),
  });
}

export function decodeTask(message) {
  const value = JSON.parse(decoder.decode(message.data));
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.id !== 'string') {
    throw new Error('Queue message is not a valid task.');
  }
  return value;
}
