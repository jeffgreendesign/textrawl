/**
 * Settings Store - Persistent app settings using electron-store
 */
import Store from 'electron-store';
import type { AppSettings } from '../../shared/types.js';

// Internal store schema (all required for electron-store)
interface StoreSchema {
  outputDir: string;
  defaultTags: string[];
  autoUpload: boolean;
  supabaseUrl: string;
  supabaseKey: string;
}

const defaults: StoreSchema = {
  outputDir: '',
  defaultTags: [],
  autoUpload: false,
  supabaseUrl: '',
  supabaseKey: '',
};

export class SettingsStore {
  private store: Store<StoreSchema>;

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'textrawl-settings',
      defaults,
      encryptionKey: 'textrawl-desktop-v1',
    });
  }

  /**
   * Get all settings
   */
  get(): AppSettings {
    const supabaseUrl = this.store.get('supabaseUrl');
    const supabaseKey = this.store.get('supabaseKey');

    return {
      outputDir: this.store.get('outputDir'),
      defaultTags: this.store.get('defaultTags'),
      autoUpload: this.store.get('autoUpload'),
      supabaseUrl: supabaseUrl || undefined,
      supabaseKey: supabaseKey || undefined,
    };
  }

  /**
   * Set all settings
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
      this.store.set('supabaseUrl', settings.supabaseUrl);
    }
    if (settings.supabaseKey !== undefined) {
      this.store.set('supabaseKey', settings.supabaseKey);
    }
  }

  /**
   * Reset to defaults
   */
  reset(): void {
    this.store.clear();
  }
}
