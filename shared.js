'use strict';

const IORedis = require('ioredis');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const redisUrl = process.env.REDIS_URL || (!isProduction ? 'redis://127.0.0.1:6379' : '');

if (!redisUrl) throw new Error('REDIS_URL is required in production.');

const config = Object.freeze({
  port: Number.parseInt(process.env.PORT || '3000', 10),
  queueName: process.env.QUEUE_NAME || 'heavy-tasks',
  workerConcurrency: Number.parseInt(process.env.WORKER_CONCURRENCY || '2', 10),
  redisUrl,
});

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}
if (!Number.isInteger(config.workerConcurrency) || config.workerConcurrency < 1 || config.workerConcurrency > 50) {
  throw new Error('WORKER_CONCURRENCY must be an integer between 1 and 50.');
}

function createRedisConnection({ worker }) {
  const connection = new IORedis(config.redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: worker ? null : 1,
  });
  connection.on('error', (error) => console.error('[redis] Connection error:', error.message));
  return connection;
}

module.exports = { config, createRedisConnection };

