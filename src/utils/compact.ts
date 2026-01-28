import { config } from './config.js';

export const isCompact = () => config.COMPACT_RESPONSES;

export function toJSON(obj: unknown): string {
	return isCompact() ? JSON.stringify(obj) : JSON.stringify(obj, null, 2);
}

export function formatId(uuid: string): string {
	return isCompact() ? uuid.slice(0, 8) : uuid;
}
