---
title: Data Import Checklist
description: Guide to common personal data exports you can import into Textrawl
---

# Data Import Checklist

This guide helps you identify personal data exports you can import into Textrawl. Start with the high-value, easy sources and work your way through.

## Quick Start (Recommended First Imports)

These sources offer the best combination of value and ease:

| Source | Format | Difficulty | Why It's Valuable |
|--------|--------|------------|-------------------|
| Gmail | MBOX | Easy | Receipts, confirmations, conversations |
| Google Drive | DOCX/PDF | Easy | Documents, notes, files |
| Obsidian | Markdown | Trivial | Already local files |
| Notion | Markdown | Easy | Notes, wikis, databases |
| Kindle Highlights | TXT/HTML | Easy | Your annotations and insights |

---

## Email Archives

Your email is often your most valuable data source - receipts, confirmations, conversations, and more.

### Gmail / Google Workspace
- **Format:** MBOX (native support)
- **Difficulty:** Easy
- **Time:** 1-48 hours (Google processes the request)
- **Size:** 1-50 GB typical

**How to export:**
1. Go to [Google Takeout](https://takeout.google.com)
2. Deselect all, then select only "Mail"
3. Choose MBOX format
4. Click "Create export" and wait for email notification
5. Download the ZIP file

**Tips:**
- Filter by label to export specific folders
- Large mailboxes may be split into multiple files
- Export can take 1-2 days for large accounts

### Apple Mail / iCloud
- **Format:** MBOX (native support)
- **Difficulty:** Easy
- **Time:** 5-30 minutes

**How to export:**
1. Open Mail app on Mac
2. Select a mailbox in the sidebar
3. Go to Mailbox > Export Mailbox
4. Choose destination folder
5. Repeat for each mailbox

**Tips:**
- Each mailbox exports separately
- Large mailboxes (>2GB) may need splitting
- iCloud mail must be synced locally first

### Outlook / Microsoft 365
- **Format:** PST (needs conversion to MBOX)
- **Difficulty:** Medium
- **Time:** 1-24 hours

**How to export:**
1. Outlook desktop: File > Open & Export > Import/Export
2. Select "Export to a file" > Outlook Data File (.pst)
3. Convert PST to MBOX using `readpst` (Linux) or third-party tools

### Thunderbird
- **Format:** MBOX (native support)
- **Difficulty:** Easy
- **Time:** 5 minutes

Thunderbird stores mail as MBOX by default:
1. Find profile folder (Help > Troubleshooting Information)
2. Copy `.mbox` files from ImapMail or Mail folders

### ProtonMail
- **Format:** EML (native support)
- **Difficulty:** Medium
- **Time:** 30 min - 2 hours

Use ProtonMail Bridge (paid) or official Export Tool to get EML files.

---

## Documents & Notes

### Google Drive
- **Format:** DOCX, PDF, TXT (native support)
- **Difficulty:** Easy
- **Time:** 1-48 hours

**How to export:**
1. Go to [Google Takeout](https://takeout.google.com)
2. Select "Drive"
3. Choose DOCX format for Google Docs
4. Create export

### Notion
- **Format:** Markdown (native support)
- **Difficulty:** Easy
- **Time:** 5-30 minutes

**How to export:**
1. Settings & Members > Settings
2. Scroll to "Export all workspace content"
3. Choose "Markdown & CSV" format
4. Download ZIP file

### Obsidian
- **Format:** Markdown (native support)
- **Difficulty:** Trivial
- **Time:** 1 minute

Your vault is already a folder of Markdown files - just point Textrawl at it.

### Apple Notes
- **Format:** PDF or HTML (partial support)
- **Difficulty:** Medium
- **Time:** 30 min - 2 hours

Options:
1. Export individual notes as PDF (File > Export as PDF)
2. Use [Apple Privacy Portal](https://privacy.apple.com) for bulk export
3. Use third-party "Exporter" app for Markdown

### Roam Research
- **Format:** Markdown (native support)
- **Difficulty:** Easy
- **Time:** 5 minutes

Click three-dot menu > Export All > Markdown format.

### Evernote
- **Format:** ENEX/XML (needs conversion)
- **Difficulty:** Medium
- **Time:** 10-60 minutes

Export as ENEX, then convert to Markdown using [yarle](https://github.com/akosbalasko/yarle) or [evernote2md](https://github.com/wormi4ok/evernote2md).

---

## Chat & Messaging

### WhatsApp
- **Format:** TXT (native support)
- **Difficulty:** Easy
- **Time:** 5-15 min per chat

Open chat > Menu > More > Export chat. Must export each chat individually.

### Slack
- **Format:** JSON (needs conversion)
- **Difficulty:** Hard
- **Time:** 1-24 hours

**Limitations:**
- Free plan: public channels only, 90 days max
- Requires workspace admin access
- Use [slackdump](https://github.com/rusq/slackdump) for personal backup without admin

### Telegram
- **Format:** HTML (partial support)
- **Difficulty:** Easy
- **Time:** 10-60 minutes

Telegram Desktop > Settings > Advanced > Export Telegram Data. Choose HTML format.

### Discord
- **Format:** JSON/HTML (partial support)
- **Difficulty:** Medium
- **Time:** 30 min - 4 hours

Use [DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter) for comprehensive export.

---

## Reading & Highlights

### Kindle Highlights
- **Format:** TXT/HTML (native support)
- **Difficulty:** Easy
- **Time:** 5-10 minutes

**How to export:**
1. Go to [read.amazon.com/notebook](https://read.amazon.com/notebook)
2. View highlights by book
3. Use Bookcision browser extension for bulk export
4. Or copy My Clippings.txt from your Kindle device

### Readwise
- **Format:** Markdown (native support)
- **Difficulty:** Easy
- **Time:** 5 minutes

Dashboard > Export > Markdown. Aggregates highlights from Kindle, articles, podcasts.

### Pocket / Instapaper
- **Format:** HTML/CSV (partial support)
- **Difficulty:** Easy
- **Time:** 5 minutes

Note: Exports are bookmarks/links, not full article content.

---

## Social Media

### Twitter / X
- **Format:** JSON/HTML (partial support)
- **Difficulty:** Easy
- **Time:** 1-24 hours
- **URL:** [twitter.com/settings/download_your_data](https://twitter.com/settings/download_your_data)

### Facebook
- **Format:** JSON/HTML (partial support)
- **Difficulty:** Easy
- **Time:** 1-48 hours
- **URL:** [facebook.com/dyi](https://www.facebook.com/dyi)

### LinkedIn
- **Format:** CSV (partial support)
- **Difficulty:** Easy
- **Time:** 10 min - 24 hours
- **URL:** [linkedin.com/mypreferences/d/download-my-data](https://www.linkedin.com/mypreferences/d/download-my-data)

---

## Journals & Diaries

### Day One
- **Format:** TXT/JSON (native support)
- **Difficulty:** Easy
- **Time:** 5-15 minutes

File > Export > Plain Text or JSON. High-value personal content.

---

## Financial Records

### Bank Statements
- **Format:** PDF (native support)
- **Difficulty:** Easy
- **Time:** 10-30 minutes

Download PDF statements from your bank's website. Great for finding specific purchases.

---

## Supported Formats

### Native Support (upload directly)
- MBOX - Email archives
- EML - Individual emails
- HTML - Web pages
- PDF - Documents
- DOCX - Word documents
- TXT - Plain text
- MD - Markdown
- ZIP - Archives containing above formats

### Needs Conversion
- PST - Convert to MBOX
- ENEX - Convert to Markdown
- JSON - Convert to readable format
- CSV - Varies by source

---

## Priority Order

If you're not sure where to start:

1. **Email** (Gmail, Apple Mail) - Highest coverage of your digital life
2. **Notes** (Obsidian, Notion) - Your own writing and thinking
3. **Highlights** (Kindle, Readwise) - Curated insights from reading
4. **Documents** (Google Drive) - Files and records
5. **Chat** (WhatsApp) - Conversations worth preserving
6. **Everything else** - Based on personal value

---

## Data Portability Rights

Under GDPR, DMA, and CCPA, you have the legal right to export your data from most services. If a service doesn't offer export, you can submit a formal data access request.
