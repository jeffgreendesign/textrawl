# Desktop App

Textrawl Desktop is a cross-platform Electron application for converting files to Markdown and uploading them to your knowledge base.

## Features

- **Drag-and-drop** - Drop files or folders onto the window to start converting
- **Batch processing** - Convert multiple files with progress tracking
- **Direct upload** - Upload converted files to Supabase with one click
- **Persistent settings** - Configuration saved between sessions

## Supported Formats

| Category | Formats |
|----------|---------|
| Email | MBOX, EML |
| Documents | PDF, DOCX, DOC, RTF, ODT, RTFD |
| Spreadsheets | XLSX, XLS, XLSB, CSV, ODS |
| Presentations | PPTX, PPT, ODP |
| Web | HTML |
| Text | TXT, MD, XML, JSON |
| Archives | ZIP (Google Takeout) |

## Quick Start

```bash
cd desktop
npm install
npm run dev      # Development mode with hot reload
```

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Build and run in development mode |
| `npm run dev:vite` | Run Vite dev server only (for renderer) |
| `npm run build` | Build all (main, preload, renderer) |
| `npm run start` | Run production build |
| `npm run pack` | Build unpacked app for testing |
| `npm run dist:mac` | Build macOS DMG installer |
| `npm run typecheck` | Type-check without building |

## Building for Distribution

### macOS

```bash
npm run dist:mac
```

Output: `desktop/release/Textrawl-{version}.dmg`

**Requirements:**
- macOS for code signing (optional but recommended)
- Icon file at `resources/icon.icns`

## Settings

The app stores settings using `electron-store`. Configuration persists between sessions:

| Setting | Description |
|---------|-------------|
| Output Directory | Where converted files are saved |
| Default Tags | Tags applied to all conversions |
| Auto Upload | Upload files immediately after conversion |
| Supabase URL | Your Supabase project URL |
| Supabase Key | Service role key for uploads |

Settings are stored at:
- macOS: `~/Library/Application Support/Textrawl/config.json`

## Architecture

```
desktop/
├── src/
│   ├── main/           # Electron main process
│   │   ├── index.ts    # App entry, window management
│   │   └── services/   # Conversion, upload, settings
│   ├── preload/        # Context bridge (IPC)
│   ├── renderer/       # Preact UI
│   └── shared/         # Types, IPC channels
├── resources/          # Icons, entitlements
└── electron-builder.yml
```

## CLI Alternative

For command-line conversion without the desktop app, see [CLI.md](CLI.md).
