import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { EntityType } from '../db/memory-entities.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { isEmbeddingsConfigured } from '../services/embeddings.js';
import { configError, toolError, toolResponse } from '../utils/compact.js';
import { logger } from '../utils/logger.js';
import { validationError } from './lib/validation.js';
import { runBuildKnowledge } from './memory.js';

const EntityTypeSchema = z.enum([
	'person',
	'concept',
	'project',
	'preference',
	'fact',
	'location',
	'organization',
]);

const RememberOutputSchema = {
	ok: z.boolean(),
	factsCreated: z.number(),
	factsDuplicate: z.number(),
	relationsCreated: z.number(),
	partial: z.boolean().optional(),
	errors: z.array(z.string()).optional(),
};

/**
 * Register the `remember` workflow tool.
 *
 * Consolidates the legacy `remember_fact`, `build_knowledge`, and
 * `relate_entities` tools into one structured-knowledge write ("remember this").
 * A single fact is just `facts: [one]`. Shares the `runBuildKnowledge` core, so
 * per-item failures are collected rather than aborting the batch.
 */
export function registerRememberTool(server: McpServer): void {
	server.registerTool(
		'remember',
		{
			title: 'Remember',
			description:
				'Write structured knowledge to the memory graph. Provide `facts` (observations about entities) and/or `relations` (links between entities). At least one is required. Entities are auto-created; duplicates are skipped.',
			inputSchema: {
				facts: z
					.array(
						z.object({
							entityName: z.string().min(1).max(200),
							entityType: EntityTypeSchema,
							observation: z.string().min(1).max(2000),
							source: z
								.enum(['conversation', 'note', 'document', 'manual'])
								.optional()
								.default('conversation'),
						}),
					)
					.max(50)
					.optional()
					.describe('Facts to remember (max 50). A single fact is a one-element array.'),
				relations: z
					.array(
						z.object({
							fromEntity: z.string().min(1).max(200),
							relation: z.string().min(1).max(100),
							toEntity: z.string().min(1).max(200),
							fromEntityType: EntityTypeSchema.optional().nullable(),
							toEntityType: EntityTypeSchema.optional().nullable(),
						}),
					)
					.max(50)
					.optional()
					.describe(
						'Directed relations to create (max 50), e.g. {fromEntity, relation, toEntity}.',
					),
			},
			outputSchema: RememberOutputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ facts, relations }) => {
			logger.info('remember called', {
				factCount: facts?.length ?? 0,
				relationCount: relations?.length ?? 0,
			});

			if (!facts?.length && !relations?.length) {
				return validationError(
					'Provide at least one fact or relation. A single fact is facts: [{ entityName, entityType, observation }].',
					['facts', 'relations'],
				);
			}

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}
			if (!isEmbeddingsConfigured()) {
				return configError('Embeddings', 'Configure an embedding provider');
			}

			try {
				const { factsCreated, factsDuplicate, relationsCreated, errors } = await runBuildKnowledge({
					facts: facts as
						| Array<{
								entityName: string;
								entityType: EntityType;
								observation: string;
								source?: 'conversation' | 'note' | 'document' | 'manual';
						  }>
						| undefined,
					relations: relations as
						| Array<{
								fromEntity: string;
								relation: string;
								toEntity: string;
								fromEntityType?: EntityType | null;
								toEntityType?: EntityType | null;
						  }>
						| undefined,
				});

				const hasErrors = errors.length > 0;
				const structuredContent = {
					ok: !hasErrors,
					factsCreated,
					factsDuplicate,
					relationsCreated,
					...(hasErrors ? { partial: true, errors } : {}),
				};

				return toolResponse({
					compact: {
						ok: !hasErrors,
						...(hasErrors ? { partial: true } : {}),
						facts: { new: factsCreated, dup: factsDuplicate },
						rel: relationsCreated,
						...(hasErrors ? { err: errors } : {}),
					},
					verbose: structuredContent,
					structuredContent,
				});
			} catch (error) {
				return toolError('remember', error);
			}
		},
	);

	logger.debug('Registered tool: remember');
}
