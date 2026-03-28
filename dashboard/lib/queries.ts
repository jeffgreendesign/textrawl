/**
 * React Query hooks for all Textrawl data fetching.
 * Provides caching, background refetching, and stale-while-revalidate.
 */
import { type UseQueryOptions, keepPreviousData, useQuery } from '@tanstack/react-query';

import {
	type Document,
	type HealthResult,
	type Stats,
	type StatusResponse,
	checkHealth,
	fetchStats,
	fetchStatus,
	getDocument,
	listDocuments,
	search,
} from './api';

// --- Query Keys ---

export const queryKeys = {
	health: ['health'] as const,
	status: ['status'] as const,
	stats: ['stats'] as const,
	documents: (limit: number, offset: number) => ['documents', limit, offset] as const,
	document: (id: string) => ['document', id] as const,
	search: (query: string) => ['search', query] as const,
};

// --- Hooks ---

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
