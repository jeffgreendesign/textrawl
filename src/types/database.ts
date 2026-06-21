/**
 * Consolidated database row types for all Textrawl tables.
 *
 * These types represent the shape of data returned by Supabase queries.
 * They are the canonical TypeScript representation of the PostgreSQL schema.
 *
 * Re-exported from individual src/db/ modules for backward compatibility.
 */

// ============================================================================
// Document & Search types (tables: documents, chunks)
// ============================================================================

/** A document in the knowledge base */
export interface Document {
	id: string;
	title: string;
	source_type: 'note' | 'file' | 'url';
	source_url: string | null;
	file_path: string | null;
	raw_content: string;
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

/** A chunk of a document with optional vector embedding */
export interface Chunk {
	id: string;
	document_id: string;
	content: string;
	chunk_index: number;
	start_offset: number | null;
	end_offset: number | null;
	embedding: number[] | null;
	metadata: Record<string, unknown>;
	created_at: string;
}

/** A result from the hybrid_search() RPC */
export interface SearchResult {
	chunk_id: string;
	document_id: string;
	content: string;
	document_title: string;
	source_type: 'note' | 'file' | 'url';
	document_metadata: Record<string, unknown> | null;
	score: number;
}

// ============================================================================
// Memory types (tables: memory_entities, memory_observations, memory_relations)
// ============================================================================

/** Entity type enum — classifies the kind of entity in the memory graph */
export type EntityType =
	| 'person'
	| 'concept'
	| 'project'
	| 'preference'
	| 'fact'
	| 'location'
	| 'organization';

/** A named entity in the memory graph */
export interface MemoryEntity {
	id: string;
	name: string;
	entity_type: EntityType;
	description: string | null;
	embedding: number[] | null;
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

/** Source attribution for an observation */
export type ObservationSource = 'conversation' | 'note' | 'document' | 'manual' | 'extraction';

/** An atomic fact about an entity */
export interface MemoryObservation {
	id: string;
	entity_id: string;
	content: string;
	source: ObservationSource;
	confidence: number;
	valid_from: string;
	valid_until: string | null;
	embedding: number[] | null;
	metadata: Record<string, unknown>;
	created_at: string;
}

/** A directed relationship between two entities */
export interface MemoryRelation {
	id: string;
	from_entity_id: string;
	to_entity_id: string;
	relation_type: string;
	strength: number;
	metadata: Record<string, unknown>;
	created_at: string;
}

/** Result from memory_hybrid_search() or memory_semantic_search() RPCs */
export interface MemorySearchResult {
	entity_id: string;
	entity_name: string;
	entity_type: EntityType;
	observation_id: string;
	observation_content: string;
	source: ObservationSource;
	confidence: number;
	score: number;
}

/** Full context for an entity including observations and relations */
export interface EntityContext {
	entity_id: string;
	entity_name: string;
	entity_type: EntityType;
	entity_description: string | null;
	observations: Array<{
		id: string;
		content: string;
		source: ObservationSource;
		confidence: number;
		created_at: string;
	}>;
	outgoing_relations: Array<{
		relation_type: string;
		to_entity: string;
		to_entity_type: EntityType;
		strength: number;
	}>;
	incoming_relations: Array<{
		relation_type: string;
		from_entity: string;
		from_entity_type: EntityType;
		strength: number;
	}>;
}

// ============================================================================
// Conversation types (tables: conversation_sessions, conversation_turns)
// ============================================================================

/** A conversation session with summary and metadata */
export interface ConversationSession {
	id: string;
	session_key: string | null;
	title: string | null;
	summary: string | null;
	summary_embedding: number[] | null;
	metadata: Record<string, unknown>;
	turn_count: number;
	last_activity: string;
	created_at: string;
}

/** A single message turn within a conversation */
export interface ConversationTurn {
	id: string;
	session_id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	embedding: number[] | null;
	turn_index: number;
	token_count: number | null;
	metadata: Record<string, unknown>;
	created_at: string;
}

/** Result from conversation_hybrid_search() RPC */
export interface ConversationSearchResult {
	session_id: string;
	session_key: string | null;
	title: string | null;
	summary: string | null;
	turn_count: number;
	last_activity: string;
	score: number;
}

/** Result from searching individual conversation turns */
export interface TurnSearchResult {
	turn_id: string;
	session_id: string;
	role: string;
	content: string;
	turn_index: number;
	created_at: string;
	score: number;
}

// ============================================================================
// Insight types (table: proactive_insights)
// ============================================================================

/** Type of proactive insight discovered by the system */
export type InsightType =
	| 'cross_source'
	| 'theme_cluster'
	| 'entity_bridge'
	| 'temporal_pattern'
	| 'outlier';

/** Status of an insight in the discovery queue */
export type InsightStatus = 'new' | 'seen' | 'dismissed';

/** A proactive insight discovered from cross-referencing knowledge */
export interface ProactiveInsight {
	id: string;
	insight_type: InsightType;
	title: string;
	summary: string;
	evidence: Array<{
		chunkId: string;
		documentId: string;
		documentTitle?: string;
		content: string;
		score: number;
		sourceType?: string;
	}>;
	entities: string[];
	batch_id: string | null;
	status: InsightStatus;
	created_at: string;
	score?: number;
}

// ============================================================================
// Claims types (table: claims)
// ============================================================================

/** Review status of a claim. */
export type ClaimStatus = 'unreviewed' | 'approved' | 'rejected';

/** Lifecycle state of a claim relative to newer knowledge. */
export type ClaimState = 'current' | 'stale' | 'conflicting' | 'superseded';

/** Privacy classification for a claim. */
export type ClaimSensitivity = 'normal' | 'sensitive' | 'restricted';

/**
 * A source-backed claim packet.
 *
 * Anchored to a single chunk: `source_quote` is a verbatim slice of
 * `chunks.content`, and `source_start_offset`/`source_end_offset` are UTF-16
 * code-unit indices into `chunks.content` (not `documents.raw_content`) — the
 * provenance invariant enforced by `src/utils/source-span.ts`.
 *
 * `embedding` is nullable: no embedding pipeline writes claims yet; a future
 * retrieval PR backfills it. The generated `fts` column is intentionally omitted.
 */
export interface Claim {
	id: string;
	claim_text: string;
	question: string | null;
	document_id: string;
	chunk_id: string;
	source_quote: string;
	source_start_offset: number;
	source_end_offset: number;
	confidence: number | null;
	status: ClaimStatus;
	state: ClaimState;
	superseded_by: string | null;
	tags: string[];
	entities: Array<Record<string, unknown>>;
	sensitivity: ClaimSensitivity;
	embedding: number[] | null;
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

// ============================================================================
// Stats types
// ============================================================================

/** Aggregated knowledge base statistics */
export interface KnowledgeStats {
	total: number;
	bySourceType: Record<string, number>;
	byContentType: Record<string, number>;
	topTags: Array<{ tag: string; count: number }>;
	dateRange: { oldest: string | null; newest: string | null };
}
