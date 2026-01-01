#!/usr/bin/env npx tsx
/**
 * Google Takeout Converter
 *
 * Converts Google Takeout archives to markdown files with YAML front matter
 * Supports: YouTube history, Calendar events, Contacts, Mail (MBOX)
 *
 * Usage:
 *   npm run convert:takeout -- <takeout.zip> [options]
 *   npx tsx scripts/cli/converters/takeout.ts <takeout.zip> [options]
 */

import { createHash } from 'crypto';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmSync,
} from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';
// @ts-ignore - unzipper types
import * as unzipper from 'unzipper';
import { createReadStream } from 'fs';

import { createBaseCommand, addTakeoutOptions, type TakeoutOptions } from '../lib/args.js';
import { createFrontmatter, serializeFrontmatter } from '../lib/frontmatter.js';
import { slugify } from '../lib/normalizer.js';
import { ProgressReporter, logger } from '../lib/progress.js';
import type {
  ConversionResult,
  YouTubeMetadata,
  CalendarMetadata,
  ContactMetadata,
} from '../lib/types.js';

const execAsync = promisify(exec);

/**
 * YouTube watch history entry from Takeout JSON
 */
interface YouTubeWatchEntry {
  header: string;
  title: string;
  titleUrl?: string;
  time: string;
  subtitles?: Array<{ name: string; url?: string }>;
  details?: Array<{ name: string }>;
  products?: string[];
}

/**
 * Extract ZIP file to temporary directory
 */
