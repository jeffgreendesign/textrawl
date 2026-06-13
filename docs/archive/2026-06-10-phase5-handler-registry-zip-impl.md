# Phase 5 — Handler Registry + Tier 1 + Safe ZIP · Implementation Plan

**Date:** 2026-06-10 · **Status:** Approved scope (parent §11), granular plan not started · **Parent:** [2026-05-31-large-upload-gcs-resumable-plan.md](2026-05-31-large-upload-gcs-resumable-plan.md) §8/§8a/§9/§11

## For an agent with no prior context

Phase 4 is **merged and live in prod**: a queued single-file upload streams from GCS → SHA-256 verify → extract → chunk → embed → document → `completed`. But extraction only handles **pdf/docx/txt/md** (`SUPPORTED_TYPES` in `src/services/processor.ts`), and ZIP isn't processed at all — a queued ZIP fails with `UNSUPPORTED_TYPE`. Phase 5 (a) refactors extraction into a **handler registry** and widens Tier‑1 single‑file support, and (b) adds a **safe, streaming ZIP handler** that turns one ZIP into one document per supported entry. ZIP/large uploads already reach the server via the resumable flow (`/init` accepts `application/zip`); only **processing** rejects them today.

Read parent §8 (registry + tiers), §8a (honest support matrix), §9 (ZIP safety), §7 (config), §4 (error codes) first.

## Decisions

**Resolved:**

- **Partial-success policy = `partial`** (parent §9). Archive-level failures (traversal/bomb/limits/empty) fail the whole ZIP *before* any document is created; once extraction begins, per-entry failures are recorded and the upload ends `partial` (or `completed` if all entries succeed). `partial`/`failed` are already legal `processing→` transitions (`src/db/uploads.ts`).
- **ZIP reader = `unzipper.Open.buffer()`** (already a dep; no new lib). Phase 4 already buffers the whole object in memory (bounded by the verified `size_bytes` ≤ `MAX_UPLOAD_SIZE_MB`), so random-access central-directory reading is available and gives **accurate per-entry uncompressed sizes up front** — essential for enforcing the bomb/size limits *before* decompressing. (True forward-streaming extraction without buffering is a later refinement; out of scope.)

**Open — confirm before T5.2 (this is STOP GATE 5a):**

- **HTML parser dep:** `html-to-text` (purpose-built text extraction, sensible defaults) vs `cheerio` (DOM, more control, heavier). **Recommendation: `html-to-text`.** Pause and confirm before adding.

## Grounding delta — what exists now (post-Phase-4)

- `src/services/processor.ts`: `extractText(buffer, mimetype)`, `validateFileType(buffer, mimetype)`, `isSupportedType(mimetype)`, hardcoded `SUPPORTED_TYPES` = **pdf/docx/txt/md only** (csv/xlsx/json libs present but **not wired**). These three functions are the public surface callers use: `src/api/upload.ts` (direct path fileFilter), `src/api/upload-sessions.ts` (`isAllowedUploadType`), `src/services/upload-processor.ts`.
- `src/services/upload-processor.ts`: `processUpload(uploadId)` — single-file only; resolves mimetype from `declared_mimetype`, guards `isSupportedType`, then `validateFileType` → `extractText` → document. **The ZIP branch is added here.**
- `src/services/storage/types.ts`: `createReadStream(objectKey): Readable` exists (Phase 4) — GCS + memory impls.
- `src/db/uploads.ts`: has `recordUploadProcessingResult(...)` (writes `document_ids` + counts + checksum) and `getUploadStatus` (reads `upload_entries`). **No `upload_entries` writer** — added in T5.3.
- Schema: `upload_entries` table + `upload_entries_uniq (upload_id, entry_path)` unique index already in prod (`scripts/setup-db-uploads.sql`) — the dedupe key for idempotent retries.
- Config: **no `ZIP_MAX_*` keys** in `src/utils/config.ts` — added in T5.3 (defaults from parent §7).
- Deps: `unzipper@0.12`, `xlsx`, `mammoth`, `pdf-parse`, `file-type` present; **HTML parser absent**.
- Error classes (`src/utils/errors.ts`): `UnsupportedFileTypeError` (`UNSUPPORTED_TYPE`, 400) exists; ZIP-specific codes (`ZIP_*`, `UNSUPPORTED_ENTRY`) are **new**.

## T5.1 — File-handler registry + Tier-1 single-file types

