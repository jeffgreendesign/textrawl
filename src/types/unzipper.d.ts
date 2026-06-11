declare module 'unzipper' {
	/** One entry in a ZIP central directory (the subset the ZIP handler reads). */
	interface ZipFile {
		/** Entry path as stored in the archive. */
		path: string;
		/** `File` for regular entries, `Directory` for directory markers. */
		type: 'File' | 'Directory';
		/** Uncompressed size in bytes (read from the central directory). */
		uncompressedSize: number;
		/** Compressed size in bytes. */
		compressedSize: number;
		/** ZIP compression method (0 = stored, 8 = deflate, …). */
		compressionMethod: number;
		/** External file attributes; high 16 bits carry the Unix mode (symlink detection). */
		externalFileAttributes: number;
		/** Decompress this entry into a Buffer. */
		buffer(): Promise<Buffer>;
	}

	interface CentralDirectory {
		files: ZipFile[];
	}

	const Open: {
		buffer(buffer: Buffer): Promise<CentralDirectory>;
	};

	export { Open };
	export type { CentralDirectory, ZipFile };
}
