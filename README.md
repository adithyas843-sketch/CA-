# CA Final OS

CA Final OS is a private study workspace for the May 2028 CA Final attempt. The current foundation includes a responsive React dashboard, six subject records, editable chapter entries, a Cloudflare Worker API, D1-backed owner authentication and study sessions, and a local timer that survives a page reload.

The ICAI chapter mapping is deliberately marked **pending verification**. The app does not seed invented syllabus chapter names or claim that an empty subject is complete.

## Stack

- React, TypeScript, Vite
- Cloudflare Workers REST API
- Cloudflare D1 relational database and SQL migrations
- Cloudflare R2 binding for private files (used by later phases)
- Local timer state and a retryable session outbox in browser storage

## Local setup

Requirements: Node.js 22.12+ and pnpm 10+ (npm can be used for dependency installation), and a Cloudflare account only for remote deployment. Install packages:

```sh
pnpm install
```

For local development, set a local owner setup token in `.dev.vars` (copy `.dev.vars.example`). Keep this file out of Git:

```text
OWNER_SETUP_TOKEN=a-long-random-token-for-local-setup
SESSION_SECURE=false
```

Apply the D1 schema and start the API Worker:

```sh
pnpm db:migrate:local
pnpm worker:dev
```

In another terminal, run the Vite frontend:

```sh
pnpm dev
```

Open the URL Vite prints. The first screen asks for the owner setup token and creates the one allowed owner account. The password must be at least 12 characters. The setup token is only needed for account creation; subsequent access uses the email and password.

The frontend proxies `/api` to the local Worker on `127.0.0.1:8787`. Keep the Worker running while using the app. The timer runs on-device and completed sessions are stored in D1; if a save fails, the session is queued in local storage and retried when connectivity returns.

## Build and checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

The migration test uses Node's built-in SQLite module. Tests do not connect to production services.

For the local Worker integration check, start `pnpm worker:dev` first. On the first run, set `TEST_SETUP_TOKEN` to the same local token from `.dev.vars`, then run `pnpm test:integration`. The integration test creates or reuses a local-only owner and writes a test chapter and study session to the local D1 database.

## Cloudflare resources and deployments

Development and production require separate D1 databases and R2 buckets. Never point local Wrangler development at production. The Worker binding names are `DB` and `FILES`.

1. Create `ca-final-os-dev` and `ca-final-os-prod` D1 databases and development/production R2 buckets.
2. Replace the placeholder `database_id` values in `wrangler.toml` with the corresponding D1 IDs. Keep the two IDs separate.
3. Set the Worker secret `OWNER_SETUP_TOKEN` for the deployment environment before first owner setup. Do not put it in Vite variables or commit it.
4. Apply production migrations only after reviewing them and verifying a backup:

```sh
pnpm db:migrate:prod
```

5. Deploy the Worker with `npx wrangler deploy --env production` after Cloudflare resources and bindings are configured.

The production frontend build can be hosted on Cloudflare Pages or served by a configured static asset binding in a later deployment phase. No production database, bucket, secrets, or deployment target has been provisioned by this repository yet.

## Data and migration safety

- Schema changes live in numbered SQL files under `migrations/` and are applied forward.
- Do not edit an already-applied migration; add the next numbered migration.
- Do not use local Wrangler commands with a production database binding.
- Take and verify a backup before any destructive schema change.
- Study sessions are keyed to the authenticated user. Database records are independent of frontend redeploys.
- The R2 bucket is private by default; public object URLs must not be introduced for personal documents.

## Current scope

Implemented: first-owner setup, sign-in/out, protected subject/chapter/session endpoints, six seed subjects, chapter creation/title/status editing, dashboard metrics from saved sessions, and timer recovery/queued session sync.

Not yet implemented: resource crawling, video/lecture library, notebook/PDF tools, practice tests, revision scheduler, AI features, scheduled backups, PWA/offline notebook sync, and production deployment. See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) and [RESOURCE_COLLECTION_REPORT.md](RESOURCE_COLLECTION_REPORT.md).
