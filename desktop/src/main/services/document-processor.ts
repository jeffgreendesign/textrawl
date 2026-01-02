/**
 * Document Processor - Extract text from various document formats
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { basename, join, extname } from 'path';
import { createHash } from 'crypto';
import type { FileType, ConversionResult } from '../../shared/types.js';

interface ProcessorOptions {
  outputDir: string;
  tags: string[];
  dryRun?: boolean;
}

interface DocumentFrontMatter {
  title: string;
  source_type: 'file';
  content_type: 'document' | 'spreadsheet' | 'presentation' | 'data';
  created_at: string;
  converted_at: string;
  source_file: string;
  source_hash: string;
  tags: string[];
  metadata: Record<string, unknown>;
}

/**
 * Create YAML front matter for a document
 */
function createFrontmatter(options: {
  title: string;
  contentType: DocumentFrontMatter['content_type'];
  sourceFile: string;
  sourceHash: string;
  tags: string[];
  metadata?: Record<string, unknown>;
}): DocumentFrontMatter {
  return {
    title: options.title,
    source_type: 'file',
    content_type: options.contentType,
    created_at: new Date().toISOString(),
    converted_at: new Date().toISOString(),
    source_file: options.sourceFile,
    source_hash: options.sourceHash,
    tags: options.tags,
    metadata: options.metadata || {},
  };
}

/**
 * Serialize front matter and content to markdown
 */
function serializeFrontmatter(frontmatter: DocumentFrontMatter, content: string): string {
  const yaml = [
    '---',
    `title: "${frontmatter.title.replace(/"/g, '\\"')}"`,
    `source_type: ${frontmatter.source_type}`,
    `content_type: ${frontmatter.content_type}`,
    `created_at: ${frontmatter.created_at}`,
    `converted_at: ${frontmatter.converted_at}`,
    `source_file: "${frontmatter.source_file.replace(/"/g, '\\"')}"`,
    `source_hash: ${frontmatter.source_hash}`,
    `tags: [${frontmatter.tags.map((t) => `"${t}"`).join(', ')}]`,
    `metadata: ${JSON.stringify(frontmatter.metadata)}`,
    '---',
    '',
  ].join('\n');

  return yaml + content;
}

/**
 * Extract text from PDF
 */
async function extractPdf(buffer: Buffer): Promise<string> {
  const pdf = await import('pdf-parse');
  const data = await pdf.default(buffer);
  return data.text;
}

/**
 * Extract text from DOCX
 */
async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * Extract text from RTF
 */
async function extractRtf(buffer: Buffer): Promise<string> {
  // rtf-parser returns structured data, we need to extract text
  const rtfParser = await import('rtf-parser');

  return new Promise((resolve, reject) => {
    rtfParser.string(buffer.toString('binary'), (err: Error | null, doc: any) => {
      if (err) {
        reject(err);
        return;
      }

      // Extract text from RTF document structure
      const extractText = (node: any): string => {
        if (!node) return '';
        if (typeof node === 'string') return node;
        if (node.content) {
          if (Array.isArray(node.content)) {
            return node.content.map(extractText).join('');
          }
          return extractText(node.content);
        }
        if (Array.isArray(node)) {
          return node.map(extractText).join('');
        }
        return '';
      };

      resolve(extractText(doc));
    });
  });
}

/**
 * Extract text from Excel files (XLSX, XLS, XLSB)
 */
async function extractExcel(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const sheets: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    sheets.push(`## ${sheetName}\n\n\`\`\`\n${csv}\n\`\`\``);
  }

  return sheets.join('\n\n');
}

/**
 * Extract text from CSV
 */
async function extractCsv(buffer: Buffer): Promise<string> {
  const { parse } = await import('csv-parse/sync');
  const records = parse(buffer.toString('utf-8'), {
    skip_empty_lines: true,
  });

  // Convert to markdown table
  if (records.length === 0) return '';

  const headers = records[0] as string[];
  const rows = records.slice(1) as string[][];

  let table = `| ${headers.join(' | ')} |\n`;
  table += `| ${headers.map(() => '---').join(' | ')} |\n`;

  for (const row of rows) {
    table += `| ${row.join(' | ')} |\n`;
  }

  return table;
}

