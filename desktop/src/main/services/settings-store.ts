/**
 * Settings Store - Persistent app settings with OS keychain encryption
 *
 * Sensitive values (Neon connection string, embedding API keys) are encrypted via
 * Electron's safeStorage API, which delegates to the OS keychain (macOS Keychain,
 * Windows DPAPI, Linux libsecret). Non-sensitive values are stored as plaintext in
 * electron-store.
 *
 * IMPORTANT: Must be constructed and init()'d after app.whenReady() resolves,
 * because safeStorage requires the app to be ready before encryption is available.
 *
 * @example
 * ```ts
 * app.whenReady().then(() => {
 *   const store = new SettingsStore();
 *   store.init(); // Removes dead Supabase-era credentials
 * });
 * ```
 */
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import Store from 'electron-store';
import type { AppSettings, EmbeddingProvider } from '../../shared/types.js';
import { logger } from '../utils/logger.js';

// Internal store schema — sensitive fields stored as safeStorage-encrypted base64
interface StoreSchema {
	outputDir: string;
	defaultTags: string[];
	autoUpload: boolean;
	verboseLogging: boolean;
	embeddingProvider: EmbeddingProvider;
	ollamaBaseUrl: string;
	_databaseUrl: string; // safeStorage-encrypted base64 (Neon DATABASE_URL)
	_openaiApiKey: string; // safeStorage-encrypted base64
	_googleApiKey: string; // safeStorage-encrypted base64
}

const defaults: StoreSchema = {
	outputDir: '',
	defaultTags: [],
	autoUpload: false,
	verboseLogging: false,
	embeddingProvider: 'openai',
	ollamaBaseUrl: '',
	_databaseUrl: '',
	_openaiApiKey: '',
	_googleApiKey: '',
};

export class SettingsStore {
	private store: Store<StoreSchema>;
	private hasWarnedPlaintext = false;

	constructor() {
		try {
			this.store = new Store<StoreSchema>({
				name: 'textrawl-settings',
				defaults,
			});
		} catch {
			// Config file corrupted (e.g. leftover encrypted data from legacy format)
			// Delete it and retry with fresh defaults
			const configPath = join(app.getPath('userData'), 'textrawl-settings.json');
			logger.error(`[settings] Config corrupted, resetting: ${configPath}`);
			try {
				unlinkSync(configPath);
			} catch {
				// file may already be gone
			}
			this.store = new Store<StoreSchema>({
				name: 'textrawl-settings',
				defaults,
			});
		}
	}

	/**
	 * Initialize after app.whenReady() — removes dead Supabase-era credentials.
	 * Must be called before get()/set().
	 */
	init(): void {
		this.cleanupLegacySupabase();
	}

	/**
	 * Encrypt a string using safeStorage (OS keychain).
	 * Falls back to plaintext if safeStorage is not available.
	 */
	private encrypt(value: string): string {
		if (!value) return '';
		if (!safeStorage.isEncryptionAvailable()) {
			if (!this.hasWarnedPlaintext) {
				this.hasWarnedPlaintext = true;
				logger.error('[settings] safeStorage not available, storing in plaintext');
			}
			return value;
		}
		return safeStorage.encryptString(value).toString('base64');
	}

	/**
	 * Decrypt a safeStorage-encrypted base64 string.
	 * Falls back to returning the raw value if decryption fails
	 * (handles pre-migration plaintext or missing keychain).
	 */
	private decrypt(stored: string): string {
		if (!stored) return '';
		if (!safeStorage.isEncryptionAvailable()) {
			return stored;
		}
		try {
			return safeStorage.decryptString(Buffer.from(stored, 'base64'));
		} catch (err) {
			// Might be plaintext from pre-migration — return as-is
			logger.debug('[settings] Decryption failed, returning raw value:', err);
			return stored;
		}
	}

	/**
	 * Remove dead Supabase credentials left by older versions. The project moved off
	 * Supabase to Neon Postgres, so these values are no longer usable by the upload CLI.
	 * Only operates on the live store (this.store) — it must NOT open a second Store with
	 * an encryptionKey on the same file, which would rewrite textrawl-settings in the
	 * legacy encrypted format and corrupt the active settings.
	 */
	private cleanupLegacySupabase(): void {
		try {
			// safeStorage-encrypted fields from the intermediate version, plus any
			// plaintext legacy fields that may linger in the same file.
			this.store.delete('_supabaseUrl' as never);
			this.store.delete('_supabaseKey' as never);
			this.store.delete('supabaseUrl' as never);
			this.store.delete('supabaseKey' as never);
		} catch (err) {
			logger.debug('[settings] Supabase field cleanup skipped:', err);
		}
	}

	/**
	 * Get all settings. Sensitive fields are decrypted transparently.
	 */
	get(): AppSettings {
		logger.debug('[settings] Loading settings');
		const databaseUrl = this.decrypt(this.store.get('_databaseUrl'));
		const openaiApiKey = this.decrypt(this.store.get('_openaiApiKey'));
		const googleApiKey = this.decrypt(this.store.get('_googleApiKey'));

		return {
			outputDir: this.store.get('outputDir'),
			defaultTags: this.store.get('defaultTags'),
			autoUpload: this.store.get('autoUpload'),
			verboseLogging: this.store.get('verboseLogging'),
			embeddingProvider: this.store.get('embeddingProvider'),
			databaseUrl: databaseUrl || undefined,
			openaiApiKey: openaiApiKey || undefined,
			googleApiKey: googleApiKey || undefined,
			ollamaBaseUrl: this.store.get('ollamaBaseUrl') || undefined,
		};
	}

	/**
	 * Set settings. Sensitive fields are encrypted before storage.
	 */
	set(settings: Partial<AppSettings>): void {
		logger.debug(`[settings] Saving settings: ${Object.keys(settings).join(', ')}`);
		if (settings.outputDir !== undefined) {
			this.store.set('outputDir', settings.outputDir);
		}
		if (settings.defaultTags !== undefined) {
			this.store.set('defaultTags', settings.defaultTags);
		}
		if (settings.autoUpload !== undefined) {
			this.store.set('autoUpload', settings.autoUpload);
		}
		if (settings.verboseLogging !== undefined) {
			this.store.set('verboseLogging', settings.verboseLogging);
		}
		if (settings.embeddingProvider !== undefined) {
			this.store.set('embeddingProvider', settings.embeddingProvider);
		}
		if (settings.ollamaBaseUrl !== undefined) {
			this.store.set('ollamaBaseUrl', settings.ollamaBaseUrl);
		}
		if (settings.databaseUrl !== undefined) {
			this.store.set('_databaseUrl', this.encrypt(settings.databaseUrl));
		}
		if (settings.openaiApiKey !== undefined) {
			this.store.set('_openaiApiKey', this.encrypt(settings.openaiApiKey));
		}
		if (settings.googleApiKey !== undefined) {
			this.store.set('_googleApiKey', this.encrypt(settings.googleApiKey));
		}
	}

	/**
	 * Reset to defaults
	 */
	reset(): void {
		this.store.clear();
	}
}
