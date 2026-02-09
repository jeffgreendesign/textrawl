---
title: Desktop Directory Browser & Security Hardening Plan
---

# Desktop Directory Browser & Security Hardening Plan

**Date:** February 8, 2026
**Status:** In Progress

## Progress

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | safeStorage migration | Done |
| 2 | Data model + types | Done |
| 3 | ProjectManager service | Done |
| 4 | IPC layer | Done |
| 5 | Directory tree UI | Done |
| 5.1 | Post-review fixes | Done |
| 6 | chokidar file watching | Done |
| 7 | Pipeline integration | Done |

### Post-review Fixes (Phase 3/4)

- `retryErrors()` now accepts `relativePaths: string[]` parameter, wired through IPC
- Output map keyed by full `source_file` value instead of `basename()` to avoid collisions across directories; lookup uses `findOutputEntry()` with exact-then-basename fallback
- Removed unnecessary `typeof entry === 'string'` type guard in `buildTree()`
- Added `console.error` to silent catch in `buildOutputMap()` directory read
- Added JSDoc to `window` field explaining Phase 6 usage

### Post-review Fixes (Phase 5)

- Replaced empty `.catch(() => {})` on `unloadProject()` teardown with error logging via `console.error` in `ProjectView.tsx`

### Phase 7 Implementation Notes

- `ProjectManager` constructor now receives `ConversionManager`, `UploadManager`, and `SettingsStore` as dependencies (injected from `index.ts`)
- `convertFiles()`: maps `TreeFile[]` → `ScannedFile[]`, pauses watching, delegates to `ConversionManager.startConversion()`, detects failures by diffing the output directory, persists errors via `ProjectStore.setFileError()`, resumes watching
- `uploadConverted()`: pauses watching, delegates to `UploadManager.startUpload()` with outputDir and tags from `SettingsStore`, resumes watching (reloads manifest + reconciles)
- `retryErrors()`: clears stored errors, re-reconciles to determine true status, delegates pending files back to `convertFiles()`
- Added `findFiles()` (bulk tree lookup) and `toScannedFile()` (TreeFile → ScannedFile mapper) private helpers
- Progress/log/completion events flow through existing IPC channels — no new events or duplication

### Resolved Open Questions

1. **Tree virtualization** — Always virtualize (no threshold)
2. **Source-output mapping** — Frontmatter parsing with mtime cache
3. **Multiple projects** — One project at a time
4. **Drag-drop into tree** — Deferred

## Overview

Add a persistent directory browser to the desktop app that shows pipeline status per-file (pending, converted, uploaded, oversized, error), and fix the credential storage security issue. This replaces the current drop-and-forget workflow with a persistent project view.

## Goals

1. **Directory tree view** — Load a source directory, see all files in a hierarchical tree with per-file pipeline status
2. **Status reconciliation** — Cross-reference source files, output `.md` files, and `.manifest.json` to determine each file's status
3. **File watching** — Detect new/changed/deleted files in real-time
4. **Credential security** — Migrate Supabase service key from obfuscated plaintext to OS keychain encryption
5. **Preserve existing workflow** — The drop zone and flat file list remain available; the directory browser is an additional view

## Current Architecture (Reference)

### Desktop Stack

- **Electron 31** (main process, CJS via esbuild)
- **Preact 10** (renderer, Vite)
- **electron-store 8** (settings persistence)
- **p-limit** (concurrency control)

### Key Files

- `desktop/src/main/index.ts` — App lifecycle, IPC handlers
- `desktop/src/main/services/settings-store.ts` — Persistent settings (electron-store)
- `desktop/src/main/services/conversion-manager.ts` — Orchestrates conversions
- `desktop/src/main/services/upload-manager.ts` — Spawns upload CLI subprocess
- `desktop/src/main/services/file-router.ts` — File type detection, size classification
- `desktop/src/main/services/document-processor.ts` — In-process text extraction
- `desktop/src/renderer/App.tsx` — Main UI component, state machine
- `desktop/src/renderer/components/FileList.tsx` — Flat file list with status icons
- `desktop/src/renderer/components/DropZone.tsx` — Drag-drop input
- `desktop/src/shared/types.ts` — Shared TypeScript interfaces
- `desktop/src/shared/ipc-channels.ts` — IPC channel constants
- `desktop/src/preload/index.ts` — Context bridge (electronAPI)
- `scripts/cli/lib/manifest.ts` — ManifestManager class
- `scripts/cli/upload.ts` — Upload pipeline

