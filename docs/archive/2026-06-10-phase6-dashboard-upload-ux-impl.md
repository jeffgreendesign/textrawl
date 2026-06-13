# Phase 6 — Dashboard Large-Upload UX · Implementation Plan

**Date:** 2026-06-10 · **Status:** Approved scope (parent §11), granular plan not started · **Parent:** [2026-05-31-large-upload-gcs-resumable-plan.md](2026-05-31-large-upload-gcs-resumable-plan.md) §8a/§10/§11

## For an agent with no prior context

The server's large-upload flow is live (Phase 4: `/init` → browser PUT to GCS → `/complete` → async Cloud Tasks processing → `/status`). But the **dashboard never uses it** — `dashboard/app/upload/page.tsx` still POSTs the whole file to the legacy direct `/api/upload` with `FormData` and **fake progress** (sets 30, then 100). So large files and ZIPs fail in the browser, and errors render as `Upload failed: [object Object]`. Phase 6 makes the dashboard drive the resumable flow for large files, shows **real progress + processing status**, and replaces the over-promising accept list and broken error rendering with honest, readable ones.

Read parent §10 (frontend behaviour) and §8a (support matrix) first.

## Sequencing

Phase 6 depends on **Phase 5 (server ZIP + widened Tier‑1)** for its accept-list to honestly include ZIP/csv/xlsx/json/html. If Phase 5 is not yet merged+deployed, ship Phase 6 with the accept-list limited to the **currently** processable types (pdf/docx/txt/md) and add the rest when Phase 5 lands. The resumable *plumbing* (T6.1) is independent of Phase 5.

## Decisions

**Resolved:**

- **The page is self-contained.** `dashboard/components/upload-zone.tsx` is **not imported anywhere** (dead) — ignore the parent §11/§12 reference to it. All UI work is in `dashboard/app/upload/page.tsx`; all client API work in `dashboard/lib/api.ts`.
- **Root cause of `[object Object]`:** `page.tsx:119` does `body.error || body.message`, but the server returns `{ error: { message, code, statusCode } }` (nested). `body.error` is an object → stringifies to `[object Object]`. The fix reads `body.error.message` / `body.error.code`.

**Open — confirm before T6.1:**

- **Resumable PUT strategy:** **chunked** (e.g. 8 MiB chunks, 256 KiB-aligned, honor GCS `308` + `Range`, in-session resume on transient failure, byte progress per chunk) **vs single-shot PUT** with `XMLHttpRequest` `upload.onprogress`. **Recommendation: chunked** — the original failure was a ~60 MB upload dying mid-flight, which single-shot can't resume. ⚠️ **Prerequisite:** bucket CORS must allow `PUT` + `Content-Range` from the dashboard origin **and expose the `Range` response header** (documented in Phase 3 T3.3 — verify it's actually applied to the bucket before building chunked resume).
- **Threshold source:** a client constant `NEXT_PUBLIC_UPLOAD_THRESHOLD_MB` (default 20, matching server `MAX_SINGLE_FILE_SIZE_MB`) decides direct-vs-resumable *before* any request. **Recommendation: this.** Alternative — always-resumable (simpler, one code path) but loses the snappy synchronous small-file response.

## Grounding delta — what exists now

- `dashboard/app/upload/page.tsx`: self-contained drop zone + per-file state (`pending|uploading|complete|error`) + fake progress; direct `fetch(${apiBase}/upload, FormData)` at line 109; over-promising copy "PDF, DOCX, TXT, MD, HTML, images, audio, MBOX, EML, ZIP" at line 188; file input has **no `accept`**; broken error read at line 119; a working "No server configured" guard at lines 76–95 (keep it).
- `dashboard/lib/api.ts`: `getApiBase()` (respects `localStorage['textrawl_server']` override + `NEXT_PUBLIC_API_URL`), `getServerBase()`, `getWsBase()`, `uploadFile()` (direct path), bearer token from `localStorage['textrawl_token']`. **No resumable client functions.**
- Server contract (from `src/api/upload-sessions.ts`, all bearer-authed except the GCS PUT):
  - `POST /api/upload/init { filename, contentType, size, checksum?, checksumAlgo? }` → `{ uploadId, objectKey, bucket, resumableUri, expiresAt, state, useDirectUpload }`
  - browser `PUT` bytes → `resumableUri` (GCS; `Content-Range`; **no** bearer header)
  - `POST /api/upload/complete { uploadId, checksum? }` → `202 { uploadId, state:'queued', statusUrl }`
  - `GET /api/upload/:uploadId/status` → `{ state, filename, size, progress:{entriesTotal,entriesProcessed,entriesFailed}, documentIds, entries:[{name,state,documentId,code}], error:{code,message}|null, … }`
  - `DELETE /api/upload/:uploadId` → cancel (idempotent; rejects once processing/terminal)

## T6.1 — Resumable client + threshold switch + real progress

