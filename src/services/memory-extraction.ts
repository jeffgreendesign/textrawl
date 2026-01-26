import Anthropic from '@anthropic-ai/sdk';
import { type EntityType, getOrCreateEntity } from '../db/memory-entities.js';
import {
	type ObservationSource,
	createObservation,
	findSimilarObservation,
} from '../db/memory-observations.js';
import { getOrCreateRelation } from '../db/memory-relations.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { generateEmbedding } from './embeddings.js';

/**
 * Extracted entity from text
 */
export interface ExtractedEntity {
	name: string;
	type: EntityType;
	observations: string[];
}

/**
 * Extracted relation from text
 */
export interface ExtractedRelation {
	from: string;
	relation: string;
	to: string;
}

/**
 * Result of memory extraction
 */
export interface ExtractionResult {
	entities: ExtractedEntity[];
	relations: ExtractedRelation[];
}

/**
 * Result of storing extracted memories
 */
export interface StorageResult {
	entitiesCreated: number;
	entitiesExisting: number;
	observationsCreated: number;
	observationsDuplicate: number;
	relationsCreated: number;
	errors: string[];
}

/**
 * The prompt for extracting entities and facts from text
 */
const EXTRACTION_PROMPT = `Analyze the following text and extract structured memory data.

Extract:
1. Named entities (people, organizations, projects, concepts, locations)
2. Atomic facts about each entity (single, specific facts)
3. Relationships between entities

Return ONLY valid JSON with this exact structure:
{
  "entities": [
    {
      "name": "entity name (use proper case for names, lowercase for concepts)",
      "type": "person|concept|project|preference|fact|location|organization",
      "observations": ["atomic fact 1", "atomic fact 2"]
    }
  ],
  "relations": [
    {
      "from": "source entity name",
      "relation": "works_at|knows|prefers|created|part_of|related_to|manages|uses|located_in",
      "to": "target entity name"
    }
  ]
}

Rules:
- Only extract EXPLICITLY stated facts, never inferences
- Each observation must be a single, atomic fact (one idea per observation)
- Use the exact entity name as it appears in the text
- Skip generic or trivial information
- For people, use their full name if available
- Confidence: only include facts you're highly confident about
- If no entities or relations are found, return empty arrays

Text to analyze:`;

let anthropicClient: Anthropic | null = null;

/**
 * Check if memory extraction is configured and enabled
 */
export function isExtractionConfigured(): boolean {
	return !!(config.ENABLE_MEMORY_EXTRACTION && config.ANTHROPIC_API_KEY);
}

/**
 * Get or create Anthropic client
 */
function getAnthropicClient(): Anthropic {
	if (!anthropicClient) {
		if (!config.ANTHROPIC_API_KEY) {
			throw new Error('ANTHROPIC_API_KEY is required for memory extraction');
		}
		anthropicClient = new Anthropic({
			apiKey: config.ANTHROPIC_API_KEY,
		});
	}
	return anthropicClient;
}

/**
 * Extract entities and facts from text using Claude
 */
