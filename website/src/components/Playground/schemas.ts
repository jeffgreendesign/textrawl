export type ToolName =
  | 'search_knowledge'
  | 'get_document'
  | 'list_documents'
  | 'update_document'
  | 'add_note';

export interface ParameterSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'enum';
  required: boolean;
  default?: unknown;
  description: string;
  options?: string[]; // For enum type
  min?: number;
  max?: number;
}

export interface ToolSchema {
  name: ToolName;
  description: string;
  parameters: ParameterSchema[];
}

export const TOOL_SCHEMAS: Record<ToolName, ToolSchema> = {
  search_knowledge: {
    name: 'search_knowledge',
    description: 'Hybrid semantic + full-text search using Reciprocal Rank Fusion',
    parameters: [
      { name: 'query', type: 'string', required: true, description: 'Natural language search query' },
      { name: 'limit', type: 'number', required: false, default: 10, min: 1, max: 50, description: 'Maximum results' },
      { name: 'fullTextWeight', type: 'number', required: false, default: 1.0, min: 0, max: 2, description: 'Keyword matching weight' },
      { name: 'semanticWeight', type: 'number', required: false, default: 1.0, min: 0, max: 2, description: 'Semantic similarity weight' },
      { name: 'sourceType', type: 'enum', required: false, options: ['note', 'file', 'url'], description: 'Filter by source type' },
      { name: 'minScore', type: 'number', required: false, min: 0, max: 1, description: 'Minimum relevance score' },
    ],
  },
  get_document: {
    name: 'get_document',
    description: 'Retrieve full document content by ID',
    parameters: [
      { name: 'documentId', type: 'string', required: true, description: 'Document UUID' },
      { name: 'includeChunks', type: 'boolean', required: false, default: false, description: 'Include document chunks' },
    ],
  },
  list_documents: {
    name: 'list_documents',
    description: 'List documents with pagination and filtering',
    parameters: [
      { name: 'limit', type: 'number', required: false, default: 20, min: 1, max: 100, description: 'Documents per page' },
      { name: 'offset', type: 'number', required: false, default: 0, min: 0, description: 'Pagination offset' },
      { name: 'sourceType', type: 'enum', required: false, options: ['note', 'file', 'url'], description: 'Filter by source type' },
    ],
  },
  update_document: {
    name: 'update_document',
    description: 'Update document title and/or tags',
    parameters: [
      { name: 'documentId', type: 'string', required: true, description: 'Document UUID' },
      { name: 'title', type: 'string', required: false, description: 'New title' },
    ],
  },
  add_note: {
    name: 'add_note',
    description: 'Create markdown notes with automatic embedding',
    parameters: [
      { name: 'title', type: 'string', required: true, description: 'Note title (max 500 chars)' },
      { name: 'content', type: 'string', required: true, description: 'Markdown content' },
    ],
  },
};

export const DEMO_RESPONSES: Record<ToolName, unknown> = {
  search_knowledge: {
    query: 'quarterly planning',
    filters: { tags: null, sourceType: null, minScore: null },
    totalResults: 3,
    results: [
      {
        documentId: '550e8400-e29b-41d4-a716-446655440000',
        documentTitle: 'Q4 Planning Notes',
        sourceType: 'note',
        tags: ['work', 'planning', 'q4'],
        chunkId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        content: 'In the Q4 planning meeting, we discussed the roadmap for the next quarter. Key priorities include launching the mobile app and improving search performance...',
        score: 0.89,
      },
      {
        documentId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        documentTitle: 'Annual Planning Overview',
        sourceType: 'note',
        tags: ['work', 'planning'],
        chunkId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        content: 'Quarterly milestones should align with company objectives. Each quarter builds on the previous...',
        score: 0.76,
      },
      {
        documentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        documentTitle: 'Team Sync Notes - March',
        sourceType: 'note',
        tags: ['meetings', 'team'],
        chunkId: 'deadbeef-cafe-babe-1234-567890abcdef',
        content: 'Discussed quarterly targets and resource allocation for upcoming projects...',
        score: 0.65,
      },
    ],
  },
  get_document: {
    document: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Q4 Planning Notes',
      sourceType: 'note',
      sourceUrl: null,
      content: '# Q4 Planning Notes\n\nIn the Q4 planning meeting, we discussed the roadmap for the next quarter.\n\n## Key Priorities\n\n1. Launch mobile app v2.0\n2. Improve search performance by 50%\n3. Add collaborative features\n\n## Timeline\n\n- October: Mobile app beta\n- November: Performance improvements\n- December: Collaboration features\n\n## Action Items\n\n- [ ] Design review for mobile app\n- [ ] Performance benchmarking\n- [ ] User research for collaboration',
      metadata: { tags: ['work', 'planning', 'q4'] },
      createdAt: '2024-10-15T10:30:00.000Z',
      updatedAt: '2024-10-15T14:22:00.000Z',
    },
  },
  list_documents: {
    documents: [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Q4 Planning Notes',
        sourceType: 'note',
        tags: ['work', 'planning', 'q4'],
        createdAt: '2024-10-15T10:30:00.000Z',
        updatedAt: '2024-10-15T14:22:00.000Z',
      },
      {
        id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        title: 'Annual Planning Overview',
        sourceType: 'note',
        tags: ['work', 'planning'],
        createdAt: '2024-09-01T09:00:00.000Z',
        updatedAt: '2024-09-01T09:00:00.000Z',
      },
      {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        title: 'Team Sync Notes - March',
        sourceType: 'note',
        tags: ['meetings', 'team'],
        createdAt: '2024-03-15T14:00:00.000Z',
        updatedAt: '2024-03-15T14:00:00.000Z',
      },
    ],
    pagination: {
      limit: 20,
      offset: 0,
      total: 47,
      hasMore: true,
    },
  },
  update_document: {
    success: true,
    document: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Q4 2024 Planning Notes - Final',
      sourceType: 'note',
      tags: ['work', 'planning', 'q4', 'finalized'],
      updatedAt: '2024-10-20T16:45:00.000Z',
    },
  },
  add_note: {
    success: true,
    documentId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    title: 'New Note Title',
    chunksCreated: 2,
    message: 'Note saved and indexed for search.',
  },
};