### Current State Machine

```text
idle → scanning → ready → converting → complete → uploading → complete
```

### Current Pipeline Status Per File

```typescript
type FileStatus = 'pending' | 'processing' | 'complete' | 'error' | 'skipped';
```

This only tracks conversion progress within a single session. There is no cross-session persistence or upload status tracking in the UI.

### Manifest System

- `.manifest.json` in each output directory
- Keyed by `sourceHash` (SHA256 of source content)
- Stores: `sourceHash`, `documentId`, `uploadedAt`, `markdownPath`, `chunksCreated`
- Used by upload CLI to skip already-uploaded files
- Not currently surfaced in the desktop UI

---

## Phase 1: Credential Security (safeStorage Migration) — Done

**Priority:** High — Do this first, independent of the directory browser.

**Commit:** `a835173` on `feat/desktop-directory-browser`

### Problem

`settings-store.ts` line 31 uses `encryptionKey: 'textrawl-desktop-v1'` which is a hardcoded string baked into the app binary. The electron-store docs explicitly state this is obfuscation, not security. The store contains `supabaseKey` (service role key that bypasses all RLS).

Reference: <https://blog.jse.li/posts/electron-store-encryption/>

### Solution

Use Electron's built-in `safeStorage` API (available since Electron 15, well-supported in Electron 31). It delegates to OS keychain:

- **macOS:** Keychain Access
- **Windows:** DPAPI (user-scoped)
- **Linux:** libsecret / kwallet

### Implementation

#### 1.1 Update `settings-store.ts`

Split storage into two layers:

```typescript
import Store from 'electron-store';
import { safeStorage } from 'electron';

// Non-sensitive settings — stored as-is in electron-store
interface PublicSchema {
  outputDir: string;
  defaultTags: string[];
  autoUpload: boolean;
  // Encrypted blobs stored as base64 strings
  _supabaseUrl: string;   // safeStorage-encrypted
  _supabaseKey: string;   // safeStorage-encrypted
}

export class SettingsStore {
  private store: Store<PublicSchema>;

  constructor() {
    this.store = new Store<PublicSchema>({
      name: 'textrawl-settings',
      defaults: {
        outputDir: '',
        defaultTags: [],
        autoUpload: false,
        _supabaseUrl: '',
        _supabaseKey: '',
      },
      // No encryptionKey — non-sensitive fields don't need it,
      // sensitive fields use safeStorage
    });
  }

  private encrypt(value: string): string {
    if (!value) return '';
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('[settings] WARNING: safeStorage not available, storing in plaintext');
      return value;
    }
    return safeStorage.encryptString(value).toString('base64');
  }

  private decrypt(stored: string): string {
    if (!stored) return '';
    if (!safeStorage.isEncryptionAvailable()) {
      // Might be plaintext from fallback or migration
      return stored;
    }
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      // Might be plaintext from pre-migration — return as-is
      return stored;
    }
  }

  get(): AppSettings {
    return {
      outputDir: this.store.get('outputDir'),
      defaultTags: this.store.get('defaultTags'),
      autoUpload: this.store.get('autoUpload'),
      supabaseUrl: this.decrypt(this.store.get('_supabaseUrl')) || undefined,
      supabaseKey: this.decrypt(this.store.get('_supabaseKey')) || undefined,
    };
  }

  set(settings: Partial<AppSettings>): void {
    if (settings.outputDir !== undefined) this.store.set('outputDir', settings.outputDir);
    if (settings.defaultTags !== undefined) this.store.set('defaultTags', settings.defaultTags);
    if (settings.autoUpload !== undefined) this.store.set('autoUpload', settings.autoUpload);
    if (settings.supabaseUrl !== undefined) this.store.set('_supabaseUrl', this.encrypt(settings.supabaseUrl));
    if (settings.supabaseKey !== undefined) this.store.set('_supabaseKey', this.encrypt(settings.supabaseKey));
  }
}
```

#### 1.2 Migration Logic

On first launch after update, detect old-format values and re-encrypt:

