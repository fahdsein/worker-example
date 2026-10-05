# NEO App Worker Example

A public testing dashboard backed by a private NEO Worker, NATS JetStream / NEO Queue, and PostgreSQL / NEO DB.

## Architecture

```text
Public browser
      |
      v
NEO Web Service -- publishes --> NEO Queue / NATS JetStream
      |                                |
      |                                v
      +-- reads status ---------- Private NEO Worker
                       NEO DB <---------+
```

- **Web Service (`server.js`)** serves the public dashboard, validates submissions, creates a durable database record, publishes a JetStream task, and returns task status.
- **Worker (`worker.js`)** consumes through a durable JetStream consumer, updates progress in NEO DB, and explicitly acknowledges successful messages.
- **NEO Queue** provides durable work delivery and retries.
- **NEO DB** preserves queued, running, retrying, completed, and failed status across restarts and replicas.

The Worker does not expose a public port. Only the Web Service is public.

## NEO App deployment — beginner steps

### 1. Prepare the repository

Push this folder as the root of its own Git repository. The repository root must contain:

```text
Dockerfile
Dockerfile.worker
package.json
server.js
worker.js
```

Do not commit `.env`, database credentials, queue credentials, or a real testing token.

### 2. Create NEO DB

1. Open the intended project in NEO App.
2. Create a **NEO DB / PostgreSQL** resource.
3. Wait until its status is ready.
4. The connection must be attached or mapped to the environment variable `DATABASE_URL`.

Set `DATABASE_AUTO_MIGRATE=true` during the first deployment. The application creates only the `worker_tasks` table. The equivalent SQL is in `db/schema.sql`.

### 3. Create NEO Queue

1. Create a **NEO Queue / NATS JetStream** resource in the same project.
2. Configure a work-queue stream and durable consumer if the NEO form asks for them.
3. Use one subject for these tasks, for example `neo.worker.tasks`.
4. Attach the same Queue to both the Web Service and Worker.
5. Ensure its connection URL is exposed as `NATS_URL`.

Recommended names:

```env
NATS_STREAM=NEO_WORKER_TASKS
NATS_SUBJECT=neo.worker.tasks
NATS_CONSUMER=neo-worker-example
```

If NEO supplies different stream, subject, or consumer values, use the exact NEO values on both services. Do not create two consumers with different names unless you intentionally want every consumer to process its own copy of each task.

### 4. Create the public Web Service

1. Choose **Web Service**.
2. Select this repository and branch.
3. Choose **Build File / Dockerfile**.
4. Use `Dockerfile` from the repository root.
5. Attach the NEO DB as `DATABASE_URL`.
6. Attach the NEO Queue as `NATS_URL` and its supplied authentication variables.
7. Configure container port `3000` when NEO does not detect it automatically.
8. Enable public access.
9. Set the health-check path to `/readyz`.
10. Start with one replica.

The Web Service must receive the Web settings from `neoapp.env.example`. NEO normally injects `PORT`; do not manually override it unless required by the deployment form.

### 5. Create the private Worker

1. Create another component from the same repository and commit.
2. Choose **Worker** as its type.
3. Choose **Build File / Dockerfile**.
4. Select `Dockerfile.worker`.
5. Attach the same NEO DB as `DATABASE_URL`.
6. Attach the same NEO Queue as `NATS_URL`.
7. Use the same `NATS_STREAM`, `NATS_SUBJECT`, and `NATS_CONSUMER` as the Web Service.
8. Do not configure a port, domain, ingress, or HTTP health check.
9. Start with one replica and `WORKER_CONCURRENCY=2`.

Multiple Worker replicas may safely share the same durable work-queue consumer. Each task is acknowledged by the Worker that completes it.

### 6. Required environment variables

Use `neoapp.env.example` as the copy checklist.

