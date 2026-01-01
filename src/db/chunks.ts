import { getSupabaseClient, isSupabaseConfigured, type Chunk } from './client.js';
import { logger } from '../utils/logger.js';
import { DatabaseError } from '../utils/errors.js';

export interface CreateChunkInput {
  documentId: string;
  content: string;
  chunkIndex: number;
  startOffset?: number;
  endOffset?: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

/**
 * Create chunks for a document in batch
 */
export async function createChunks(chunks: CreateChunkInput[]): Promise<Chunk[]> {
  if (!isSupabaseConfigured()) {
    throw new DatabaseError('Supabase not configured');
  }

  if (chunks.length === 0) {
    return [];
  }

  const client = getSupabaseClient();

  const records = chunks.map((chunk) => ({
    document_id: chunk.documentId,
    content: chunk.content,
    chunk_index: chunk.chunkIndex,
    start_offset: chunk.startOffset ?? null,
    end_offset: chunk.endOffset ?? null,
    embedding: chunk.embedding ?? null,
    metadata: chunk.metadata ?? {},
  }));

  const { data, error } = await client.from('chunks').insert(records).select();

  if (error) {
    logger.error('Failed to create chunks', { error: error.message });
    throw new DatabaseError('Failed to create chunks');
  }

  logger.info('Created chunks', {
    documentId: chunks[0].documentId,
    count: data.length,
  });

  return data as Chunk[];
}

/**
 * Get chunks for a document
 */
export async function getChunksForDocument(documentId: string): Promise<Chunk[]> {
  if (!isSupabaseConfigured()) {
    throw new DatabaseError('Supabase not configured');
  }

  const client = getSupabaseClient();

  const { data, error } = await client
    .from('chunks')
    .select('*')
    .eq('document_id', documentId)
    .order('chunk_index', { ascending: true });

  if (error) {
    logger.error('Failed to get chunks', { error: error.message });
    throw new DatabaseError('Failed to get chunks');
  }

  return data as Chunk[];
}
