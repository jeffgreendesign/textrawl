import type { Metadata, Viewport } from 'next';
import AppShell from '../components/app-shell';
import { Providers } from '../lib/providers';
import './globals.css';

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	maximumScale: 5,
	viewportFit: 'cover',
};

export const metadata: Metadata = {
	title: 'Textrawl Command Center',
	description:
		'Your second brain — visual dashboard for knowledge management and agent orchestration',
	appleWebApp: {
		capable: true,
		statusBarStyle: 'black-translucent',
		title: 'textrawl',
	},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	// suppressHydrationWarning on <html>/<body>: the static `dark` class plus browser
	// extensions that mutate these elements before hydration otherwise trip React #418.
	return (
		<html lang="en" className="dark" suppressHydrationWarning>
			<body suppressHydrationWarning>
				<Providers>
					<AppShell>{children}</AppShell>
				</Providers>
			</body>
		</html>
	);
}
