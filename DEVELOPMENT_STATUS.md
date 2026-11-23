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
- Add permitted source discovery adapters after robots/access rules are verified or an authorized API/export is available.
- Build lecture, notebook, PDF, practice, revision, analytics, and AI phases.
- Implement backup export/restore and verify recovery.
- Configure actual Cloudflare resources, secrets, GitHub build/deploy integration, and production frontend hosting.
- Test stylus support on actual Android tablet hardware.

## Blocked

- Production setup is blocked on Cloudflare account resources and D1/R2 identifiers.
- Automated resource discovery remains disabled: robots.txt retrieval was unavailable for each reviewed domain, ShriCasa terms were not located, and CA Study Partner terms prohibit unauthorized automated extraction.
- Public deployment still needs Cloudflare account resources and D1/R2 identifiers.

## Phase 2 completed slice

- Investigated all four requested domains and recorded public access, policy limitations, source URLs, and the check date in `RESOURCE_COLLECTION_REPORT.md`.
- Added migration `0002_resource_sources.sql` with source-policy registry entries for ShriCasa, NextGen Career Circle, CA Study Partner, and ICAI.
- Added authenticated endpoints to read the source registry and resource catalogue, and to import a user-supplied resource link with server-side validation and canonical-URL deduplication.
- Added a Resource Collector page for manual link import and catalogue review. Subject/chapter mappings stay pending human review.
- Automated fetching is deliberately not enabled while robots/access status is unresolved. CA Study Partner automation remains prohibited absent authorized export/API access.

## Phase 2 YouTube discovery extension

- YouTube Data API v3 is the primary video discovery source. The Worker queues subject-specific searches for all six subjects and detailed, full-course, chapter-wise, marathon, revision, fast-track, MCQ, case-study, and exam-preparation categories. Queries include preferred faculty names, spelling aliases, and broader subject searches so alternatives remain available.
- Playlist search results are stored in D1; playlist contents are paginated with `playlistItems.list`, and video metadata is fetched with `videos.list`. Results are deduplicated by YouTube video ID and retain their API metadata, playlist position, mapping confidence, captions availability, and source provenance.
- Faculty preferences are editable in Settings. IDT defaults to Ridhi Baghmar and AFM to Prateek Jagathi. Candidate channels remain pending until fetched from YouTube and explicitly reviewed; videos cannot be imported into Lecture Manager until their channel identity is verified.
- Classification suggestions stay pending for human approval. The current ICAI May 2028 syllabus version remains unverified, so video mentions of the attempt do not establish syllabus relevance and no chapter list is fabricated.
- The API key is read only from the Worker `YOUTUBE_API_KEY` secret. Discovery has not been run in this environment, so no video or playlist counts are claimed. The production secret, D1 IDs, migration, deployment, and a production redeployment persistence check still require configured Cloudflare resources.

## Validation status

- Source review: complete for the initial repository contents.
- Automated unit tests: 14 passing for the current local implementation, including all three additive migrations, existing-resource retention, preferred defaults, search coverage, classification, duration parsing, and resource URL canonicalization/deduplication.
- Local Worker integration test: passed after applying migrations `0002` and `0003`. It passed again after restarting Wrangler, confirming persistence across a local Worker restart.
- Typecheck: passing after the YouTube and topic-mapping changes. Frontend production build: passing.
- Responsive browser review: passed at 390px and 768px; actual Android stylus hardware remains untested.
- Local D1 migrations `0001` through `0003` applied successfully. Production deployment is not configured or attempted. YouTube API discovery was not run because no API key secret is configured; no live result count is claimed.
