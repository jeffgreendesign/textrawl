/**
 * Manifest tracking for uploaded files
 *
 * Tracks which files have been uploaded to avoid duplicates
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Entry in the upload manifest
 */
export interface ManifestEntry {
  /** SHA256 hash of the source content */
  sourceHash: string;
  /** Supabase document ID */
  documentId: string;
  /** When the document was uploaded */
  uploadedAt: string;
  /** Relative path to the markdown file */
  markdownPath: string;
  /** Number of chunks created */
  chunksCreated?: number;
}

/**
 * Manifest structure
 */
export interface Manifest {
  version: 1;
  /** Map of sourceHash -> ManifestEntry */
  entries: Record<string, ManifestEntry>;
  /** Last updated timestamp */
  updatedAt: string;
}

/**
 * Manifest manager for tracking uploaded files
 */
export class ManifestManager {
  private manifest: Manifest;
  private path: string;
  private dirty: boolean = false;

  constructor(outputDir: string) {
    this.path = join(outputDir, '.manifest.json');
    this.manifest = this.load();
  }

  /**
   * Load manifest from disk or create new one
   */
  private load(): Manifest {
    if (existsSync(this.path)) {
      try {
        const content = readFileSync(this.path, 'utf-8');
        const parsed = JSON.parse(content);

        // Validate version
        if (parsed.version !== 1) {
          console.error(`[WARN] Unknown manifest version ${parsed.version}, creating new manifest`);
          return this.createEmpty();
        }

        return parsed as Manifest;
      } catch (error) {
        console.error(`[WARN] Failed to parse manifest, creating new one: ${error}`);
        return this.createEmpty();
      }
    }

    return this.createEmpty();
  }

  /**
   * Create an empty manifest
   */
  private createEmpty(): Manifest {
    return {
      version: 1,
      entries: {},
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Save manifest to disk
   */
  save(): void {
    if (!this.dirty) {
      return;
    }

    this.manifest.updatedAt = new Date().toISOString();
    writeFileSync(this.path, JSON.stringify(this.manifest, null, 2));
    this.dirty = false;
  }

  /**
   * Check if a file has been uploaded (by source hash)
   */
  isUploaded(sourceHash: string): boolean {
    return sourceHash in this.manifest.entries;
  }

  /**
   * Get entry by source hash
   */
  getEntry(sourceHash: string): ManifestEntry | undefined {
    return this.manifest.entries[sourceHash];
  }

  /**
   * Record a successful upload
   */
  recordUpload(entry: ManifestEntry): void {
    this.manifest.entries[entry.sourceHash] = entry;
    this.dirty = true;
  }

  /**
   * Remove an entry
   */
  removeEntry(sourceHash: string): void {
    if (sourceHash in this.manifest.entries) {
      delete this.manifest.entries[sourceHash];
      this.dirty = true;
    }
  }

  /**
   * Get all entries
   */
  getAllEntries(): ManifestEntry[] {
    return Object.values(this.manifest.entries);
  }

  /**
   * Get count of uploaded files
   */
  getCount(): number {
    return Object.keys(this.manifest.entries).length;
  }

  /**
   * Find entry by markdown path
   */
  findByPath(markdownPath: string): ManifestEntry | undefined {
    return Object.values(this.manifest.entries).find(
      (entry) => entry.markdownPath === markdownPath
    );
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.manifest.entries = {};
    this.dirty = true;
  }

  /**
   * Get manifest stats
   */
  getStats(): { totalFiles: number; totalChunks: number; lastUpdated: string } {
    const entries = Object.values(this.manifest.entries);
    const totalChunks = entries.reduce(
      (sum, entry) => sum + (entry.chunksCreated || 0),
      0
    );

    return {
      totalFiles: entries.length,
      totalChunks,
      lastUpdated: this.manifest.updatedAt,
    };
  }
}
