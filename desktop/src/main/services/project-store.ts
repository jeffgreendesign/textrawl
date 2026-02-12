/**
 * Project Store - Persistent project state (last-loaded project + file errors)
 *
 * Separate from SettingsStore — no encryption needed since this only holds
 * file paths and error messages. All other pipeline states are derived from
 * the filesystem and upload manifest at reconciliation time.
 */
import Store from 'electron-store';

interface FileError {
	error: string;
	lastAttempt: string; // ISO timestamp
	attempts: number;
}

interface RecentProjectEntry {
	sourceDir: string;
	outputDir: string;
	lastOpened: string; // ISO timestamp
}

interface ProjectStoreSchema {
	lastProject: { sourceDir: string; outputDir: string } | null;
	recentProjects: RecentProjectEntry[];
	fileErrors: Record<string, FileError>;
}

const MAX_RECENT_PROJECTS = 10;

/** Maximum conversion retry attempts per file before giving up. */
export const MAX_RETRIES = 3;

const defaults: ProjectStoreSchema = {
	lastProject: null,
	recentProjects: [],
	fileErrors: {},
};

export class ProjectStore {
	private store: Store<ProjectStoreSchema>;

	constructor() {
		this.store = new Store<ProjectStoreSchema>({
			name: 'textrawl-project',
			defaults,
		});
	}

	// --- Last project ---

	getLastProject(): { sourceDir: string; outputDir: string } | null {
		return this.store.get('lastProject');
	}

	setLastProject(sourceDir: string, outputDir: string): void {
		this.store.set('lastProject', { sourceDir, outputDir });
		this.addRecentProject(sourceDir, outputDir);
	}

	clearLastProject(): void {
		this.store.set('lastProject', null);
	}

	// --- Recent projects ---

	getRecentProjects(): RecentProjectEntry[] {
		return this.store.get('recentProjects');
	}

	addRecentProject(sourceDir: string, outputDir: string): void {
		const projects = this.store.get('recentProjects');
		// Remove existing entry for this sourceDir (if any)
		const filtered = projects.filter((p) => p.sourceDir !== sourceDir);
		// Prepend new entry
		filtered.unshift({
			sourceDir,
			outputDir,
			lastOpened: new Date().toISOString(),
		});
		// Cap at max
		this.store.set('recentProjects', filtered.slice(0, MAX_RECENT_PROJECTS));
	}

	removeRecentProject(sourceDir: string): void {
		const projects = this.store.get('recentProjects');
		this.store.set(
			'recentProjects',
			projects.filter((p) => p.sourceDir !== sourceDir),
		);
	}

	// --- File errors ---

	private isSafeKey(key: string): boolean {
		return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
	}

	getFileError(relativePath: string): FileError | undefined {
		if (!this.isSafeKey(relativePath)) return undefined;
		const errors = this.store.get('fileErrors');
		return errors[relativePath];
	}

	getFileAttempts(relativePath: string): number {
		if (!this.isSafeKey(relativePath)) return 0;
		const errors = this.store.get('fileErrors');
		return errors[relativePath]?.attempts ?? 0;
	}

	setFileError(relativePath: string, error: string): void {
		if (!this.isSafeKey(relativePath)) return;
		const errors = this.store.get('fileErrors');
		const existing = errors[relativePath];
		const attempts = (existing?.attempts ?? 0) + 1;
		errors[relativePath] = { error, lastAttempt: new Date().toISOString(), attempts };
		this.store.set('fileErrors', errors);
	}

	/** Set a file error with an explicit attempt count (preserves cumulative count across retries). */
	setFileErrorWithAttempts(relativePath: string, error: string, attempts: number): void {
		if (!this.isSafeKey(relativePath)) return;
		const errors = this.store.get('fileErrors');
		errors[relativePath] = { error, lastAttempt: new Date().toISOString(), attempts };
		this.store.set('fileErrors', errors);
	}

	clearFileError(relativePath: string): void {
		if (!this.isSafeKey(relativePath)) return;
		const errors = this.store.get('fileErrors');
		delete errors[relativePath];
		this.store.set('fileErrors', errors);
	}

	getAllErrors(): Record<string, FileError> {
		return this.store.get('fileErrors');
	}

	clearAllErrors(): void {
		this.store.set('fileErrors', {});
	}
}
