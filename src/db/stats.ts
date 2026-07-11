import type { KnowledgeStats } from '../types/database.js';
import { DatabaseError } from '../utils/errors.js';
import { isDatabaseConfigured, pgQuery, queryCount } from './pg-client.js';

export type { KnowledgeStats } from '../types/database.js';

/**
 * Gather aggregate statistics about the knowledge base, including document counts
 * by source type and content type, top tags, and the date range of stored documents.
 *
 * @returns Knowledge base statistics with totals, breakdowns, top 10 tags, and date range
 * @throws {DatabaseError} If the database is not configured or any of the underlying queries fail
 */
export async function getKnowledgeStats(): Promise<KnowledgeStats> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	// Run independent queries in parallel
	const [total, sourceTypeResult, metadataResult, oldestResult, newestResult] = await Promise.all([
		queryCount('SELECT count(*) FROM documents'),

		pgQuery<{ source_type: string | null }>('SELECT source_type FROM documents'),

		pgQuery<{ metadata: Record<string, unknown> | null }>('SELECT metadata FROM documents'),

		pgQuery<{ created_at: Date | string }>(
			'SELECT created_at FROM documents ORDER BY created_at ASC LIMIT 1',
		),

		pgQuery<{ created_at: Date | string }>(
			'SELECT created_at FROM documents ORDER BY created_at DESC LIMIT 1',
		),
	]);

	// Aggregate source types
	const bySourceType: Record<string, number> = {};
	for (const doc of sourceTypeResult.rows) {
		const st = doc.source_type || 'unknown';
		bySourceType[st] = (bySourceType[st] || 0) + 1;
	}

	// Aggregate content types and tags from metadata
	const byContentType: Record<string, number> = {};
	const tagCounts: Record<string, number> = {};

	for (const doc of metadataResult.rows) {
		const metadata = doc.metadata;
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

	// Date range (empty database returns null)
	// pg driver returns Date objects for TIMESTAMPTZ — convert at source
	const oldestRaw = oldestResult.rows[0]?.created_at ?? null;
	const newestRaw = newestResult.rows[0]?.created_at ?? null;
	const oldest = oldestRaw instanceof Date ? oldestRaw.toISOString() : oldestRaw;
	const newest = newestRaw instanceof Date ? newestRaw.toISOString() : newestRaw;

	return {
		total,
		bySourceType,
		byContentType,
		topTags,
		dateRange: {
			oldest,
			newest,
		},
	};
}
