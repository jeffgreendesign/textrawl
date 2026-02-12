/**
 * Desktop main-process logger.
 *
 * Wraps console.error (stderr) with timestamps and log levels,
 * consistent with the main project's logger in src/utils/logger.ts.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const envLevel = process.env.LOG_LEVEL as string | undefined;
let currentLevel: LogLevel = envLevel && envLevel in LOG_LEVELS ? (envLevel as LogLevel) : 'info';

function shouldLog(level: LogLevel): boolean {
	return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
	if (!shouldLog(level)) return;
	const ts = new Date().toISOString();
	console.error(`[${ts}] [${level.toUpperCase()}] ${message}`, ...args);
}

export const logger = {
	debug: (message: string, ...args: unknown[]) => log('debug', message, ...args),
	info: (message: string, ...args: unknown[]) => log('info', message, ...args),
	warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
	error: (message: string, ...args: unknown[]) => log('error', message, ...args),
	setLevel: (level: LogLevel) => {
		currentLevel = level;
	},
	getLevel: (): LogLevel => currentLevel,
};
