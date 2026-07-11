import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { baseOptions } from '@/app/layout.config';
import { source } from '@/lib/source';

type DocsLayoutProps = {
	children: ReactNode;
};

export default function Layout({ children }: DocsLayoutProps): ReactNode {
	return (
		<DocsLayout
			{...baseOptions}
			tree={source.pageTree}
			sidebar={{
				banner: (
					<div className="flex items-center gap-2 px-2 py-1.5 text-xs font-mono text-ds-muted">
						<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-ds-accent-subtle text-ds-accent">
							MIT
						</span>
						<span>Knowledge Base</span>
					</div>
				),
			}}
		>
			{children}
		</DocsLayout>
	);
}
