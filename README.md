# PaaS worker example

This repository demonstrates the common PaaS pattern of running a public web service and a private background worker as separate processes. Both services use the same Redis instance and queue name.

## Architecture

- **Web service (`server.js`)** serves the dashboard, enqueues jobs, and reports job status.
- **Worker service (`worker.js`)** consumes queued jobs. It does not expose a public port.
- **Redis** stores the BullMQ queue and job state.

Keeping the services separate lets the web and worker scale independently and prevents long-running work from blocking web requests.

## Run locally with Docker

Docker Compose is the simplest complete local setup:

```sh
docker compose up --build
```

Open <http://localhost:3000>. Stop and remove the containers with:

```sh
docker compose down
```

The named Redis volume is retained. Use `docker compose down --volumes` only when you intentionally want to delete queued job data.

## Run directly with Node.js

Node.js 22 or later and a reachable Redis instance are required.

```sh
npm ci
copy .env.example .env
npm start
```

In a second terminal:

```sh
npm run worker
```

On macOS or Linux, replace `copy .env.example .env` with `cp .env.example .env`.

## Deploy from a GitHub repository

Make this folder the root of its own repository, then connect that repository to the PaaS. Provision Redis and create two services from the same commit:

1. **Web service** — build with `Dockerfile`, or use build command `npm ci` and start command `npm start`. Expose the platform-provided `PORT`. Configure `/healthz` as the liveness endpoint and `/readyz` as readiness if supported.
2. **Worker service** — build with `Dockerfile.worker`, or use build command `npm ci` and start command `npm run worker`. Do not configure a public port or HTTP health check for this process.
3. Set the same `REDIS_URL` and `QUEUE_NAME` on both services. Set `WORKER_CONCURRENCY` on the worker as appropriate for its CPU and workload.

Platforms that recognize a `Procfile` can use the included `web` and `worker` process declarations instead of Dockerfiles.

## Environment variables

| Variable | Service | Required | Default | Purpose |
| --- | --- | --- | --- | --- |
| `PORT` | Web | Usually supplied by PaaS | `3000` | HTTP listen port |
| `REDIS_URL` | Both | Yes in production | `redis://127.0.0.1:6379` locally | Redis connection URL, including credentials/TLS options supplied by the provider |
| `QUEUE_NAME` | Both | No | `heavy-tasks` | Queue name; must match across services |
| `WORKER_CONCURRENCY` | Worker | No | `2` | Jobs processed concurrently by each worker instance |

Do not commit `.env` or production credentials. The included `.env.example` contains only safe local defaults.

## Verification

```sh
npm run check
npm test
```

After deployment, submit a job in the dashboard and confirm it progresses from queued to completed. The web service readiness endpoint should return HTTP 200 only when Redis is reachable.
