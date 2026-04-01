import type { Document } from '../types/database.js';
import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { isDatabaseConfigured, pgQuery, queryCount, queryOneOrThrow } from './pg-client.js';

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
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		const doc = await queryOneOrThrow<Document>(
			`INSERT INTO documents (title, source_type, raw_content, source_url, file_path, metadata)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 RETURNING *`,
			[
				input.title,
				input.sourceType,
				input.rawContent,
				input.sourceUrl || null,
				input.filePath || null,
				JSON.stringify(input.metadata || {}),
			],
			'Document',
		);

		logger.info('Created document', { id: doc.id, title: doc.title });
		return doc;
	} catch (error) {
		if (error instanceof NotFoundError) {
			throw new DatabaseError('Failed to create document: no row returned');
		}
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to create document', { error: message });
		throw new DatabaseError(`Failed to create document: ${message}`);
	}
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
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		return await queryOneOrThrow<Document>(
			'SELECT * FROM documents WHERE id = $1',
			[id],
			`Document not found: ${id}`,
		);
	} catch (error) {
		if (error instanceof NotFoundError) {
			throw new NotFoundError(`Document not found: ${id}`);
		}
		logger.error('Failed to get document', {
			error: error instanceof Error ? error.message : String(error),
		});
		throw new DatabaseError('Failed to get document');
	}
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
	if (!isDatabaseConfigured()) {
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

	// Allowlist for sort columns to prevent SQL injection
	const allowedSortColumns = ['created_at', 'updated_at', 'title'] as const;
	const safeSort = allowedSortColumns.includes(sortBy as (typeof allowedSortColumns)[number])
		? sortBy
		: 'created_at';
	const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';

	const conditions: string[] = [];
	const params: unknown[] = [];
	let paramIndex = 1;

	if (sourceType) {
		conditions.push(`source_type = $${paramIndex++}`);
		params.push(sourceType);
	}

	if (contentType) {
		conditions.push(`metadata->>'content_type' = $${paramIndex++}`);
		params.push(contentType);
	}

	if (tags && tags.length > 0) {
		conditions.push(`metadata->'tags' @> $${paramIndex++}::jsonb`);
		params.push(JSON.stringify(tags));
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

	try {
		const dataQuery = `SELECT * FROM documents ${whereClause}
			ORDER BY ${safeSort} ${direction}, id ${direction}
			LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
		const dataParams = [...params, limit, offset];

		const countQuery = `SELECT count(*) FROM documents ${whereClause}`;

		const [dataResult, total] = await Promise.all([
			pgQuery<Document>(dataQuery, dataParams),
			queryCount(countQuery, params),
		]);

		return {
			documents: dataResult.rows,
			total,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to list documents', { error: message });
		throw new DatabaseError('Failed to list documents');
	}
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
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	// Get existing document first to merge metadata
	const existing = await getDocument(id);

	const setClauses: string[] = [];
	const params: unknown[] = [];
	let paramIndex = 1;

	if (input.title !== undefined) {
		setClauses.push(`title = $${paramIndex++}`);
		params.push(input.title);
	}

	if (input.tags !== undefined) {
		// Merge tags into existing metadata
		const mergedMetadata = {
			...(existing.metadata as Record<string, unknown>),
			tags: input.tags,
		};
		setClauses.push(`metadata = $${paramIndex++}`);
		params.push(JSON.stringify(mergedMetadata));
	}

	if (setClauses.length === 0) {
		return existing;
	}

	params.push(id);

	try {
		const doc = await queryOneOrThrow<Document>(
			`UPDATE documents SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
			params,
			'Document',
		);

		logger.info('Updated document', { id, updates: setClauses.map((c) => c.split(' =')[0]) });
		return doc;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to update document', { error: message });
		throw new DatabaseError('Failed to update document');
	}
}