Refactor extraction from the hardcoded map into a registry, and wire the already-present csv/xlsx/json parsers. Behaviour for the existing 4 types must not change.

- New `src/services/processor/types.ts`: `FileHandler { key; extensions: string[]; mimeTypes: string[]; sniff?(buf): boolean; extract(buf: Buffer): Promise<string> }`.
- New `src/services/processor/registry.ts`: `register(h)`, `resolveByMime(mime)`, `resolveByExtension(name)`, `resolveForEntry(name, buf)` (extension + magic sniff, folding in the old `validateFileType` check), `isSupportedMime(mime)`, `supportedExtensions()`.
- New `src/services/processor/handlers/`: `text.ts` (txt/md → `buffer.toString('utf-8')`), `pdf.ts` (`pdf-parse`), `docx.ts` (`mammoth`), `csv.ts` + `xlsx.ts` (`xlsx` → sheet_to_csv/txt), `json.ts` (parse → pretty text). One `register()` call per handler in `registry.ts` (or an `index.ts` barrel).
- **Keep `src/services/processor.ts` as the stable façade:** `extractText`/`validateFileType`/`isSupportedType` delegate to the registry. Callers (`upload.ts`, `upload-sessions.ts`, `upload-processor.ts`) stay unchanged.
- **Test-first** `src/services/processor/__tests__/registry.test.ts`: resolves by extension + magic; the original 4 types still extract from fixtures; new csv/xlsx/json extract expected text; unknown type → unresolved. Add a tiny `src/services/processor/__tests__/fixtures/` dir (none today).
- `pnpm verify:fast` → **PAUSE for CodeRabbit** → commit `refactor(processor): file-handler registry + csv/xlsx/json handlers` → PR A.

## T5.2 — HTML handler → STOP GATE 5a

- **🛑 STOP GATE 5a:** confirm the HTML dep (`html-to-text` recommended) before adding it.
- Add the dep; new `src/services/processor/handlers/html.ts` (`.html`/`.htm`, `text/html`) → extracted text (strip scripts/styles/markup).
- Register it; it automatically becomes a valid ZIP entry type too.
- **Test-first**: fixture HTML → expected text (no tags/script content).
- `pnpm verify:fast` → **PAUSE for CodeRabbit** → commit `feat(processor): html handler` → PR B.

## T5.3 — Safe streaming ZIP handler + per-entry results

One ZIP → one document per supported entry, with strict safety. Archive-level failures → `failed` (no documents); per-entry failures → recorded, upload ends `partial`.

