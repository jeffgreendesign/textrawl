import type { AdvancedIndex } from 'fumadocs-core/search/server';
import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

export const revalidate = false;

/** File name without directory or extension, e.g. `guides/setup.mdx` -> `setup`. */
function fileStem(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}

export const { GET } = createFromSource(source, {
	buildIndex(page) {
		const structuredData =
			'structuredData' in page.data && page.data.structuredData
				? page.data.structuredData
				: { headings: [], contents: [] };

		const index: AdvancedIndex = {
			title: page.data.title ?? fileStem(page.path),
			url: page.url,
			id: page.url,
			structuredData,
		};

		if ('description' in page.data && page.data.description) {
			index.description = String(page.data.description);
		}

		return index;
	},
	search: {
		tolerance: 1,
		boost: {
			content: 1,
		},
	},
});
