import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import OpenAI from 'openai';
import { config } from '../utils/config.js';
import { ExternalServiceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
	if (!config.OPENAI_API_KEY) {
		throw new ExternalServiceError('OPENAI_API_KEY not configured for audio transcription');
	}
	if (!openai) {
		openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
	}
	return openai;
}

const MIME_TO_EXT: Record<string, string> = {
	'audio/mpeg': '.mp3',
	'audio/mp3': '.mp3',
	'audio/wav': '.wav',
	'audio/wave': '.wav',
	'audio/x-wav': '.wav',
	'audio/mp4': '.m4a',
	'audio/m4a': '.m4a',
	'audio/ogg': '.ogg',
	'audio/webm': '.webm',
};

/**
 * Transcribe audio using OpenAI Whisper API.
 * Returns the transcribed text.
 */
export async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string> {
	const client = getOpenAIClient();
	const ext = MIME_TO_EXT[mimeType] ?? '.mp3';

	// Write buffer to temp file (Whisper API requires a file)
	const tempPath = join(tmpdir(), `textrawl-audio-${randomUUID()}${ext}`);

	try {
		await writeFile(tempPath, buffer);

		const transcription = await client.audio.transcriptions.create({
			model: 'whisper-1',
			file: createReadStream(tempPath),
		});

		logger.info('Audio transcribed', {
			mimeType,
			transcriptionLength: transcription.text.length,
		});

		return transcription.text;
	} catch (error) {
		throw new ExternalServiceError(
			`Audio transcription failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		// Clean up temp file
		await unlink(tempPath).catch(() => {});
	}
}

/**
 * Check if audio transcription is available (requires OpenAI API key).
 */
export function isAudioProcessingConfigured(): boolean {
	return !!config.OPENAI_API_KEY;
}
