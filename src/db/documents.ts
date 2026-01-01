import {
  getSupabaseClient,
  isSupabaseConfigured,
  type Document,
} from './client.js';
import { logger } from '../utils/logger.js';
import { DatabaseError, NotFoundError } from '../utils/errors.js';

export interface CreateDocumentInput {
  title: string;
  sourceType: 'note' | 'file' | 'url';
  rawContent: string;
  sourceUrl?: string;
  filePath?: string;
  metadata?: Record<string, unknown>;
}

export interface ListDocumentsOptions {
  limit?: number;
  offset?: number;
  sourceType?: 'note' | 'file' | 'url';
  tags?: string[];
}

export interface UpdateDocumentInput {
  title?: string;
  tags?: string[];
}

/**
 * Create a new document
 */
export async function createDocument(
  input: CreateDocumentInput
): Promise<Document> {
  if (!isSupabaseConfigured()) {
    throw new DatabaseError('Supabase not configured');
  }

  const client = getSupabaseClient();

  const { data, error } = await client
    .from('documents')
    .insert({
      title: input.title,
      source_type: input.sourceType,
      raw_content: input.rawContent,
      source_url: input.sourceUrl || null,
      file_path: input.filePath || null,
      metadata: input.metadata || {},
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create document', { error: error.message });
    throw new DatabaseError('Failed to create document');
  }

  logger.info('Created document', { id: data.id, title: data.title });
  return data as Document;
}

/**
 * Get a document by ID
 */
export async function getDocument(id: string): Promise<Document> {
  if (!isSupabaseConfigured()) {
    throw new DatabaseError('Supabase not configured');
  }

  const client = getSupabaseClient();

  const { data, error } = await client
    .from('documents')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError(`Document not found: ${id}`);
    }
    logger.error('Failed to get document', { error: error.message });
    throw new DatabaseError('Failed to get document');
  }

  return data as Document;
}

/**
 * List documents with pagination
 */
export async function listDocuments(
  options: ListDocumentsOptions = {}
): Promise<{ documents: Document[]; total: number }> {
  if (!isSupabaseConfigured()) {
    throw new DatabaseError('Supabase not configured');
  }

  const { limit = 20, offset = 0, sourceType, tags } = options;
  const client = getSupabaseClient();

  let query = client
    .from('documents')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sourceType) {
    query = query.eq('source_type', sourceType);
  }

  // Filter by tags using JSONB contains operator
  if (tags && tags.length > 0) {
    query = query.contains('metadata->tags', tags);
  }

  const { data, error, count } = await query;

  if (error) {
    logger.error('Failed to list documents', { error: error.message });
    throw new DatabaseError('Failed to list documents');
  }

  return {
    documents: data as Document[],
    total: count || 0,
  };
}

/**
 * Update a document's title and/or tags
 */
export async function updateDocument(
  id: string,
  input: UpdateDocumentInput
): Promise<Document> {
  if (!isSupabaseConfigured()) {
    throw new DatabaseError('Supabase not configured');
  }

  // Get existing document first to merge metadata
  const existing = await getDocument(id);

  const client = getSupabaseClient();

  const updates: Record<string, unknown> = {};

  if (input.title !== undefined) {
    updates.title = input.title;
  }

  if (input.tags !== undefined) {
    // Merge tags into existing metadata
    updates.metadata = {
      ...(existing.metadata as Record<string, unknown>),
      tags: input.tags,
    };
  }

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  const { data, error } = await client
    .from('documents')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update document', { error: error.message });
    throw new DatabaseError('Failed to update document');
  }

  logger.info('Updated document', { id, updates: Object.keys(updates) });
  return data as Document;
}
