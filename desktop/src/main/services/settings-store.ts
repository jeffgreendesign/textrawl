/**
 * Settings Store - Persistent app settings with OS keychain encryption
 *
 * Sensitive values (Supabase credentials) are encrypted via Electron's safeStorage API,
 * which delegates to the OS keychain (macOS Keychain, Windows DPAPI, Linux libsecret).
 * Non-sensitive values are stored as plaintext in electron-store.
 *
 * IMPORTANT: Must be constructed and init()'d after app.whenReady() resolves,
 * because safeStorage requires the app to be ready before encryption is available.
 *
 * @example
 * ```ts
 * app.whenReady().then(() => {
 *   const store = new SettingsStore();
 *   store.init(); // Runs legacy migration
 * });
 * ```
 */
import { safeStorage } from 'electron';
import Store from 'electron-store';
import type { AppSettings } from '../../shared/types.js';
import { logger } from '../utils/logger.js';

// Internal store schema — sensitive fields stored as safeStorage-encrypted base64
interface StoreSchema {
	outputDir: string;
	defaultTags: string[];
	autoUpload: boolean;
	_supabaseUrl: string; // safeStorage-encrypted base64
	_supabaseKey: string; // safeStorage-encrypted base64
}

const defaults: StoreSchema = {
	outputDir: '',
	defaultTags: [],
	autoUpload: false,
	_supabaseUrl: '',
	_supabaseKey: '',
};

export class SettingsStore {
	private store: Store<StoreSchema>;
	private hasWarnedPlaintext = false;

	constructor() {
		this.store = new Store<StoreSchema>({
			name: 'textrawl-settings',
			defaults,
		});
	}

	/**
	 * Initialize after app.whenReady() — migrates legacy credentials to safeStorage.
	 * Must be called before get()/set() to ensure migration has run.
	 */
	init(): void {
		this.migrateFromLegacy();
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
	 * Migrate credentials from legacy obfuscated storage to safeStorage.
	 * The old store used encryptionKey: 'textrawl-desktop-v1' with field names
	 * 'supabaseUrl' and 'supabaseKey'. The new store uses safeStorage-encrypted
	 * '_supabaseUrl' and '_supabaseKey' fields without an encryptionKey.
	 */
	private migrateFromLegacy(): void {
		try {
			const oldStore = new Store({
				name: 'textrawl-settings',
				encryptionKey: 'textrawl-desktop-v1',
			});
			const oldUrl = oldStore.get('supabaseUrl') as string | undefined;
			const oldKey = oldStore.get('supabaseKey') as string | undefined;

			if (oldUrl || oldKey) {
				if (oldUrl) this.store.set('_supabaseUrl', this.encrypt(oldUrl));
				if (oldKey) this.store.set('_supabaseKey', this.encrypt(oldKey));
				// Delete legacy fields
				oldStore.delete('supabaseUrl' as never);
				oldStore.delete('supabaseKey' as never);
				logger.info('[settings] Migrated credentials to safeStorage');
			}
		} catch (err) {
			logger.error('[settings] Legacy migration failed (may be clean install):', err);
		}
	}

	/**
	 * Get all settings. Sensitive fields are decrypted transparently.
	 */
	get(): AppSettings {
		const supabaseUrl = this.decrypt(this.store.get('_supabaseUrl'));
		const supabaseKey = this.decrypt(this.store.get('_supabaseKey'));

		return {
			outputDir: this.store.get('outputDir'),
			defaultTags: this.store.get('defaultTags'),
			autoUpload: this.store.get('autoUpload'),
			supabaseUrl: supabaseUrl || undefined,
			supabaseKey: supabaseKey || undefined,
		};
	}

	/**
	 * Set settings. Sensitive fields are encrypted before storage.
	 */
	set(settings: Partial<AppSettings>): void {
		if (settings.outputDir !== undefined) {
			this.store.set('outputDir', settings.outputDir);
		}
		if (settings.defaultTags !== undefined) {
			this.store.set('defaultTags', settings.defaultTags);
		}
		if (settings.autoUpload !== undefined) {
			this.store.set('autoUpload', settings.autoUpload);
		}
		if (settings.supabaseUrl !== undefined) {
			this.store.set('_supabaseUrl', this.encrypt(settings.supabaseUrl));
		}
		if (settings.supabaseKey !== undefined) {
			this.store.set('_supabaseKey', this.encrypt(settings.supabaseKey));
		}
	}

	/**
	 * Reset to defaults
	 */
	reset(): void {
		this.store.clear();
	}
}