| Variable | Web | Worker | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | Yes | Attached NEO DB PostgreSQL URL |
| `DATABASE_AUTO_MIGRATE` | Yes initially | Yes initially | Creates the idempotent task table |
| `DATABASE_SSL` | If required | If required | Enables PostgreSQL TLS |
| `NATS_URL` | Yes | Yes | Attached NEO Queue connection URL |
| `NATS_STREAM` | Yes | Yes | JetStream stream name |
| `NATS_SUBJECT` | Yes | Yes | Task publication subject |
| `NATS_CONSUMER` | Yes | Yes | Durable Worker consumer |
| `NATS_TOKEN` | Provider-dependent | Provider-dependent | Queue token supplied by NEO |
| `NATS_USER` / `NATS_PASSWORD` | Provider-dependent | Provider-dependent | Alternative NATS authentication |
| `NATS_MANAGE_RESOURCES` | `false` | `false` | NEO normally owns streams and consumers |
| `WORKER_CONCURRENCY` | No | Recommended | Simultaneous tasks per Worker replica |
| `TEST_SUBMIT_TOKEN` | Recommended | No | Protects task creation on a shared staging URL |
| `SUBMIT_RATE_LIMIT` | Recommended | No | Per-instance submissions per minute; default `10` |
| `MAX_PENDING_TASKS` | Recommended | No | Global DB-backed pending-task limit; default `100` |

The code also accepts `QUEUE_URL` as a fallback alias for `NATS_URL`.

Set `NATS_MANAGE_RESOURCES=false` on NEO. Use `true` only with the disposable local Docker NATS broker where the application is expected to create its test stream and consumer.

### 7. Public verification

After both services are deployed:

1. Open the Web Service public URL.
2. Confirm `/healthz` returns HTTP `200` and `status: ok`.
3. Confirm `/readyz` returns HTTP `200` with both `database: ready` and `queue: ready`.
4. Open `/` and submit a short task such as five seconds.
5. If `TEST_SUBMIT_TOKEN` is configured, enter it in the dashboard.
6. Observe the status transition through `queued`, `running`, and `completed`.
7. Open the Worker logs and confirm the same task ID was processed.
8. Restart the Web Service and confirm the completed task status remains available from `/api/tasks/<task-id>`.
9. Scale the Worker to two replicas and submit several jobs. Each task should complete once rather than being processed by every replica.

If `/readyz` returns `503`, inspect the Web Service logs. Typical causes are:

- NEO DB was not attached as `DATABASE_URL`.
- NEO Queue was not attached as `NATS_URL`.
- Stream, subject, or consumer names do not match the Queue configuration.
- `NATS_MANAGE_RESOURCES=false` but the configured stream or consumer does not exist.
- Queue credentials or TLS settings are missing.

## Local complete test with Docker

Docker Compose starts PostgreSQL, NATS JetStream, the public Web Service, and the private Worker:

```powershell
docker compose up --build
```

Open <http://localhost:3000>, submit a task, and watch the `worker` container logs.

Stop the stack with:

```powershell
docker compose down
```

The PostgreSQL and NATS volumes remain. Use `docker compose down --volumes` only when you intentionally want to delete local test data.

## Run directly with Node.js

Node.js 22 or later, PostgreSQL, and NATS JetStream are required. Copy `.env.example` to `.env`, adjust the connection values, and run:

```powershell
npm ci
npm start
```

In another terminal:

```powershell
npm run worker
```

## API summary

| Method and path | Purpose |
| --- | --- |
| `GET /` | Public testing dashboard |
| `GET /healthz` | Web process liveness |
| `GET /readyz` | NEO DB and Queue readiness |
| `GET /api/config` | Tells the dashboard whether a testing token is required |
| `POST /api/tasks` | Creates and publishes a task |
| `GET /api/tasks/:id` | Reads durable progress and result |

Task duration is restricted to 1–60 seconds. JetStream delivery is explicitly acknowledged, failed processing is retried, and the database prevents status loss across Web Service restarts.

## Repository verification

```powershell
npm run check
npm test
```

The public Web Service can start and serve `/` and `/healthz` without its dependencies, but `/readyz` correctly returns `503` until NEO DB and NEO Queue are configured.
