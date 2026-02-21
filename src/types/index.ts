/**
 * Textrawl type definitions
 *
 * Centralized exports for all database row types and domain types.
 * Import from here for quick access to any type used across the codebase.
 */

export type {
	// Document & Search
	Document,
	Chunk,
	SearchResult,
	// Memory
	EntityType,
	MemoryEntity,
	ObservationSource,
	MemoryObservation,
	MemoryRelation,
	MemorySearchResult,
	EntityContext,
	// Conversations
	ConversationSession,
	ConversationTurn,
	ConversationSearchResult,
	TurnSearchResult,
	// Insights
	InsightType,
	InsightStatus,
	ProactiveInsight,
	// Stats
	KnowledgeStats,
} from './database.js';
