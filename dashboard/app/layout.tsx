import type { Metadata, Viewport } from 'next';
import AppShell from '../components/app-shell';
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
	return (
		<html lang="en" className="dark">
			<body>
				<AppShell>{children}</AppShell>
			</body>
		</html>
	);
}
