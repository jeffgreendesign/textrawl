import Anthropic from '@anthropic-ai/sdk';
import { config } from '../utils/config.js';
import { ExternalServiceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

let anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
	if (!config.ANTHROPIC_API_KEY) {
		throw new ExternalServiceError('ANTHROPIC_API_KEY not configured for image description');
	}
	if (!anthropic) {
		anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
	}
	return anthropic;
}

/**
 * Generate a text description of an image using Claude's vision capabilities.
 */
export async function describeImage(buffer: Buffer, mimeType: string): Promise<string> {
	const client = getAnthropicClient();
	const base64 = buffer.toString('base64');

	const mediaType = mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

	try {
		const response = await client.messages.create({
			model: config.EXTRACTION_MODEL,
			max_tokens: 1024,
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'image',
							source: { type: 'base64', media_type: mediaType, data: base64 },
						},
						{
							type: 'text',
							text: 'Describe this image in detail. Include any text visible in the image, objects, people, locations, and context. Be thorough but concise.',
						},
					],
				},
			],
		});

		const textBlock = response.content.find((b) => b.type === 'text');
		const description = textBlock && 'text' in textBlock ? textBlock.text : '';

		logger.info('Image described', {
			mimeType,
			descriptionLength: description.length,
		});

		return description;
	} catch (error) {
		throw new ExternalServiceError(
			`Image description failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Check if image processing is available (requires Anthropic API key).
 */
export function isImageProcessingConfigured(): boolean {
	return !!config.ANTHROPIC_API_KEY;
}