async function extractZip(zipPath: string): Promise<string> {
  const tempDir = join(tmpdir(), `takeout-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  logger.info(`Extracting to ${tempDir}...`);

  await new Promise<void>((resolve, reject) => {
    createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: tempDir }))
      .on('close', resolve)
      .on('error', reject);
  });

  return tempDir;
}

/**
 * Find Takeout data directories
 */
function findTakeoutDirs(extractedPath: string): {
  youtube?: string;
  calendar?: string;
  contacts?: string;
  mail?: string;
} {
  const result: ReturnType<typeof findTakeoutDirs> = {};

  // Common Takeout folder names (may vary by language)
  const patterns = {
    youtube: ['YouTube and YouTube Music', 'YouTube', 'YouTube Music'],
    calendar: ['Calendar', 'Google Calendar'],
    contacts: ['Contacts', 'Google Contacts'],
    mail: ['Mail', 'Gmail'],
  };

  function searchDir(dir: string): void {
    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          // Check for known patterns
          for (const [type, names] of Object.entries(patterns)) {
            if (names.some((n) => entry.includes(n))) {
              result[type as keyof typeof result] = fullPath;
            }
          }

          // Recurse into subdirectories (but not too deep)
          if (fullPath.split('/').length < extractedPath.split('/').length + 4) {
            searchDir(fullPath);
          }
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  searchDir(extractedPath);
  return result;
}

/**
 * Convert YouTube watch history
 */
async function convertYouTubeHistory(
  youtubeDir: string,
  outputDir: string,
  options: TakeoutOptions
): Promise<{ success: number; error: number }> {
  let successCount = 0;
  let errorCount = 0;

  // Find watch history file
  const historyPaths = [
    join(youtubeDir, 'history', 'watch-history.json'),
    join(youtubeDir, 'watch-history.json'),
  ];

  let historyPath: string | undefined;
  for (const p of historyPaths) {
    if (existsSync(p)) {
      historyPath = p;
      break;
    }
  }

  if (!historyPath) {
    logger.warn('YouTube watch history not found');
    return { success: 0, error: 0 };
  }

  logger.info(`Processing YouTube watch history from ${historyPath}`);

  const historyData = JSON.parse(readFileSync(historyPath, 'utf-8')) as YouTubeWatchEntry[];
  const youtubeOutputDir = join(outputDir, 'youtube');
  mkdirSync(youtubeOutputDir, { recursive: true });

  for (const entry of historyData) {
    try {
      // Skip non-video entries
      if (!entry.titleUrl || !entry.titleUrl.includes('watch?v=')) {
        continue;
      }

      // Extract video ID
      const videoIdMatch = entry.titleUrl.match(/[?&]v=([^&]+)/);
      const videoId = videoIdMatch ? videoIdMatch[1] : 'unknown';

      // Parse watch time
      const watchedAt = new Date(entry.time);
      const dateStr = watchedAt.toISOString().split('T')[0];

      // Extract channel info
      const channelName = entry.subtitles?.[0]?.name || 'Unknown Channel';

      // Build metadata
      const metadata: YouTubeMetadata = {
        video_id: videoId,
        channel_name: channelName,
        channel_id: undefined,
        watched_at: watchedAt.toISOString(),
        raw_data: entry as unknown as Record<string, unknown>,
      };

      // Generate source hash
      const hashInput = `${videoId}-${entry.time}`;
      const sourceHash = createHash('sha256').update(hashInput).digest('hex');

      // Create front matter
      const title = entry.title.replace('Watched ', '');
      const frontmatter = createFrontmatter({
        title: `Watched: ${title}`,
        sourceType: 'file',
        contentType: 'youtube',
        sourceFile: historyPath,
        sourceHash: `sha256:${sourceHash}`,
        createdAt: watchedAt,
        tags: ['imported', 'youtube', 'watched'],
        metadata: metadata as unknown as Record<string, unknown>,
      });

      // Create content
      const content = `# ${title}

- **Channel**: ${channelName}
- **Watched**: ${watchedAt.toLocaleDateString()} at ${watchedAt.toLocaleTimeString()}
- **Link**: ${entry.titleUrl}
`;

      // Generate output path
      const slug = slugify(title, 40);
      const outputPath = join(youtubeOutputDir, `${dateStr}-${slug}.md`);

      // Write file
      if (!options.dryRun) {
        const output = serializeFrontmatter(frontmatter, content);
        writeFileSync(outputPath, output);
      }

      successCount++;
    } catch (error) {
      errorCount++;
      if (options.verbose) {
        logger.error(`Failed to convert YouTube entry: ${error}`);
      }
    }
  }

  return { success: successCount, error: errorCount };
}

/**
 * Convert Calendar events from ICS files
 */
async function convertCalendar(
  calendarDir: string,
  outputDir: string,
  options: TakeoutOptions
): Promise<{ success: number; error: number }> {
  let successCount = 0;
  let errorCount = 0;

  // Find ICS files
  const icsFiles: string[] = [];

  function findIcs(dir: string): void {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          findIcs(fullPath);
        } else if (entry.endsWith('.ics')) {
          // Filter by calendar name if specified
          if (options.calendarName) {
            if (!entry.includes(options.calendarName)) {
              continue;
            }
          }
          icsFiles.push(fullPath);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  findIcs(calendarDir);

  if (icsFiles.length === 0) {
    logger.warn('No calendar files found');
    return { success: 0, error: 0 };
  }

  logger.info(`Found ${icsFiles.length} calendar file(s)`);

  const calendarOutputDir = join(outputDir, 'calendar');
  mkdirSync(calendarOutputDir, { recursive: true });

  for (const icsFile of icsFiles) {
    try {
      const icsContent = readFileSync(icsFile, 'utf-8');
      const calendarName = basename(icsFile, '.ics');

      // Simple ICS parsing (basic VEVENT extraction)
      const events = parseIcsEvents(icsContent);

      for (const event of events) {
        try {
          const metadata: CalendarMetadata = {
            event_id: event.uid || createHash('md5').update(JSON.stringify(event)).digest('hex'),
            calendar_name: calendarName,
            start_time: event.dtstart || '',
            end_time: event.dtend || event.dtstart || '',
            location: event.location,
            attendees: event.attendees,
            recurrence: event.rrule,
            status: event.status as CalendarMetadata['status'],
            raw_ics: event.raw,
          };

          const startDate = new Date(event.dtstart || Date.now());
          const dateStr = startDate.toISOString().split('T')[0];

          // Generate source hash
          const sourceHash = createHash('sha256')
            .update(metadata.event_id)
            .digest('hex');

          // Create front matter
          const frontmatter = createFrontmatter({
            title: event.summary || 'Untitled Event',
            sourceType: 'file',
            contentType: 'calendar',
            sourceFile: icsFile,
            sourceHash: `sha256:${sourceHash}`,
            createdAt: startDate,
            tags: ['imported', 'calendar', calendarName.toLowerCase()],
            metadata: metadata as unknown as Record<string, unknown>,
          });

          // Create content
          let content = `# ${event.summary || 'Untitled Event'}\n\n`;
          content += `- **When**: ${startDate.toLocaleDateString()} ${startDate.toLocaleTimeString()}\n`;
          if (event.location) {
            content += `- **Location**: ${event.location}\n`;
          }
          if (event.attendees && event.attendees.length > 0) {
            content += `- **Attendees**: ${event.attendees.join(', ')}\n`;
          }
          if (event.description) {
            content += `\n## Description\n\n${event.description}\n`;
          }

          // Generate output path
          const slug = slugify(event.summary || 'event', 40);
          const outputPath = join(calendarOutputDir, `${dateStr}-${slug}.md`);

          // Write file
          if (!options.dryRun) {
            const output = serializeFrontmatter(frontmatter, content);
            writeFileSync(outputPath, output);
          }

          successCount++;
        } catch (error) {
          errorCount++;
          if (options.verbose) {
            logger.error(`Failed to convert event: ${error}`);
          }
        }
      }
    } catch (error) {
      errorCount++;
      logger.error(`Failed to parse calendar file ${icsFile}: ${error}`);
    }
  }

  return { success: successCount, error: errorCount };
}

