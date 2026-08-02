import { z } from 'zod';
import { logger } from './logger.js';

/**
 * Environment configuration schema with validation
 */
const envSchema = z.object({
	// Server
	PORT: z
		.string()
		.default('3000')
		.transform((val) => parseInt(val, 10)),
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
	LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

	// Authentication
	API_BEARER_TOKEN: z
		.string()
		.min(32, 'API_BEARER_TOKEN must be at least 32 characters')
		.regex(
			/^[a-zA-Z0-9_-]+$/,
			'API_BEARER_TOKEN must contain only alphanumeric characters, underscores, and hyphens',
		)
		.optional(),

	// Database (Neon PostgreSQL)
	DATABASE_URL: z.string().optional(),
	DATABASE_URL_UNPOOLED: z.string().optional(),

	// Embeddings
	EMBEDDING_PROVIDER: z.enum(['openai', 'ollama', 'google']).default('openai'),

	// OpenAI
	OPENAI_API_KEY: z.string().startsWith('sk-').optional(),

	// Google AI
	GOOGLE_AI_API_KEY: z.string().optional(),
	// Embeddings are requested at 1536d (Matryoshka) so the vectors fit pgvector's
	// 2000-dimension HNSW limit. See GOOGLE_DIMENSIONS in src/services/embeddings.ts.
	GOOGLE_EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),

	// Ollama
	OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
	// Supported models and their dimensions:
	// - nomic-embed-text (1024d) - Original, use setup-db-ollama.sql
	// - nomic-embed-text-v2-moe (768d) - MoE, multilingual, use setup-db-ollama-v2.sql
	// - mxbai-embed-large (1024d) - Alternative, use setup-db-ollama.sql
	OLLAMA_MODEL: z.string().default('nomic-embed-text'),

	// Ingest concurrency. Peak concurrent provider requests during ingest is roughly
	// EMBED_WINDOW_CONCURRENCY * EMBEDDING_BATCH_CONCURRENCY; withRetry absorbs 429s.
	// Concurrent provider batches within a single generateEmbeddings call (speeds up
	// semantic chunking and any large embed that splits into many batches).
	EMBEDDING_BATCH_CONCURRENCY: z
		.string()
		.default('2')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1'),
	// Concurrent 128-chunk embed+insert windows (overlaps embed and insert across
	// windows for large documents). Peak memory scales with this value.
	EMBED_WINDOW_CONCURRENCY: z
		.string()
		.default('2')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1'),

	// Feature flags
	ENABLE_MEMORY: z
		.string()
		.default('true')
		.transform((val) => val.toLowerCase() === 'true'),

	// Conversation memory (Phase 2)
	ENABLE_CONVERSATIONS: z
		.string()
		.default('true')
		.transform((val) => val.toLowerCase() === 'true'),

	// Memory extraction (Phase 3)
	ENABLE_MEMORY_EXTRACTION: z
		.string()
		.default('false')
		.transform((val) => val.toLowerCase() === 'true'),

	// Anthropic API for memory extraction (uses Claude for entity/fact extraction)
	ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-').optional(),

	// Model for memory extraction (fast, cheap model recommended)
	EXTRACTION_MODEL: z.string().default('claude-haiku-4-5'),

	// Model for insight synthesis (benefits from more capable reasoning).
	// Sonnet 5 runs adaptive thinking unless told otherwise — see the explicit
	// `thinking` setting in src/services/insight-analysis.ts before changing this.
	INSIGHT_MODEL: z.string().default('claude-sonnet-5'),

	// Response format - compact saves 40-60% tokens but uses short keys
	COMPACT_RESPONSES: z
		.string()
		.default('true')
		.transform((val) => val.toLowerCase() === 'true'),

	// Tool surface (which MCP tools are advertised). The MCP spec defines no
	// standard tool-filtering primitive, so this is a server-local convention.
	// - normal: compact workflow surface (ask, search, get_document, capture,
	//   remember, daily_briefing, timeline) — recommended for personal/family bots.
	// - full: workflow surface + admin tools + the original granular tools.
	// - legacy: exactly the original tool set (strict backward compatibility).
	MCP_TOOLSET: z.enum(['normal', 'full', 'legacy']).default('normal'),

	// Expose admin/maintenance tools (health_check, get_stats, insight maintenance,
	// destructive forget/delete, Postgres analysis) in the `normal` surface. Always
	// on under `full`/`legacy`. Keep false for family/personal assistants.
	EXPOSE_ADMIN_TOOLS: z
		.string()
		.default('false')
		.transform((val) => val.toLowerCase() === 'true'),

	// OAuth (optional - enables OAuth flow when all are set)
	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	OAUTH_JWT_SECRET: z.string().min(32).optional(),
	OAUTH_ALLOWED_EMAILS: z.string().optional(),
	OAUTH_SERVER_URL: z.url().optional(),

	// Proactive insights
	ENABLE_INSIGHTS: z
		.string()
		.default('true')
		.transform((val) => val.toLowerCase() === 'true'),

	// Number of chunks that must be inserted before an insight scan is eligible
	INSIGHT_BATCH_THRESHOLD: z
		.string()
		.default('50')
		.transform((val) => parseInt(val, 10)),

	// Debounce seconds — wait this long after last insert before scanning
	INSIGHT_DEBOUNCE_SECONDS: z
		.string()
		.default('300')
		.transform((val) => parseInt(val, 10)),

	// Stale-lock recovery — if an insight scan marked the queue as processing but
	// never cleared the flag (e.g. the process was killed mid-scan), treat the lock
	// as stale after this many seconds so future scans are not blocked forever.
	INSIGHT_STALE_SECONDS: z
		.string()
		.default('1800')
		.transform((val) => parseInt(val, 10)),

	// Dedicated, narrowly-scoped token for POST /api/insights/scan, used by the
	// external scheduler. Kept separate from API_BEARER_TOKEN so the scheduler job
	// config never holds the master token. When unset, the endpoint falls back to
	// the normal bearer/OAuth auth.
	INSIGHT_SCAN_TOKEN: z.string().optional(),

	// Chunking strategy
	// - fixed: Paragraph-aware splitting at ~512 tokens (fast, no extra API calls)
	// - semantic: Embedding-based splitting at topic boundaries (better retrieval, slower)
	CHUNKING_MODE: z.enum(['fixed', 'semantic']).default('fixed'),

	// Semantic chunking similarity threshold (0-1)
	// Lower values create more chunks (more topic sensitivity)
	// Higher values create fewer chunks (less sensitive to topic shifts)
	// Recommended: 0.4-0.6
	SEMANTIC_SIMILARITY_THRESHOLD: z
		.string()
		.default('0.5')
		.transform((val) => parseFloat(val))
		.refine((val) => val >= 0 && val <= 1, 'Must be between 0 and 1'),

	// Directory for pg-analyze report history (default: ./reports/pg-analysis)
	PG_REPORT_DIR: z.string().default('./reports/pg-analysis'),

	// Redis (optional - enables shared rate limiting across instances)
	REDIS_URL: z.url().optional(),

	// File size limits
	MAX_SINGLE_FILE_SIZE_MB: z
		.string()
		.default('20')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1 MB'),

	WARN_FILE_SIZE_MB: z
		.string()
		.default('5')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1 MB'),

	// Soft threshold: documents estimated to exceed this many chunks are logged as
	// large (the CLI warns; the server logs). Advisory only — not a rejection.
	MAX_CHUNKS_PER_FILE: z
		.string()
		.default('500')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1'),

	// Hard ceiling: the chunker throws ChunkLimitError once a single document
	// produces more than this many chunks, bounding chunks/embeddings/DB rows for
	// pathological or oversized inputs. Set well above what a max-size legitimate
	// upload yields (a 20MB text file is ~10k chunks) so normal large files still
	// process; this is a backstop, not a routine limit.
	MAX_CHUNKS_HARD_CAP: z
		.string()
		.default('50000')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1'),

	// Large-upload (GCS resumable + Cloud Tasks) workflow — plan §7.
	// Max size accepted by the resumable `/api/upload/init` path.
	MAX_UPLOAD_SIZE_MB: z
		.string()
		.default('500')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1 MB'),

	// Dashboard switch point: size ≤ threshold → direct upload, > → resumable.
	// Unset → falls back to MAX_SINGLE_FILE_SIZE_MB at the use site.
	UPLOAD_THRESHOLD_MB: z
		.string()
		.optional()
		.transform((val) => (val === undefined ? undefined : parseInt(val, 10))),

	// Resumable session + upload-row expiry (minutes).
	UPLOAD_SESSION_TTL_MIN: z
		.string()
		.default('120')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1 minute'),

	// GCS bucket for large uploads (required once real GCS storage lands).
	GCS_UPLOAD_BUCKET: z.string().optional(),

	// GCP project id for the GCS client. Optional: auto-detected from ADC on
	// Cloud Run / from the service-account key locally. Set to pin it explicitly.
	GCS_PROJECT_ID: z.string().optional(),

	// Cloud Tasks (async upload processing) — plan §7 / Phase 4.
	// Queue id; when set together with UPLOAD_PROCESS_URL, the real Cloud Tasks
	// queue is used instead of the in-memory fake.
	CLOUD_TASKS_QUEUE: z.string().optional(),

	// Queue location/region. Defaults to us-central1; the live deployment overrides
	// it to us-east4 to colocate with Cloud Run and the GCS bucket.
	CLOUD_TASKS_LOCATION: z.string().default('us-central1'),

	// OIDC identity minted into each task; the processing endpoint verifies the
	// token's email matches this service account.
	CLOUD_TASKS_SERVICE_ACCOUNT: z.string().optional(),

	// Internal processing endpoint base URL. Task target is `<url>/<uploadId>` and
	// the URL doubles as the OIDC audience the endpoint verifies.
	UPLOAD_PROCESS_URL: z.url().optional(),

	// Safe-ZIP extraction limits (plan §7 / §9). Enforced against the central
	// directory *before* decompressing, so bomb/oversize archives are rejected up
	// front. All archive-level violations fail the whole upload (no documents).

	// Max number of file entries in a single archive.
	ZIP_MAX_ENTRIES: z
		.string()
		.default('2000')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1'),

	// Max compressed archive size (bytes). Unset → falls back to
	// MAX_UPLOAD_SIZE_MB at the use site. A non-numeric value is rejected (rather
	// than parsing to NaN and silently disabling the compressed-size bomb guard).
	ZIP_MAX_COMPRESSED_BYTES: z
		.string()
		.optional()
		.transform((val) => (val === undefined ? undefined : parseInt(val, 10)))
		.refine((val) => val === undefined || (Number.isFinite(val) && val >= 1), 'Must be at least 1'),

	// Max total uncompressed (expanded) size across all entries (bytes) — bomb guard.
	ZIP_MAX_EXPANDED_BYTES: z
		.string()
		.default('2000000000')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1'),

	// Max uncompressed size of any single entry (bytes).
	ZIP_MAX_ENTRY_BYTES: z
		.string()
		.default('50000000')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1'),

	// Max overall compression ratio (expanded / compressed) — bomb guard.
	ZIP_MAX_COMPRESSION_RATIO: z
		.string()
		.default('100')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1'),

	// Max entry-path length (characters).
	ZIP_MAX_FILENAME_LEN: z
		.string()
		.default('255')
		.transform((val) => parseInt(val, 10))
		.refine((val) => val >= 1, 'Must be at least 1'),
});

