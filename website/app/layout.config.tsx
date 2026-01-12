import { AuthorBadge } from '@/components/author-badge';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
	nav: {
		title: <span className="font-mono font-semibold">textrawl</span>,
		children: <AuthorBadge />,
	},
	links: [
		{ text: 'Docs', url: '/docs' },
		{ text: 'GitHub', url: 'https://github.com/jeffgreendesign/textrawl', external: true },
		{ text: 'npm', url: 'https://www.npmjs.com/package/textrawl', external: true },
	],
	githubUrl: 'https://github.com/jeffgreendesign/textrawl',
};
