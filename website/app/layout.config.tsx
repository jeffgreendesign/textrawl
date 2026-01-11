import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
	nav: {
		title: <span className="font-mono font-bold">textrawl</span>,
	},
	links: [
		{
			text: 'Docs',
			url: '/docs',
			active: 'nested-url',
		},
		{
			text: 'Playground',
			url: '/playground',
		},
		{
			text: 'GitHub',
			url: 'https://github.com/jeffgreendesign/textrawl',
			external: true,
		},
		{
			text: 'npm',
			url: 'https://www.npmjs.com/package/textrawl',
			external: true,
		},
	],
	githubUrl: 'https://github.com/jeffgreendesign/textrawl',
};
