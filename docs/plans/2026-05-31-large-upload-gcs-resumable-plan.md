# Large Upload + ZIP Support — GCS Resumable + Cloud Tasks Plan

**Date:** 2026-05-31 · **Status:** In progress — Phases 1–3 merged (PRs #91–#93); Phase 4 next · **Scope:** plan + tracking

## Context

A large ZIP (~60 MB) upload from the Vercel-hosted dashboard failed in the browser with
`TypeError: Load failed` and produced **no** Vercel logs. The current upload design buffers the whole
file in memory on Cloud Run and processes synchronously in-request; ZIP is advertised in the dashboard
but unsupported server-side; and the multer limit is hardcoded at 10 MB while the `MAX_SINGLE_FILE_SIZE`
config (default 20) is never wired in.

An earlier remediation plan was rejected because it staged file bytes in Postgres (`bytea`), assembled
them with `Buffer.concat`, and ran ZIP extraction + embedding synchronously inside `/complete`. This
plan replaces that with **object storage (GCS) + browser-direct resumable uploads + Cloud Tasks async
processing**, behind a **file-handler registry** for broad text-bearing file support. Target: uploads
up to 500 MB.

### Locked decisions

- **Async model:** Cloud Tasks → internal authenticated Cloud Run endpoint (CPU guaranteed inside a
  request). No post-response in-process work. CPU-always-allocated only as a short-lived MVP fallback;
  separate worker / Cloud Run Job is a later scale-up path.
- **Browser → GCS:** GCS **resumable session URI** (server-initiated), chunked browser upload with
  progress + resume. Single V4 signed PUT only as a fallback for smaller "large-ish" files.
- **Integrity:** canonical **app-level SHA-256 verified by streaming during processing** (+ GCS
  `crc32c`/`size`/`generation` captured at complete). Browser MD5 / GCS `md5Hash` explicitly avoided.
- **File support:** conservative, tiered, honest. Handler registry, not "just ZIP," not "all files."

## Progress tracker

Updated 2026-06-01. Marks what has actually landed so a fresh agent can resume without re-deriving state. Check items off as slices merge.

- [x] **Phase 1 — Small-path fix & error clarity** (T1.1, T1.2) — merged
- [x] **Phase 2 — Upload contract + state machine + schema** (T2.1–T2.3) — merged (#92)
- [x] **Phase 3 — GCS resumable** (T3.1–T3.3) — merged (#93)
- [x] **Phase 4 — Async processing (Cloud Tasks)** (T4.1–T4.3) — merged (PRs #99, #102, #101). Sub-plan: [2026-06-01-phase4-cloud-tasks-impl.md](2026-06-01-phase4-cloud-tasks-impl.md). **Prod activation pending** (set Cloud Run env): [2026-06-06-phase4-cloud-run-activation.md](2026-06-06-phase4-cloud-run-activation.md)
- [ ] **Phase 5 — Handler registry + Tier 1 + safe ZIP** (T5.1–T5.3)
- [ ] **Phase 6 — Dashboard large-upload UX** (T6.1, T6.2)
- [ ] **Phase 7 — Cleanup, observability, deployment docs**

Resolved design decisions (2026-06-01):

- **OIDC (T4.2): strict, no escape hatch (option 1B).** The internal processing endpoint always requires a valid Cloud Tasks OIDC token in every environment; the pipeline is tested at the `processUpload()` function seam and OIDC by mocking `verifyIdToken`. No loopback/dev bypass ships.
- **Checksum (T4.3): optional in MVP (option 2A).** No `UPLOAD_REQUIRE_CHECKSUM` flag yet; the client SHA-256 stays optional and is compared only when provided. The enforce toggle is deferred to Phase 7.

## Confirmed repo facts (grounding)

| Area | Fact | Location |
|---|---|---|
| Upload route | multer `memoryStorage()`, **hardcoded 10 MB**, fileFilter via `isSupportedType` | `src/api/upload.ts:14-24` |
| Unused config | `MAX_SINGLE_FILE_SIZE` (default 20), `WARN_FILE_SIZE_MB`, `MAX_CHUNKS_PER_FILE` defined, never read | `src/utils/config.ts:128-144` |
| Config pattern | Zod `envSchema`, `string → transform(parseInt) → refine`; singleton `config` | `src/utils/config.ts` |
| Error handler | Maps `TextrawlError` only; **MulterError / 413 falls through to generic 500** | `src/api/middleware/error.ts` |
| Error classes | `ValidationError`, `AuthenticationError`, `AuthorizationError`, `NotFoundError`, `DatabaseError`, etc. | `src/utils/errors.ts` |
| DB client | Neon `@neondatabase/serverless` Pool via `DATABASE_URL`; helpers `pgQuery/queryOne/queryOneOrThrow/queryCount` | `src/db/pg-client.ts` |
| Document insert | `createDocument({title, sourceType, rawContent, sourceUrl, filePath, metadata})` `INSERT ... RETURNING *` | `src/db/documents.ts:33-60` |
| Chunk insert | `createChunks(...)` batched (50/INSERT) | `src/db/chunks.ts` |
| Extraction | `extractText(buffer, mimetype)`; `SUPPORTED_TYPES` = pdf/docx/txt/md; `validateFileType` magic check | `src/services/processor.ts` |
| Chunking | `smartChunk(text, generateEmbeddings, options)` | `src/services/chunker.ts` |
| Embeddings | `generateEmbeddings(texts)`, `isOpenAIConfigured()` | `src/services/embeddings.ts` |
| Pipeline hook | `onDocumentIngested()` exists but **not called** from upload | `src/services/pipeline.ts` |
| Schema | Hand-run SQL; `gen_random_uuid()`, `timestamptz default now()`, `jsonb default '{}'`, `on delete cascade`, trigger `updated_at` | `scripts/setup-db.sql` |
| RLS / ownership | `service_role` full access; anon/authenticated denied. **No `owner_id` columns** anywhere | `scripts/security-rls.sql` |
| Auth | `bearerAuth`: static `API_BEARER_TOKEN` or OAuth JWT (`GOOGLE_CLIENT_ID`+`OAUTH_JWT_SECRET`) | `src/api/middleware/auth.ts` |
| Dashboard upload | `dashboard/app/upload/page.tsx` POSTs `FormData` to `${apiBase}/upload`; **fake progress** (30→100); token from `localStorage['textrawl_token']` | + `dashboard/components/upload-zone.tsx` |
| Dashboard API base | `getApiBase()` → `NEXT_PUBLIC_API_URL` (default `http://localhost:3000/api`) | `dashboard/lib/api.ts` |
| UI over-promises | "PDF, DOCX, TXT, MD, HTML, images, audio, MBOX, EML, ZIP" advertised; server does 4 types | `dashboard/app/upload/page.tsx:188` |
| Deploy | distroless Node22, `PORT=8080`; Cloud Run **512Mi / 1 vCPU / 60s / min 0 / max 10**; `express.json({limit:'1mb'})` | `Dockerfile`, `docs/guides/cloud-run-deployment.mdx`, `src/index.ts:58` |
| Deps present | `multer`, `unzipper@0.12.0` (devDeps), `file-type`, `mammoth`, `pdf-parse`, `xlsx`. **No `@google-cloud/storage`** | `package.json` |
| Tests | `src/**/__tests__/**/*.test.ts` (vitest, `vi.mock`); **no supertest, no fixtures dir, no API tests** | `vitest.config.ts` |

**Assumptions (flagged):** single-tenant token model — `owner_token_hash` is an **interim** binding
(the repo has no real owner/user model); it must not be over-designed into multi-tenant security and
does not block implementation. GCP project + service account + bucket provisioning is the maintainer's to do
(this plan documents required IAM/CORS/lifecycle). Canonical integrity is an app-level SHA-256 verified
by streaming (see §4 Checksum strategy).

---

## 1. Context and diagnosis

- **Vercel logs silent:** the dashboard fetches `${getApiBase()}/upload` straight on the
  Textrawl server (Cloud Run) — `NEXT_PUBLIC_API_URL`, not a Vercel route. Bytes never traverse a
  Vercel function, so Vercel has nothing to log. The browser surfaced only `TypeError: Load failed`
  (a generic network/connection-reset error) because the connection died mid-upload.
- **Single-shot 60 MB fails:** `src/api/upload.ts` uses `multer.memoryStorage()` with a hardcoded
  **10 MB** cap. A 60 MB body is rejected/aborted by multer before the handler runs; even absent the
  cap, buffering 60–500 MB in a 512Mi Cloud Run instance and finishing extract+embed+insert inside a
  60s request is infeasible. The request can be reset before Express logs anything.
- **ZIP UI/server mismatch:** dashboard advertises ZIP/HTML/images/audio/MBOX/EML
  (`dashboard/app/upload/page.tsx:188`) but `SUPPORTED_TYPES` server-side is only pdf/docx/txt/md.
  ZIP uploads are accepted by the picker and then fail server-side.
- **10 MB cap vs config:** `MAX_SINGLE_FILE_SIZE` (default 20) exists in `src/utils/config.ts` but is
  never referenced; the effective limit is the literal `10 * 1024 * 1024` at `src/api/upload.ts:16`.

## 2. Rejected architecture (explicit)

- **Rejected: Postgres/Neon `bytea` staging of file bytes.** Reasons: WAL amplification and PITR/
  backup bloat (every byte written is replicated and retained); TOAST overhead and table/heap bloat;
  autovacuum pressure that degrades query latency for the actual knowledge tables; Neon storage billing
  on bytes that belong in object storage; connection/timeout risk pushing 500 MB blobs through a
  serverless Pool; and cleanup failure modes leaving orphaned multi-hundred-MB rows.
- **Rejected: `Buffer.concat` assembly.** Materializes the whole file/archive in memory — directly
  causes OOM on a 512Mi instance for large files and defeats streaming.
- **Rejected: synchronous ZIP/extract/embed in `/complete`.** Blows past the 60s Cloud Run request
  budget, holds memory for the full archive, and gives no retry/idempotency. `/complete` must be a
  fast validate-and-enqueue.

## 3. Target architecture

```text
Browser ──POST /api/upload/init──────────────► Textrawl API (Cloud Run)
  │                                              creates upload row (Postgres, metadata only)
  │                                              starts GCS resumable session (server-side)
  ◄──────────── { uploadId, resumableUri } ──────
  │
  ├──PUT chunks──────────────────────────────► GCS bucket (bytes never touch Vercel/Cloud Run/PG)
  │
  ├──POST /api/upload/complete {uploadId, checksum}──► API verifies owner/state/object/size/crc32c/generation/type
  │                                              transitions uploaded→queued (txn) + enqueues Cloud Task
  ◄──────────── 202 Accepted { statusUrl } ──────
  │
Cloud Tasks ──OIDC POST /api/upload/process/:uploadId──► internal endpoint (CPU allocated in-request)
  │                                              streams object from GCS → handler registry →
  │                                              extract → chunk → embed → createDocument(s) →
  │                                              update upload + per-entry results
  │
  └──GET /api/upload/:uploadId/status (poll)──► API returns upload + processing progress
```

Postgres stores **metadata/state/results only**. Bytes live in GCS and are streamed during
processing. Small files keep the existing direct `/api/upload` path.

## 4. API contract

All endpoints under `/api`, guarded by existing `bearerAuth` except the internal processing endpoint
(Cloud Tasks OIDC only). Errors use existing `TextrawlError` subclasses → JSON
`{ error: { message, code, statusCode } }`.

### `POST /api/upload/init`

```jsonc
// request
{
  "filename": "sample.zip",
  "contentType": "application/zip",   // declared; normalized server-side
  "size": 62914560,                    // bytes; validated against MAX_UPLOAD_SIZE_MB
  "checksumAlgo": "sha256",          // canonical app-level algo; optional intent
  "checksum": null                     // optional everywhere; if absent, verified during processing
}
// 200
{
  "uploadId": "f1e2...uuid",
  "objectKey": "uploads/2026/05/f1e2.../sample.zip", // server-generated, NOT trusted from client
  "bucket": "textrawl-uploads",
  "resumableUri": "https://storage.googleapis.com/upload/storage/v1/b/.../o?uploadType=resumable&upload_id=...",
  "expiresAt": "2026-05-31T18:00:00Z",
  "state": "initialized"
}
```

- Owner binding: server records `owner_token_hash` (SHA-256 of the presented bearer token, or OAuth
  `sub`) — see ownership note in §6.
- Type/size policy enforced here (reject early): extension+declared MIME normalized; size ≤
  `MAX_UPLOAD_SIZE_MB`. Files ≤ `MAX_SINGLE_FILE_SIZE_MB` may be told to use the direct path
  (response hint `"useDirectUpload": true`) — dashboard decides (§10).

### Resumable object upload (browser → GCS)

- Not a Textrawl endpoint. Browser PUTs bytes to `resumableUri` in chunks, honoring GCS
  `308 Resume Incomplete` + `Range` semantics; supports resume after a dropped connection.
- **Chunk sizing/headers (GCS rules):** every non-final chunk must be a multiple of **256 KiB**
  (262144 bytes); pick a larger multiple (e.g. 8–32 MiB) for throughput. Each PUT sets
  `Content-Range: bytes <start>-<end>/<total>` (or `*/<total>` / `bytes */*` when probing); on `308`
  read the returned `Range` header to resume from the next byte. Only the final chunk may be a
  non-256-KiB multiple.
- Bucket CORS must allow the dashboard origin, methods `PUT, POST, GET`, and headers
  `Content-Type, Content-Range, x-goog-*`.

### `POST /api/upload/complete`

```jsonc
// request — checksum OPTIONAL (browser SHA-256 if practical, else verified during processing)
{ "uploadId": "f1e2...", "checksum": "sha256:ab12...", "checksumAlgo": "sha256" }
// 202
{ "uploadId": "f1e2...", "state": "queued", "statusUrl": "/api/upload/f1e2.../status" }
```

Verifies at complete (fast, metadata-only — no full read): ownership (token hash match) → current
state `uploaded`/`initialized` and not terminal → GCS object exists → object `size` == recorded size
→ capture `generation` + `crc32c` (+ `etag`) → normalized type allowed. **Canonical SHA-256 is NOT
computed here** (would require reading the whole object). If a client SHA-256 was provided it is
stored as `checksum_expected`; otherwise it stays null and is computed during processing. Then
**transactionally** transitions to `queued` and enqueues exactly one Cloud Task keyed by `uploadId`.
**Idempotent:** a second `complete` for an already-`queued`/`processing`/`completed` upload returns
the current state without enqueuing a duplicate.

### `GET /api/upload/:uploadId/status`

```jsonc
{
  "uploadId": "f1e2...",
  "state": "processing",
  "filename": "sample.zip",
  "size": 62914560,
  "progress": { "entriesTotal": 42, "entriesProcessed": 17, "entriesFailed": 1 },
  "documentIds": ["...","..."],
  "entries": [ { "name": "notes/spring.md", "state": "completed", "documentId": "..." },
               { "name": "weird.exe", "state": "skipped", "code": "UNSUPPORTED_ENTRY" } ],
  "error": null,                  // { code, message } when state=failed
  "createdAt": "...", "updatedAt": "...", "completedAt": null
}
```

### `DELETE /api/upload/:uploadId` (cancel/abort)

Aborts the GCS resumable session if still uploading, marks `cancelled`, schedules object cleanup.
Idempotent; rejects if already `processing`/`completed` (returns conflict).

### Internal: `POST /api/upload/process/:uploadId`

Cloud Tasks → Cloud Run only. **Rejects** any request lacking a valid Google-signed OIDC token whose
audience matches the configured processing URL/service account. Not exposed to `bearerAuth` clients.
Idempotent on `uploadId` (no-op if already `completed`/`failed`).

### Stable error codes

`FILE_TOO_LARGE` (413), `UNSUPPORTED_TYPE`, `UNSUPPORTED_ENTRY`, `OBJECT_NOT_FOUND`, `SIZE_MISMATCH`,
`CHECKSUM_MISMATCH`, `UPLOAD_EXPIRED`, `INVALID_STATE`, `FORBIDDEN_OWNER`, `ZIP_PATH_TRAVERSAL`,
`ZIP_BOMB`, `ZIP_TOO_MANY_ENTRIES`, `ZIP_ENTRY_TOO_LARGE`, `ZIP_NESTED_ARCHIVE`,
`ZIP_NO_SUPPORTED_ENTRIES`.

### Checksum / integrity strategy

- **Canonical = app-level SHA-256**, computed by **streaming** — never by buffering the whole file.
- **Why not browser-MD5 + GCS `md5Hash`:** WebCrypto provides no MD5; naive whole-file hashing forces
  large files into browser memory; and `md5Hash` is absent on composed/parallel-composite GCS objects,
  so it is not a durable long-term primitive.
- **At `/complete`:** verify cheap GCS metadata only — `size`, capture `generation`, `crc32c`, `etag`.
  `crc32c` is always present and gives a fast transport-integrity signal; record it as `gcs_crc32c`.
- **Browser SHA-256 (optional, preferred when practical):** compute incrementally over the same chunks
  streamed to GCS (WebCrypto `digest` per chunk is not resumable across a stream, so use an incremental
  approach or a small wasm hasher; if too costly for MVP, **skip it**). If provided, store as
  `checksum_expected`.
- **During processing (canonical verification):** the Cloud Task processor streams the object from GCS
  and computes SHA-256 incrementally **before extraction**. If `checksum_expected` is set and differs →
  fail the job with `CHECKSUM_MISMATCH` before any document is created. Always persist the computed
  digest + `checksum_verified_at`. This keeps verification streaming and out of the request path.

## 5. Upload state machine

States: `initialized → uploading → uploaded → queued → processing → completed | partial | failed`,
plus `expired` and `cancelled`.

| From | To | Trigger |
|---|---|---|
| `initialized` | `uploading` | first byte / first PUT observed (optional; may be inferred) |
| `initialized`/`uploading` | `uploaded` | `/complete` object-verify passes (pre-enqueue) |
| `uploaded` | `queued` | Cloud Task enqueued (same txn) |
| `queued` | `processing` | process endpoint starts (idempotent guard) |
| `processing` | `completed` | all supported entries succeeded |
| `processing` | `partial` | ≥1 entry succeeded, ≥1 failed (archives) |
| `processing` | `failed` | archive-level validation fails, or single-file extract fails, or unrecoverable error |
| `initialized`/`uploading`/`uploaded` | `expired` | resumable session / TTL elapsed before complete |
| `initialized`/`uploading`/`uploaded`/`queued` | `cancelled` | `DELETE` |

**Idempotency / duplicates:** `complete` is idempotent per `uploadId`; Cloud Task retries hit the
`processing`/`completed` guard and do not recreate documents (per-entry results record which documents
already exist). Terminal states (`completed`/`failed`/`cancelled`/`expired`) reject further transitions.

## 6. Database schema sketch (metadata only)

New SQL: `scripts/setup-db-uploads.sql` (+ RLS block appended to `scripts/security-rls.sql`).
No file bytes, no chunks here — documents/chunks continue to use existing tables via
`createDocument`/`createChunks`.

```sql
create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  owner_token_hash text,                 -- sha256(bearer token) or OAuth sub; NULL if auth disabled
  filename text not null,
  title text,
  declared_mimetype text,
  normalized_type text,                  -- registry handler key, e.g. 'pdf','zip'
  size_bytes bigint not null,
  checksum_algo text default 'sha256',   -- canonical app-level algo
  checksum_expected text,                -- client SHA-256 if provided (else null)
  checksum_computed text,                -- SHA-256 computed by processor stream
  checksum_verified_at timestamptz,
  gcs_crc32c text,                       -- GCS object crc32c captured at complete
  bucket text not null,
  object_key text not null,
  object_generation text,                -- GCS generation captured at complete
  object_etag text,
  state text not null default 'initialized'
    check (state in ('initialized','uploading','uploaded','queued','processing',
                     'completed','partial','failed','expired','cancelled')),
  error_code text,
  error_message text,
  entries_total int default 0,
  entries_processed int default 0,
  entries_failed int default 0,
  document_ids uuid[] default '{}',
  metadata jsonb default '{}',           -- tags, source hints, task name for dedupe
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  expires_at timestamptz,
  completed_at timestamptz
);
create index if not exists uploads_state_idx on uploads(state);
create index if not exists uploads_owner_idx on uploads(owner_token_hash);
create index if not exists uploads_expires_idx on uploads(expires_at);

-- per-entry results (archives). For single files, one row optional.
create table if not exists upload_entries (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references uploads(id) on delete cascade,
  entry_path text not null,
  normalized_type text,
  size_bytes bigint,
  state text not null default 'pending'
    check (state in ('pending','completed','failed','skipped')),
  document_id uuid references documents(id) on delete set null,
  error_code text,
  error_message text,
  created_at timestamptz default now()
);
create index if not exists upload_entries_upload_idx on upload_entries(upload_id);
-- dedupe extracted entries on retry:
create unique index if not exists upload_entries_uniq on upload_entries(upload_id, entry_path);
```

Reuse `updated_at` trigger pattern from `scripts/setup-db.sql`. **Ownership note — INTERIM:** the repo
has no real owner/user model today. `owner_token_hash` is a lightweight, interim binding so a future
multi-token deployment *can* scope status/cancel; it is **not** a multi-tenant security boundary and
must not be over-designed into one. When auth is disabled it is NULL and ownership checks are skipped.
Replace with a real user model if/when one lands — do not block this work on it.

## 7. Config (env names + defaults)

Add to `src/utils/config.ts` `envSchema` using the existing `string→transform→refine` pattern;
document in `.env.example` and `docs/ENV.md`.

| Env | Default | Notes |
|---|---|---|
| `MAX_SINGLE_FILE_SIZE_MB` | `20` | direct `/api/upload` cap; **wire into multer** (replaces hardcoded 10 MB). Keep under Cloud Run/`express` body limits. (Reuse/rename existing `MAX_SINGLE_FILE_SIZE`.) |
| `MAX_UPLOAD_SIZE_MB` | `500` | max size accepted by `/init` resumable workflow |
| `UPLOAD_THRESHOLD_MB` | `MAX_SINGLE_FILE_SIZE_MB` | dashboard switch point: ≤ → direct, > → resumable |
| `GCS_UPLOAD_BUCKET` | — (required for large uploads) | bucket name |
| `GCS_PROJECT_ID` | — | GCP project |
| `UPLOAD_SESSION_TTL_MIN` | `120` | resumable session + upload row expiry |
| `CLOUD_TASKS_QUEUE` | `textrawl-upload-processing` | queue id |
| `CLOUD_TASKS_LOCATION` | `us-central1` | region |
| `CLOUD_TASKS_SERVICE_ACCOUNT` | — | OIDC identity for task→Cloud Run |
| `UPLOAD_PROCESS_URL` | — | internal endpoint URL (OIDC audience) |
| `UPLOAD_PROCESS_TIMEOUT_S` | `600` | Cloud Run request timeout for processing service (raise from 60s) |
| `UPLOAD_PROCESS_CONCURRENCY` | `1` | low (1–2), protects memory for large archives |
| `UPLOAD_REQUIRE_CHECKSUM` | `false` | if true, `/complete` requires a client SHA-256; else verified during processing |
| `ZIP_MAX_ENTRIES` | `2000` | |
| `ZIP_MAX_COMPRESSED_BYTES` | `MAX_UPLOAD_SIZE_MB` | |
| `ZIP_MAX_EXPANDED_BYTES` | `2_000_000_000` | bomb guard |
| `ZIP_MAX_ENTRY_BYTES` | `50_000_000` | per-entry expanded cap |
| `ZIP_MAX_COMPRESSION_RATIO` | `100` | expanded/compressed guard |
| `ZIP_MAX_FILENAME_LEN` | `255` | |
| `UPLOAD_CLEANUP_TTL_HOURS` | `24` | terminal/abandoned object cleanup; backed by GCS lifecycle rule |

## 8. Handler registry + file-type tiers

Restructure extraction from a hardcoded `SUPPORTED_TYPES` map into a registry so support expands
cleanly. Proposed layout (adapt to repo conventions; `processor.ts` stays as the entry that delegates
to the registry):

```text
src/services/processor/
  registry.ts      # register(handler), resolve(normalizedType|magic) -> handler
  types.ts         # FileHandler { key, extensions, mimeTypes, sniff(buf), extract(stream|buffer) -> string }
  handlers/
    text.ts pdf.ts docx.ts csv.ts xlsx.ts json.ts html.ts archive-zip.ts
    (eml.ts, xml.ts, rtf.ts, pptx.ts, epub.ts as Tier 1.5;
     mbox.ts, doc-legacy.ts, image-ocr.ts, audio-video.ts as later/optional)
```

Each handler declares extensions + MIME types + an optional magic-sniff, and an `extract` that prefers
streaming. `validateFileType` (magic check) folds into the registry's sniff step.

**Tier 1 — MVP (conservative; only well-supported parsers ship first):**

| Type | Library | Status |
|---|---|---|
| `.txt`, `.md` | native `buffer.toString` | present |
| `.pdf` | `pdf-parse` | present |
| `.docx` | `mammoth` | present |
| `.csv`, `.xlsx` | `xlsx` | present |
| `.json` | native | present |
| `.html`/`.htm` | `html-to-text` or `cheerio` | **add dep** |
| `.zip` of Tier-1 entries | `unzipper` (present) / `yauzl` for stricter streaming | present |

**Tier 1.5 — soon (added once each parser has tests, not bundled into the MVP claim):**
`.eml` (`mailparser`), `.xml` (`fast-xml-parser`), `.rtf` (lightweight rtf parser), `.pptx`
(`officeparser`/jszip+XML), `.epub` (`epub2`/jszip+XML). Each is a separate handler + test slice.

**Later / explicit non-MVP:** `.doc` (legacy binary), `.mbox`, images + OCR, scanned-PDF OCR,
audio/video transcription, **nested archives**, `.tar`/`.gz`/`.7z`. The registry leaves extension
points; none ship in MVP.

**Language to use:** "broad support for common text-bearing files," "ZIP containing supported
document/text files," "more formats planned soon," "OCR/media planned as later handlers,"
"unsupported files receive clear, structured errors." Never "all file types supported."

## 8a. Product-facing support matrix

Single source of truth for what the product honestly claims; the dashboard accept list + copy MUST be
generated from / match this. No type is advertised before server support + tests exist.

| File type | Supported now (MVP) | Via ZIP | Planned soon (1.5) | Not yet |
|---|:--:|:--:|:--:|:--:|
| `.txt`, `.md`, `.pdf`, `.docx`, `.csv`, `.xlsx`, `.json`, `.html`/`.htm` | ✅ | ✅ | | |
| `.zip` (of supported entries) | ✅ | n/a | | |
| `.eml`, `.xml`, `.rtf`, `.pptx`, `.epub` | | | 🔜 | |
| `.doc`, `.mbox` | | | | ⛔ |
| images (`.png/.jpg/.heic/.tiff`), scanned-PDF OCR, audio/video | | | | ⛔ |
| nested archives, `.tar`/`.gz`/`.7z` | | | | ⛔ |

- **Supported now:** ingested directly.
- **Supported through ZIP:** only entries that are themselves "supported now."
- **Planned soon:** show as disabled/"coming soon" in UI; do not accept yet.
- **Not supported yet:** rejected at `/init` (or per-entry) with `UNSUPPORTED_TYPE` /
  `UNSUPPORTED_ENTRY` and a clear message.
- **Dashboard rule:** the picker `accept` and the help copy (currently the over-promising
  "PDF, DOCX, TXT, MD, HTML, images, audio, MBOX, EML, ZIP" at `dashboard/app/upload/page.tsx:188`)
  must be replaced to reflect exactly the "Supported now" column, with ZIP labeled
  "ZIP containing supported document/text files."

## 9. ZIP handling

ZIP is a registry handler (`archive-zip.ts`) that **streams** entries from the GCS object (no full
`Buffer.concat`). One supported entry → one Textrawl document (+ one `upload_entries` row).

Strict safety (all enforced before/while extracting each entry):

- Reject path traversal: `../`, absolute paths, Windows drive prefixes (`C:\`), backslashes.
- Reject symlinks / device files / non-regular entries.
- Reject nested archives (MVP).
- Enforce `ZIP_MAX_ENTRIES`, `ZIP_MAX_COMPRESSED_BYTES`, `ZIP_MAX_EXPANDED_BYTES`,
  `ZIP_MAX_ENTRY_BYTES`, `ZIP_MAX_COMPRESSION_RATIO`, `ZIP_MAX_FILENAME_LEN` (abort archive on bomb
  signals — these are archive-level failures → `failed`).
- Skip OS junk: `__MACOSX/`, `.DS_Store`, `Thumbs.db`.
- Validate each entry by extension **and** content/magic sniff via the registry.
- Zero supported entries → `failed` with `ZIP_NO_SUPPORTED_ENTRIES`.

**Partial-success policy (chosen):** use **`partial`**. Archive-level validation (traversal/bomb/
limits/empty) fails the whole ZIP *before* any documents are created. Once extraction begins, per-entry
failures (e.g. a corrupt PDF) are recorded in `upload_entries` and the upload ends `partial` (or
`completed` if all succeed). Rationale: after some documents are successfully created, hard-failing the
whole upload would orphan/confuse already-ingested content; `partial` + per-entry errors is honest,
recoverable, and matches the status response shape.

## 10. Frontend / dashboard behavior

- **Threshold switch:** in `dashboard/app/upload/page.tsx` (+ `upload-zone.tsx`), files ≤
  `UPLOAD_THRESHOLD_MB` keep the existing single-shot `POST ${apiBase}/upload`; larger files use the
  init → resumable-PUT → complete → poll flow. Threshold comes from server (`/init` hint) or a
  configured constant.
- **Real progress:** replace the fake `30→100` with byte-based progress from resumable chunk PUTs
  (uploading phase) and `GET /status` polling (processing phase: `entriesProcessed/entriesTotal`).
- **ZIP MIME normalization:** browsers report ZIP as `application/zip`, `application/x-zip-compressed`,
  or `''`; normalize client- and server-side. Keep the existing token header
  (`localStorage['textrawl_token']`).
- **Resume/retry:** resumable PUTs retry/resume on transient network errors; surface a Retry control.
  (Cross-session resume — persisting the session URI — is **out of scope** for MVP; documented.)
- **Clear errors:** map structured `{ error: { code, message } }` to readable text; eliminate bare
  `Load failed`. Distinguish "no server configured" (already handled), 413, unsupported type,
  checksum mismatch, expired session, processing failure.

## 11. Implementation task slices

Each task = test-first → expected failing test → implement → verify → commit. Slices are sized for an
agent to execute without re-planning. Run `pnpm verify:fast` before every commit; full `pnpm verify`
at the end of each phase. **Stop gates** are mandatory pauses for human review.

### Phase 1 — Small-path fix & error clarity ✅ merged

- **T1.1 Wire multer cap to config.**
  - Files: `src/utils/config.ts` (add `MAX_SINGLE_FILE_SIZE_MB`, reuse existing
    `MAX_SINGLE_FILE_SIZE`), `src/api/upload.ts`.
  - Test-first: `src/api/__tests__/upload-limits.test.ts` — asserts multer `limits.fileSize` derives
    from config, not literal `10*1024*1024`. **Expected fail:** current hardcode.
  - Implement: replace literal with `config.MAX_SINGLE_FILE_SIZE_MB * 1024 * 1024`.
  - Verify: `pnpm test src/api/__tests__/upload-limits.test.ts && pnpm typecheck`.
  - Commit: `fix(upload): wire MAX_SINGLE_FILE_SIZE_MB into multer limit`.
- **T1.2 MulterError/413 + type-rejection JSON.**
  - Files: `src/api/middleware/error.ts` (map `MulterError` `LIMIT_FILE_SIZE`→413, others→400 JSON
    `{error:{message,code,statusCode}}`), `src/api/upload.ts`.
  - Test-first: assert 413 JSON body w/ stable code `FILE_TOO_LARGE`; unsupported type → 400
    `UNSUPPORTED_TYPE`. **Expected fail:** today falls through to generic 500.
  - Verify: `pnpm test src/api/__tests__/upload-limits.test.ts`.
  - Commit: `fix(upload): return structured JSON for Multer/413/type errors`.
- **🛑 STOP GATE 1:** if any existing small-upload behavior regresses, stop and report. Do not proceed.

### Phase 2 — Upload contract + state machine + schema (GCS/Tasks stubbed) ✅ merged (#92)

- **T2.1 Schema + RLS.** Files: `scripts/setup-db-uploads.sql`, append `scripts/security-rls.sql`.
  Test-first: a SQL-shape unit/snapshot test or `db/uploads` integration guard. Commit:
  `feat(db): uploads + upload_entries metadata schema`.
- **T2.2 DB module.** Files: `src/db/uploads.ts` (mirror `src/db/documents.ts`; use
  `pgQuery/queryOne/queryOneOrThrow`). Test-first: `src/db/__tests__/uploads.test.ts` (mock pg) for
  create/get/transition. Commit: `feat(db): uploads metadata module`.
- **T2.3 State machine + endpoints (stubbed storage/tasks).** Files: `src/api/upload-sessions.ts`
  (`init`/`complete`/`status`/`DELETE`), mount in `src/api/routes.ts`. Storage + Tasks behind
  interfaces with in-memory fakes. Test-first: legal/illegal transitions, idempotent `complete`,
  ownership rejection (403), empty-DB status. Commit: `feat(upload): session API + state machine`.
- **🛑 STOP GATE 2:** review the init/complete/status contract (shapes + codes) **before** any GCS or
  dashboard work.

### Phase 3 — GCS resumable ✅ merged (#93)

- **T3.1 GCS service.** Add deps `@google-cloud/storage`. Files: `src/services/storage/gcs.ts`
  (`startResumableSession`, `headObject`→size/generation/crc32c/etag, `abortSession`,
  `createReadStream`, `signedPutUrl` fallback). Test-first: `vi.mock` the storage client; assert
  server-generated object key, never client-supplied. Commit: `feat(storage): GCS resumable helper`.
- **T3.2 Wire into init/complete.** Replace stubs; `/complete` captures generation/crc32c, verifies
  size + existence. Test-first: missing object → `OBJECT_NOT_FOUND`; size mismatch → `SIZE_MISMATCH`.
  Commit: `feat(upload): GCS-backed init/complete`.
- **T3.3 Docs:** bucket CORS (dashboard origin; `PUT/POST/GET`; `Content-Range`, `x-goog-*`) +
  lifecycle rule (abandoned-upload TTL). File: `docs/guides/cloud-run-deployment.mdx`. Commit:
  `docs: GCS bucket CORS + lifecycle for resumable uploads`.
- **🛑 STOP GATE 3:** confirm the GCS init/complete contract end-to-end (mocked) before dashboard.

### Phase 4 — Async processing (Cloud Tasks) ▶ next — see [sub-plan](2026-06-01-phase4-cloud-tasks-impl.md)

- **T4.1 Cloud Tasks enqueue + OIDC.** Add dep `@google-cloud/tasks`. Files:
  `src/services/tasks/cloud-tasks.ts` (enqueue keyed by `uploadId`; OIDC token config). Test-first:
  enqueue called once per `complete`; dedupe on retry. Commit: `feat(tasks): Cloud Tasks enqueue`.
- **T4.2 Internal processing endpoint.** Files: `src/api/upload-process.ts` (`POST
  /api/upload/process/:uploadId`), OIDC verify helper in `src/api/middleware/auth.ts`. Test-first:
  **unauthenticated/non-OIDC rejected (401/403)**; idempotent no-op when terminal. Commit:
  `feat(upload): internal Cloud Tasks processing endpoint (OIDC)`.
- **T4.3 Processing pipeline (single-file).** Stream object from GCS → SHA-256 verify (before
  extract) → `extractText`(registry) → `smartChunk` → `generateEmbeddings` → `createDocument`/
  `createChunks` → `onDocumentIngested()` → status transitions. Test-first: streaming asserted (no
  full buffer); `CHECKSUM_MISMATCH` before extraction; success → `completed`. Commit:
  `feat(upload): async single-file processing pipeline`.
- **🛑 STOP GATE 4:** if OIDC auth cannot be verified locally or mocked convincingly, stop and report
  before building further on the internal endpoint.

### Phase 5 — Handler registry + Tier 1 + safe ZIP

- **T5.1 Registry refactor.** Files: `src/services/processor/{registry,types}.ts` +
  `handlers/{text,pdf,docx,csv,xlsx,json}.ts`; `src/services/processor.ts` delegates. Test-first:
  registry resolves by extension+magic; existing 4 types still extract. Commit:
  `refactor(processor): file-handler registry`.
- **T5.2 HTML handler.** Add dep (`html-to-text` or `cheerio`). Test-first: fixture HTML → text.
  **🛑 STOP GATE 5a:** if the HTML/parsers dependency choice is ambiguous, stop and confirm before
  adding. Commit: `feat(processor): html handler`.
- **T5.3 Safe ZIP handler.** Files: `src/services/processor/handlers/archive-zip.ts` (stream entries
  from GCS; enforce all §9 limits; per-entry `upload_entries`; `partial`). Test-first: one doc per
  supported entry; traversal/bomb/too-many/oversized/nested rejected; zero-supported →
  `ZIP_NO_SUPPORTED_ENTRIES`; mixed → `partial`. Commit: `feat(processor): safe streaming ZIP`.
- (Tier 1.5 handlers `.eml/.xml/.rtf/.pptx/.epub` are **separate post-MVP slices**, each its own
  dep + test + matrix update; not part of the MVP claim.)

### Phase 6 — Dashboard large-upload UX

- **T6.1 Resumable client + threshold switch.** Files: `dashboard/app/upload/page.tsx`,
  `dashboard/components/upload-zone.tsx`, `dashboard/lib/api.ts`. ≤ threshold → existing direct POST;
  larger → init→resumable PUT→complete→poll. Real byte progress + status polling. Commit:
  `feat(dashboard): resumable large-upload flow`.
- **T6.2 Support matrix + error mapping.** Replace over-promising accept list/copy with §8a "Supported
  now" set; map structured `{error:{code}}` to readable text (no bare `Load failed`); ZIP MIME
  normalization. Commit: `feat(dashboard): honest support matrix + clear upload errors`.

### Phase 7 — Cleanup, observability, deployment docs

- GCS lifecycle rule + a small expiry sweeper for abandoned `uploads` rows/objects (`expires_at`).
- Structured logs/metrics: state transitions, task retries, per-entry outcomes, checksum results.
- Update `docs/guides/cloud-run-deployment.mdx` (deployment shape below), `docs/ENV.md`,
  `.env.example`. README/AGENTS only if the MCP tool list changes (it does not).
- Commit: `chore(upload): cleanup, observability, deployment docs`.

### Deployment shape (Cloud Tasks / Cloud Run)

- **MVP:** **one** Cloud Run service exposes both the lightweight API and the internal processing
  endpoint; the processing endpoint is callable **only** by Cloud Tasks via OIDC.
- Raise the Cloud Run **request timeout** for processing (current 60s → e.g. `UPLOAD_PROCESS_TIMEOUT_S`
  600s) and likely bump **memory/CPU** above today's 512Mi / 1 vCPU.
- **Concurrency low (1–2)** initially to protect memory for large files/archives.
- **If** raising resources for processing would over-provision the lightweight API path, **later split**
  into two services: `textrawl-api` and `textrawl-upload-processor` (same image, different
  scaling/resource config; Tasks targets the processor).
- **If** a single file/ZIP can exceed the Cloud Run request timeout, **later** split into per-entry
  Cloud Tasks or move processing to **Cloud Run Jobs**. Mark as scale-up, not MVP.

## 12. Critical files

| Path | Action |
|---|---|
| `src/api/upload.ts` | wire config cap; keep small-file path |
| `src/api/upload-sessions.ts` | **new** init/complete/status/cancel |
| `src/api/upload-process.ts` | **new** internal Cloud Tasks endpoint (OIDC) |
| `src/api/routes.ts`, `src/index.ts` | mount new routes; raise processing-path body/timeout as needed |
| `src/api/middleware/error.ts` | MulterError/413 → JSON; new stable codes |
| `src/api/middleware/auth.ts` | reuse; add OIDC verify helper for internal endpoint |
| `src/utils/config.ts`, `.env.example`, `docs/ENV.md` | new config + docs |
| `src/db/uploads.ts` | **new** metadata/state CRUD (mirror `documents.ts`) |
| `scripts/setup-db-uploads.sql`, `scripts/security-rls.sql` | **new** schema + RLS |
| `src/services/storage/gcs.ts` | **new** GCS resumable/head/abort/signed-url |
| `src/services/tasks/cloud-tasks.ts` | **new** enqueue + OIDC |
| `src/services/processor/` (registry + handlers) | refactor from `processor.ts`; new handlers |
| `src/services/chunker.ts`, `embeddings.ts`, `db/chunks.ts`, `db/documents.ts`, `pipeline.ts` | reuse as-is |
| `dashboard/app/upload/page.tsx`, `dashboard/components/upload-zone.tsx`, `dashboard/lib/api.ts` | resumable client, progress, errors |
| `Dockerfile`, `docs/guides/cloud-run-deployment.mdx` | processing-service resources/timeout/concurrency; bucket CORS/lifecycle; queue + IAM |
| `src/**/__tests__/...`, fixtures dir (**new**) | tests + sample files |
| `package.json` | **MVP:** add `@google-cloud/storage`, `@google-cloud/tasks`, an HTML parser (`html-to-text`/`cheerio`); move `unzipper` to deps (or add `yauzl`). **Tier 1.5 (later slices):** `mailparser`, `fast-xml-parser`, rtf, `officeparser`, epub |

## 13. Verification plan

Tests (vitest, `src/**/__tests__/`, `vi.mock` for DB/GCS/Tasks; add a `fixtures/` dir — none today):

- Small upload still works; oversized small upload → **413 JSON**; unsupported type → JSON `code`.
- `/init` returns `uploadId` + `resumableUri`; **object key is server-generated** (client-supplied key ignored).
- `/complete` verifies ownership + object size/existence (metadata only); missing object →
  `OBJECT_NOT_FOUND`; size mismatch → `SIZE_MISMATCH`; wrong owner → 403; captures `crc32c`/generation.
- **Checksum (canonical, streaming):** processor computes SHA-256 from the GCS stream **before
  extraction**; if `checksum_expected` set and differs → `CHECKSUM_MISMATCH` and **no document
  created**; computed digest + `checksum_verified_at` persisted. Assert no whole-file buffering.
- `/complete` **idempotent**: second call does not enqueue a duplicate task.
- Internal process endpoint **rejects unauthenticated/non-OIDC** calls; task **retry is idempotent**
  (no duplicate documents — `upload_entries` unique index).
- Processing **streams** from GCS (assert no full-buffer read; mock returns a stream and asserts
  chunked consumption).
- Each **Tier-1 handler** extracts expected text from a fixture.
- Valid ZIP → **one document per supported entry**; mixed ZIP → **`partial`** + per-entry errors.
- ZIP **traversal / bomb / too-many-entries / oversized-entry / nested-archive** → rejected;
  **zero supported entries** → `ZIP_NO_SUPPORTED_ENTRIES`.
- Status endpoint reflects upload + processing progress; dashboard shows progress and **clear errors**
  (no bare `Load failed`).
- End-to-end: prefer a GCS emulator/mock (e.g. `fake-gcs-server`) or a dedicated test bucket per repo
  preference; Cloud Tasks mocked in CI, with a documented manual smoke test against a real queue.

Gates: `pnpm verify:fast` (lint + lint:md + typecheck + test + security/docs/tool-sync) then
`pnpm verify` before any PR.

### Manual smoke-test checklist (run against a real GCS bucket + Cloud Tasks queue)

- [ ] Small `.txt` upload via existing direct path still works (document created).
- [ ] Oversized **direct** upload returns **JSON 413** (`FILE_TOO_LARGE`), not `Load failed`.
- [ ] Large-upload `/init` returns `uploadId` + resumable session URI + server-generated object key.
- [ ] Browser uploads a real **>10 MB** file directly to GCS via the resumable URI (progress advances).
- [ ] `/complete` returns `202` and a Cloud Task is enqueued (visible in the queue).
- [ ] Status transitions `queued → processing → completed` via `GET /status` polling.
- [ ] Valid ZIP creates **one document per supported entry**; `upload_entries` populated.
- [ ] ZIP with path traversal fails with a clear code (`ZIP_PATH_TRAVERSAL`), no partial docs.
- [ ] ZIP with mixed entries ends `partial` with per-entry errors.
- [ ] Dashboard never shows only a bare `TypeError: Load failed` — errors are structured + readable.
- [ ] Internal processing endpoint returns 401/403 when called without a valid Cloud Tasks OIDC token.

## Non-goals

- No OCR / image / audio / video extraction in MVP (Tier-3 extension points only).
- Do **not** proxy large bodies through Vercel.
- Do **not** store file bytes in Postgres.
- Do **not** process large ZIPs synchronously in request handlers.
- Do **not** add malware scanning now (note as future hardening: scan GCS object pre-processing).
- No cross-session resumable-upload persistence in MVP.

## Ready-for-implementation checklist

- [x] Maintainer approves async model = **Cloud Tasks** and upload = **GCS resumable**.
- [ ] GCP project, `GCS_UPLOAD_BUCKET`, service account, Cloud Tasks queue provisioned. (Bucket config landed in #93; Tasks queue + service account still the maintainer's to provision before Phase 4 deploy.)
- [x] Bucket CORS (dashboard origin) + lifecycle (abandoned-upload TTL) defined. (Documented in T3.3.)
- [ ] Separate/raised-resource processing path (memory/CPU/timeout, concurrency=1) confirmed.
- [x] `partial` ZIP policy + per-entry results accepted.
- [x] `owner_token_hash` accepted as **interim** binding (not a multi-tenant boundary). (Implemented in #92.)
- [x] Checksum = canonical **SHA-256 verified by streaming during processing** (+ GCS `crc32c`/size at complete); browser SHA-256 optional. Accepted. (Refined 2026-06-01: optional in MVP, option 2A — see Progress tracker.)
- [x] Conservative MVP Tier 1 + honest support matrix accepted; dashboard accept list to match. (Dashboard match lands in Phase 6.)
- [ ] **MVP dependencies** approved: `@google-cloud/storage`, `@google-cloud/tasks`, `html-to-text` **or** `cheerio`, and `unzipper` moved to deps (**or** `yauzl`). (`@google-cloud/storage` + `unzipper` present; `@google-cloud/tasks` + HTML parser pending in Phases 4–5.)
- [x] **Tier 1.5 dependencies** (later, separate slices) noted: `mailparser`, `fast-xml-parser`, an RTF parser, `officeparser`/PPTX parser, an EPUB parser.
