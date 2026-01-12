import { Features } from '@/components/landing/features';
import { Hero } from '@/components/landing/hero';
import { MCPShowcase } from '@/components/landing/mcp-showcase';
import { QuickStart } from '@/components/landing/quick-start';
import { MakerNote } from '@/components/maker-note';
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function LandingPage(): ReactNode {
	return (
		<main>
			<Hero />
			<Features />
			<MCPShowcase />
			<QuickStart />
			<WhyIBuiltThis />
			<Footer />
		</main>
	);
}

function WhyIBuiltThis(): ReactNode {
	return (
		<MakerNote>
			<p className="maker-note-text">
				I kept losing context. Notes in one app, bookmarks in another, PDFs scattered across
				folders. When I needed to find something, <strong>search always failed me.</strong>
			</p>
			<p className="maker-note-text">
				Textrawl started as a personal knowledge base—a way to crawl my own documents and make them
				searchable with <em>semantic understanding</em>, not just keyword matching.
			</p>
			<p className="maker-note-text">
				Now it's an MCP server that gives AI assistants access to your knowledge. Your second brain,
				available in every conversation.
			</p>
		</MakerNote>
	);
}

function Footer(): ReactNode {
	return (
		<footer className="footer-attribution">
			<span>Built by</span>
			<Link href="https://hirejeffgreen.com" target="_blank" rel="noopener noreferrer">
				<span className="name">Jeff Green</span>
			</Link>
			<span>·</span>
			<Link
				href="https://github.com/jeffgreendesign/textrawl"
				target="_blank"
				rel="noopener noreferrer"
			>
				GitHub
			</Link>
		</footer>
	);
}