```typescript
private migrateFromLegacy(): void {
  // Old store used encryptionKey obfuscation with fields 'supabaseUrl' and 'supabaseKey'
  // Try reading old fields — if they exist, re-encrypt with safeStorage and delete old keys
  const oldStore = new Store({ name: 'textrawl-settings', encryptionKey: 'textrawl-desktop-v1' });
  const oldUrl = oldStore.get('supabaseUrl') as string | undefined;
  const oldKey = oldStore.get('supabaseKey') as string | undefined;

  if (oldUrl || oldKey) {
    if (oldUrl) this.store.set('_supabaseUrl', this.encrypt(oldUrl));
    if (oldKey) this.store.set('_supabaseKey', this.encrypt(oldKey));
    // Delete legacy fields
    oldStore.delete('supabaseUrl');
    oldStore.delete('supabaseKey');
    console.error('[settings] Migrated credentials to safeStorage');
  }
}
```

Call `migrateFromLegacy()` in the constructor after `safeStorage.isEncryptionAvailable()` becomes true (which requires `app.whenReady()`). Since the SettingsStore is instantiated at module scope in `index.ts`, either:

- Move instantiation into the `app.whenReady()` callback, or
- Add a separate `init()` method called after ready

#### 1.3 Startup Warning

If `safeStorage.isEncryptionAvailable()` returns false (rare, mainly headless Linux without a keyring), log a warning and show a one-time dialog:

```typescript
if (!safeStorage.isEncryptionAvailable()) {
  dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Security Warning',
    message: 'No system keychain available. Credentials will be stored without encryption.',
    detail: 'On Linux, install gnome-keyring or kwallet for secure credential storage.',
  });
}
```

#### 1.4 Remove encryptionKey

Remove the `encryptionKey: 'textrawl-desktop-v1'` from the Store constructor entirely. Non-sensitive fields (outputDir, tags, autoUpload) don't need obfuscation.

### Files Changed

- `desktop/src/main/services/settings-store.ts` — Rewrite
- `desktop/src/main/index.ts` — Move SettingsStore init into `app.whenReady()`

### Testing

- Verify settings persist across app restart
- Verify migration from old encrypted format works (manually create old-format config, launch updated app)
- Verify `supabaseKey` is not readable in `~/Library/Application Support/textrawl-desktop/textrawl-settings.json`
- Verify fallback warning on Linux without keyring

---

## Phase 2: Directory Browser — Data Model & State Management

### New Types

Add to `desktop/src/shared/types.ts`:

```typescript
// Pipeline status for a file across sessions
export type PipelineStatus =
  | 'pending'       // Source exists, not yet converted
  | 'converting'    // Conversion in progress (current session only)
  | 'converted'     // .md output exists but not uploaded
  | 'uploading'     // Upload in progress (current session only)
  | 'uploaded'      // In manifest, successfully uploaded to Supabase
  | 'error'         // Last operation failed
  | 'oversized'     // Exceeds size threshold for its type
  | 'unsupported';  // No converter available

// A file in the directory tree
export interface TreeFile {
  // Identity
  relativePath: string;       // Relative to project source dir
  name: string;
  isDirectory: boolean;

  // Detection (from file-router)
  fileType: FileType;
  converterType: ConverterType | null;
  size: number;
  sizeTier: SizeTier;
  sizeWarning?: string;

  // Pipeline state
  pipelineStatus: PipelineStatus;
  convertedPath?: string;     // Relative path to .md in output dir
  documentId?: string;        // Supabase doc ID (from manifest)
  uploadedAt?: string;        // ISO timestamp (from manifest)
  error?: string;             // Last error message
  lastProcessed?: string;     // ISO timestamp of last operation
}

// A loaded project directory
export interface ProjectState {
  sourceDir: string;          // Absolute path to source directory
  outputDir: string;          // Absolute path to output directory
  lastScanned: string;        // ISO timestamp
  stats: {
    total: number;
    pending: number;
    converted: number;
    uploaded: number;
    errors: number;
    oversized: number;
    unsupported: number;
  };
}
```

### State Persistence

Use `electron-store` (separate store instance from settings) to persist:

```typescript
// desktop/src/main/services/project-store.ts
interface ProjectSchema {
  // Most recently loaded project
  lastProject: {
    sourceDir: string;
    outputDir: string;
  } | null;
  // Persisted error states (keyed by relativePath)
  // Only errors are persisted — other states are reconciled from filesystem + manifest
  fileErrors: Record<string, { error: string; lastAttempt: string }>;
}
```

**Why only persist errors?** All other states can be derived:

