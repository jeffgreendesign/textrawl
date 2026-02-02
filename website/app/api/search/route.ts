import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

export const revalidate = false;

export const { GET } = createFromSource(source, undefined, {
	search: {
		tolerance: 1,
		boost: {
			content: 1,
			keywords: 2,
		},
	},
});
