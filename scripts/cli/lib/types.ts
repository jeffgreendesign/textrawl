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
