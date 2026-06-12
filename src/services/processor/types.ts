/**
 * File-handler registry types (plan §8, T5.1).
 *
 * Each {@link FileHandler} declares how to recognise one family of files (by
 * extension + MIME, with an optional binary magic signature) and how to extract
 * its plain text. The registry resolves handlers; the `processor.ts` façade and
 * the ZIP handler drive extraction through them.
 */

export interface FileHandler {
	/**
	 * Stable handler key. Doubles as the per-entry `normalized_type` recorded for
	 * ZIP entries (e.g. `'pdf'`, `'csv'`).
	 */
	readonly key: string;

	/** Lower-case file extensions (no leading dot) this handler claims, e.g. `['txt', 'md']`. */
	readonly extensions: readonly string[];

	/** MIME types this handler claims (declared/normalized content types). */
	readonly mimeTypes: readonly string[];

	/**
	 * MIME types `file-type` may report from this family's magic bytes. Omit for
	 * text-bearing formats with no magic signature (txt/md/csv/json) — those are
	 * validated by the *absence* of a conflicting binary signature instead.
	 */
	readonly magicMimes?: readonly string[];

	/** Extract plain text from the (already buffered) file bytes. */
	extract(buffer: Buffer): Promise<string>;
}
