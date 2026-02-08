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
}

interface ProjectStoreSchema {
	lastProject: { sourceDir: string; outputDir: string } | null;
	fileErrors: Record<string, FileError>;
}

const defaults: ProjectStoreSchema = {
	lastProject: null,
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
	}

	clearLastProject(): void {
		this.store.set('lastProject', null);
	}

	// --- File errors ---

	getFileError(relativePath: string): FileError | undefined {
		const errors = this.store.get('fileErrors');
		return errors[relativePath];
	}

	setFileError(relativePath: string, error: string): void {
		const errors = this.store.get('fileErrors');
		errors[relativePath] = { error, lastAttempt: new Date().toISOString() };
		this.store.set('fileErrors', errors);
	}

	clearFileError(relativePath: string): void {
		const errors = this.store.get('fileErrors');
		delete errors[relativePath];
		this.store.set('fileErrors', errors);
	}

	clearAllErrors(): void {
		this.store.set('fileErrors', {});
	}
}
