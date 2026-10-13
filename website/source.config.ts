import { defineConfig, defineDocs } from 'fumadocs-mdx/config';

export const docs = defineDocs({
	dir: '../docs',
	docs: {
		files: ['**/*.mdx'],
	},
});

export default defineConfig({
	mdxOptions: {
		rehypeCodeOptions: {
			themes: {
				light: 'github-light',
				dark: 'github-dark',
			},
		},
	},
});
