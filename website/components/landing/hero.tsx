import { AuthorBadge } from '@/components/author-badge';
import { OSSBadge } from '@/components/oss-badge';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function Hero(): ReactNode {
	return (
		<section className="hero" data-mode="editorial">
			<OSSBadge />
			<h1 className="hero-title">textrawl</h1>
			<p className="hero-subtitle">
				Personal knowledge base for AI. Crawl your documents, search with meaning.
			</p>
			<div className="hero-meta">
				<code className="hero-install">npx textrawl init</code>
				<AuthorBadge />
			</div>
			<div className="hero-actions">
				<Link href="/docs/getting-started/quick-start" className="btn-primary">
					Get Started
				</Link>
				<Link href="/docs/mcp-tools" className="btn-secondary">
					MCP Tools →
				</Link>
			</div>
		</section>
	);
}