export type Config = z.infer<typeof envSchema>;

let cachedConfig: Config | null = null;

/**
 * Load and validate configuration from environment variables.
 * In development mode, allows missing credentials for initial setup.
 */
export function loadConfig(): Config {
	if (cachedConfig) {
		return cachedConfig;
	}

	const result = envSchema.safeParse(process.env);

	if (!result.success) {
		logger.error('Configuration validation failed', {
			errors: z.treeifyError(result.error),
		});
		process.exit(1);
	}

	cachedConfig = result.data;

	// Require some auth in production mode
	if (
		result.data.NODE_ENV === 'production' &&
		!result.data.API_BEARER_TOKEN &&
		!result.data.GOOGLE_CLIENT_ID
	) {
		logger.error('API_BEARER_TOKEN or OAuth (GOOGLE_CLIENT_ID) is required in production mode');
		process.exit(1);
	}

	// Validate OAuth config: if any OAuth var is set, all required ones must be
	const oauthVars = [
		result.data.GOOGLE_CLIENT_ID,
		result.data.GOOGLE_CLIENT_SECRET,
		result.data.OAUTH_JWT_SECRET,
		result.data.OAUTH_SERVER_URL,
	];
	const oauthSet = oauthVars.filter(Boolean).length;
	if (oauthSet > 0 && oauthSet < 4) {
		logger.error(
			'OAuth partially configured. Set all of: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_JWT_SECRET, OAUTH_SERVER_URL',
		);
		process.exit(1);
	}

	// Log warnings for missing optional config in development
	if (result.data.NODE_ENV === 'development') {
		if (!result.data.API_BEARER_TOKEN) {
			logger.warn('API_BEARER_TOKEN not set - auth will be disabled');
		}
		if (!result.data.DATABASE_URL) {
			logger.warn('DATABASE_URL not set - database features disabled');
		}
		if (result.data.EMBEDDING_PROVIDER === 'openai' && !result.data.OPENAI_API_KEY) {
			logger.warn('OPENAI_API_KEY not set - embeddings disabled');
		}
		if (result.data.EMBEDDING_PROVIDER === 'ollama') {
			logger.info(
				`Using Ollama embeddings: ${result.data.OLLAMA_MODEL} at ${result.data.OLLAMA_BASE_URL}`,
			);
		}
		if (result.data.EMBEDDING_PROVIDER === 'google' && !result.data.GOOGLE_AI_API_KEY) {
			logger.warn('GOOGLE_AI_API_KEY not set - embeddings disabled');
		}
		if (result.data.EMBEDDING_PROVIDER === 'google') {
			logger.info(`Using Google AI embeddings: ${result.data.GOOGLE_EMBEDDING_MODEL}`);
		}
	}

	return result.data;
}

export const config = loadConfig();
