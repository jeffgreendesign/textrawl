# Research: Recent Advancements (January 2026)

This document summarizes recent advancements and techniques relevant to Textrawl discovered during research on January 24, 2026.

## MCP Protocol Updates

### MCP Tool Search / Lazy Loading (Jan 15, 2026)

Anthropic released MCP Tool Search that introduces "lazy loading" for tools. When tool descriptions exceed 10% of context window, they're dynamically discovered via search instead of loaded upfront.

- Token usage reduced from ~134k to ~5k (85% reduction)
- MCP evaluation accuracy improved from 49% to 74% for Opus 4

**Relevance:** If Textrawl grows to have many tools, this pattern prevents context bloat.

### Active SEPs (Spec Enhancement Proposals)

- **DPoP extension** for authentication
- **Multi-turn SSE** for transport
- **Server Cards** for discovery - could improve Textrawl discoverability

### Multimodal MCP

Protocol is expanding to support images, video, and audio in 2026. Current text-only approach could eventually expand.

### Governance Update

MCP was donated to the Agentic AI Foundation (Linux Foundation) in December 2025, co-founded by Anthropic, Block, and OpenAI. Now has open governance.

---

## Vector Database: pgvectorscale

### DiskANN Extension

The pgvectorscale extension with DiskANN is the 2026 game-changer for vector databases:

- Allows vector index to live on SSD instead of RAM
- Viable up to ~50M vectors on modest hardware
- Longer initial build time (~40min for 10M vectors)
- Runs on cheaper hardware after build

**Current State:** Textrawl uses HNSW index which is RAM-bound. For large-scale deployments, pgvectorscale could significantly reduce costs.

**Consideration:** Evaluate pgvectorscale when approaching RAM limits or planning for scale.

---

## Advanced RAG Techniques

### New Approaches (January 2026)

| Technique | Description | Textrawl Relevance |
|-----------|-------------|-------------------|
| **HiFi-RAG** | Multi-stage filtering with query reformulation before generation | Could improve `hybrid_search()` |
| **QuCo-RAG** | Dynamic retrieval based on entity rarity - flags rare entities to reduce hallucinations | Relevant to memory tools |
| **Bidirectional RAG** | Write-back to corpus with grounding checks (NLI entailment, source attribution) | Relevant to `add_note` tool |
| **MiA-RAG** | Mindscape-Aware - builds high-level summaries for long documents | Could improve document processing |
| **MegaRAG** | Multimodal knowledge graphs for long documents | Future consideration |

### Google's "Sufficient Context" Research

Published at ICLR 2025, now implemented in Vertex AI RAG Engine:

1. Add sufficiency check before generation
2. Re-rank retrieved contexts based on relevance
3. Tune abstention threshold with confidence signals

**Implementation Ideas:**
- Add relevance re-ranking as optional step after `hybrid_search()`
- Consider context sufficiency scoring before returning results

---

## Chunking Strategies

### Adaptive Chunking

Current Textrawl approach: Fixed 512-token chunks with 50-token overlap.

**Adaptive Alternative:**
- Smaller chunks for information-dense paragraphs
- Larger chunks for general/introductory sections
- Uses ML models to analyze semantic density

**Research Results:**
- Clinical study: 87% accuracy vs 50% baseline with adaptive chunking
- Precision 0.50, recall 0.88, F1 0.64 (vs baseline 0.17, 0.40, 0.24)

### Max-Min Semantic Chunking

Novel method using semantic similarity and Max-Min algorithm:
- Average AMI scores of 0.85-0.90
- Significantly outperformed other methods on "hard questions"

### Recommended Hybrid Approach

Semantic-first with size constraints:
- Detect semantic boundaries using embeddings
- Enforce minimum (200 tokens) and maximum (1000 tokens) constraints
- Merge chunks that are too small
- Split oversized chunks within semantic sections

---

## Hybrid Search Improvements

