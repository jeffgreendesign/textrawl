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
	lastProcessed?: string; // ISO timestamp
	children?: TreeFile[]; // for directory nodes
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