/**
 * Simple ICS event parser
 */
interface IcsEvent {
  uid?: string;
  summary?: string;
  description?: string;
  dtstart?: string;
  dtend?: string;
  location?: string;
  attendees?: string[];
  rrule?: string;
  status?: string;
  raw: string;
}

function parseIcsEvents(icsContent: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  const lines = icsContent.split(/\r?\n/);

  let currentEvent: IcsEvent | null = null;
  let currentProperty = '';
  let currentValue = '';

  for (const line of lines) {
    // Handle line continuations
    if (line.startsWith(' ') || line.startsWith('\t')) {
      currentValue += line.slice(1);
      continue;
    }

    // Process previous property
    if (currentEvent && currentProperty && currentValue) {
      processIcsProperty(currentEvent, currentProperty, currentValue);
    }

    // Parse new property
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    currentProperty = line.slice(0, colonIndex).split(';')[0].toUpperCase();
    currentValue = line.slice(colonIndex + 1);

    if (currentProperty === 'BEGIN' && currentValue === 'VEVENT') {
      currentEvent = { raw: '', attendees: [] };
    } else if (currentProperty === 'END' && currentValue === 'VEVENT') {
      if (currentEvent) {
        currentEvent.raw = ''; // Don't store full raw ICS in memory
        events.push(currentEvent);
        currentEvent = null;
      }
    }
  }

  return events;
}

function processIcsProperty(event: IcsEvent, property: string, value: string): void {
  // Unescape ICS values
  const unescaped = value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');

  switch (property) {
    case 'UID':
      event.uid = unescaped;
      break;
    case 'SUMMARY':
      event.summary = unescaped;
      break;
    case 'DESCRIPTION':
      event.description = unescaped;
      break;
    case 'DTSTART':
      event.dtstart = parseIcsDate(unescaped);
      break;
    case 'DTEND':
      event.dtend = parseIcsDate(unescaped);
      break;
    case 'LOCATION':
      event.location = unescaped;
      break;
    case 'ATTENDEE':
      // Extract email from ATTENDEE:mailto:email@example.com
      const emailMatch = unescaped.match(/mailto:([^\s]+)/i);
      if (emailMatch && event.attendees) {
        event.attendees.push(emailMatch[1]);
      }
      break;
    case 'RRULE':
      event.rrule = unescaped;
      break;
    case 'STATUS':
      event.status = unescaped.toLowerCase();
      break;
  }
}

function parseIcsDate(value: string): string {
  // ICS date formats: 20240115T120000Z or 20240115
  try {
    if (value.includes('T')) {
      // DateTime format
      const year = value.slice(0, 4);
      const month = value.slice(4, 6);
      const day = value.slice(6, 8);
      const hour = value.slice(9, 11);
      const minute = value.slice(11, 13);
      const second = value.slice(13, 15);
      const tz = value.endsWith('Z') ? 'Z' : '';
      return `${year}-${month}-${day}T${hour}:${minute}:${second}${tz}`;
    } else {
      // Date only format
      const year = value.slice(0, 4);
      const month = value.slice(4, 6);
      const day = value.slice(6, 8);
      return `${year}-${month}-${day}T00:00:00`;
    }
  } catch {
    return value;
  }
}

