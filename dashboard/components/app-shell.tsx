'use client';

import {
	Bot,
	Brain,
	Clock,
	FileText,
	Home,
	LayoutGrid,
	Lightbulb,
	Menu,
	MessageSquare,
	Search,
	Settings,
	Upload,
	X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useHealth } from '@/lib/queries';
import CommandPalette from './command-palette';

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

export default function AppShell({ children }: { children: React.ReactNode }) {
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const pathname = usePathname();
	const router = useRouter();
	const { data: health } = useHealth();

	// Close sidebar on route change
	const [prevPathname, setPrevPathname] = useState(pathname);
	if (pathname !== prevPathname) {
		setPrevPathname(pathname);
		setSidebarOpen(false);
	}

	// Close on Escape key + ⌘K palette toggle
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				if (paletteOpen) setPaletteOpen(false);
				else setSidebarOpen(false);
			}
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				setPaletteOpen((prev) => !prev);
			}
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [paletteOpen]);

	// Lock body scroll when sidebar is open on mobile
	useEffect(() => {
		if (sidebarOpen) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	}, [sidebarOpen]);

	const toggleRef = useRef<HTMLButtonElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const didMountRef = useRef(false);

	// Manage focus when sidebar opens/closes (skip initial mount)
	useEffect(() => {
		if (!didMountRef.current) {
			didMountRef.current = true;
			return;
		}
		if (sidebarOpen) {
			closeRef.current?.focus();
		} else {
			toggleRef.current?.focus();
		}
	}, [sidebarOpen]);

	const closeSidebar = useCallback(() => setSidebarOpen(false), []);
	const openSidebar = useCallback(() => setSidebarOpen(true), []);

	return (
		<div style={{ display: 'flex', minHeight: '100dvh' }}>
			{/* Overlay — click to dismiss; keyboard dismissal via document Escape listener */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: overlay dismissed via document-level Escape listener */}
			<div
				className={`sidebar-overlay${sidebarOpen ? ' sidebar-overlay-visible' : ''}`}
				onClick={closeSidebar}
			/>

			{/* Sidebar */}
			<nav
				className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}
				style={{
					backgroundColor: 'var(--bg-secondary)',
					borderRight: '1px solid var(--border-default)',
					display: 'flex',
					flexDirection: 'column',
					gap: '0.25rem',
				}}
			>
				<div
					style={{
						padding: '0 1.5rem 1.5rem',
						borderBottom: '1px solid var(--border-default)',
						marginBottom: '0.75rem',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
					}}
				>
					<div>
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
						{/* biome-ignore lint/a11y/useKeyWithClickEvents: click navigates */}
						<p
							onClick={() => router.push('/agents')}
							style={{
								fontSize: '0.75rem',
								color: 'var(--text-muted)',
								marginTop: '0.25rem',
								display: 'flex',
								alignItems: 'center',
								gap: '0.375rem',
								cursor: 'pointer',
							}}
						>
							<span
								style={{
									width: 8,
									height: 8,
									borderRadius: '50%',
									backgroundColor: health == null ? '#71717a' : health.ok ? '#22c55e' : '#ef4444',
									boxShadow: health?.ok ? '0 0 6px #22c55e' : undefined,
									display: 'inline-block',
									animation:
										health == null
											? 'pulse 1.5s infinite'
											: health.ok
												? 'pulse 2s infinite'
												: undefined,
								}}
							/>
							{health == null ? 'Connecting...' : health.ok ? `${health.latencyMs}ms` : 'Offline'}
						</p>
					</div>
					<button
						ref={closeRef}
						type="button"
						className="sidebar-close"
						onClick={closeSidebar}
						aria-label="Close menu"
						style={{
							background: 'none',
							border: 'none',
							color: 'var(--text-muted)',
							cursor: 'pointer',
							padding: '0.25rem',
						}}
					>
						<X size={20} />
					</button>
				</div>
				{navItems.map((item) => {
					const Icon = item.icon;
					const isActive = pathname === item.href;
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
								color: isActive ? 'var(--text-accent)' : 'var(--text-secondary)',
								textDecoration: 'none',
								transition: 'all 150ms ease',
								backgroundColor: isActive ? 'var(--bg-tertiary)' : 'transparent',
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
				className="main-content"
				style={{
					flex: 1,
					padding: 'var(--main-padding)',
					overflow: 'auto',
				}}
			>
				{/* Top bar — sticky for Safari 26 toolbar tinting */}
				<div
					className="top-bar"
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: '0.75rem',
						marginBottom: '2rem',
						paddingBottom: '1rem',
						borderBottom: '1px solid var(--border-default)',
					}}
				>
					{/* Hamburger (mobile only) */}
					<button
						ref={toggleRef}
						type="button"
						className="sidebar-toggle"
						onClick={openSidebar}
						aria-label="Open menu"
						style={{
							background: 'none',
							border: 'none',
							color: 'var(--text-primary)',
							cursor: 'pointer',
							padding: '0.5rem',
							flexShrink: 0,
						}}
					>
						<Menu size={24} />
					</button>

					{/* Search bar — opens command palette */}
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: click triggers palette */}
					<div
						className="top-bar-search"
						onClick={() => setPaletteOpen(true)}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '0.5rem',
							backgroundColor: 'var(--bg-tertiary)',
							borderRadius: '0.5rem',
							padding: '0.5rem 1rem',
							flex: 1,
							maxWidth: 480,
							cursor: 'pointer',
						}}
					>
						<Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
						<span
							style={{
								color: 'var(--text-muted)',
								fontSize: '0.875rem',
								flex: 1,
							}}
						>
							Search...
						</span>
						<kbd
							style={{
								fontSize: '0.6875rem',
								fontFamily: 'var(--font-mono)',
								color: 'var(--text-muted)',
								backgroundColor: 'var(--bg-secondary)',
								padding: '0.125rem 0.375rem',
								borderRadius: '0.25rem',
								border: '1px solid var(--border-default)',
							}}
						>
							⌘K
						</kbd>
					</div>
				</div>

				{children}
			</main>

			{/* Command Palette */}
			{paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
		</div>
	);
}
