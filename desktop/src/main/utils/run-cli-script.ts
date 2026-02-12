/**
 * Shared utility for spawning CLI scripts via tsx.
 *
 * Centralises child-process lifecycle management so conversion-manager
 * and upload-manager don't duplicate spawn/stream/cleanup boilerplate.
 *
 * Key correctness guarantees:
 *  - Resolves on 'close' (not 'exit') so all pipe FDs are released
 *  - Explicitly destroys streams on every exit path
 *  - Supports AbortSignal for clean cancellation
 *  - Caps stderr accumulation to prevent memory waste
 *  - Optional timeout kills hung processes
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from './logger.js';

// ---- Public types ----

export interface CliProgress {
	/** Percentage 0-100 */
	percent: number;
	/** Current item count (if available from "[PROGRESS] 45% (690/1548)") */
	current: number | null;
	/** Total item count (if available) */
	total: number | null;
}

export interface CliOutputLine {
	text: string;
	stream: 'stdout' | 'stderr';
}

export interface RunCliScriptOptions {
	/** Script path relative to the project root (e.g. 'scripts/cli/converters/mbox.ts') */
	scriptPath: string;
	/** Arguments passed after the script path */
	args: string[];
	/** Label for error messages (default: 'Script') */
	label?: string;
	/** Mirror stderr to process.stderr for terminal debugging (default: false) */
	mirrorStderr?: boolean;
	/** Called when a [PROGRESS] line is parsed from stderr */
	onProgress?: (progress: CliProgress) => void;
	/** Called for each non-progress output line */
	onOutput?: (line: CliOutputLine) => void;
	/** AbortSignal — when aborted, the child process is killed */
	signal?: AbortSignal;
	/** Absolute timeout in ms — after this, the child is killed (default: 300_000 = 5 min) */
	timeout?: number;
	/**
	 * Idle timeout in ms — if no stdout/stderr output is received for this
	 * duration the child is killed. When set, `timeout` is ignored.
	 * Useful for long-running jobs that produce continuous output.
	 */
	idleTimeout?: number;
	/** Extra environment variables merged over inherited process.env (takes precedence) */
	env?: Record<string, string>;
}

// ---- Internal helpers ----

/** Max bytes of stderr kept for error diagnostics. */
const STDERR_CAP = 2048;

/** Resolved tsx binary path — cached after first lookup. */
let resolvedTsxPath: string | null = null;

/**
 * Find the tsx binary. Prefer the local node_modules/.bin/tsx (avoids
 * npx's per-spawn resolver overhead). Falls back to spawning via npx.
 */
function getTsxCommand(projectRoot: string): { cmd: string; baseArgs: string[] } {
	if (resolvedTsxPath === null) {
		const localTsx = resolve(projectRoot, 'node_modules', '.bin', 'tsx');
		resolvedTsxPath = existsSync(localTsx) ? localTsx : '';
	}
	if (resolvedTsxPath) {
		return { cmd: resolvedTsxPath, baseArgs: [] };
	}
	// Fallback: npx tsx (slower — resolver runs every time)
	return { cmd: 'npx', baseArgs: ['tsx'] };
}

function appendStderr(buffer: string, chunk: string): string {
	const combined = buffer + chunk;
	if (combined.length > STDERR_CAP) {
		return combined.slice(-STDERR_CAP);
	}
	return combined;
}

// ---- Main function ----

// __dirname is available in CJS bundle — always resolves to dist/main/
const projectRoot = resolve(__dirname, '..', '..', '..');