- `pending` = source file exists, no `.md` output
- `converted` = `.md` output exists in output dir
- `uploaded` = entry exists in `.manifest.json`
- `oversized` = file-router `sizeTier === 'large'`
- `unsupported` = `converterType === null`

Errors need persistence because they represent past failures that aren't observable from filesystem state alone.

### Files to Create

- `desktop/src/main/services/project-store.ts` — New, project state persistence

### Files to Modify

- `desktop/src/shared/types.ts` — Add new types

---

## Phase 3: Project Manager Service

### New Service: `project-manager.ts`

This is the core new service in the main process. It:

1. **Loads a directory** — Recursively scans using existing `file-router.ts` functions
2. **Builds the tree** — Creates hierarchical `TreeFile[]` structure
3. **Reconciles status** — Cross-references source dir, output dir, and manifest
4. **Watches for changes** — Uses chokidar to detect filesystem changes
5. **Emits updates** — Sends tree updates to renderer via IPC

```typescript
// desktop/src/main/services/project-manager.ts

import chokidar from 'chokidar';
import { ManifestManager } from '../../../../scripts/cli/lib/manifest.js';

export class ProjectManager {
  private watcher: chokidar.FSWatcher | null = null;
  private window: BrowserWindow;
  private sourceDir: string;
  private outputDir: string;
  private manifest: ManifestManager | null = null;
  private tree: TreeFile[] = [];

  constructor(window: BrowserWindow) { ... }

  /**
   * Load a source directory and reconcile status
   */
  async loadProject(sourceDir: string, outputDir: string): Promise<ProjectState> { ... }

  /**
   * Build tree from source directory scan
   */
  private async buildTree(sourceDir: string): Promise<TreeFile[]> {
    // Reuse file-router's scanDirectory() for detection
    // But build hierarchical structure instead of flat list
    // Include ALL files, not just convertible ones (mark unsupported)
  }

  /**
   * Reconcile pipeline status for each file
   */
  private async reconcileStatus(tree: TreeFile[]): Promise<void> {
    // For each leaf file in tree:
    // 1. Check sizeTier → if 'large', mark 'oversized'
    // 2. Check converterType → if null, mark 'unsupported'
    // 3. Check output dir for matching .md file → if exists, mark 'converted'
    // 4. Check manifest for sourceHash → if exists, mark 'uploaded'
    // 5. Check persisted errors → if exists, mark 'error'
    // 6. Otherwise → 'pending'
  }

  /**
   * Start watching source + output directories
   */
  private startWatching(): void {
    this.watcher = chokidar.watch(
      [this.sourceDir, this.outputDir],
      {
        followSymlinks: false,
        ignored: /(^|[\/\\])\./,  // Ignore dotfiles (.git, .DS_Store, etc.)
        depth: 20,
        ignoreInitial: true,       // We already scanned
        awaitWriteFinish: {        // Wait for large files to finish writing
          stabilityThreshold: 2000,
          pollInterval: 100,
        },
      },
    );

    this.watcher.on('add', (path) => this.handleFileAdded(path));
    this.watcher.on('unlink', (path) => this.handleFileRemoved(path));
    this.watcher.on('change', (path) => this.handleFileChanged(path));
  }

  /**
   * Stop watching and clean up
   */
  async unloadProject(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
    this.tree = [];
  }

  /**
   * Get current tree (for initial render)
   */
  getTree(): TreeFile[] { return this.tree; }

  /**
   * Refresh — re-reconcile all status
   */
  async refresh(): Promise<void> { ... }

  /**
   * Convert specific files (delegates to ConversionManager)
   */
  async convertFiles(relativePaths: string[]): Promise<void> { ... }

  /**
   * Upload all converted files (delegates to UploadManager)
   */
  async uploadConverted(): Promise<void> { ... }

  /**
   * Retry failed files
   */
  async retryErrors(): Promise<void> { ... }
}
```

### Status Reconciliation Logic (Detail)

The key matching problem: how to link a source file to its converted `.md` output and its manifest entry.

**Source → Converted:** The document processor and CLI converters write `.md` files to the output directory. The filename is derived from the source (e.g., `report.docx` → `report.md`). The frontmatter contains `source_file` and `source_hash`.

**Converted → Uploaded:** The manifest is keyed by `sourceHash`. The frontmatter of each `.md` file contains `source_hash`.

**Reconciliation approach:**

