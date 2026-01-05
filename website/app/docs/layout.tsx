import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { AuthorBadge } from '@/components/author-badge';

type DocsLayoutProps = {
	children: ReactNode;
};

export default function Layout({ children }: DocsLayoutProps): ReactNode {
	return (
		<DocsLayout
			tree={source.pageTree}
			nav={{
				title: <span className="font-mono font-semibold">textrawl</span>,
				children: <AuthorBadge />,
			}}
			sidebar={{
				banner: (
					<div className="flex items-center gap-2 px-2 py-1.5 text-xs font-mono text-ds-muted">
						<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-ds-accent-subtle text-ds-accent">
							MIT
						</span>
						<span>MCP Server</span>
					</div>
				),
			}}
		>
			{children}
		</DocsLayout>
	);
}
