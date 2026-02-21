import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { type Document, getSupabaseClient, isSupabaseConfigured } from './client.js';

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
	contentType?: 'email' | 'youtube' | 'calendar' | 'contact' | 'webpage' | 'document';
	tags?: string[];
	sortBy?: 'created_at' | 'updated_at' | 'title';
	sortOrder?: 'asc' | 'desc';
}

export interface UpdateDocumentInput {
	title?: string;
	tags?: string[];
}

/**
 * Create a new document
 */
export async function createDocument(input: CreateDocumentInput): Promise<Document> {
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
		throw new DatabaseError(`Failed to create document: ${error.message}`);
	}

	logger.info('Created document', { id: data.id, title: data.title });
	return data as Document;
}

/**
 * Retrieve a single document by its UUID.
 *
 * @param id - The UUID of the document to retrieve
 * @returns The full document record
 * @throws {NotFoundError} If no document exists with the given ID
 * @throws {DatabaseError} If Supabase is not configured or the query fails
 */
export async function getDocument(id: string): Promise<Document> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client.from('documents').select('*').eq('id', id).single();

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
 * List documents with pagination, optional filtering by source type, content type,
 * and tags, and configurable sort order.
 *
 * @param options - Pagination and filter options
 * @param options.limit - Maximum number of documents to return (default: 20)
 * @param options.offset - Number of documents to skip for pagination (default: 0)
 * @param options.sourceType - Filter by source type ('note', 'file', or 'url')
 * @param options.contentType - Filter by content type in metadata JSONB
 * @param options.tags - Filter to documents whose metadata tags contain all specified tags
 * @param options.sortBy - Column to sort by (default: 'created_at')
 * @param options.sortOrder - Sort direction, 'asc' or 'desc' (default: 'desc')
 * @returns An object with the matching documents array and the total count for pagination
 * @throws {DatabaseError} If Supabase is not configured or the query fails
 */
export async function listDocuments(
	options: ListDocumentsOptions = {},
): Promise<{ documents: Document[]; total: number }> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const {
		limit = 20,
		offset = 0,
		sourceType,
		contentType,
		tags,
		sortBy = 'created_at',
		sortOrder = 'desc',
	} = options;
	const client = getSupabaseClient();

	let query = client
		.from('documents')
		.select('*', { count: 'exact' })
		.order(sortBy, { ascending: sortOrder === 'asc' })
		.range(offset, offset + limit - 1);

	if (sourceType) {
		query = query.eq('source_type', sourceType);
	}

	// Filter by content_type in metadata JSONB
	if (contentType) {
		query = query.filter('metadata->>content_type', 'eq', contentType);
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
 * Update a document's title and/or tags. Tags are merged into the existing
 * metadata object. If no fields are provided, the existing document is returned unchanged.
 *
 * @param id - The UUID of the document to update
 * @param input - Fields to update (title and/or tags)
 * @param input.title - New title for the document
 * @param input.tags - New tags array, merged into existing metadata
 * @returns The updated document record
 * @throws {NotFoundError} If no document exists with the given ID
 * @throws {DatabaseError} If Supabase is not configured or the update fails
 */
export async function updateDocument(id: string, input: UpdateDocumentInput): Promise<Document> {
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