1. Scan output dir for all `.md` files
2. Parse frontmatter of each to extract `source_file` and `source_hash`
3. Build a lookup: `Map<sourceFileName, { convertedPath, sourceHash }>`
4. For each source file in tree:
   - Look up by source filename in the converted map
   - If found, check manifest by sourceHash
   - Set status accordingly

**Performance consideration:** For large directories (1000+ files), parsing all frontmatter on every reconciliation is expensive. Cache the source→converted mapping and only re-parse when the output dir watcher detects changes.

### Manifest Integration

The `ManifestManager` class is in `scripts/cli/lib/manifest.ts` (used by upload CLI). It reads `.manifest.json` from the output directory. For the project manager, import and use it directly — it's a pure Node.js class with no CLI dependencies.

Since the desktop main process is bundled as CJS (esbuild) and ManifestManager uses ESM imports with `.js` extensions, you'll need to either:

- Add `manifest.ts` to the esbuild bundle's entry points, or
- Create a thin wrapper in `desktop/src/main/services/` that re-exports the class

Recommended: Create a local copy or wrapper to avoid coupling the desktop build to the CLI module resolution.

### chokidar Configuration Notes

```typescript
// Security: only watch user-selected directories
// Never watch system paths or follow symlinks outside the tree
chokidar.watch([sourceDir, outputDir], {
  followSymlinks: false,        // Don't traverse into symlinked dirs
  ignored: [
    /(^|[\/\\])\./,             // Dotfiles (.git, .DS_Store, .env, .ssh)
    '**/node_modules/**',        // Never watch node_modules
    '**/.manifest.json',         // Don't react to our own manifest writes
  ],
  depth: 20,                     // Reasonable depth limit
  ignoreInitial: true,           // We do our own initial scan
  persistent: true,              // Keep watching
  awaitWriteFinish: {
    stabilityThreshold: 2000,    // Wait for writes to finish (large files)
    pollInterval: 100,
  },
});
```

### Files to Create

- `desktop/src/main/services/project-manager.ts` — Core service

### Files to Modify

- `desktop/src/main/index.ts` — Add project IPC handlers

---

## Phase 4: IPC Layer

### New IPC Channels

Add to `desktop/src/shared/ipc-channels.ts`:

```typescript
export const IPC = {
  // ... existing channels ...

  // Project channels (invoke)
  PROJECT_LOAD: 'project:load',           // (sourceDir, outputDir) → ProjectState
  PROJECT_UNLOAD: 'project:unload',       // → void
  PROJECT_REFRESH: 'project:refresh',     // → ProjectState
  PROJECT_GET_TREE: 'project:getTree',    // → TreeFile[]
  PROJECT_CONVERT: 'project:convert',     // relativePaths[] → void
  PROJECT_UPLOAD: 'project:upload',       // → void
  PROJECT_RETRY: 'project:retry',         // relativePaths[] → void

  // Project channels (send/events)
  PROJECT_FILE_UPDATE: 'project:fileUpdate',     // TreeFile (single file changed)
  PROJECT_STATS_UPDATE: 'project:statsUpdate',   // ProjectState.stats
} as const;
```

### IPC Handlers in `index.ts`

```typescript
let projectManager: ProjectManager | null = null;

ipcMain.handle(IPC.PROJECT_LOAD, async (_event, sourceDir: string, outputDir: string) => {
  if (!mainWindow) return null;
  projectManager = new ProjectManager(mainWindow);
  return projectManager.loadProject(sourceDir, outputDir);
});

ipcMain.handle(IPC.PROJECT_UNLOAD, async () => {
  await projectManager?.unloadProject();
  projectManager = null;
});

ipcMain.handle(IPC.PROJECT_GET_TREE, async () => {
  return projectManager?.getTree() ?? [];
});

// ... etc
```

### Preload Bridge

Add corresponding methods to `desktop/src/preload/index.ts`:

