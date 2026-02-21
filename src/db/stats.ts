import type { KnowledgeStats } from '../types/database.js';
import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient, isSupabaseConfigured } from './client.js';

export type { KnowledgeStats } from '../types/database.js';

/**
 * Gather aggregate statistics about the knowledge base, including document counts
 * by source type and content type, top tags, and the date range of stored documents.
 *
 * @returns Knowledge base statistics with totals, breakdowns, top 10 tags, and date range
 * @throws {DatabaseError} If Supabase is not configured or any of the underlying queries fail
 */
export async function getKnowledgeStats(): Promise<KnowledgeStats> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	// Get total count
	const { count: total, error: countError } = await client
		.from('documents')
		.select('*', { count: 'exact', head: true });

	if (countError) {
		logger.error('Failed to get document count', { error: countError.message });
		throw new DatabaseError('Failed to get document count');
	}

	// Get counts by source_type
	const { data: sourceTypeData, error: sourceTypeError } = await client
		.from('documents')
		.select('source_type');

	if (sourceTypeError) {
		logger.error('Failed to get source type counts', { error: sourceTypeError.message });
		throw new DatabaseError('Failed to get source type counts');
	}

	const bySourceType: Record<string, number> = {};
	for (const doc of sourceTypeData || []) {
		const st = doc.source_type || 'unknown';
		bySourceType[st] = (bySourceType[st] || 0) + 1;
	}

	// Get counts by content_type from metadata
	const { data: metadataData, error: metadataError } = await client
		.from('documents')
		.select('metadata');

	if (metadataError) {
		logger.error('Failed to get metadata', { error: metadataError.message });
		throw new DatabaseError('Failed to get metadata');
	}

	const byContentType: Record<string, number> = {};
	const tagCounts: Record<string, number> = {};

	for (const doc of metadataData || []) {
		const metadata = doc.metadata as Record<string, unknown> | null;
		if (metadata) {
			// Count content types
			const contentType = (metadata.content_type as string) || 'unknown';
			byContentType[contentType] = (byContentType[contentType] || 0) + 1;

			// Count tags
			const tags = metadata.tags as string[] | undefined;
			if (tags && Array.isArray(tags)) {
				for (const tag of tags) {
					tagCounts[tag] = (tagCounts[tag] || 0) + 1;
				}
			}
		}
	}

	// Sort tags by count and take top 10
	const topTags = Object.entries(tagCounts)
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 10);

	// Get date range
	const { data: oldestData, error: oldestError } = await client
		.from('documents')
		.select('created_at')
		.order('created_at', { ascending: true })
		.limit(1)
		.single();

	const { data: newestData, error: newestError } = await client
		.from('documents')
		.select('created_at')
		.order('created_at', { ascending: false })
		.limit(1)
		.single();

	// Handle empty database case gracefully
	const oldest = oldestError ? null : oldestData?.created_at || null;
	const newest = newestError ? null : newestData?.created_at || null;

	return {
		total: total || 0,
		bySourceType,
		byContentType,
		topTags,
		dateRange: {
			oldest,
			newest,
		},
	};
}