/**
 * Convert Contacts from VCF files
 */
async function convertContacts(
  contactsDir: string,
  outputDir: string,
  options: TakeoutOptions
): Promise<{ success: number; error: number }> {
  let successCount = 0;
  let errorCount = 0;

  // Find VCF files
  const vcfFiles: string[] = [];

  function findVcf(dir: string): void {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          findVcf(fullPath);
        } else if (entry.endsWith('.vcf')) {
          vcfFiles.push(fullPath);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  findVcf(contactsDir);

  if (vcfFiles.length === 0) {
    logger.warn('No contact files found');
    return { success: 0, error: 0 };
  }

  logger.info(`Found ${vcfFiles.length} contact file(s)`);

  const contactsOutputDir = join(outputDir, 'contacts');
  mkdirSync(contactsOutputDir, { recursive: true });

  for (const vcfFile of vcfFiles) {
    try {
      const vcfContent = readFileSync(vcfFile, 'utf-8');
      const contacts = parseVcfContacts(vcfContent);

      for (const contact of contacts) {
        try {
          // Skip contacts without email if option is set
          if (options.contactsOnlyEmail && (!contact.emails || contact.emails.length === 0)) {
            continue;
          }

          const metadata: ContactMetadata = {
            contact_id: contact.uid,
            display_name: contact.fn || 'Unknown',
            emails: contact.emails,
            phones: contact.phones,
            organization: contact.org,
            job_title: contact.title,
            raw_vcard: contact.raw,
          };

          // Generate source hash
          const sourceHash = createHash('sha256')
            .update(contact.uid || contact.fn || JSON.stringify(contact))
            .digest('hex');

          // Create front matter
          const frontmatter = createFrontmatter({
            title: contact.fn || 'Unknown Contact',
            sourceType: 'file',
            contentType: 'contact',
            sourceFile: vcfFile,
            sourceHash: `sha256:${sourceHash}`,
            tags: ['imported', 'contact'],
            metadata: metadata as unknown as Record<string, unknown>,
          });

          // Create content
          let content = `# ${contact.fn || 'Unknown Contact'}\n\n`;

          if (contact.org) {
            content += `**Organization**: ${contact.org}\n`;
          }
          if (contact.title) {
            content += `**Title**: ${contact.title}\n`;
          }

          if (contact.emails && contact.emails.length > 0) {
            content += `\n## Email\n\n`;
            for (const email of contact.emails) {
              content += `- ${email.type ? `${email.type}: ` : ''}${email.value}\n`;
            }
          }

          if (contact.phones && contact.phones.length > 0) {
            content += `\n## Phone\n\n`;
            for (const phone of contact.phones) {
              content += `- ${phone.type ? `${phone.type}: ` : ''}${phone.value}\n`;
            }
          }

          if (contact.note) {
            content += `\n## Notes\n\n${contact.note}\n`;
          }

          // Generate output path
          const slug = slugify(contact.fn || 'contact', 40);
          const outputPath = join(contactsOutputDir, `${slug}.md`);

          // Write file
          if (!options.dryRun) {
            const output = serializeFrontmatter(frontmatter, content);
            writeFileSync(outputPath, output);
          }

          successCount++;
        } catch (error) {
          errorCount++;
          if (options.verbose) {
            logger.error(`Failed to convert contact: ${error}`);
          }
        }
      }
    } catch (error) {
      errorCount++;
      logger.error(`Failed to parse contacts file ${vcfFile}: ${error}`);
    }
  }

  return { success: successCount, error: errorCount };
}

/**
 * Simple VCF contact parser
 */
interface VcfContact {
  uid?: string;
  fn?: string;
  org?: string;
  title?: string;
  emails?: Array<{ type?: string; value: string }>;
  phones?: Array<{ type?: string; value: string }>;
  note?: string;
  raw: string;
}

function parseVcfContacts(vcfContent: string): VcfContact[] {
  const contacts: VcfContact[] = [];
  const lines = vcfContent.split(/\r?\n/);

  let currentContact: VcfContact | null = null;
  let currentRaw: string[] = [];

  for (const line of lines) {
    if (line.startsWith('BEGIN:VCARD')) {
      currentContact = { emails: [], phones: [], raw: '' };
      currentRaw = [line];
    } else if (line.startsWith('END:VCARD')) {
      if (currentContact) {
        currentRaw.push(line);
        currentContact.raw = currentRaw.join('\n');
        contacts.push(currentContact);
        currentContact = null;
        currentRaw = [];
      }
    } else if (currentContact) {
      currentRaw.push(line);

      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const propertyPart = line.slice(0, colonIndex);
      const value = line.slice(colonIndex + 1);
      const [property, ...params] = propertyPart.split(';');

      // Extract type from parameters
      let type: string | undefined;
      for (const param of params) {
        if (param.startsWith('TYPE=')) {
          type = param.slice(5).toLowerCase();
        }
      }

      switch (property.toUpperCase()) {
        case 'UID':
          currentContact.uid = value;
          break;
        case 'FN':
          currentContact.fn = value;
          break;
        case 'ORG':
          currentContact.org = value.split(';')[0];
          break;
        case 'TITLE':
          currentContact.title = value;
          break;
        case 'EMAIL':
          currentContact.emails?.push({ type, value });
          break;
        case 'TEL':
          currentContact.phones?.push({ type, value });
          break;
        case 'NOTE':
          currentContact.note = value.replace(/\\n/g, '\n');
          break;
      }
    }
  }

  return contacts;
}

/**
 * Main conversion function
 */
async function convertTakeout(inputPath: string, options: TakeoutOptions): Promise<void> {
  const resolvedInput = resolve(inputPath);

  // Check if input exists
  if (!existsSync(resolvedInput)) {
    logger.error(`Takeout archive not found: ${resolvedInput}`);
    process.exit(1);
  }

  const outputDir = resolve(options.output);
  mkdirSync(outputDir, { recursive: true });

  // Extract ZIP if needed
  let extractedPath: string;
  const isZip = resolvedInput.endsWith('.zip');

  if (isZip) {
    extractedPath = await extractZip(resolvedInput);
  } else {
    extractedPath = resolvedInput;
  }

  try {
    // Find data directories
    logger.info('Scanning for Takeout data...');
    const dirs = findTakeoutDirs(extractedPath);

    logger.info('Found data:', dirs);

    const results = {
      youtube: { success: 0, error: 0 },
      calendar: { success: 0, error: 0 },
      contacts: { success: 0, error: 0 },
      mail: { success: 0, error: 0 },
    };

    // Process each type
    if (options.types.includes('youtube') && dirs.youtube) {
      logger.info('Processing YouTube...');
      results.youtube = await convertYouTubeHistory(dirs.youtube, outputDir, options);
    }

    if (options.types.includes('calendar') && dirs.calendar) {
      logger.info('Processing Calendar...');
      results.calendar = await convertCalendar(dirs.calendar, outputDir, options);
    }

    if (options.types.includes('contacts') && dirs.contacts) {
      logger.info('Processing Contacts...');
      results.contacts = await convertContacts(dirs.contacts, outputDir, options);
    }

    if (options.types.includes('mail') && dirs.mail) {
      logger.info('Processing Mail...');
      // Find MBOX files and process them
      // This would delegate to the MBOX converter
      logger.warn('Mail processing requires running convert:mbox separately on the extracted MBOX files');
      logger.info(`Mail directory: ${dirs.mail}`);
    }

    // Summary
    logger.info('\n=== Conversion Summary ===');
    for (const [type, result] of Object.entries(results)) {
      if (result.success > 0 || result.error > 0) {
        logger.info(`${type}: ${result.success} converted, ${result.error} errors`);
      }
    }

    logger.info(`\nOutput directory: ${outputDir}`);
  } finally {
    // Clean up extracted files if we extracted a ZIP
    if (isZip && extractedPath !== resolvedInput) {
      logger.info('Cleaning up temporary files...');
      try {
        rmSync(extractedPath, { recursive: true, force: true });
      } catch {
        logger.warn(`Failed to clean up ${extractedPath}`);
      }
    }
  }
}

// CLI setup
const program = createBaseCommand(
  'convert-takeout',
  'Convert Google Takeout archive to Markdown files with YAML front matter'
);

addTakeoutOptions(program);

program
  .argument('<path>', 'Takeout ZIP file or extracted directory')
  .action(async (path: string, opts: TakeoutOptions) => {
    await convertTakeout(path, opts);
  });

program.parse();
