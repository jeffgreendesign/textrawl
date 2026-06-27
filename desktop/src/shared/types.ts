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
	| 'facebook'
	| 'instagram'
	| 'spotify'
	| 'reddit'
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
export type ConverterType =
	| 'mbox'
	| 'eml'
	| 'html'
	| 'takeout'
	| 'facebook'
	| 'instagram'
	| 'spotify'
	| 'reddit'
	| 'processor';

// Size tier classification for file size warnings
export type SizeTier = 'normal' | 'warning' | 'large';

// Scanned file with routing info
export interface ScannedFile {
	id: string;
	path: string;
	name: string;
	type: FileType;
	converterType: ConverterType | null;
	size: number;
	isDirectory: boolean;
	sizeTier: SizeTier;
	sizeWarning?: string;
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

// Pipeline status for directory browser (full lifecycle)
export type PipelineStatus =
	| 'pending'
	| 'converting'
	| 'converted'
	| 'uploading'
	| 'uploaded'
	| 'error'
	| 'oversized'
	| 'unsupported';

// Per-directory recursive stats
export interface DirectoryStats {
	total: number;
	pending: number;
	converted: number;
	uploaded: number;
	errors: number;
	oversized: number;
	unsupported: number;
}

// A file node in the directory tree
export interface TreeFile {
	relativePath: string; // relative to source dir
	name: string;
	isDirectory: boolean;
	fileType: FileType;
	converterType: ConverterType | null;
	size: number;
	sizeTier: SizeTier;
	sizeWarning?: string;
	pipelineStatus: PipelineStatus;
	convertedPath?: string; // relative path to .md in output dir
	documentId?: string; // Supabase doc ID from manifest
	uploadedAt?: string; // ISO timestamp from manifest
	error?: string; // last error message
	retryCount?: number; // number of conversion attempts (shown in UI for error files)
	lastProcessed?: string; // ISO timestamp
	children?: TreeFile[]; // for directory nodes
	recursiveStats?: DirectoryStats; // for directory nodes only
}

// Aggregate counts for a project
export interface ProjectStats {
	total: number;
	pending: number;
	converted: number;
	uploaded: number;
	errors: number;
	oversized: number;
	unsupported: number;
}

// Top-level project state
export interface ProjectState {
	sourceDir: string;
	outputDir: string;
	lastScanned: string; // ISO timestamp
	stats: ProjectStats;
}

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
	startedAt?: number;
	elapsedMs?: number;
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

// Embedding provider for the upload pipeline — mirrors the server/CLI EMBEDDING_PROVIDER.
// Must stay in sync with scripts/cli/lib/config.ts and src/utils/config.ts.
export type EmbeddingProvider = 'openai' | 'google' | 'ollama';

// App settings
export interface AppSettings {
	outputDir: string;
	defaultTags: string[];
	autoUpload: boolean;
	verboseLogging?: boolean;
	// Upload/ingest connection — passed through to the upload CLI as env vars so the
	// desktop writes to the same Neon database the dashboard/server use.
	databaseUrl?: string; // Neon DATABASE_URL
	embeddingProvider?: EmbeddingProvider;
	openaiApiKey?: string; // OPENAI_API_KEY (provider=openai)
	googleApiKey?: string; // GOOGLE_AI_API_KEY (provider=google)
	ollamaBaseUrl?: string; // OLLAMA_BASE_URL (provider=ollama)
}

// Status report for oversized/unsupported file breakdown
export interface StatusReportGroup {
	extension: string;
	count: number;
	totalSizeMB: number;
	examples: string[];
}

export interface StatusReport {
	oversized: StatusReportGroup[];
	unsupported: StatusReportGroup[];
	totalOversized: number;
	totalUnsupported: number;
}

// Recent project entry for quick-open
export interface RecentProject {
	sourceDir: string;
	outputDir: string;
	lastOpened: string; // ISO timestamp
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

/** Result from convertSelected — breakdown of what was processed */
export interface ConvertSelectedResult {
	pending: number;
	retried: number;
	oversized: number;
	skipped: number;
	total: number;
}
