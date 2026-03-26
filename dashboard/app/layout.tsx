import {
	Bot,
	Brain,
	Clock,
	FileText,
	Home,
	LayoutGrid,
	Lightbulb,
	MessageSquare,
	Search,
	Settings,
	Upload,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
	title: 'Textrawl Command Center',
	description:
		'Your second brain — visual dashboard for knowledge management and agent orchestration',
};

const navItems = [
	{ href: '/', label: 'Dashboard', icon: Home },
	{ href: '/knowledge', label: 'Knowledge', icon: FileText },
	{ href: '/memory', label: 'Memory', icon: Brain },
	{ href: '/conversations', label: 'Conversations', icon: MessageSquare },
	{ href: '/insights', label: 'Insights', icon: Lightbulb },
	{ href: '/timeline', label: 'Timeline', icon: Clock },
	{ href: '/upload', label: 'Upload', icon: Upload },
	{ href: '/agents', label: 'Agents', icon: Bot },
	{ href: '/applets', label: 'Applets', icon: LayoutGrid },
	{ href: '/settings', label: 'Settings', icon: Settings },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className="dark">
			<body>
				<div style={{ display: 'flex', minHeight: '100vh' }}>
					{/* Sidebar */}
					<nav
						style={{
							width: 240,
							backgroundColor: 'var(--bg-secondary)',
							borderRight: '1px solid var(--border-default)',
							padding: '1.5rem 0',
							display: 'flex',
							flexDirection: 'column',
							gap: '0.25rem',
							flexShrink: 0,
						}}
					>
						<div
							style={{
								padding: '0 1.5rem 1.5rem',
								borderBottom: '1px solid var(--border-default)',
								marginBottom: '0.75rem',
							}}
						>
							<h1
								style={{
									fontFamily: 'var(--font-mono)',
									fontSize: '1.125rem',
									fontWeight: 600,
									color: 'var(--text-accent)',
								}}
							>
								textrawl
							</h1>
							<p
								style={{
									fontSize: '0.75rem',
									color: 'var(--text-muted)',
									marginTop: '0.25rem',
								}}
							>
								Command Center
							</p>
						</div>
						{navItems.map((item) => {
							const Icon = item.icon;
							return (
								<Link
									key={item.href}
									href={item.href}
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: '0.75rem',
										padding: '0.625rem 1.5rem',
										fontSize: '0.875rem',
										color: 'var(--text-secondary)',
										textDecoration: 'none',
										transition: 'all 150ms ease',
									}}
								>
									<Icon size={18} />
									{item.label}
								</Link>
							);
						})}
					</nav>

					{/* Main content */}
					<main
						style={{
							flex: 1,
							padding: '2rem',
							overflow: 'auto',
						}}
					>
						{/* Top bar with search */}
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								marginBottom: '2rem',
								paddingBottom: '1rem',
								borderBottom: '1px solid var(--border-default)',
							}}
						>
							<div
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: '0.5rem',
									backgroundColor: 'var(--bg-tertiary)',
									borderRadius: '0.5rem',
									padding: '0.5rem 1rem',
									flex: 1,
									maxWidth: 480,
								}}
							>
								<Search size={16} style={{ color: 'var(--text-muted)' }} />
								<input
									type="text"
									placeholder="Search your knowledge..."
									aria-label="Search your knowledge"
									style={{
										background: 'none',
										border: 'none',
										outline: 'none',
										color: 'var(--text-primary)',
										fontSize: '0.875rem',
										width: '100%',
									}}
								/>
							</div>
						</div>

						{children}
					</main>
				</div>
			</body>
		</html>
	);
}