- **Config** (`src/utils/config.ts`, parent §7 defaults): `ZIP_MAX_ENTRIES` (2000), `ZIP_MAX_COMPRESSED_BYTES` (= `MAX_UPLOAD_SIZE_MB`*MB), `ZIP_MAX_EXPANDED_BYTES` (2_000_000_000), `ZIP_MAX_ENTRY_BYTES` (50_000_000), `ZIP_MAX_COMPRESSION_RATIO` (100), `ZIP_MAX_FILENAME_LEN` (255). Document in `.env.example` + `docs/ENV.md`.
- **Errors** (`src/utils/errors.ts`): `UnsupportedEntryError` (`UNSUPPORTED_ENTRY`), `ZipPathTraversalError` (`ZIP_PATH_TRAVERSAL`), `ZipBombError` (`ZIP_BOMB`), `ZipTooManyEntriesError` (`ZIP_TOO_MANY_ENTRIES`), `ZipEntryTooLargeError` (`ZIP_ENTRY_TOO_LARGE`), `ZipNestedArchiveError` (`ZIP_NESTED_ARCHIVE`), `ZipNoSupportedEntriesError` (`ZIP_NO_SUPPORTED_ENTRIES`). Codes per parent §4.
- **DB** (`src/db/uploads.ts`): `recordUploadEntry({ uploadId, entryPath, normalizedType, sizeBytes, state, documentId?, errorCode?, errorMessage? })` — `INSERT … ON CONFLICT (upload_id, entry_path) DO UPDATE` so Cloud Task retries don't duplicate rows (mirrors the existing writers' shape).
- **New** `src/services/processor/handlers/archive-zip.ts`: `extractZip(buffer)` using `unzipper.Open.buffer(buffer)`:
  - Read central directory. Enforce `ZIP_MAX_ENTRIES`, `ZIP_MAX_COMPRESSED_BYTES`, total `ZIP_MAX_EXPANDED_BYTES`, and `ZIP_MAX_COMPRESSION_RATIO` (expanded/compressed) **before decompressing** → archive-level throw.
  - Per entry: skip OS junk (`__MACOSX/`, `.DS_Store`, `Thumbs.db`); reject path traversal (`../`, absolute, `C:\`, backslashes), symlinks/non-regular entries, nested archives (`.zip`/`.tar`/`.gz`/`.7z`), filename length > `ZIP_MAX_FILENAME_LEN`, uncompressed size > `ZIP_MAX_ENTRY_BYTES`.
  - Yield `{ entryPath, buffer }` only for entries that resolve to a supported handler (`registry.resolveForEntry`); track skipped/unsupported.
- **Wire into** `src/services/upload-processor.ts`: after computing the ZIP's SHA-256 (existing `readAndHash`) + checksum verify, branch on ZIP mime (`application/zip`, `application/x-zip-compressed`):
  - Archive-level validation throws → transition `failed` with the stable `ZIP_*` code, no documents.
  - Else loop entries: each supported entry → `createDocument` + chunk/embed + `createChunks` + `onDocumentIngested` + `recordUploadEntry(state:'completed', documentId)`; per-entry extract failure → `recordUploadEntry(state:'failed', code)`. Collect `documentIds`.
  - Zero supported entries → `failed` `ZIP_NO_SUPPORTED_ENTRIES`.
  - Else `recordUploadProcessingResult({ documentIds, checksumComputed, entriesTotal, entriesProcessed, entriesFailed })` → transition `completed` (all ok) or `partial` (≥1 failed).
- **Test-first** `src/services/processor/__tests__/archive-zip.test.ts` + `upload-processor` ZIP cases (build ZIPs in-memory with a zip lib or committed fixtures): one doc per supported entry; mixed (good + corrupt) → `partial` + per-entry rows; traversal / bomb (ratio) / too-many / oversized-entry / nested → rejected with the right code, **no documents**; zero-supported → `ZIP_NO_SUPPORTED_ENTRIES`; **idempotent retry** (rerun) → no duplicate `upload_entries` (unique index) and no duplicate documents.
- `pnpm verify:fast` → **PAUSE for CodeRabbit** → commit `feat(processor): safe streaming ZIP handler` → `pnpm verify` → PR C.

## New surface area summary

- **Deps:** an HTML parser (`html-to-text` recommended) — T5.2 only.
- **Config:** `ZIP_MAX_ENTRIES`, `ZIP_MAX_COMPRESSED_BYTES`, `ZIP_MAX_EXPANDED_BYTES`, `ZIP_MAX_ENTRY_BYTES`, `ZIP_MAX_COMPRESSION_RATIO`, `ZIP_MAX_FILENAME_LEN`.
- **New files:** `src/services/processor/{types,registry}.ts`, `handlers/{text,pdf,docx,csv,xlsx,json,html,archive-zip}.ts`, fixtures dir, 3 test files.
- **Edits:** `src/services/processor.ts` (delegate to registry), `src/services/upload-processor.ts` (ZIP branch), `src/db/uploads.ts` (`recordUploadEntry`), `src/utils/errors.ts` (ZIP codes), `config.ts`, `.env.example`, `docs/ENV.md`.
- **No MCP tool-list change** → `tool-sync-check.sh` stays green.

## PR shaping (each independently mergeable; behaviour preserved behind the registry façade)

- **PR A** = T5.1 registry + Tier‑1 (single-file support widens to csv/xlsx/json)
- **PR B** = T5.2 HTML handler — **STOP GATE 5a** before adding the dep
- **PR C** = T5.3 safe ZIP — makes a queued ZIP produce one document per supported entry

## Verification

- Per slice: the named test files, then `pnpm verify:fast` before each commit, `pnpm verify` before each PR. Pause for CodeRabbit before each commit/PR.
- **End-to-end (after PR C merges + deploys):** drive the resumable API (init → GCS PUT → complete → poll) with a real ZIP of mixed supported/unsupported entries; expect `partial` with one document per supported entry and per-entry rows in the status response. (Same direct-API harness used to verify Phase 4; the dashboard can't drive it until Phase 6.)
- **Honesty:** this unblocks the *server* side of ZIP. The dashboard still can't send ZIP/large files until **Phase 6** (resumable client + accept-list + error mapping). Do not advertise ZIP in the UI before Phase 6.