export async function extractMemoriesFromText(text: string): Promise<ExtractionResult> {
	if (!isExtractionConfigured()) {
		throw new Error(
			'Memory extraction not configured. Set ENABLE_MEMORY_EXTRACTION=true and ANTHROPIC_API_KEY',
		);
	}

	const client = getAnthropicClient();

	// Truncate text if too long (keep under 10k tokens)
	const maxChars = 30000; // ~7500 tokens
	const truncatedText =
		text.length > maxChars ? text.slice(0, maxChars) + '\n\n[Text truncated...]' : text;

	logger.info('Extracting memories from text', {
		originalLength: text.length,
		truncatedLength: truncatedText.length,
		model: config.EXTRACTION_MODEL,
	});

	const startTime = Date.now();

	try {
		const response = await client.messages.create({
			model: config.EXTRACTION_MODEL,
			max_tokens: 2000,
			messages: [
				{
					role: 'user',
					content: `${EXTRACTION_PROMPT}\n\n${truncatedText}`,
				},
			],
		});

		const latencyMs = Date.now() - startTime;
		logger.debug('Extraction API call completed', {
			latencyMs,
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
		});

		// Extract text from response
		const textContent = response.content.find((c) => c.type === 'text');
		if (!textContent || textContent.type !== 'text') {
			logger.warn('No text content in extraction response');
			return { entities: [], relations: [] };
		}

		// Parse JSON from response
		const jsonText = textContent.text.trim();

		// Try to extract JSON from the response (it might be wrapped in markdown)
		let jsonContent = jsonText;
		const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
		if (jsonMatch) {
			jsonContent = jsonMatch[1];
		}

		try {
			const parsed = JSON.parse(jsonContent) as ExtractionResult;

			// Validate structure
			if (!Array.isArray(parsed.entities)) {
				parsed.entities = [];
			}
			if (!Array.isArray(parsed.relations)) {
				parsed.relations = [];
			}

			// Validate and filter entities
			parsed.entities = parsed.entities.filter((e) => {
				if (!e.name || typeof e.name !== 'string') return false;
				if (!e.type || !isValidEntityType(e.type)) return false;
				if (!Array.isArray(e.observations)) {
					e.observations = [];
				}
				e.observations = e.observations.filter((o) => typeof o === 'string' && o.trim().length > 0);
				return e.name.trim().length > 0;
			});

			// Validate and filter relations
			parsed.relations = parsed.relations.filter((r) => {
				return (
					r.from &&
					typeof r.from === 'string' &&
					r.to &&
					typeof r.to === 'string' &&
					r.relation &&
					typeof r.relation === 'string'
				);
			});

			logger.info('Extraction completed', {
				entityCount: parsed.entities.length,
				relationCount: parsed.relations.length,
				latencyMs,
			});

			return parsed;
		} catch (parseError) {
			logger.error('Failed to parse extraction response', {
				error: parseError instanceof Error ? parseError.message : String(parseError),
				response: jsonContent.slice(0, 500),
			});
			return { entities: [], relations: [] };
		}
	} catch (error) {
		logger.error('Memory extraction failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

/**
 * Validate entity type
 */
function isValidEntityType(type: string): type is EntityType {
	return [
		'person',
		'concept',
		'project',
		'preference',
		'fact',
		'location',
		'organization',
	].includes(type);
}

/**
 * Store extracted memories in the database
 */
export async function storeExtractedMemories(
	extraction: ExtractionResult,
	source: ObservationSource = 'extraction',
): Promise<StorageResult> {
	const result: StorageResult = {
		entitiesCreated: 0,
		entitiesExisting: 0,
		observationsCreated: 0,
		observationsDuplicate: 0,
		relationsCreated: 0,
		errors: [],
	};

	// Track entity name -> ID mapping for relations
	const entityIdMap = new Map<string, string>();

	// Process entities
	for (const entity of extraction.entities) {
		try {
			// Get or create entity
			const dbEntity = await getOrCreateEntity({
				name: entity.name.trim(),
				entityType: entity.type,
			});

			entityIdMap.set(entity.name.toLowerCase(), dbEntity.id);

			// Check if entity was just created by comparing timestamps
			// If created_at equals updated_at, the entity was just created
			const isNewEntity = dbEntity.created_at === dbEntity.updated_at;
			if (isNewEntity) {
				result.entitiesCreated++;
			} else {
				result.entitiesExisting++;
			}

			// Process observations
			for (const observation of entity.observations) {
				try {
					// Check for duplicate
					const existing = await findSimilarObservation(dbEntity.id, observation);
					if (existing) {
						result.observationsDuplicate++;
						continue;
					}

					// Generate embedding for observation
					const embedding = await generateEmbedding(observation);

					// Create observation
					await createObservation({
						entityId: dbEntity.id,
						content: observation,
						source,
						embedding,
						validUntil: null,
					});
					result.observationsCreated++;
				} catch (obsError) {
					result.errors.push(
						`Failed to create observation for ${entity.name}: ${obsError instanceof Error ? obsError.message : String(obsError)}`,
					);
				}
			}
		} catch (entityError) {
			result.errors.push(
				`Failed to create entity ${entity.name}: ${entityError instanceof Error ? entityError.message : String(entityError)}`,
			);
		}
	}

	// Process relations
	for (const relation of extraction.relations) {
		try {
			// Get entity IDs (must already exist from entities processing)
			const fromId = entityIdMap.get(relation.from.toLowerCase());
			const toId = entityIdMap.get(relation.to.toLowerCase());

			if (!fromId) {
				// Try to get or create the entity
				const fromEntity = await getOrCreateEntity({
					name: relation.from.trim(),
					entityType: 'concept', // Default type
				});
				entityIdMap.set(relation.from.toLowerCase(), fromEntity.id);
			}

			if (!toId) {
				const toEntity = await getOrCreateEntity({
					name: relation.to.trim(),
					entityType: 'concept',
				});
				entityIdMap.set(relation.to.toLowerCase(), toEntity.id);
			}

			const finalFromId = entityIdMap.get(relation.from.toLowerCase())!;
			const finalToId = entityIdMap.get(relation.to.toLowerCase())!;

			await getOrCreateRelation({
				fromEntityId: finalFromId,
				toEntityId: finalToId,
				relationType: relation.relation,
			});
			result.relationsCreated++;
		} catch (relError) {
			result.errors.push(
				`Failed to create relation ${relation.from} -> ${relation.to}: ${relError instanceof Error ? relError.message : String(relError)}`,
			);
		}
	}

	logger.info('Stored extracted memories', {
		entitiesExisting: result.entitiesExisting,
		observationsCreated: result.observationsCreated,
		observationsDuplicate: result.observationsDuplicate,
		relationsCreated: result.relationsCreated,
		errorCount: result.errors.length,
	});

	return result;
}

/**
 * Extract and store memories from text in one call
 */
export async function extractAndStoreMemories(
	text: string,
	source: ObservationSource = 'extraction',
): Promise<{
	extraction: ExtractionResult;
	storage: StorageResult;
}> {
	const extraction = await extractMemoriesFromText(text);
	const storage = await storeExtractedMemories(extraction, source);
	return { extraction, storage };
}
