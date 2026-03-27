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
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

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
	const pathname = usePathname();

	// Close sidebar on route change
	const [prevPathname, setPrevPathname] = useState(pathname);
	if (pathname !== prevPathname) {
		setPrevPathname(pathname);
		setSidebarOpen(false);
	}

	// Close on Escape key
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setSidebarOpen(false);
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, []);

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

					{/* Search bar */}
					<div
						className="top-bar-search"
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
						<Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
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
	);
}
