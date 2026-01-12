'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { type ReactNode, useEffect, useState } from 'react';

export function ThemeToggle(): ReactNode {
	const { resolvedTheme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const toggleTheme = (): void => {
		setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
	};

	if (!mounted) {
		return (
			<button type="button" className="theme-toggle" aria-label="Toggle theme">
				<span className="sr-only">Loading theme</span>
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={toggleTheme}
			className="theme-toggle"
			aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
		>
			{resolvedTheme === 'dark' ? (
				<Sun size={18} strokeWidth={1.5} />
			) : (
				<Moon size={18} strokeWidth={1.5} />
			)}
		</button>
	);
}