/**
 * Extract text from PowerPoint (PPTX)
 */
async function extractPptx(buffer: Buffer): Promise<string> {
  const unzipper = await import('unzipper');
  const { XMLParser } = await import('fast-xml-parser');
  const { Readable } = await import('stream');

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
  });

  const slides: string[] = [];

  // PPTX is a ZIP file containing XML
  const directory = await unzipper.Open.buffer(buffer);

  for (const file of directory.files) {
    if (file.path.match(/ppt\/slides\/slide\d+\.xml/)) {
      const content = await file.buffer();
      const xml = parser.parse(content.toString('utf-8'));

      // Extract text from slide
      const extractTextFromNode = (node: any): string[] => {
        const texts: string[] = [];
        if (!node) return texts;

        if (typeof node === 'string') {
          texts.push(node);
        } else if (node.t) {
          texts.push(typeof node.t === 'string' ? node.t : String(node.t));
        } else if (typeof node === 'object') {
          for (const key of Object.keys(node)) {
            texts.push(...extractTextFromNode(node[key]));
          }
        }

        return texts;
      };

      const slideTexts = extractTextFromNode(xml);
      const slideNum = file.path.match(/slide(\d+)/)?.[1] || '?';
      slides.push(`## Slide ${slideNum}\n\n${slideTexts.join('\n')}`);
    }
  }

  return slides.join('\n\n---\n\n');
}

/**
 * Extract text from OpenDocument formats (ODT, ODS, ODP)
 */
async function extractOpenDocument(buffer: Buffer): Promise<string> {
  const unzipper = await import('unzipper');
  const { XMLParser } = await import('fast-xml-parser');

  const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
  });

  const directory = await unzipper.Open.buffer(buffer);
  const contentFile = directory.files.find((f) => f.path === 'content.xml');

  if (!contentFile) {
    throw new Error('No content.xml found in OpenDocument file');
  }

  const content = await contentFile.buffer();
  const xml = parser.parse(content.toString('utf-8'));

  // Extract text recursively
  const extractText = (node: any): string => {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(extractText).join(' ');
    if (typeof node === 'object') {
      return Object.values(node).map(extractText).join(' ');
    }
    return String(node);
  };

  return extractText(xml).replace(/\s+/g, ' ').trim();
}

/**
 * Extract text from RTFD bundle (macOS)
 */
async function extractRtfd(dirPath: string): Promise<string> {
  const rtfFile = join(dirPath, 'TXT.rtf');
  const buffer = readFileSync(rtfFile);
  return extractRtf(buffer);
}

/**
 * Read and optionally add frontmatter to markdown files
 */
async function processMarkdown(
  buffer: Buffer,
  sourceFile: string,
  options: ProcessorOptions
): Promise<{ content: string; hasFrontmatter: boolean }> {
  const matter = await import('gray-matter');
  const text = buffer.toString('utf-8');
  const parsed = matter.default(text);

  // Check if it already has frontmatter
  if (parsed.matter && parsed.matter.length > 0) {
    return { content: text, hasFrontmatter: true };
  }

  // Add frontmatter
  const title = basename(sourceFile, extname(sourceFile));
  const sourceHash = `sha256:${createHash('sha256').update(buffer).digest('hex')}`;

  const frontmatter = createFrontmatter({
    title,
    contentType: 'document',
    sourceFile,
    sourceHash,
    tags: ['imported', 'markdown', ...options.tags],
  });

  return {
    content: serializeFrontmatter(frontmatter, parsed.content),
    hasFrontmatter: false,
  };
}

/**
 * Format XML as readable markdown
 */
