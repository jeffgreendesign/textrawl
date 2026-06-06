/**
 * Single-file processing-pipeline tests (T4.3).
 *
 * `processUpload()` is tested at its function seam with storage, db, embeddings,
 * processor, chunker, and pipeline all mocked — hermetic, no GCS/Postgres/LLM.
 * Pins the §4 contract: the object is consumed as a *stream* (not a buffered
 * read), SHA-256 is verified *before* extraction, a mismatch creates no
 * document, the happy path persists results and reaches `completed`, and a rerun
 * on a terminal upload is a no-op (idempotent).
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BYTES = Buffer.from('hello world');
const DIGEST = createHash('sha256').update(BYTES).digest('hex');

// --- Hoisted mock collaborators ---

const { storage, mockConfig } = vi.hoisted(() => ({
	storage: {
		// A fresh stream per call — streams are single-use.
		createReadStream: vi.fn(() => Readable.from([Buffer.from('hello world')])),
		headObject: vi.fn(),
	},
	mockConfig: {
		MAX_UPLOAD_SIZE_MB: 500,
		CHUNKING_MODE: 'fixed',
		EMBEDDING_PROVIDER: 'openai',
	},
}));

vi.mock('../../utils/config.js', () => ({ config: mockConfig }));
vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../db/pg-client.js', () => ({ isDatabaseConfigured: vi.fn(() => true) }));
vi.mock('../storage/index.js', () => ({ getStorageService: () => storage }));
vi.mock('../embeddings.js', () => ({
	generateEmbeddings: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
	isEmbeddingsConfigured: vi.fn(() => true),
}));
vi.mock('../processor.js', () => ({
	extractText: vi.fn(async () => 'hello world'),
	validateFileType: vi.fn(async () => true),
	isSupportedType: vi.fn(() => true),
}));
vi.mock('../chunker.js', () => ({
	smartChunk: vi.fn(async () => [
		{ content: 'hello world', index: 0, startOffset: 0, endOffset: 11, tokenCount: 2 },
	]),
}));
vi.mock('../pipeline.js', () => ({ onDocumentIngested: vi.fn(async () => undefined) }));
vi.mock('../../db/documents.js', () => ({
	createDocument: vi.fn(async () => ({ id: 'doc-1', title: 'sample.txt' })),
}));
vi.mock('../../db/chunks.js', () => ({ createChunks: vi.fn(async () => undefined) }));
vi.mock('../../db/uploads.js', () => ({
	getUpload: vi.fn(),
	transitionUploadState: vi.fn(async () => undefined),
	recordUploadProcessingResult: vi.fn(async () => undefined),
}));

// --- Imports (after mocks) ---

import { createChunks } from '../../db/chunks.js';
import { createDocument } from '../../db/documents.js';
import {
	getUpload,
	recordUploadProcessingResult,
	transitionUploadState,
} from '../../db/uploads.js';
import { onDocumentIngested } from '../pipeline.js';
import { extractText, isSupportedType } from '../processor.js';
import { processUpload } from '../upload-processor.js';

const m = {
	getUpload: vi.mocked(getUpload),
	transitionUploadState: vi.mocked(transitionUploadState),
	recordUploadProcessingResult: vi.mocked(recordUploadProcessingResult),
	createDocument: vi.mocked(createDocument),
	createChunks: vi.mocked(createChunks),
	onDocumentIngested: vi.mocked(onDocumentIngested),
	extractText: vi.mocked(extractText),
	isSupportedType: vi.mocked(isSupportedType),
};

// biome-ignore lint/suspicious/noExplicitAny: loose Upload fixture
function buildUpload(overrides: Record<string, any> = {}): any {
	return {
		id: 'up-1',
		filename: 'sample.txt',
		title: null,
		declared_mimetype: 'text/plain',
		size_bytes: BYTES.length,
		checksum_expected: null,
		object_key: 'uploads/2026/06/up-1/sample.txt',
		state: 'processing',
		document_ids: [],
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	storage.createReadStream.mockImplementation(() => Readable.from([Buffer.from('hello world')]));
	m.isSupportedType.mockReturnValue(true);
});

describe('processUpload', () => {
	it('reads the object as a stream (not a buffered headObject) and verifies before extracting', async () => {
		m.getUpload.mockResolvedValueOnce(buildUpload());
		await processUpload('up-1');

		expect(storage.createReadStream).toHaveBeenCalledWith('uploads/2026/06/up-1/sample.txt');
		expect(storage.headObject).not.toHaveBeenCalled();
		expect(m.extractText).toHaveBeenCalled();
	});

	it('happy path → document + chunks created, pipeline fired, results persisted, completed', async () => {
		m.getUpload.mockResolvedValueOnce(buildUpload());
		await processUpload('up-1');

		expect(m.createDocument).toHaveBeenCalledTimes(1);
		expect(m.createChunks).toHaveBeenCalledTimes(1);
		expect(m.onDocumentIngested).toHaveBeenCalledWith(
			'doc-1',
			expect.any(String),
			'hello world',
			1,
		);
		expect(m.recordUploadProcessingResult).toHaveBeenCalledWith(
			'up-1',
			expect.objectContaining({
				documentIds: ['doc-1'],
				checksumComputed: DIGEST,
				entriesProcessed: 1,
			}),
		);
		expect(m.transitionUploadState).toHaveBeenLastCalledWith('up-1', 'completed');
	});

	it('verifies a supplied checksum (sha256: prefix tolerated) before extracting', async () => {
		m.getUpload.mockResolvedValueOnce(buildUpload({ checksum_expected: `sha256:${DIGEST}` }));
		await processUpload('up-1');
		expect(m.createDocument).toHaveBeenCalledTimes(1);
		expect(m.transitionUploadState).toHaveBeenLastCalledWith('up-1', 'completed');
	});

	it('checksum mismatch → CHECKSUM_MISMATCH, no document, failed', async () => {
		m.getUpload.mockResolvedValueOnce(buildUpload({ checksum_expected: 'sha256:deadbeef' }));
		await processUpload('up-1');

		expect(m.createDocument).not.toHaveBeenCalled();
		expect(m.transitionUploadState).toHaveBeenCalledWith(
			'up-1',
			'failed',
			expect.objectContaining({ errorCode: 'CHECKSUM_MISMATCH' }),
		);
	});

	it('unsupported type → no document, failed UNSUPPORTED_TYPE', async () => {
		m.isSupportedType.mockReturnValue(false);
		m.getUpload.mockResolvedValueOnce(
			buildUpload({ declared_mimetype: 'application/x-msdownload' }),
		);
		await processUpload('up-1');

		expect(m.createDocument).not.toHaveBeenCalled();
		expect(m.transitionUploadState).toHaveBeenCalledWith(
			'up-1',
			'failed',
			expect.objectContaining({ errorCode: 'UNSUPPORTED_TYPE' }),
		);
	});

	it('is idempotent: a rerun on a completed upload creates no duplicate document', async () => {
		m.getUpload.mockResolvedValueOnce(buildUpload({ state: 'completed', document_ids: ['doc-1'] }));
		await processUpload('up-1');

		expect(storage.createReadStream).not.toHaveBeenCalled();
		expect(m.createDocument).not.toHaveBeenCalled();
		expect(m.transitionUploadState).not.toHaveBeenCalled();
	});

	it('returns quietly when the upload row is missing', async () => {
		m.getUpload.mockResolvedValueOnce(null);
		await processUpload('missing');
		expect(m.createDocument).not.toHaveBeenCalled();
		expect(m.transitionUploadState).not.toHaveBeenCalled();
	});
});
