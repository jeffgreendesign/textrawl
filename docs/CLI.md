# CLI Conversion Tools

Textrawl includes CLI tools for converting various file formats to Markdown, then uploading them to your knowledge base.

## Quick Start

```bash
# Convert files
npm run convert -- mbox ~/Mail/archive.mbox
npm run convert -- html ./saved-pages/

# Upload to Supabase
npm run upload -- ./converted/emails
```

## Table of Contents

- [Unified Converter](#unified-converter)
- [Format-Specific Commands](#format-specific-commands)
  - [MBOX (Email Archives)](#mbox-email-archives)
  - [EML (Individual Emails)](#eml-individual-emails)
  - [HTML (Web Pages)](#html-web-pages)
  - [Google Takeout](#google-takeout)
- [Upload Utility](#upload-utility)
- [Web UI](#web-ui)
- [Output Format](#output-format)

## Unified Converter

The main entry point for all conversions:

```bash
npm run convert -- <command> <path> [options]
```

**Commands:**
| Command | Description |
|---------|-------------|
| `mbox <file>` | Convert MBOX email archive |
| `eml <path>` | Convert EML file(s) or directory |
| `html <path>` | Convert HTML file(s) or directory |
| `takeout <path>` | Convert Google Takeout archive |
| `auto <path>` | Auto-detect format and convert |

**Common Options:**
| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <dir>` | `./converted` | Output directory |
| `-v, --verbose` | `false` | Enable verbose logging |
| `--dry-run` | `false` | Preview without writing files |
| `-t, --tags <tags...>` | `[]` | Additional tags to add |

## Format-Specific Commands

### MBOX (Email Archives)

Convert MBOX email archive files (e.g., Gmail exports, Thunderbird backups).

```bash
npm run convert -- mbox <file> [options]

# Examples
npm run convert -- mbox ~/Mail/archive.mbox
npm run convert -- mbox inbox.mbox -o ./emails --date-folders
npm run convert -- mbox archive.mbox --from-filter "important@" --tags work
```

**Options:**
| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <dir>` | `./converted/emails` | Output directory |
| `--date-folders` | `true` | Organize by YYYY-MM folders |
| `--keep-signatures` | `false` | Preserve email signatures |
| `--extract-attachments` | `false` | Extract attachments to subdirectory |
| `--raw` | `false` | Preserve raw text without normalization |
| `--max-emails <n>` | unlimited | Maximum emails to process |
| `--from-filter <regex>` | - | Filter by sender (regex pattern) |
| `--date-after <date>` | - | Only emails after date (ISO 8601) |
| `--date-before <date>` | - | Only emails before date (ISO 8601) |

### EML (Individual Emails)

Convert individual EML files or a directory of EML files.

```bash
npm run convert -- eml <path> [options]

# Examples
npm run convert -- eml message.eml
npm run convert -- eml ./email-folder/ -o ./converted/emails
```

**Options:**
| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <dir>` | `./converted/emails` | Output directory |
| `--date-folders` | `true` | Organize by YYYY-MM folders |
| `--keep-signatures` | `false` | Preserve email signatures |
| `--extract-attachments` | `false` | Extract attachments |
| `--raw` | `false` | Preserve raw text |

### HTML (Web Pages)

Convert HTML files to Markdown with metadata extraction.

```bash
npm run convert -- html <path> [options]

# Examples
npm run convert -- html page.html
npm run convert -- html ./saved-pages/ -r --clean-boilerplate
npm run convert -- html article.html --url-base "https://example.com"
```

**Options:**
| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <dir>` | `./converted/web` | Output directory |
| `-r, --recursive` | `false` | Process directories recursively |
| `--clean-boilerplate` | `true` | Remove nav, footer, ads, etc. |
| `--extract-images` | `false` | Extract and save images |
| `--url-base <url>` | - | Base URL for relative links |
| `--raw` | `false` | Preserve raw text |

### Google Takeout

Convert Google Takeout archives (ZIP files containing your exported Google data).

```bash
npm run convert -- takeout <path> [options]

# Examples
npm run convert -- takeout takeout.zip
npm run convert -- takeout ./Takeout/ --types youtube calendar
```

**Supported Data Types:**
- `youtube` - Watch history, liked videos
- `calendar` - Events from Google Calendar
- `contacts` - Google Contacts
- `mail` - Gmail messages

**Options:**
| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <dir>` | `./converted/takeout` | Output directory |
| `--types <types...>` | `youtube,calendar,contacts` | Types to process |
| `--youtube-history` | `true` | Include watch history |
| `--youtube-likes` | `true` | Include liked videos |
| `--calendar-name <name>` | - | Filter by calendar name |
| `--contacts-only-email` | `false` | Only contacts with email |

## Upload Utility

Upload converted Markdown files to Supabase with automatic chunking and embedding generation.

```bash
npm run upload -- <directory> [options]

# Examples
npm run upload -- ./converted/emails
npm run upload -- ./converted/ -r --force
npm run upload -- ./converted/web --concurrency 10
```

**Options:**
| Option | Default | Description |
|--------|---------|-------------|
| `-r, --recursive` | `true` | Process subdirectories |
| `--force` | `false` | Re-upload even if already in manifest |
| `--concurrency <n>` | `5` | Parallel document processing |
| `--batch-size <n>` | `50` | Embeddings per batch |
| `--pattern <glob>` | `**/*.md` | Glob pattern for files |
| `-c, --config <path>` | `.env` | Path to .env file |

**Requirements:**
- `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` must be configured
- Embedding provider (OpenAI or Ollama) must be configured

**Manifest Tracking:**
The upload utility creates a `.manifest.json` file in each directory to track which files have been uploaded. This prevents duplicate uploads on subsequent runs. Use `--force` to re-upload files.

## Web UI

A drag-and-drop web interface for file conversion (development tool).

```bash
npm run ui
# Opens at http://localhost:3001
```

**Features:**
- Drag-and-drop file upload
- Real-time conversion progress
- Auto-upload option after conversion
- Supports MBOX, EML, ZIP (Takeout), HTML

**Environment:**
| Variable | Default | Description |
|----------|---------|-------------|
| `UI_PORT` | `3001` | Web UI port |

## Output Format

Converted files are saved as Markdown with YAML frontmatter:

```markdown
---
title: "Email Subject or Page Title"
source_type: email
source_hash: "abc123..."
tags:
  - imported
  - email
created_at: "2024-01-15T10:30:00Z"
converted_at: "2024-03-20T14:22:00Z"
metadata:
  from: "sender@example.com"
  to: "recipient@example.com"
---

# Email Subject

Email or document content here...
```

**Frontmatter Fields:**
| Field | Description |
|-------|-------------|
| `title` | Document title |
| `source_type` | `email`, `web`, `youtube`, `calendar`, `contact` |
| `source_hash` | Hash for deduplication |
| `tags` | Array of tags |
| `created_at` | Original creation date |
| `converted_at` | Conversion timestamp |
| `metadata` | Format-specific metadata |

The `source_hash` is required for the upload utility to track uploaded files and prevent duplicates.