```typescript
// Project management
loadProject: (sourceDir: string, outputDir: string): Promise<ProjectState | null> =>
  ipcRenderer.invoke(IPC.PROJECT_LOAD, sourceDir, outputDir),

unloadProject: (): Promise<void> =>
  ipcRenderer.invoke(IPC.PROJECT_UNLOAD),

getProjectTree: (): Promise<TreeFile[]> =>
  ipcRenderer.invoke(IPC.PROJECT_GET_TREE),

refreshProject: (): Promise<ProjectState | null> =>
  ipcRenderer.invoke(IPC.PROJECT_REFRESH),

convertFiles: (paths: string[]): Promise<void> =>
  ipcRenderer.invoke(IPC.PROJECT_CONVERT, paths),

uploadConverted: (): Promise<void> =>
  ipcRenderer.invoke(IPC.PROJECT_UPLOAD),

retryFiles: (paths: string[]): Promise<void> =>
  ipcRenderer.invoke(IPC.PROJECT_RETRY, paths),

// Event listeners
onFileUpdate: (callback: (file: TreeFile) => void) => { ... },
onStatsUpdate: (callback: (stats: ProjectState['stats']) => void) => { ... },
```

### Files to Modify

- `desktop/src/shared/ipc-channels.ts` — Add project channels
- `desktop/src/main/index.ts` — Add project IPC handlers
- `desktop/src/preload/index.ts` — Add project bridge methods

---

## Phase 5: Directory Tree UI

### New Dependency

```bash
cd desktop && pnpm add @headless-tree/core @headless-tree/react
```

**Why headless-tree:**

- Headless — you own all rendering, no Preact compat issues
- Framework-agnostic core with React binding (works with preact/compat)
- Virtualized — handles large directories
- Drag-and-drop, keybindings, search, rename built in
- Actively maintained (successor to react-complex-tree, by same author)
- <https://github.com/lukasbach/headless-tree>

**Why NOT react-arborist:**

- React-specific, requires heavier preact/compat bridging
- Not framework-agnostic

**Why NOT MUI X Tree View:**

