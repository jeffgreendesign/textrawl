import Link from 'next/link';
import type { ReactNode } from 'react';

export function AuthorBadge(): ReactNode {
	return (
		<Link
			href="https://hirejeffgreen.com"
			target="_blank"
			rel="noopener noreferrer"
			className="author-badge"
		>
			<span className="author-badge-by">by</span>
			<span className="author-badge-name">Jeff Green</span>
		</Link>
	);
}
