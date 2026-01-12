import './globals.css';
import { RootProvider } from 'fumadocs-ui/provider';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
	title: {
		template: '%s | textrawl',
		default: 'textrawl - Personal Knowledge Base for AI',
	},
	description:
		'Crawl your documents, create embeddings, and search with semantic understanding. MCP server for Claude and other AI assistants.',
	metadataBase: new URL('https://textrawl.com'),
	icons: {
		icon: [
			{ url: '/favicon.ico', sizes: '32x32' },
			{ url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
			{ url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
		],
		apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
		other: [
			{ rel: 'manifest', url: '/site.webmanifest' },
		],
	},
};

type RootLayoutProps = {
	children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps): ReactNode {
	return (
		<html
			lang="en"
			className="dark"
			data-theme="midnight"
			data-mode="technical"
			suppressHydrationWarning
		>
			<body className="flex min-h-screen flex-col bg-ds-primary text-ds-primary font-sans antialiased">
				<RootProvider
					theme={{
						enabled: true,
						defaultTheme: 'dark',
						attribute: 'class',
					}}
				>
					{children}
				</RootProvider>
			</body>
		</html>
	);
}