- **Client API** (`dashboard/lib/api.ts`): add `initUpload(file, opts)`, `putResumable(resumableUri, file, onProgress)` (chunked; resolves committed offset via `bytes */total` probe on resume), `completeUpload(uploadId, checksum?)`, `getUploadStatus(uploadId)`, `cancelUpload(uploadId)`. Reuse `getApiBase()`/token headers; the GCS PUT sends **no** bearer header.
- **Page flow** (`page.tsx`): per file, if `size ≤ NEXT_PUBLIC_UPLOAD_THRESHOLD_MB` → existing direct `uploadFile`; else **resumable**: `init` → `putResumable` (byte progress drives the bar) → `complete` → **poll `getUploadStatus`** until terminal. Extend the per-file state to `pending → uploading → processing → complete | partial | error`, with a **Retry** control on transient upload errors and a **Cancel** that calls `cancelUpload`. Replace the fake `30/100` with real bytes (upload) then `entriesProcessed/entriesTotal` or a processing spinner (processing).
- **Config:** add `NEXT_PUBLIC_UPLOAD_THRESHOLD_MB` to `dashboard/.env.example` (or document it) + a default constant.
- **Test-first** (dashboard test setup — confirm vitest/RTL config exists; add if missing): mock `lib/api.ts`; small file → direct path; large file → init/put/complete/poll sequence with progress transitions; poll resolves `completed`; a `partial` status surfaces per-entry failures; cancel calls `cancelUpload`.
- `pnpm verify:fast` → **PAUSE for CodeRabbit** → commit `feat(dashboard): resumable large-upload flow with real progress` → PR A.

## T6.2 — Honest support matrix + clear error mapping

- **Accept list + copy** (`page.tsx`): set the file input `accept` and the help copy from §8a **"Supported now"** (with Phase 5 deployed: `.txt,.md,.pdf,.docx,.csv,.xlsx,.json,.html,.htm,.zip`; ZIP labeled "ZIP containing supported document/text files"). Remove images/audio/MBOX/EML from the copy. Source the list from a single constant so it can't drift.
- **Error mapping** (`lib/api.ts` + `page.tsx`): a `parseApiError(res)` helper that reads `{ error: { code, message } }` and maps stable codes → friendly text — `FILE_TOO_LARGE` ("File exceeds the maximum size"), `UNSUPPORTED_TYPE`/`UNSUPPORTED_ENTRY`, `SIZE_MISMATCH`/`OBJECT_NOT_FOUND` ("Upload didn't finish — retry"), `CHECKSUM_MISMATCH`, `UPLOAD_EXPIRED`, `ZIP_*` (traversal/bomb/too-many/oversized/nested → clear messages), plus a network fallback ("Couldn't reach the server"). **Eliminates `[object Object]` and bare `Load failed`.**
- **ZIP MIME normalization:** browsers report ZIP as `application/zip`, `application/x-zip-compressed`, or `''` — normalize client-side (by extension) before `init` so `contentType` is consistent.
- **Test-first:** `parseApiError` maps each code to the expected string; nested-error body no longer yields `[object Object]`; the accept constant matches the §8a "supported now" set.
- `pnpm verify:fast` → **PAUSE for CodeRabbit** → commit `feat(dashboard): honest support matrix + clear upload errors` → `pnpm verify` → PR B.

## New surface area summary

- **Config:** `NEXT_PUBLIC_UPLOAD_THRESHOLD_MB` (dashboard).
- **Edits:** `dashboard/lib/api.ts` (resumable client + `parseApiError`), `dashboard/app/upload/page.tsx` (threshold switch, real progress, status polling, retry/cancel, accept list, error text, ZIP MIME). Possibly delete the dead `dashboard/components/upload-zone.tsx`.
- **No server changes** — Phase 6 is dashboard-only; it consumes the existing Phase 3/4 contract.
- **Infra prerequisite to verify (not code):** bucket CORS allows browser `PUT` + `Content-Range` from the dashboard origin and exposes `Range` (Phase 3 T3.3).

## PR shaping

- **PR A** = T6.1 resumable client + threshold + real progress
- **PR B** = T6.2 honest accept-list + clear errors (depends on A)

## Verification

- Per slice: dashboard tests, then `pnpm verify:fast` / `pnpm verify`; pause for CodeRabbit.
- **Manual E2E (the real proof):** from the deployed dashboard, upload (a) a small `.txt` → direct path still works; (b) a **>threshold** `.pdf` → resumable bar advances by real bytes → processing → "complete"; (c) with Phase 5 live, a **ZIP** of mixed entries → ends "partial" with per-entry results; (d) an unsupported/oversized file → a **readable** error (never `[object Object]` or `Load failed`). Watch `gcloud run services logs read textrawl …` + the Cloud Tasks queue during (b)/(c).
- **CORS check first:** confirm a browser `PUT` with `Content-Range` to the resumable URI succeeds cross-origin from the dashboard origin before relying on chunked resume.