async function extractXml(buffer: Buffer): Promise<string> {
  const { XMLParser } = await import('fast-xml-parser');
  const parser = new XMLParser({
    ignoreAttributes: false,
  });

  const text = buffer.toString('utf-8');
  const parsed = parser.parse(text);

  // Pretty print as JSON for readability
  return '```xml\n' + text + '\n```\n\n## Parsed Structure\n\n```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
}

/**
 * Format JSON as readable markdown
 */
function extractJson(buffer: Buffer): string {
  const text = buffer.toString('utf-8');
  try {
    const parsed = JSON.parse(text);
    return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
  } catch {
    return '```\n' + text + '\n```';
  }
}

/**
 * Get content type for a file type
 */
function getContentType(type: FileType): DocumentFrontMatter['content_type'] {
  switch (type) {
    case 'xlsx':
    case 'xls':
    case 'xlsb':
    case 'csv':
    case 'ods':
      return 'spreadsheet';
    case 'pptx':
    case 'ppt':
    case 'odp':
      return 'presentation';
    case 'xml':
    case 'json':
      return 'data';
    default:
      return 'document';
  }
}

/**
 * Process a document file and convert to markdown
 */
export async function processDocument(
  filePath: string,
  fileType: FileType,
  options: ProcessorOptions
): Promise<ConversionResult> {
  try {
    const buffer = readFileSync(filePath);
    const sourceHash = `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
    const title = basename(filePath, extname(filePath));

    let text: string;
    let skipFrontmatter = false;

    // Extract text based on file type
    switch (fileType) {
      case 'pdf':
        text = await extractPdf(buffer);
        break;
      case 'docx':
      case 'doc':
        text = await extractDocx(buffer);
        break;
      case 'rtf':
        text = await extractRtf(buffer);
        break;
      case 'rtfd':
        text = await extractRtfd(filePath);
        break;
      case 'xlsx':
      case 'xls':
      case 'xlsb':
        text = await extractExcel(buffer);
        break;
      case 'csv':
        text = await extractCsv(buffer);
        break;
      case 'pptx':
        text = await extractPptx(buffer);
        break;
      case 'ppt':
        // Legacy PPT not supported, return error
        return {
          success: false,
          error: 'Legacy .ppt format not supported. Please convert to .pptx',
        };
      case 'odt':
      case 'ods':
      case 'odp':
        text = await extractOpenDocument(buffer);
        break;
      case 'txt':
      case 'text':
        text = buffer.toString('utf-8');
        break;
      case 'md':
        const mdResult = await processMarkdown(buffer, filePath, options);
        if (mdResult.hasFrontmatter) {
          // Already has frontmatter, just copy
          text = mdResult.content;
          skipFrontmatter = true;
        } else {
          text = mdResult.content;
          skipFrontmatter = true; // Frontmatter already added
        }
        break;
      case 'xml':
        text = await extractXml(buffer);
        break;
      case 'json':
        text = extractJson(buffer);
        break;
      default:
        return {
          success: false,
          error: `Unsupported file type: ${fileType}`,
        };
    }

    // Create output with frontmatter
    let output: string;
    if (skipFrontmatter) {
      output = text;
    } else {
      const frontmatter = createFrontmatter({
        title,
        contentType: getContentType(fileType),
        sourceFile: filePath,
        sourceHash,
        tags: ['imported', fileType, ...options.tags],
      });
      output = serializeFrontmatter(frontmatter, text);
    }

    // Write output
    if (!options.dryRun) {
      mkdirSync(options.outputDir, { recursive: true });
      const outputPath = join(options.outputDir, `${title}.md`);
      writeFileSync(outputPath, output, 'utf-8');

      return {
        success: true,
        outputPath,
        sourceHash,
        stats: {
          originalChars: buffer.length,
          normalizedChars: text.length,
          metadataFields: options.tags.length + 4,
        },
      };
    }

    return {
      success: true,
      sourceHash,
      stats: {
        originalChars: buffer.length,
        normalizedChars: text.length,
        metadataFields: (options.tags ?? []).length + 4,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
