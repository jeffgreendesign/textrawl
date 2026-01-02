/**
 * Shared types for Textrawl Desktop
 */

// File type detection
export type FileType =
  | 'mbox'
  | 'mbox-bundle'
  | 'eml'
  | 'html'
  | 'takeout'
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'rtf'
  | 'odt'
  | 'xlsx'
  | 'xls'
  | 'xlsb'
  | 'csv'
  | 'ods'
  | 'pptx'
  | 'ppt'
  | 'odp'
  | 'txt'
  | 'md'
  | 'text'
  | 'rtfd'
  | 'xml'
  | 'json'
  | 'zip'
  | 'unknown';

// Converter type for routing
export type ConverterType = 'mbox' | 'eml' | 'html' | 'takeout' | 'processor';

// Scanned file with routing info
export interface ScannedFile {
  id: string;
  path: string;
  name: string;
  type: FileType;
  converterType: ConverterType | null;
  size: number;
  isDirectory: boolean;
}

// Conversion options from UI
export interface ConversionOptions {
  outputDir: string;
  tags: string[];
  dryRun: boolean;
  verbose: boolean;
}

// File processing status
export type FileStatus = 'pending' | 'processing' | 'complete' | 'error' | 'skipped';

// Progress update for a single file
export interface FileProgress {
  fileId: string;
  fileName: string;
  status: FileStatus;
  progress: number; // 0-100
  message?: string;
  outputPath?: string;
  error?: string;
}

// Overall progress
export interface OverallProgress {
  totalFiles: number;
  completedFiles: number;
  errorCount: number;
  skippedCount: number;
  percentComplete: number;
  currentFile?: string;
}

// Combined progress update
export interface ProgressUpdate {
  type: 'file' | 'overall';
  data: FileProgress | OverallProgress;
}

// Log entry for UI
export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  details?: string;
  fileId?: string;
}

// Upload options
export interface UploadOptions {
  directory: string;
  tags: string[];
}

// App settings
export interface AppSettings {
  outputDir: string;
  defaultTags: string[];
  autoUpload: boolean;
  supabaseUrl?: string;
  supabaseKey?: string;
}

// Conversion result from CLI
export interface ConversionResult {
  success: boolean;
  outputPath?: string;
  sourceHash?: string;
  error?: string;
  stats?: {
    originalChars: number;
    normalizedChars: number;
    metadataFields: number;
  };
}