- Known Preact compatibility issues (<https://github.com/preactjs/preact/issues/3395>)
- Pulls in all of MUI as a dependency

### New Component: `DirectoryTree.tsx`

```typescript
// desktop/src/renderer/components/DirectoryTree.tsx

import { useTree } from '@headless-tree/react';

interface DirectoryTreeProps {
  tree: TreeFile[];
  onConvert: (paths: string[]) => void;
  onRetry: (paths: string[]) => void;
  selectedPaths: Set<string>;
  onSelectionChange: (paths: Set<string>) => void;
}

export function DirectoryTree({ tree, onConvert, onRetry, selectedPaths, onSelectionChange }: DirectoryTreeProps) {
  // Build headless-tree data provider from TreeFile[]
  // Custom node renderer with:
  //   - Folder expand/collapse
  //   - File type icon (reuse FILE_ICONS from FileList.tsx)
  //   - Pipeline status indicator (colored dot/icon)
  //   - Size warning badge
  //   - Right-click context menu (convert, retry, show in finder)
}
```

### Custom Node Renderer

Each tree node renders:

```text
[expand] [type-icon] filename.ext                    [size] [status-badge]
```

Status badge colors/icons:

```text
pending      →  ○  (gray)       — Ready to convert
converting   →  ◐  (yellow)     — In progress (animated)
converted    →  ◑  (blue)       — Ready to upload
uploading    →  ◐  (blue)       — Upload in progress
uploaded     →  ●  (green)      — Complete
error        →  ✗  (red)        — Failed (hover for message)
oversized    →  ▲  (orange)     — Exceeds size limit
unsupported  →  −  (dim gray)   — No converter available
```

### Stats Bar Component

```typescript
// desktop/src/renderer/components/ProjectStats.tsx

// Horizontal bar showing counts: 42 pending · 15 converted · 28 uploaded · 3 errors · 2 oversized
// Click a status to filter the tree to only show files with that status
```

### Action Bar Component

```typescript
// desktop/src/renderer/components/ProjectActions.tsx

// Buttons contextual to current state:
// - "Convert All Pending" (when pending > 0)
// - "Convert Selected" (when files selected)
// - "Upload All Converted" (when converted > 0)
// - "Retry Failed" (when errors > 0)
// - "Refresh" (always)
```

### Updated App Layout

The App.tsx state machine gains a new top-level mode:

```typescript
type AppMode = 'dropzone' | 'project';
```

- **dropzone mode** (default) — Current behavior: drop files, convert, upload, done
- **project mode** — New: load a directory, see tree, persistent status

The user switches modes via a toggle or by using "Open Project Directory" from the menu/settings.

```text
┌─────────────────────────────────────────────────┐
│  Textrawl                    [Drop Zone] [Project]│
├─────────────────────────────────────────────────┤
│  Source: ~/Documents          Output: ~/textrawl  │
│  42 pending · 15 converted · 28 uploaded · 3 err  │
├─────────────────────────────────────────────────┤
│  ▸ 📁 Mail/                                       │
│  ▾ 📁 Documents/                                  │
│    ✅ notes.pdf                     1.2MB  ●      │
│    ⬚ report.docx                   340KB  ○      │
│    ❌ corrupt.pdf                    89KB  ✗      │
│    ⚠️ huge-export.xlsx              45MB  ▲      │
│  ▸ 📁 Web/                                        │
├─────────────────────────────────────────────────┤
│  [Convert All Pending]  [Upload Converted]         │
│  [Retry Failed (3)]                                │
├─────────────────────────────────────────────────┤
│  ▾ Logs                                           │
│    ...                                             │
└─────────────────────────────────────────────────┘
```

### Files to Create

- `desktop/src/renderer/components/DirectoryTree.tsx` — Tree view component
- `desktop/src/renderer/components/ProjectStats.tsx` — Status summary bar
- `desktop/src/renderer/components/ProjectActions.tsx` — Contextual action buttons
- `desktop/src/renderer/components/ProjectView.tsx` — Container for project mode

### Files to Modify

- `desktop/src/renderer/App.tsx` — Add project mode toggle and routing
- `desktop/src/renderer/styles.css` — Tree view styles, status badge styles

---

## Phase 6: File Watching Integration

### chokidar Dependency

```bash
cd desktop && pnpm add chokidar@^5
```

**chokidar v5** (released November 2025):

- ESM-only — main process is CJS bundled by esbuild, so add `chokidar` to esbuild externals
- Requires Node 20+ — project requires Node 22+, so compatible
- Zero dependencies (aside from Node's built-in `fs.watch`)
- <https://github.com/paulmillr/chokidar>

**Update esbuild config** in `desktop/package.json`:

```diff
"build:main": "esbuild src/main/index.ts --bundle --platform=node --target=node20 --outfile=dist/main/index.js --format=cjs --external:electron --external:electron-store
+ --external:chokidar
  ..."
```

Since chokidar v5 is ESM-only and the main process bundle is CJS, it must be externalized and loaded at runtime from node_modules (same pattern used for electron-store, pdf-parse, etc.). The `desktop/.npmrc` has `shamefully-hoist=true` which ensures it's available.

### Watch Event Handling

```typescript
// In ProjectManager

private handleFileAdded(absolutePath: string): void {
  const relativePath = path.relative(this.sourceDir, absolutePath);

  // Is this in the source dir or output dir?
  if (absolutePath.startsWith(this.sourceDir)) {
    // New source file — route it, reconcile status, emit update
    const { type, converterType } = routeFile(absolutePath);
    if (type === 'unknown') return;
    // Build TreeFile, reconcile, emit PROJECT_FILE_UPDATE
  } else if (absolutePath.startsWith(this.outputDir)) {
    // New output file — a conversion completed
    // Find matching source file, update status to 'converted'
    // Re-read manifest in case upload happened externally
  }
}

private handleFileRemoved(absolutePath: string): void {
  if (absolutePath.startsWith(this.sourceDir)) {
    // Source file deleted — remove from tree, emit update
  } else if (absolutePath.startsWith(this.outputDir)) {
    // Output file deleted — revert matching source to 'pending'
  }
}

private handleFileChanged(absolutePath: string): void {
  if (absolutePath.startsWith(this.outputDir) && basename(absolutePath) === '.manifest.json') {
    // Manifest changed (e.g., upload CLI wrote to it)
    // Re-reconcile all status
    this.manifest = new ManifestManager(this.outputDir);
    this.reconcileStatus(this.tree);
    this.emitFullUpdate();
  }
}
```

### Debouncing

Chokidar can fire many events in rapid succession (especially during conversion of many files). Debounce updates to the renderer:

```typescript
private pendingUpdates: Map<string, TreeFile> = new Map();
private updateTimer: NodeJS.Timeout | null = null;

private queueUpdate(file: TreeFile): void {
  this.pendingUpdates.set(file.relativePath, file);
  if (!this.updateTimer) {
    this.updateTimer = setTimeout(() => this.flushUpdates(), 200);
  }
}

private flushUpdates(): void {
  this.updateTimer = null;
  const updates = Array.from(this.pendingUpdates.values());
  this.pendingUpdates.clear();

  // Batch send to renderer
  this.window.webContents.send(IPC.PROJECT_FILE_UPDATE, updates);
  this.emitStatsUpdate();
}
```

### Lifecycle

- **Start watching** when a project is loaded (`loadProject()`)
- **Stop watching** when project is unloaded or window closes
- **Pause watching** during active conversion/upload (to avoid reacting to our own writes)
- **Resume watching** after conversion/upload completes

---

## Phase 7: Integration with Existing Pipeline

### Conversion Integration

When the user clicks "Convert" from the project view, the flow is:

1. User selects files in tree (or "Convert All Pending")
2. Renderer calls `electronAPI.convertFiles(relativePaths)`
3. Main process:
   a. Pauses chokidar watcher
   b. Maps relativePaths to ScannedFile[] (already have this data in the tree)
   c. Calls existing `conversionManager.startConversion(files, options)`
   d. Listens for completion, updates tree status
   e. Resumes chokidar watcher
4. Progress events flow through existing IPC channels (PROGRESS, LOG)
5. On completion, reconcile affected files' status

### Upload Integration

Same pattern:

1. User clicks "Upload All Converted"
2. Main process calls existing `uploadManager.startUpload(options)`
3. On completion, reload manifest, reconcile status
4. Tree updates automatically via reconciliation

### Error Recovery

For files with `error` status:

- Store the error message in `project-store` (persisted via electron-store)
- Display error on hover/click in tree
- "Retry" re-queues the file for conversion or upload depending on where it failed
- On successful retry, clear the persisted error

---

## Implementation Order

```text
Phase 1: safeStorage migration          (standalone, do first)
Phase 2: Data model + types             (foundation)
Phase 3: ProjectManager service         (core logic)
Phase 4: IPC layer                      (connect main ↔ renderer)
Phase 5: Directory tree UI              (visible result)
Phase 6: chokidar file watching         (real-time updates)
Phase 7: Pipeline integration           (connect to convert/upload)
```

Phases 2-4 can be developed together. The tree UI (5) can start in parallel with the service layer (3) using mock data. File watching (6) layers on after the basic tree works, and pipeline integration (7) ties everything together.

## Dependencies to Add

```bash
# In desktop/
pnpm add chokidar@^5 @headless-tree/core @headless-tree/react
```

Existing dependencies that will be reused:

- `electron-store` (already installed) — project state persistence
- `p-limit` (already installed) — concurrency control
- `electron` safeStorage API (built-in, no install needed)

## Build Configuration Changes

Update `desktop/package.json` esbuild command to externalize chokidar:

```diff
"build:main": "esbuild src/main/index.ts --bundle --platform=node --target=node20
  --outfile=dist/main/index.js --format=cjs
  --external:electron --external:electron-store --external:pdf-parse
  --external:mammoth --external:xlsx --external:csv-parse --external:rtf-parser
- --external:unzipper --external:gray-matter --external:fast-xml-parser"
+ --external:unzipper --external:gray-matter --external:fast-xml-parser
+ --external:chokidar"
```

## Security Considerations

1. **Credentials** — Phase 1 migrates to OS keychain via safeStorage
2. **chokidar scope** — Only watches user-selected directories, no symlink following, dotfiles ignored
3. **State files** — `project-store` contains file paths and error messages only, no file content or credentials
4. **Manifest** — Already plaintext on disk, no change in security posture
5. **Tree data in renderer** — File paths are sent to renderer via IPC; this is acceptable since the renderer is sandboxed and the user already has filesystem access

## Open Questions

1. **Tree virtualization threshold** — At what file count should we enable virtualization? headless-tree supports it out of the box, but it adds complexity. Suggest: always virtualize (no downside for small trees, required for large ones).

2. **Source ↔ Output mapping** — The cleanest mapping relies on parsing frontmatter `source_file` from each `.md`. For the initial scan this means reading potentially hundreds of files. Alternative: maintain a separate mapping file in the output dir alongside `.manifest.json`. Suggest: frontmatter parsing with caching (only re-parse when output file mtime changes).

3. **Multiple projects** — Should the app support multiple loaded project directories simultaneously? Suggest: start with one project at a time, add multi-project later if needed.

4. **Drag-drop into tree** — Should users be able to drag files from Finder into the tree to add them to the source directory? Suggest: defer this — it's a file management feature, not a conversion feature.
