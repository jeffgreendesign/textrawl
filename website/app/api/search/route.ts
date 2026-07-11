import type { AdvancedIndex } from 'fumadocs-core/search/server';
import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

export const revalidate = false;

export const { GET } = createFromSource(
	source,
	(page) => {
		const structuredData =
			'structuredData' in page.data && page.data.structuredData
				? page.data.structuredData
				: { headings: [], contents: [] };

		const index: AdvancedIndex = {
			title: page.data.title ?? page.file.name,
			url: page.url,
			id: page.url,
			structuredData,
		};

		if ('description' in page.data && page.data.description) {
			index.description = String(page.data.description);
		}

		return index;
	},
	{
		search: {
			tolerance: 1,
			boost: {
				content: 1,
				keywords: 2,
			},
		},
	},
);
