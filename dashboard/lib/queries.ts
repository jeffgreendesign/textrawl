/**
 * React Query hooks for all Textrawl data fetching.
 * Provides caching, background refetching, and stale-while-revalidate.
 */
import { keepPreviousData, type UseQueryOptions, useQuery } from '@tanstack/react-query';

import {
	type ConversationDetail,
	type ConversationSession,
	checkHealth,
	type Document,
	type EntityContext,
	fetchConversation,
	fetchConversations,
	fetchInsightStats,
	fetchInsights,
	fetchMemoryEntities,
	fetchMemoryEntity,
	fetchMemoryGraph,
	fetchStats,
	fetchStatus,
	getDocument,
	type HealthResult,
	type InsightItem,
	type InsightStats,
	listDocuments,
	type MemoryEntity,
	type MemoryGraph,
	type Stats,
	type StatusResponse,
	search,
	searchConversations,
} from './api';

// --- Query Keys ---

export const queryKeys = {
	health: ['health'] as const,
	status: ['status'] as const,
	stats: ['stats'] as const,
	documents: (limit: number, offset: number) => ['documents', limit, offset] as const,
	document: (id: string) => ['document', id] as const,
	search: (query: string) => ['search', query] as const,
	memoryGraph: (limit: number) => ['memory', 'graph', limit] as const,
	memoryEntities: (limit: number, offset: number, types?: string[]) =>
		['memory', 'entities', limit, offset, types] as const,
	memoryEntity: (name: string) => ['memory', 'entity', name] as const,
	conversations: (limit: number, offset: number) => ['conversations', limit, offset] as const,
	conversation: (id: string) => ['conversation', id] as const,
	conversationSearch: (query: string) => ['conversations', 'search', query] as const,
	insights: (options: { status?: string; type?: string; limit?: number; offset?: number }) =>
		['insights', options] as const,
	insightStats: ['insights', 'stats'] as const,
};

// --- Existing Hooks ---

export function useHealth() {
	return useQuery<HealthResult>({
		queryKey: queryKeys.health,
		queryFn: checkHealth,
		refetchInterval: 30_000,
		staleTime: 10_000,
	});
}

export function useStatus() {
	return useQuery<StatusResponse>({
		queryKey: queryKeys.status,
		queryFn: fetchStatus,
		staleTime: 60_000,
		retry: 1,
	});
}

export function useStats() {
	return useQuery<Stats>({
		queryKey: queryKeys.stats,
		queryFn: fetchStats,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
	});
}

export function useDocuments(limit = 20, offset = 0) {
	return useQuery({
		queryKey: queryKeys.documents(limit, offset),
		queryFn: () => listDocuments(limit, offset),
		staleTime: 30_000,
		placeholderData: keepPreviousData,
	});
}

export function useDocument(id: string, options?: Partial<UseQueryOptions<Document>>) {
	return useQuery<Document>({
		queryKey: queryKeys.document(id),
		queryFn: () => getDocument(id),
		staleTime: 60_000,
		enabled: !!id,
		...options,
	});
}

export function useSearch(query: string) {
	return useQuery({
		queryKey: queryKeys.search(query),
		queryFn: () => search(query, 10),
		enabled: query.length > 0,
		staleTime: 60_000,
	});
}

// --- Memory Hooks ---

export function useMemoryGraph(limit = 200) {
	return useQuery<MemoryGraph>({
		queryKey: queryKeys.memoryGraph(limit),
		queryFn: () => fetchMemoryGraph(limit),
		staleTime: 60_000,
	});
}

export function useMemoryEntities(limit = 50, offset = 0, types?: string[]) {
	return useQuery<{ entities: MemoryEntity[]; total: number }>({
		queryKey: queryKeys.memoryEntities(limit, offset, types),
		queryFn: () => fetchMemoryEntities(limit, offset, types),
		staleTime: 30_000,
		placeholderData: keepPreviousData,
	});
}

export function useMemoryEntity(name: string) {
	return useQuery<EntityContext>({
		queryKey: queryKeys.memoryEntity(name),
		queryFn: () => fetchMemoryEntity(name),
		staleTime: 60_000,
		enabled: !!name,
	});
}

// --- Conversation Hooks ---

export function useConversations(limit = 20, offset = 0) {
	return useQuery<{ sessions: ConversationSession[]; total: number }>({
		queryKey: queryKeys.conversations(limit, offset),
		queryFn: () => fetchConversations(limit, offset),
		staleTime: 30_000,
		placeholderData: keepPreviousData,
	});
}

export function useConversation(id: string) {
	return useQuery<ConversationDetail>({
		queryKey: queryKeys.conversation(id),
		queryFn: () => fetchConversation(id),
		staleTime: 60_000,
		enabled: !!id,
	});
}

export function useConversationSearch(query: string, limit?: number) {
	return useQuery({
		queryKey: queryKeys.conversationSearch(query),
		queryFn: () => searchConversations(query, limit),
		enabled: query.length > 0,
		staleTime: 60_000,
	});
}

// --- Insight Hooks ---

export function useInsights(
	options: { status?: string; type?: string; limit?: number; offset?: number } = {},
) {
	return useQuery<{ insights: InsightItem[]; total: number }>({
		queryKey: queryKeys.insights(options),
		queryFn: () => fetchInsights(options),
		staleTime: 30_000,
	});
}

export function useInsightStats() {
	return useQuery<InsightStats>({
		queryKey: queryKeys.insightStats,
		queryFn: fetchInsightStats,
		staleTime: 30_000,
	});
}
