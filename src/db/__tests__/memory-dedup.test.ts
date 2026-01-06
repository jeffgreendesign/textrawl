
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findSimilarObservation, SEMANTIC_SIMILARITY_THRESHOLD } from '../memory-observations.js';

// Mock dependencies
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockClient = {
  rpc: mockRpc,
  from: mockFrom,
};

vi.mock('../client.js', () => ({
  getSupabaseClient: () => mockClient,
  isSupabaseConfigured: () => true,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('Memory Deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock for exact match check (returns null/empty by default)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      })
    });
  });

  it('should return null if no embedding is provided and no exact match', async () => {
    const result = await findSimilarObservation('entity-1', 'content');
    expect(result).toBeNull();
  });

  it('should use vector search with entity filtering if embedding is provided', async () => {
    const embedding = [0.1, 0.2, 0.3];

    // Mock RPC response for no match
    mockRpc.mockResolvedValue({ data: [], error: null });

    await findSimilarObservation('entity-1', 'content', SEMANTIC_SIMILARITY_THRESHOLD, embedding);

    expect(mockRpc).toHaveBeenCalledWith('memory_semantic_search', {
      query_embedding: embedding,
      match_count: 5,
      entity_types: null,
      include_expired: false,
      filter_entity_id: 'entity-1',
    });
  });

  it('should return null if vector match is below threshold', async () => {
    const embedding = [0.1, 0.2, 0.3];

    // Mock RPC response with low similarity
    mockRpc.mockResolvedValue({
      data: [{
        entity_id: 'entity-1',
        observation_id: 'obs-1',
        similarity: 0.5
      }],
      error: null
    });

    const result = await findSimilarObservation('entity-1', 'content', SEMANTIC_SIMILARITY_THRESHOLD, embedding);
    expect(result).toBeNull();
  });

  // Note: We no longer check for "different entity" returned from RPC because the SQL query now filters by entity_id

  it('should return observation if vector match is high and entity matches', async () => {
    const embedding = [0.1, 0.2, 0.3];
    const mockObservation = { id: 'obs-1', content: 'similar content' };

    // Mock RPC response with high similarity
    mockRpc.mockResolvedValue({
      data: [{
        entity_id: 'entity-1',
        observation_id: 'obs-1',
        observation_content: 'similar content',
        similarity: 0.98
      }],
      error: null
    });

    // Mock getObservation call
    mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
                    })
                })
            })
        })
    }).mockReturnValueOnce({ // This is for the getObservation call
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockObservation, error: null })
        })
      })
    });

    const result = await findSimilarObservation('entity-1', 'content', SEMANTIC_SIMILARITY_THRESHOLD, embedding);
    expect(result).toEqual(mockObservation);
  });
});
