/**
 * Shared types for CLI utilities
 */

export type SourceType = 'note' | 'file' | 'url';
export type ContentType = 'email' | 'youtube' | 'calendar' | 'contact' | 'webpage' | 'document';

/**
 * Result of a conversion operation
 */
export interface ConversionResult {
	success: boolean;
	/** Path to the output markdown file */
	outputPath?: string;
	/** SHA256 hash of the source content for deduplication */
	sourceHash?: string;
	/** Error message if conversion failed */
	error?: string;
	/** Processing stats */
	stats?: {
		originalChars: number;
		normalizedChars: number;
		metadataFields: number;
	};
}

/**
 * Result of an upload operation
 */
export interface UploadResult {
	success: boolean;
	/** Supabase document ID */
	documentId?: string;
	/** Number of chunks created */
	chunksCreated?: number;
	/** Source hash from frontmatter (avoids re-reading file for manifest) */
	sourceHash?: string;
	/** Error message if upload failed */
	error?: string;
	/** Whether the file was skipped (already in manifest) */
	skipped?: boolean;
}

/**
 * Front matter structure for converted documents
 */
export interface DocumentFrontMatter {
	title: string;
	source_type: SourceType;
	content_type: ContentType;
	created_at: string;
	converted_at: string;
	source_file: string;
	source_hash: string;
	tags: string[];
	metadata: Record<string, unknown>;
}

/**
 * Email-specific metadata
 */
export interface EmailMetadata {
	from: string;
	from_name?: string;
	to: string[];
	cc?: string[];
	bcc?: string[];
	subject: string;
	message_id: string;
	in_reply_to?: string;
	thread_id?: string;
	has_attachments: boolean;
	attachment_count?: number;
	attachments?: Array<{
		name: string;
		type: string;
		size: number;
		path?: string;
	}>;
	raw_headers: Record<string, string | string[]>;
}

/**
 * YouTube watch history metadata
 */
export interface YouTubeMetadata {
	video_id: string;
	channel_name: string;
	channel_id?: string;
	watched_at: string;
	duration_seconds?: number;
	category?: string;
	raw_data: Record<string, unknown>;
}

/**
 * Calendar event metadata
 */
export interface CalendarMetadata {
	event_id: string;
	calendar_name?: string;
	start_time: string;
	end_time: string;
	location?: string;
	attendees?: string[];
	recurrence?: string;
	status?: 'confirmed' | 'tentative' | 'cancelled';
	raw_ics: string;
}

/**
 * Contact metadata
 */
export interface ContactMetadata {
	contact_id?: string;
	display_name: string;
	emails?: Array<{ type?: string; value: string }>;
	phones?: Array<{ type?: string; value: string }>;
	organization?: string;
	job_title?: string;
	raw_vcard: string;
}

/**
 * Google Drive file metadata from -info.json companion files
 */
export interface DriveFileMetadata {
	/** Google Drive document ID */
	doc_id?: string;
	/** Original file title from Google */
	original_title?: string;
	/** File owner email or name */
	owner?: string;
	/** Whether the file was starred in Drive */
	starred?: boolean;
	/** Whether the file was shared */
	shared?: boolean;
	/** Whether the file was in trash */
	trashed?: boolean;
	/** Description set in Google Drive */
	description?: string;
	/** Original file type/extension */
	file_type?: string;
	/** Google Drive folder path */
	drive_path?: string;
	/** Created timestamp from -info.json */
	created?: string;
	/** Modified timestamp from -info.json */
	modified?: string;
}

/**
 * Webpage metadata
 */
export interface WebpageMetadata {
	url: string;
	domain: string;
	author?: string;
	published_at?: string;
	fetched_at: string;
	word_count?: number;
	reading_time_minutes?: number;
	language?: string;
	has_images: boolean;
	image_count?: number;
	raw_meta: Record<string, string>;
}

// ─── Scan / Split Types ───

/**
 * A heading found in a markdown document
 */
export interface HeadingNode {
	/** Heading level (1-6) */
	level: number;
	/** Heading text */
	text: string;
	/** Line number in the body content (1-based) */
	line: number;
	/** Character offset in body content */
	offset: number;
	/** Character count of section content (until next heading or EOF) */
	sectionLength: number;
	/** Estimated chunks for this section */
	estimatedChunks: number;
}

/**
 * A suggested point to split a large file
 */
export interface SplitPoint {
	/** Character offset in body content where the split occurs */
	offset: number;
	/** Heading that starts this section */
	heading?: HeadingNode;
	/** Estimated size in bytes of the resulting part */
	estimatedPartSize: number;
	/** Estimated chunks for the resulting part */
	estimatedChunks: number;
}

/**
 * Result of scanning a single file for upload readiness
 */
export interface ScanFileResult {
	/** Relative path to the file */
	relativePath: string;
	/** File size in bytes */
	fileSizeBytes: number;
	/** File size in MB */
	fileSizeMB: number;
	/** Estimated chunk count */
	estimatedChunks: number;
	/** Whether the file exceeds the file size limit */
	exceedsFileSize: boolean;
	/** Whether the file exceeds the chunk count limit */
	exceedsChunkLimit: boolean;
	/** Whether the file can be uploaded as-is */
	uploadable: boolean;
	/** Heading structure */
	headings: HeadingNode[];
	/** Suggested split points */
	suggestedSplitPoints: SplitPoint[];
	/** Has valid frontmatter */
	hasValidFrontmatter: boolean;
	/** Title from frontmatter */
	title?: string;
	/** Error if file couldn't be scanned */
	error?: string;
}

/**
 * Summary of a scan across a directory
 */
export interface ScanSummary {
	totalFiles: number;
	uploadableFiles: number;
	needsSplitting: number;
	exceedsSizeLimit: number;
	exceedsChunkLimit: number;
	totalEstimatedChunks: number;
	files: ScanFileResult[];
}

/**
 * Metadata added to split file frontmatter for document linking
 */
export interface SplitMetadata {
	/** Group identifier (original file's source_hash) */
	split_group: string;
	/** 1-based part number */
	split_part: number;
	/** Total parts in the group */
	split_total: number;
	/** Title of the original unsplit document */
	split_source_title: string;
	/** Heading that starts this part */
	split_heading?: string;
}

/**
 * Result of splitting a single file
 */
export interface SplitFileResult {
	/** Original file path */
	originalPath: string;
	/** Whether splitting was performed */
	wasSplit: boolean;
	/** Paths of written part files */
	partPaths: string[];
	/** Number of parts created */
	partCount: number;
	/** Error if splitting failed */
	error?: string;
}

/**
 * Log entry for processing feedback
 */
export interface LogEntry {
	timestamp: string;
	level: 'info' | 'warn' | 'error' | 'debug';
	message: string;
	details?: Record<string, unknown>;
}

/**
 * Processing event for SSE streaming
 */
export interface ProcessingEvent {
	type: 'start' | 'progress' | 'log' | 'complete' | 'error';
	fileId: string;
	fileName: string;
	data: {
		status?: 'pending' | 'processing' | 'complete' | 'error';
		progress?: number;
		message?: string;
		details?: Record<string, unknown>;
		result?: ConversionResult | UploadResult;
	};
}
