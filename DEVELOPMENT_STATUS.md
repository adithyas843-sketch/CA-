# Development status

Updated: 23 November 2026

## Completed in this foundation slice

- Inspected `main`: one initial commit and README only; no existing code or study data needed migration.
- Created the `codex/phase-1-foundation` branch.
- Added React/TypeScript/Vite application configuration and Cloudflare Worker configuration with distinct dev/prod D1 and R2 bindings.
- Added additive D1 migration for authentication, settings, subjects, syllabus versions, chapters, topics, resource catalog foundations, sessions, and backups.
- Seeded the six required subjects. May 2028 syllabus source status remains pending verification.
- Added one-time owner setup, password hashing, cookie sessions, logout, authenticated API access, subject/chapter reads, chapter creation/title/status updates, and idempotent study session persistence.
- Added a dashboard with real saved study totals, activity history, and subject/chapter counts.
- Added a timer that persists its active state locally across reloads and queues failed session saves for retry.
- Added local setup, migration, deployment, and data-safety documentation.

## Pending

- Verify current ICAI May 2028 syllabus/subject chapter source references and populate reviewed versions.
- Add editable syllabus version metadata and chapter archive operations.
- Build resource source investigation/adapters and the review queue.
- Build lecture, notebook, PDF, practice, revision, analytics, and AI phases.
- Implement backup export/restore and verify recovery.
- Configure actual Cloudflare resources, secrets, GitHub build/deploy integration, and production frontend hosting.
- Test stylus support on actual Android tablet hardware.

## Blocked

- Production setup is blocked on Cloudflare account resources and D1/R2 identifiers.
- Resource discovery is not started; source terms, robots rules, and current public access have not yet been checked.

## Validation status

- Source review: complete for the initial repository contents.
- Automated unit tests: 7 passing under the bundled Node runtime.
- Local Worker integration test: passing (owner setup/login, authorization, six subjects, chapter create/update, study-session idempotency and persistence, dashboard totals).
- Typecheck: passing.
- Frontend production build: passing.
- Responsive browser review: passed at 390px and 768px; actual Android stylus hardware remains untested.
- Local D1 migration: applied successfully. Production deployment is not configured or attempted.