export function runCliScript(options: RunCliScriptOptions): Promise<void> {
	const {
		scriptPath,
		args,
		label = 'Script',
		mirrorStderr = false,
		onProgress,
		onOutput,
		signal,
		timeout = 300_000,
		idleTimeout,
		env: extraEnv,
	} = options;

	return new Promise((resolvePromise, reject) => {
		// Already aborted before we start
		if (signal?.aborted) {
			reject(new Error(`${label} aborted before start`));
			return;
		}

		const fullScriptPath = resolve(projectRoot, scriptPath);
		const { cmd, baseArgs } = getTsxCommand(projectRoot);
		const spawnArgs = [...baseArgs, fullScriptPath, ...args];

		logger.debug(`[run-cli-script] Spawning: ${cmd} ${spawnArgs.join(' ')}`);
		logger.debug(`[run-cli-script] CWD: ${projectRoot}`);

		// Filter out Electron-specific env vars that can interfere with
		// child Node.js processes (e.g. ELECTRON_RUN_AS_NODE)
		const childEnv: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (!key.startsWith('ELECTRON_') && value !== undefined) {
				childEnv[key] = value;
			}
		}
		// Merge caller-provided env vars (takes precedence over inherited)
		if (extraEnv) {
			for (const [key, value] of Object.entries(extraEnv)) {
				childEnv[key] = value;
			}
		}

		let child: ChildProcess;
		try {
			// Use 'pipe' for stdin instead of 'ignore' to avoid EBADF in
			// Electron's modified FD environment where /dev/null remapping fails.
			child = spawn(cmd, spawnArgs, {
				cwd: projectRoot,
				stdio: ['pipe', 'pipe', 'pipe'],
				env: childEnv,
			});
			// Close stdin immediately — child processes don't read from it.
			child.stdin?.end();
		} catch (err) {
			reject(err);
			return;
		}

		let stderr = '';
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			// Release pipe FDs immediately
			child.stdin?.destroy();
			child.stdout?.destroy();
			child.stderr?.destroy();
			fn();
		};

		// ---- Timeout ----
		const effectiveTimeout = idleTimeout ?? timeout;
		const timeoutKind = idleTimeout ? 'idle' : 'absolute';

		const startTimer = () => {
			if (timer) clearTimeout(timer);
			if (effectiveTimeout > 0) {
				timer = setTimeout(() => {
					if (!settled) {
						child.kill('SIGTERM');
						const reason =
							timeoutKind === 'idle'
								? `${label} timed out after ${Math.round(effectiveTimeout / 1000)}s of inactivity`
								: `${label} timed out after ${Math.round(effectiveTimeout / 1000)}s`;
						settle(() => reject(new Error(reason)));
					}
				}, effectiveTimeout);
			}
		};

		const resetIdleTimer = () => {
			if (timeoutKind === 'idle') startTimer();
		};

		startTimer();

		// ---- AbortSignal ----
		if (signal) {
			const onAbort = () => {
				if (!settled) {
					child.kill('SIGTERM');
					settle(() => reject(new Error(`${label} aborted`)));
				}
			};
			signal.addEventListener('abort', onAbort, { once: true });
			// Clean up listener when we settle normally
			const originalSettle = settle;
			// We can't reassign settle (const), so use a wrapper pattern
			// Instead, remove the listener in the close/error handlers below
			child.on('close', () => signal.removeEventListener('abort', onAbort));
			child.on('error', () => signal.removeEventListener('abort', onAbort));
		}

		// ---- Stderr ----
		child.stderr?.on('data', (data: Buffer) => {
			const output = data.toString();
			stderr = appendStderr(stderr, output);
			resetIdleTimer();

			if (mirrorStderr) {
				process.stderr.write(output);
			}

			// Parse [PROGRESS] lines
			if (onProgress) {
				const match = output.match(/\[PROGRESS\]\s*(\d+)%(?:\s*\((\d+)\/(\d+)\))?/);
				if (match) {
					onProgress({
						percent: parseInt(match[1], 10),
						current: match[2] ? parseInt(match[2], 10) : null,
						total: match[3] ? parseInt(match[3], 10) : null,
					});
				}
			}

			if (onOutput) {
				const lines = output
					.split('\n')
					.filter((line) => line.trim() && !line.includes('[PROGRESS]'));
				for (const line of lines) {
					onOutput({ text: line, stream: 'stderr' });
				}
			}
		});

		// ---- Stdout ----
		child.stdout?.on('data', (data: Buffer) => {
			resetIdleTimer();
			const output = data.toString().trim();
			if (output && onOutput) {
				onOutput({ text: output, stream: 'stdout' });
			}
		});

		// ---- Close (KEY FIX: not 'exit') ----
		// 'close' fires after all stdio streams have been closed,
		// ensuring pipe FDs are returned to the OS before the next spawn.
		child.on('close', (code) => {
			settle(() => {
				if (code === 0) {
					resolvePromise();
				} else {
					reject(new Error(`${label} exited with code ${code}: ${stderr.slice(-500)}`));
				}
			});
		});

		// ---- Spawn error (e.g. ENOENT, EACCES, EBADF) ----
		child.on('error', (error) => {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === 'EBADF') {
				logger.error(
					`[run-cli-script] ${label} spawn EBADF — failed to spawn: ${cmd} ${spawnArgs.join(' ')}. This usually indicates a file descriptor issue in the Electron environment.`,
				);
			} else {
				logger.error(`[run-cli-script] ${label} spawn error:`, error);
			}
			settle(() =>
				reject(
					new Error(
						`${label} failed to start: ${code || error.message}` +
							` (command: ${cmd} ${spawnArgs.slice(0, 2).join(' ')}...)`,
					),
				),
			);
		});
	});
}
