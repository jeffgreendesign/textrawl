/**
 * Textrawl type definitions
 *
 * Centralized exports for all database row types and domain types.
 * Import from here for quick access to any type used across the codebase.
 */

export type {
	Chunk,
	ConversationSearchResult,
	// Conversations
	ConversationSession,
	ConversationTurn,
	// Document & Search
	Document,
	EntityContext,
	// Memory
	EntityType,
	InsightStatus,
	// Insights
	InsightType,
	// Stats
	KnowledgeStats,
	MemoryEntity,
	MemoryObservation,
	MemoryRelation,
	MemorySearchResult,
	ObservationSource,
	ProactiveInsight,
	SearchResult,
	TurnSearchResult,
} from './database.js';