### Weighted RRF (Elasticsearch, Sept 2025)

Current RRF implementation uses uniform weighting. Weighted RRF improvements:

```
Each retriever gets its own weight parameter:
- semantic_weight: 1.0
- fts_weight: 0.8
```

### OpenSearch 2.19 RRF (Nov 2025)

Planning improvements:
- Z-score normalization
- Custom normalization functions
- Configurable handling of missing items (currently default to 0.0)
- Using `max_rank + 1` for missing items

### Linear Retriever Alternative

While RRF focuses on ranks (ignoring scores), linear retriever:
- Calculates weighted sum across queries
- Supports MinMax normalization
- Easier to tune and optimize

---

## Embedding Models

### OpenAI (Current: text-embedding-3-small)

No new models in past 30 days. text-embedding-3-small and text-embedding-3-large remain current.

**Note:** Mistral-embed achieved highest accuracy (77.8%) in recent benchmarks, outperforming text-embedding-3-large.

### Ollama: nomic-embed-text-v2-moe

Major upgrade from current nomic-embed-text:

| Feature | v1 | v2-moe |
|---------|-----|--------|
| Architecture | Standard | Mixture of Experts |
| Parameters | - | 475M total, 305M active |
| Languages | English-focused | ~100 languages |
| Dimensions | 1024 fixed | 768 (flexible to 256 via Matryoshka) |
| Performance | Good | Outperforms models 2x its size |

**Matryoshka Embeddings:** Can reduce dimensions from 768 to 256 with minimal performance loss = 3x storage reduction.

**Recommendation:** Consider upgrading Ollama users to nomic-embed-text-v2-moe.

---

## Priority Recommendations

### High Priority (High value, low effort)

1. **Upgrade Ollama embedding model** to `nomic-embed-text-v2-moe`
   - Better performance, multilingual, Matryoshka support
   - Note: Different dimensions (768 vs 1024) - requires re-embedding

### Medium Priority (Medium effort, high impact)

2. **Implement adaptive/semantic chunking**
   - Research shows significant accuracy improvements
   - Start with hybrid approach: semantic boundaries + size constraints

3. **Add weighted RRF support**
   - Allow configurable weights for FTS vs semantic in `hybrid_search()`
   - Consider linear retriever as alternative fusion method

### Monitor / Future Consideration

4. **pgvectorscale** for scaling beyond RAM limits
5. **MCP Server Cards** for improved discoverability
6. **HiFi-RAG** multi-stage filtering with re-ranking
7. **Bidirectional RAG** write-back with grounding checks for `add_note`

---

## Sources

- [MCP Core Maintainer Update (Jan 22, 2026)](https://blog.modelcontextprotocol.io/posts/2026-01-22-core-maintainer-update/)
- [Anthropic MCP Tool Search](https://blog.arcade.dev/anthropic-tool-search-claude-mcp-runtime)
- [Pinecone vs Supabase pgvector 2026](https://geetopadesha.com/vector-search-in-2026-pinecone-vs-supabase-pgvector-performance-test/)
- [12 New Advanced Types of RAG](https://www.turingpost.com/p/12ragtypes)
- [Google RAG Sufficient Context Research](https://research.google/blog/deeper-insights-into-retrieval-augmented-generation-the-role-of-sufficient-context/)
- [Chunking Strategies for RAG (Weaviate)](https://weaviate.io/blog/chunking-strategies-for-rag)
- [Max-Min Semantic Chunking](https://link.springer.com/article/10.1007/s10791-025-09638-7)
- [Weighted RRF in Elasticsearch](https://www.elastic.co/search-labs/blog/weighted-reciprocal-rank-fusion-rrf)
- [nomic-embed-text-v2-moe](https://ollama.com/library/nomic-embed-text-v2-moe)
- [Nomic Embed v2 Blog](https://www.nomic.ai/blog/posts/nomic-embed-text-v2)
