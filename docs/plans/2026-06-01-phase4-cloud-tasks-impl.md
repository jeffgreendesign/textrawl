# Phase 4 — Async Processing (Cloud Tasks) · Implementation Plan

**Date:** 2026-06-01 · **Status:** Approved design, not started · **Parent:** [2026-05-31-large-upload-gcs-resumable-plan.md](2026-05-31-large-upload-gcs-resumable-plan.md) §11 Phase 4

## For an agent with no prior context

Phases 1–3 of the large-upload effort are **merged** (PRs #91–#93). Uploads currently flow `init → browser PUT to GCS → complete → state=queued` and then **stop** — nothing processes a queued upload yet. Phase 4 builds the async processing leg so a queued upload actually produces documents. Single-file only; ZIP is Phase 5.

Read the parent plan's "Progress tracker" and §11 first. This doc is the granular, code-grounded breakdown for Phase 4 with the two open design decisions already resolved.

### Resolved design decisions

- **OIDC (T4.2): strict, no escape hatch (option 1B).** The internal processing endpoint always requires a valid Cloud Tasks OIDC token in every environment. The processing pipeline is tested at the `processUpload()` function seam; OIDC is tested by mocking `verifyIdToken`. No loopback/dev-secret bypass ships. Consequence: no local HTTP end-to-end for the processing leg (the `init`/`complete`/`status` legs stay locally runnable).
- **Checksum (T4.3): optional in MVP (option 2A).** No `UPLOAD_REQUIRE_CHECKSUM` flag. The client SHA-256 stays optional; the processor always computes and records a SHA-256, but only fails on mismatch when the client supplied `checksum_expected`. The enforce toggle is deferred to Phase 7.

## Grounding delta — scaffolding that already exists

Phases 2–3 left ports and seams in place, so parts of the original §11 Phase 4 are already done or smaller than written:

- The `TaskQueue` port + `MemoryTaskQueue` fake + `getTaskQueue()`/`setTaskQueue()` dispatch already exist (`src/services/tasks/{types,memory,index}.ts`). **T4.1 shrinks** to adding the real impl + config-gating it.
- `/complete` already enqueues via `getTaskQueue().enqueueProcessing()` with correct ordering (`src/api/upload-sessions.ts`). **No router change for T4.1.**
- `queued → processing → completed/partial/failed` are already legal transitions with a CAS guard (`src/db/uploads.ts`). **No state-machine change.**
- **New scope the original plan glossed:** the `StorageService` port (`src/services/storage/types.ts`) has **no read method** — T4.3 must add one to the port + GCS impl + memory fake.
- **New scope:** `src/db/uploads.ts` has only `recordUploadObjectMetadata` — T4.3 must add a processing-result writer (`document_ids`, `checksum_computed`, counts).
- `extractText` is **Buffer-based** (`src/services/processor.ts`); MVP buffers the streamed object (bounded by the single-file cap). True streaming extraction + ZIP are Phase 5.
- `google-auth-library` is **not** a direct dep; T4.2 must add it.

## T4.1 — Real Cloud Tasks queue

Swap the in-memory fake for Google Cloud Tasks when configured; fall back to the fake otherwise. Dedupe by deterministic task name (`process-<uploadId>`).

- [ ] Add dep `@google-cloud/tasks` (direct).
- [ ] New file `src/services/tasks/cloud-tasks.ts`: `CloudTasksQueue implements TaskQueue`. Create an HTTP task targeting `UPLOAD_PROCESS_URL/<uploadId>` with an OIDC token (`oidcToken.serviceAccountEmail = CLOUD_TASKS_SERVICE_ACCOUNT`, `audience = UPLOAD_PROCESS_URL`). Set task `name = process-<sanitized uploadId>`; catch gRPC `ALREADY_EXISTS` (code 6) and return `{ deduplicated: true }`.
- [ ] Edit `src/services/tasks/index.ts`: gate like storage — `if (config.CLOUD_TASKS_QUEUE && config.UPLOAD_PROCESS_URL)` → `CloudTasksQueue`, else `MemoryTaskQueue`.
- [ ] Add config `CLOUD_TASKS_QUEUE`, `CLOUD_TASKS_LOCATION` (default `us-central1`), `CLOUD_TASKS_SERVICE_ACCOUNT`, `UPLOAD_PROCESS_URL` to `src/utils/config.ts`; document in `.env.example` + `docs/ENV.md`.
- [ ] Tests `src/services/tasks/__tests__/cloud-tasks.test.ts` (`vi.mock('@google-cloud/tasks')`): `createTask` called once with correct queue path + OIDC audience; `ALREADY_EXISTS` → `deduplicated: true`, no throw; `index.ts` picks CloudTasks when env set, Memory when unset.
- [ ] Commit `feat(tasks): Cloud Tasks queue with OIDC + dedupe`.

## T4.2 — Internal processing endpoint (OIDC-gated) → STOP GATE 4

`POST /api/upload/process/:uploadId`, callable only by Cloud Tasks via a valid Google OIDC token. Idempotent. Strict (option 1B) — no bypass.

- [ ] Add dep `google-auth-library` (direct) for `OAuth2Client.verifyIdToken`.
- [ ] New file `src/api/middleware/oidc.ts`: `cloudTasksOidc` middleware — extract `Authorization: Bearer <id_token>`; `verifyIdToken({ idToken, audience: config.UPLOAD_PROCESS_URL })`; assert `payload.email === CLOUD_TASKS_SERVICE_ACCOUNT` and `email_verified`; reject → `AuthenticationError`/`AuthorizationError` (401/403). Never falls through to `bearerAuth`. No loopback/dev branch.
- [ ] New file `src/api/upload-process.ts`: router; mount in `src/api/routes.ts` with `cloudTasksOidc` (not `bearerAuth`). Idempotent guard: load upload; terminal state (`completed`/`partial`/`failed`/`cancelled`/`expired`) → 200 no-op. Transition `queued → processing` (CAS) then invoke `processUpload()`.
- [ ] Tests `src/api/__tests__/upload-process.test.ts` (mock `verifyIdToken`): no token / bad audience / wrong SA → 401/403; terminal state → no-op 200, pipeline not called; valid OIDC + `queued` → pipeline invoked, transitions to `processing`.
- [ ] Commit `feat(upload): internal Cloud Tasks processing endpoint (OIDC)`.
- [ ] **STOP GATE 4 (mandatory):** if OIDC cannot be verified/mocked convincingly, stop and report before building T4.3.

## T4.3 — Single-file processing pipeline

Stream object from GCS → SHA-256 verify before extraction → extract → chunk → embed → create document + chunks → record results → terminal state. Single-file only.

- [ ] Port addition: add `createReadStream(objectKey): Readable` to `StorageService` (`src/services/storage/types.ts`); implement in `gcs.ts` (`file().createReadStream()`) and `memory.ts` (`Readable.from(buffer)`).
- [ ] DB addition: add `recordUploadProcessingResult(id, { documentIds, checksumComputed, checksumVerifiedAt, entriesTotal, entriesProcessed, entriesFailed })` to `src/db/uploads.ts` (plain UPDATE, mirrors `recordUploadObjectMetadata`).
- [ ] New error `ChecksumMismatchError` (`CHECKSUM_MISMATCH`, 422) in `src/utils/errors.ts`.
- [ ] New file `src/services/upload-processor.ts`: `processUpload(uploadId)`. Load upload; resolve handler via `isSupportedType(normalized_type)`. Stream from `createReadStream`, piping through `crypto.createHash('sha256')` while accumulating to a Buffer (bounded by `MAX_SINGLE_FILE_SIZE_MB`). If `checksum_expected` set and digest differs → `ChecksumMismatchError`, transition `failed`, no document created. Else `extractText` → `smartChunk` → `createDocument` → `createChunks` → `onDocumentIngested` → `recordUploadProcessingResult` → transition `completed`. Wrap in try/catch → `failed` with a stable code on any error.
- [ ] Tests `src/services/__tests__/upload-processor.test.ts` (mock storage/db/embeddings): assert streaming (consumes a `Readable`, not a buffered `headObject`); `checksum_expected` mismatch → `CHECKSUM_MISMATCH` with zero `createDocument` calls; happy path → document + chunks created, `completed`, `document_ids` persisted; rerun on `completed` → no duplicate document (idempotent).
- [ ] Commit `feat(upload): async single-file processing pipeline`.
- [ ] Document the MVP limitation: the object is buffered in memory (bounded by the single-file cap); streaming extraction + ZIP are Phase 5.

## New surface area summary

- **Deps:** `@google-cloud/tasks`, `google-auth-library` (both direct).
- **Config:** `CLOUD_TASKS_QUEUE`, `CLOUD_TASKS_LOCATION`, `CLOUD_TASKS_SERVICE_ACCOUNT`, `UPLOAD_PROCESS_URL`. (No `UPLOAD_REQUIRE_CHECKSUM` — option 2A.)
- **New files:** `tasks/cloud-tasks.ts`, `api/middleware/oidc.ts`, `api/upload-process.ts`, `services/upload-processor.ts` (+ 3 test files).
- **Edits:** `tasks/index.ts`, `storage/{types,gcs,memory}.ts` (read method), `db/uploads.ts` (result writer), `errors.ts`, `routes.ts`, `config.ts`, `.env.example`, `docs/ENV.md`.
- **Infra (docs only here; provisioning is Phase 7 / maintainer):** Cloud Tasks queue + service account + OIDC IAM; raise Cloud Run request timeout 60s → 600s for the processing path.

## Suggested PR shaping

Each slice is independently mergeable behind config gates (real impls activate only when env is set, so `main` stays safe):

- PR A = T4.1 (Cloud Tasks queue)
- PR B = T4.2 (OIDC endpoint) — stop gate before merge
- PR C = T4.3 (pipeline) — makes a queued upload produce documents end-to-end (mocked)

## Verification

Per slice: `pnpm verify:fast` before each commit; `pnpm verify` before each PR. Pause before each commit/PR for CodeRabbit review (project workflow).
